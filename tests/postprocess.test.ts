import { describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { unzipSync } from 'fflate';
import { quatFromAxisAngle, quatNormalize, type Quat } from '@/lib/math3d';
import type { RetargetHistoryEntry, RetargetResult } from '@/lib/retarget/types';
import {
  clonePostProcessConfig,
  DEFAULT_POSTPROCESS_CONFIG,
  detectMotionAnomalies,
  exportPostProcessReportJson,
  extractJointLimits,
  quatGeodesicAngle,
  runPostProcess,
  smoothQuatOneEuroSO3,
  smoothQuatSequenceSO3,
  buildWindowTapGetter,
  type JointLimitInfo,
} from '@/lib/postprocess';
import { exportCsv, exportJson, exportNpz } from '@/lib/export/motion';
import { usePostProcessStore } from '@/stores/postprocess';
import { entryById, loadRobotFromDisk } from './robots/_utils';

async function loadRobotWithDofNames(id: string) {
  const robot = await loadRobotFromDisk(entryById(id));
  const { mujoco, model } = robot;
  const jntType = model.jnt_type as Int32Array;
  const jointNames: string[] = [];
  const dofJointNames: string[] = [];
  for (let j = 0; j < model.njnt; j++) {
    const name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT.value, j) ?? `joint_${j}`;
    jointNames.push(name);
    if (jntType[j] === 2 || jntType[j] === 3) dofJointNames.push(name);
  }
  robot.jointNames = jointNames;
  robot.dofJointNames = dofJointNames;
  return robot;
}

function makeSyntheticResult(frameCount = 120, nDof = 4, fps = 30): RetargetResult {
  const nq = 7 + nDof;
  const qpos = new Float64Array(frameCount * nq);
  const dofNames = Array.from({ length: nDof }, (_, i) => `joint_${i}`);
  for (let f = 0; f < frameCount; f++) {
    const t = f / fps;
    const b = f * nq;
    qpos[b] = 0.8 * t; // smooth forward walk
    qpos[b + 1] = 0.05 * Math.sin(2 * Math.PI * 0.5 * t);
    qpos[b + 2] = 0.78 + 0.02 * Math.sin(2 * Math.PI * 2 * t);
    const yaw = 0.3 * Math.sin(0.5 * t);
    const q = quatFromAxisAngle([0, 0, 1], yaw);
    qpos[b + 3] = q[0];
    qpos[b + 4] = q[1];
    qpos[b + 5] = q[2];
    qpos[b + 6] = q[3];
    for (let d = 0; d < nDof; d++) {
      // Smooth fast sinusoidal joint motion (~6-8 rad/s peak)
      qpos[b + 7 + d] = 0.6 * Math.sin(2 * Math.PI * 1.5 * t + d * 0.5);
    }
  }
  return {
    robotId: 'test_robot',
    engine: 'gmr',
    fps,
    frameCount,
    nq,
    qpos,
    dofNames,
    taskNames: ['pelvis'],
    taskHumanBodies: ['Hips'],
    posErrors: new Float32Array(frameCount),
    scaledHuman: new Float32Array(0),
    humanBodyNames: [],
    elapsedMs: 12,
  };
}

function makeHistoryEntry(id: string, result: RetargetResult): RetargetHistoryEntry {
  return {
    id,
    bvhName: `${id}.bvh`,
    robotId: result.robotId,
    robotLabel: `${result.robotId}.xml`,
    engine: result.engine,
    createdAt: Date.UTC(2026, 10, 15, 10, 0, 0),
    result,
  };
}

function decodeNpyHeaderAndData(bytes: Uint8Array): { shape: number[]; values: Float64Array } {
  const headerLen = bytes[8] | (bytes[9] << 8);
  const header = new TextDecoder().decode(bytes.subarray(10, 10 + headerLen));
  const shapeMatch = header.match(/'shape':\s*\(([^)]*)\)/)!;
  const shape = shapeMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const data = bytes.subarray(10 + headerLen);
  const values = new Float64Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return { shape, values };
}

