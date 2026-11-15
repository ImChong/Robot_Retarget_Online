import { quatNormalize, type Quat } from '../math3d';
import type { RetargetResult } from '../retarget/types';
import { detectMotionAnomalies, detectOutlierFrames1D, groupTrueSpans } from './detect';
import { buildWindowTapGetter, interpolateGap1D, smoothSeries1D } from './filters';
import {
  canonicalizeQuatSequence,
  isQuatFinite,
  quatDot,
  quatGeodesicAngle,
  quatNorm,
  quatSlerp,
  smoothQuatOneEuroSO3,
  smoothQuatSequenceSO3,
} from './quaternion';
import {
  DEFAULT_DETECTION_THRESHOLDS,
  type JointLimitInfo,
  type PostProcessConfig,
  type PostProcessOperationsSummary,
  type PostProcessOutput,
  type TrajectoryDelta,
} from './types';

export const DEFAULT_POSTPROCESS_CONFIG: PostProcessConfig = {
  thresholds: { ...DEFAULT_DETECTION_THRESHOLDS },
  quatCanonicalize: true,
  outlierRepair: {
    enabled: true,
    maxRepairSpan: DEFAULT_DETECTION_THRESHOLDS.maxRepairSpan,
    repairJoints: true,
    repairRootPos: true,
    repairRootRot: true,
  },
  smoothing: {
    enabled: true,
    method: 'savgol',
    windowSize: 7,
    polyOrder: 2,
    gaussianSigma: 1.5,
    oneEuroMinCutoff: 1.5,
    oneEuroBeta: 0.05,
    smoothJoints: true,
    smoothRootPos: true,
    smoothRootRot: true,
  },
  constraints: {
    enforceJointLimits: true,
    enforceVelocityLimit: false,
    maxJointVelocityRadS: 20.0,
  },
};

export function clonePostProcessConfig(cfg: PostProcessConfig): PostProcessConfig {
  return {
    thresholds: { ...cfg.thresholds },
    quatCanonicalize: cfg.quatCanonicalize,
    outlierRepair: { ...cfg.outlierRepair },
    smoothing: { ...cfg.smoothing },
    constraints: { ...cfg.constraints },
  };
}

export function createRawPassthroughConfig(base?: PostProcessConfig): PostProcessConfig {
  const cfg = clonePostProcessConfig(base ?? DEFAULT_POSTPROCESS_CONFIG);
  cfg.quatCanonicalize = false;
  cfg.outlierRepair.enabled = false;
  cfg.smoothing.enabled = false;
  cfg.constraints.enforceJointLimits = false;
  cfg.constraints.enforceVelocityLimit = false;
  return cfg;
}

function repairSeries1D(
  col: Float64Array,
  halfWin: number,
  nSigma: number,
  minSpike: number,
  maxRepairSpan: number,
): { repairedCells: number; skippedSpans: number } {
  const T = col.length;
  const nanBad = new Array<boolean>(T).fill(false);
  for (let f = 0; f < T; f++) {
    if (!Number.isFinite(col[f])) nanBad[f] = true;
  }
  const spikeBad = detectOutlierFrames1D(col, halfWin, nSigma, minSpike);
  const bad = new Array<boolean>(T);
  for (let f = 0; f < T; f++) bad[f] = nanBad[f] || spikeBad[f];

  const isBad = (idx: number) => bad[idx];
  let repairedCells = 0;
  let skippedSpans = 0;

  for (const [s, e] of groupTrueSpans(bad)) {
    const span = e - s + 1;
    if (span > maxRepairSpan) {
      skippedSpans++;
      continue;
    }
    if (interpolateGap1D(col, s, e, isBad)) {
      repairedCells += span;
    } else {
      skippedSpans++;
    }
  }
  return { repairedCells, skippedSpans };
}

function computeTrajectoryDelta(raw: RetargetResult, processed: RetargetResult): TrajectoryDelta {
  const { frameCount: T, nq } = raw;
  const nDof = Math.max(0, nq - 7);

  let dofSumSq = 0;
  let dofCount = 0;
  let dofMaxDiffRad = 0;

  let posSumSq = 0;
  let posCount = 0;
  let posMaxDiffM = 0;

  let rotSumSqDeg = 0;
  let rotCount = 0;
  let rotMaxDiffDeg = 0;

  for (let f = 0; f < T; f++) {
    const b = f * nq;
    const rx = raw.qpos[b];
    const ry = raw.qpos[b + 1];
    const rz = raw.qpos[b + 2];
    const px = processed.qpos[b];
    const py = processed.qpos[b + 1];
    const pz = processed.qpos[b + 2];
    if (
      Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) &&
      Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)
    ) {
      const d = Math.hypot(px - rx, py - ry, pz - rz);
      posSumSq += d * d;
      posCount++;
      if (d > posMaxDiffM) posMaxDiffM = d;
    }

    const rq: Quat = [raw.qpos[b + 3], raw.qpos[b + 4], raw.qpos[b + 5], raw.qpos[b + 6]];
    const pq: Quat = [processed.qpos[b + 3], processed.qpos[b + 4], processed.qpos[b + 5], processed.qpos[b + 6]];
    if (isQuatFinite(rq) && isQuatFinite(pq) && quatNorm(rq) > 1e-8 && quatNorm(pq) > 1e-8) {
      const deg = (quatGeodesicAngle(rq, pq) * 180) / Math.PI;
      rotSumSqDeg += deg * deg;
      rotCount++;
      if (deg > rotMaxDiffDeg) rotMaxDiffDeg = deg;
    }

    for (let d = 0; d < nDof; d++) {
      const rv = raw.qpos[b + 7 + d];
      const pv = processed.qpos[b + 7 + d];
      if (Number.isFinite(rv) && Number.isFinite(pv)) {
        const diff = Math.abs(pv - rv);
        dofSumSq += diff * diff;
        dofCount++;
        if (diff > dofMaxDiffRad) dofMaxDiffRad = diff;
      }
    }
  }

  return {
    dofRmsDiffRad: Math.sqrt(dofSumSq / Math.max(1, dofCount)),
    dofMaxDiffRad,
    rootPosRmsDiffM: Math.sqrt(posSumSq / Math.max(1, posCount)),
    rootPosMaxDiffM: posMaxDiffM,
    rootRotRmsDiffDeg: Math.sqrt(rotSumSqDeg / Math.max(1, rotCount)),
    rootRotMaxDiffDeg: rotMaxDiffDeg,
  };
}

/**
 * Pure, non-mutating post-processing pipeline. Always reads `rawResult` and
 * returns a fresh `processedResult` (no in-place mutation, no cumulative filtering).
 */