describe('postprocess detection and repair', () => {
  it('does not flag smooth fast motion as anomalous', () => {
    const res = makeSyntheticResult(120, 4, 30);
    // Boost amplitude to create fast (~11 rad/s) but completely smooth motion
    for (let f = 0; f < res.frameCount; f++) {
      res.qpos[f * res.nq + 7] = 1.2 * Math.sin(2 * Math.PI * 1.5 * (f / res.fps));
    }
    const report = detectMotionAnomalies(res);
    expect(report.metrics.totalIssues).toBe(0);
    expect(report.metrics.spikeCount).toBe(0);
    expect(report.metrics.jitterIssueCount).toBe(0);
  });

  it('detects and repairs isolated NaN/Inf and single-frame spikes without mutating raw data', () => {
    const res = makeSyntheticResult(100, 3, 30);
    // Inject isolated NaN, Inf, joint spike, root pos spike, and root rot spike
    res.qpos[20 * res.nq + 7] = Number.NaN;
    res.qpos[40 * res.nq + 8] = Number.POSITIVE_INFINITY;
    res.qpos[60 * res.nq + 7] += 1.4; // single-frame joint spike
    res.qpos[50 * res.nq + 2] += 0.6; // root z spike
    const qBad = quatFromAxisAngle([1, 0, 0], 1.8);
    res.qpos[70 * res.nq + 3] = qBad[0];
    res.qpos[70 * res.nq + 4] = qBad[1];
    res.qpos[70 * res.nq + 5] = qBad[2];
    res.qpos[70 * res.nq + 6] = qBad[3];

    const rawSnapshot = new Float64Array(res.qpos);
    const out = runPostProcess(res, DEFAULT_POSTPROCESS_CONFIG);

    // Raw bytes/values strictly preserved (NaN === NaN checked via Object.is)
    expect(res.qpos.length).toBe(rawSnapshot.length);
    for (let i = 0; i < rawSnapshot.length; i++) {
      expect(Object.is(res.qpos[i], rawSnapshot[i])).toBe(true);
    }

    expect(out.metricsBefore.nanInfCount).toBe(2);
    expect(out.metricsBefore.spikeCount).toBeGreaterThanOrEqual(3);
    expect(out.metricsAfter.nanInfCount).toBe(0);
    expect(out.metricsAfter.spikeCount).toBe(0);
    expect(out.metricsAfter.totalIssues).toBeLessThan(out.metricsBefore.totalIssues);
    expect(out.processedResult.frameCount).toBe(res.frameCount);
    expect(out.processedResult.fps).toBe(res.fps);
    expect(out.processedResult.dofNames).toEqual(res.dofNames);
    expect(Number.isFinite(out.processedResult.qpos[20 * res.nq + 7])).toBe(true);
    expect(Number.isFinite(out.processedResult.qpos[40 * res.nq + 8])).toBe(true);
    expect(out.operations.repairedJointCells).toBeGreaterThanOrEqual(3);
    expect(out.operations.repairedRootPosFrames).toBeGreaterThanOrEqual(1);
    expect(out.operations.repairedRootRotFrames).toBeGreaterThanOrEqual(1);
  });

  it('flags long NaN/discontinuity spans as unrepairable and refuses blind interpolation', () => {
    const res = makeSyntheticResult(80, 2, 30);
    // Inject a 7-frame NaN gap (> maxRepairSpan=4)
    for (let f = 30; f <= 36; f++) {
      res.qpos[f * res.nq + 7] = Number.NaN;
    }
    const out = runPostProcess(res, DEFAULT_POSTPROCESS_CONFIG);
    const unrep = out.rawDetection.anomalies.filter((a) => a.repairability === 'unrepairable');
    expect(unrep.length).toBeGreaterThanOrEqual(1);
    expect(out.operations.skippedUnrepairableSpans).toBeGreaterThanOrEqual(1);
    expect(Number.isNaN(out.processedResult.qpos[33 * res.nq + 7])).toBe(true);
    expect(out.metricsAfter.unrepairableCount).toBeGreaterThanOrEqual(1);
  });

  it('detects continuous high-frequency jitter and reduces acceleration/jerk after smoothing', () => {
    const res = makeSyntheticResult(120, 2, 30);
    for (let f = 30; f <= 60; f++) {
      res.qpos[f * res.nq + 7] += (f % 2 === 0 ? 1 : -1) * 0.08;
    }
    const out = runPostProcess(res, DEFAULT_POSTPROCESS_CONFIG);
    expect(out.metricsBefore.jitterIssueCount).toBeGreaterThanOrEqual(1);
    expect(out.metricsAfter.jitterIssueCount).toBe(0);
    expect(out.metricsAfter.rmsJointAccRadS2).toBeLessThan(out.metricsBefore.rmsJointAccRadS2 * 0.6);
    expect(out.metricsAfter.rmsJointJerkRadS3).toBeLessThan(out.metricsBefore.rmsJointJerkRadS3 * 0.5);
  });

  it('handles quaternion antipodal sign flips and SO(3) smoothing without false spikes or zero-crossings', () => {
    const res = makeSyntheticResult(60, 2, 30);
    // Flip sign q -> -q on frames 15..25 and add slight rotation jitter
    const rawQuats: Quat[] = [];
    for (let f = 0; f < 60; f++) {
      const b = f * res.nq;
      let q: Quat = [res.qpos[b + 3], res.qpos[b + 4], res.qpos[b + 5], res.qpos[b + 6]];
      if (f >= 15 && f <= 25) q = [-q[0], -q[1], -q[2], -q[3]];
      res.qpos[b + 3] = q[0];
      res.qpos[b + 4] = q[1];
      res.qpos[b + 5] = q[2];
      res.qpos[b + 6] = q[3];
      rawQuats.push(q);
    }

    const report = detectMotionAnomalies(res);
    // Sign flips are reported as info, NOT as root_rot_spike or excessive_velocity!
    expect(report.metrics.quatFlipCount).toBeGreaterThanOrEqual(1);
    expect(report.anomalies.filter((a) => a.type === 'root_rot_spike')).toHaveLength(0);
    expect(report.anomalies.filter((a) => a.type === 'excessive_velocity')).toHaveLength(0);

    // SO(3) smoothers produce exact unit quaternions with no dip near zero across sign flip
    const taps = buildWindowTapGetter('savgol', 7, 2, 1.5);
    const smoothedSG = smoothQuatSequenceSO3(rawQuats, taps);
    const smoothedOE = smoothQuatOneEuroSO3(rawQuats, 30, 1.5, 0.05);
    for (let f = 0; f < 60; f++) {
      const nSG = Math.hypot(...smoothedSG[f]);
      const nOE = Math.hypot(...smoothedOE[f]);
      expect(nSG).toBeCloseTo(1, 8);
      expect(nOE).toBeCloseTo(1, 8);
      expect(quatGeodesicAngle(smoothedSG[f], quatNormalize(rawQuats[f]))).toBeLessThan(0.05);
    }
  });

  it('detects and repairs 2-frame burst spikes on top of fast smooth sinusoidal motion', () => {
    const res = makeSyntheticResult(100, 2, 30);
    for (let f = 0; f < res.frameCount; f++) {
      res.qpos[f * res.nq + 7] = 1.2 * Math.sin(2 * Math.PI * 1.5 * (f / res.fps));
    }
    res.qpos[45 * res.nq + 7] += 1.1;
    res.qpos[46 * res.nq + 7] += 1.1;
    const out = runPostProcess(res, DEFAULT_POSTPROCESS_CONFIG);
    expect(out.metricsBefore.spikeCount).toBeGreaterThanOrEqual(1);
    expect(out.metricsAfter.spikeCount).toBe(0);
    expect(out.operations.repairedJointCells).toBeGreaterThanOrEqual(2);
  });

  it('detects joint limit violations, records clamped cells, and exposes real MuJoCo limits', async () => {
    const robot = await loadRobotWithDofNames('unitree_g1');
    const limits: JointLimitInfo[] = extractJointLimits(robot);
    expect(limits.length).toBe(robot.dofJointNames.length);
    const limitedJoint = limits.find((l) => l.limited)!;
    expect(limitedJoint).toBeDefined();

    const res = makeSyntheticResult(50, robot.dofJointNames.length, 30);
    res.dofNames = [...robot.dofJointNames];
    const mid = 0.5 * (limitedJoint.min + limitedJoint.max);
    for (let f = 0; f < 50; f++) {
      for (const l of limits) {
        res.qpos[f * res.nq + 7 + l.dofIndex] = l.limited ? 0.5 * (l.min + l.max) : 0;
      }
      res.qpos[f * res.nq + 7 + limitedJoint.dofIndex] = mid;
    }
    // Inject a sustained large limit violation (frames 20..25)
    for (let f = 20; f <= 25; f++) {
      res.qpos[f * res.nq + 7 + limitedJoint.dofIndex] = limitedJoint.max + 0.3;
    }

    const out = runPostProcess(res, DEFAULT_POSTPROCESS_CONFIG, limits);
    const rawLimitAnoms = out.rawDetection.anomalies.filter((a) => a.type === 'joint_limit');
    expect(rawLimitAnoms.length).toBeGreaterThanOrEqual(1);
    expect(rawLimitAnoms[0].repairability).toBe('confirm');
    expect(out.operations.clampedLimitCells).toBeGreaterThanOrEqual(1);
    expect(out.metricsAfter.limitViolationCount).toBe(0);
  });

  it('is idempotent (no cumulative filtering) and isolates sessions by historyId', () => {
    setActivePinia(createPinia());
    const pp = usePostProcessStore();

    const resA = makeSyntheticResult(60, 3, 30);
    resA.qpos[25 * resA.nq + 7] += 1.0;
    const resB = makeSyntheticResult(60, 3, 30);
    resB.qpos[10 * resB.nq + 8] = Number.NaN;

    const entryA = makeHistoryEntry('hist_a', resA);
    const entryB = makeHistoryEntry('hist_b', resB);

    pp.ensureSession(entryA);
    pp.ensureSession(entryB);

    // Change A's config multiple times, then switch to B, then back to A, then undo
    pp.updateConfig(entryA, (c) => {
      c.smoothing.windowSize = 11;
      c.smoothing.method = 'gaussian';
    });
    const afterGaussian = new Float64Array(pp.getSession('hist_a')!.output.processedResult.qpos);

    // Re-running with same config directly produces bit-identical output (no double filtering)
    const directCfg = clonePostProcessConfig(pp.getSession('hist_a')!.config);
    const directOut = runPostProcess(resA, directCfg);
    expect(afterGaussian).toEqual(directOut.processedResult.qpos);

    // Entry B remains at default config untouched
    expect(pp.getSession('hist_b')!.config.smoothing.method).toBe('savgol');
    expect(pp.getSession('hist_b')!.output.metricsAfter.nanInfCount).toBe(0);

    // Undo restores A's original savgol config
    pp.undo(entryA);
    expect(pp.getSession('hist_a')!.config.smoothing.method).toBe('savgol');

    // Reset to raw returns raw values untouched
    pp.resetToRaw(entryA);
    expect(pp.getSession('hist_a')!.output.processedResult.qpos).toEqual(resA.qpos);
  });

  it('exports valid NPZ / CSV / JSON / Post-process Report compatible with existing readers', async () => {
    const res = makeSyntheticResult(40, 3, 30);
    res.qpos[15 * res.nq + 7] += 1.2;
    const entry = makeHistoryEntry('export_test', res);
    const out = runPostProcess(res, DEFAULT_POSTPROCESS_CONFIG);

    // NPZ
    const npzBlob = exportNpz(out.processedResult);
    const files = unzipSync(new Uint8Array(await npzBlob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['dof_pos.npy', 'fps.npy', 'root_pos.npy', 'root_rot.npy']);
    const fps = decodeNpyHeaderAndData(files['fps.npy']);
    expect(fps.values[0]).toBe(30);
    const dof = decodeNpyHeaderAndData(files['dof_pos.npy']);
    expect(dof.shape).toEqual([40, 3]);

    // CSV
    const csvText = await exportCsv(out.processedResult).text();
    const lines = csvText.trim().split('\n');
    expect(lines.length).toBe(41);
    expect(lines[0]).toContain('root_px,root_py,root_pz,root_qx,root_qy,root_qz,root_qw');

    // JSON
    const jsonObj = JSON.parse(await exportJson(out.processedResult).text());
    expect(jsonObj.format).toBe('gmr_robot_motion');
    expect(jsonObj.frame_count).toBe(40);
    expect(jsonObj.dof_names).toEqual(res.dofNames);

    // Report JSON
    const reportObj = JSON.parse(
      await exportPostProcessReportJson(entry, DEFAULT_POSTPROCESS_CONFIG, out).text(),
    );
    expect(reportObj.format).toBe('rro_postprocess_report_v1');
    expect(reportObj.metrics_before.spikeCount).toBeGreaterThanOrEqual(1);
    expect(reportObj.metrics_after.spikeCount).toBe(0);
    expect(Array.isArray(reportObj.anomalies_raw)).toBe(true);
  });
});