export function runPostProcess(
  rawResult: RetargetResult,
  config: PostProcessConfig,
  jointLimits: readonly JointLimitInfo[] = [],
): PostProcessOutput {
  const th = { ...config.thresholds, maxRepairSpan: config.outlierRepair.maxRepairSpan };
  const rawDetection = detectMotionAnomalies(rawResult, jointLimits, th);

  const T = rawResult.frameCount;
  const nq = rawResult.nq;
  const nDof = Math.max(0, nq - 7);
  const fps = Number.isFinite(rawResult.fps) && rawResult.fps > 0 ? rawResult.fps : 30;
  const dt = 1 / fps;

  // Fresh deep copy of qpos; rawResult is never touched.
  const outQpos = new Float64Array(rawResult.qpos);
  const operations: PostProcessOperationsSummary = {
    quatNormalizedFrames: 0,
    quatSignFlippedFrames: 0,
    repairedJointCells: 0,
    repairedRootPosFrames: 0,
    repairedRootRotFrames: 0,
    skippedUnrepairableSpans: 0,
    smoothingApplied: false,
    smoothingMethod: 'none',
    clampedLimitCells: 0,
    largeLimitWarnings: 0,
    velocityClampedCells: 0,
  };

  if (T > 0 && nq >= 7 && outQpos.length >= T * nq) {
    // Extract root quats
    let quats: Quat[] = new Array(T);
    for (let f = 0; f < T; f++) {
      const b = f * nq;
      quats[f] = [outQpos[b + 3], outQpos[b + 4], outQpos[b + 5], outQpos[b + 6]];
    }

    // Stage 0: Quaternion normalization & hemisphere alignment
    if (config.quatCanonicalize) {
      const canon = canonicalizeQuatSequence(quats);
      quats = canon.quats;
      operations.quatNormalizedFrames = canon.normFixedCount;
      operations.quatSignFlippedFrames = canon.signFlippedCount;
    }

    // Stage 1: Outlier / spike repair
    if (config.outlierRepair.enabled) {
      const maxSpan = Math.max(1, Math.floor(config.outlierRepair.maxRepairSpan));

      if (config.outlierRepair.repairRootPos) {
        const px = new Float64Array(T);
        const py = new Float64Array(T);
        const pz = new Float64Array(T);
        for (let f = 0; f < T; f++) {
          const b = f * nq;
          px[f] = outQpos[b];
          py[f] = outQpos[b + 1];
          pz[f] = outQpos[b + 2];
        }
        const rx = repairSeries1D(px, th.hampelWindowHalf, th.hampelSigma, th.rootPosSpikeM, maxSpan);
        const ry = repairSeries1D(py, th.hampelWindowHalf, th.hampelSigma, th.rootPosSpikeM, maxSpan);
        const rz = repairSeries1D(pz, th.hampelWindowHalf, th.hampelSigma, th.rootPosSpikeM, maxSpan);
        operations.skippedUnrepairableSpans += rx.skippedSpans + ry.skippedSpans + rz.skippedSpans;
        for (let f = 0; f < T; f++) {
          const b = f * nq;
          const changed = px[f] !== outQpos[b] || py[f] !== outQpos[b + 1] || pz[f] !== outQpos[b + 2];
          if (changed) operations.repairedRootPosFrames++;
          outQpos[b] = px[f];
          outQpos[b + 1] = py[f];
          outQpos[b + 2] = pz[f];
        }
      }

      if (config.outlierRepair.repairRootRot) {
        const badRot = new Array<boolean>(T).fill(false);
        for (let f = 0; f < T; f++) {
          if (!isQuatFinite(quats[f]) || quatNorm(quats[f]) < 1e-8) {
            badRot[f] = true;
          }
        }
        for (let f = 1; f < T - 1; f++) {
          if (badRot[f] || badRot[f - 1] || badRot[f + 1]) continue;
          const mid = quatSlerp(quats[f - 1], quats[f + 1], 0.5);
          const geoErr = quatGeodesicAngle(quats[f], mid);
          const neighborSpan = quatGeodesicAngle(quats[f - 1], quats[f + 1]);
          if (geoErr > th.rootRotSpikeRad && geoErr > neighborSpan * 0.75) {
            badRot[f] = true;
          }
        }
        for (const [s, e] of groupTrueSpans(badRot)) {
          const span = e - s + 1;
          if (span > maxSpan) {
            operations.skippedUnrepairableSpans++;
            continue;
          }
          let left = s - 1;
          while (left >= 0 && badRot[left]) left--;
          let right = e + 1;
          while (right < T && badRot[right]) right++;
          if (left < 0 && right >= T) {
            operations.skippedUnrepairableSpans++;
            continue;
          }
          for (let f = s; f <= e; f++) {
            if (left >= 0 && right < T) {
              quats[f] = quatSlerp(quats[left], quats[right], (f - left) / (right - left));
            } else if (left >= 0) {
              quats[f] = quatNormalize(quats[left]);
            } else {
              quats[f] = quatNormalize(quats[right]);
            }
            if (f > 0 && isQuatFinite(quats[f - 1]) && quatDot(quats[f - 1], quats[f]) < 0) {
              quats[f] = [-quats[f][0], -quats[f][1], -quats[f][2], -quats[f][3]];
            }
            operations.repairedRootRotFrames++;
          }
        }
      }

      if (config.outlierRepair.repairJoints) {
        const col = new Float64Array(T);
        for (let d = 0; d < nDof; d++) {
          for (let f = 0; f < T; f++) col[f] = outQpos[f * nq + 7 + d];
          const res = repairSeries1D(col, th.hampelWindowHalf, th.hampelSigma, th.minJointSpikeRad, maxSpan);
          operations.repairedJointCells += res.repairedCells;
          operations.skippedUnrepairableSpans += res.skippedSpans;
          for (let f = 0; f < T; f++) outQpos[f * nq + 7 + d] = col[f];
        }
      }
    }

    // Stage 2: Temporal smoothing
    if (config.smoothing.enabled) {
      const sm = config.smoothing;
      const smOpts = {
        windowSize: sm.windowSize,
        polyOrder: sm.polyOrder,
        gaussianSigma: sm.gaussianSigma,
        oneEuroMinCutoff: sm.oneEuroMinCutoff,
        oneEuroBeta: sm.oneEuroBeta,
      };
      let anySmooth = false;

      if (sm.smoothRootPos) {
        anySmooth = true;
        for (let axis = 0; axis < 3; axis++) {
          const col = new Float64Array(T);
          for (let f = 0; f < T; f++) col[f] = outQpos[f * nq + axis];
          const filtered = smoothSeries1D(col, fps, sm.method, smOpts);
          for (let f = 0; f < T; f++) outQpos[f * nq + axis] = filtered[f];
        }
      }

      if (sm.smoothRootRot) {
        anySmooth = true;
        if (sm.method === 'one_euro') {
          quats = smoothQuatOneEuroSO3(quats, fps, sm.oneEuroMinCutoff, sm.oneEuroBeta);
        } else {
          const getTaps = buildWindowTapGetter(sm.method, sm.windowSize, sm.polyOrder, sm.gaussianSigma);
          quats = smoothQuatSequenceSO3(quats, getTaps);
        }
      }

      if (sm.smoothJoints) {
        anySmooth = true;
        const col = new Float64Array(T);
        for (let d = 0; d < nDof; d++) {
          for (let f = 0; f < T; f++) col[f] = outQpos[f * nq + 7 + d];
          const filtered = smoothSeries1D(col, fps, sm.method, smOpts);
          for (let f = 0; f < T; f++) outQpos[f * nq + 7 + d] = filtered[f];
        }
      }

      operations.smoothingApplied = anySmooth;
      operations.smoothingMethod = anySmooth ? sm.method : 'none';
    }

    // Write canonicalized/repaired/smoothed quats back into outQpos
    for (let f = 0; f < T; f++) {
      const b = f * nq;
      outQpos[b + 3] = quats[f][0];
      outQpos[b + 4] = quats[f][1];
      outQpos[b + 5] = quats[f][2];
      outQpos[b + 6] = quats[f][3];
    }

    // Stage 3: Joint constraint enforcement (with audit counts — never silent!)
    const limitByDof = new Map<number, JointLimitInfo>();
    for (const lim of jointLimits) limitByDof.set(lim.dofIndex, lim);

    if (config.constraints.enforceVelocityLimit && config.constraints.maxJointVelocityRadS > 0) {
      const maxStep = config.constraints.maxJointVelocityRadS * dt;
      for (let d = 0; d < nDof; d++) {
        for (let f = 1; f < T; f++) {
          const idxPrev = (f - 1) * nq + 7 + d;
          const idxCur = f * nq + 7 + d;
          const prev = outQpos[idxPrev];
          const cur = outQpos[idxCur];
          if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue;
          const delta = cur - prev;
          if (Math.abs(delta) > maxStep) {
            outQpos[idxCur] = prev + Math.sign(delta) * maxStep;
            operations.velocityClampedCells++;
          }
        }
      }
    }

    if (config.constraints.enforceJointLimits) {
      for (let d = 0; d < nDof; d++) {
        const lim = limitByDof.get(d);
        if (!lim?.limited) continue;
        for (let f = 0; f < T; f++) {
          const idx = f * nq + 7 + d;
          const v = outQpos[idx];
          if (!Number.isFinite(v)) continue;
          if (v < lim.min) {
            if (lim.min - v > th.softLimitMarginRad) operations.largeLimitWarnings++;
            outQpos[idx] = lim.min;
            operations.clampedLimitCells++;
          } else if (v > lim.max) {
            if (v - lim.max > th.softLimitMarginRad) operations.largeLimitWarnings++;
            outQpos[idx] = lim.max;
            operations.clampedLimitCells++;
          }
        }
      }
    }
  }

  const processedResult: RetargetResult = {
    robotId: rawResult.robotId,
    engine: rawResult.engine,
    fps: rawResult.fps,
    frameCount: rawResult.frameCount,
    nq: rawResult.nq,
    qpos: outQpos,
    dofNames: [...rawResult.dofNames],
    taskNames: [...rawResult.taskNames],
    taskHumanBodies: [...rawResult.taskHumanBodies],
    posErrors: new Float32Array(rawResult.posErrors),
    scaledHuman: new Float32Array(rawResult.scaledHuman),
    humanBodyNames: [...rawResult.humanBodyNames],
    elapsedMs: rawResult.elapsedMs,
  };

  const processedDetection = detectMotionAnomalies(processedResult, jointLimits, th);
  const delta = computeTrajectoryDelta(rawResult, processedResult);

  return {
    rawDetection,
    processedDetection,
    processedResult,
    metricsBefore: rawDetection.metrics,
    metricsAfter: processedDetection.metrics,
    delta,
    operations,
    jointLimits: [...jointLimits],
  };
}
