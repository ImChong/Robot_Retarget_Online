/**
 * Physical-plausibility metrics for a retargeted legged motion, after the
 * reference-quality measures in X-Morph (arXiv:2606.30290, Table 1: foot slip,
 * penetration, contact height / floating, joint acceleration) and the
 * smoothness term of the retargeting objective (velocity / acceleration / jerk).
 * Everything is measured on the robot's own forward kinematics, so two
 * retargeting methods can be compared on the same clip without trusting either
 * one's targets.
 */

import type { RobotModel } from '../mujoco/runtime';

export interface LegMotionQuality {
  /** Mean horizontal foot speed while the foot is on the ground (cm/s). */
  footSlip: number;
  /** 95th-percentile (over all foot-frames) / max depth of a foot below the ground (cm). */
  penetrationP95: number;
  penetrationMax: number;
  /** RMS joint velocity / acceleration / jerk over leg DoFs (rad/s, rad/s², rad/s³). */
  jointVelRms: number;
  jointAccRms: number;
  jointJerkRms: number;
  /** Largest single-frame joint change (rad) — knee flips show up here. */
  maxJointStep: number;
  /** Frames in which some joint moves more than `spikeRad` in one step. */
  spikeFrames: number;
  /** Mean / max trunk tilt from vertical (deg). */
  tiltMean: number;
  tiltMax: number;
  /** RMS rate of change of the trunk's up axis (deg/s): roll / pitch wobble, turning excluded. */
  tiltRateRms: number;
}

export interface LegMotionQualityOptions {
  /** Height of a foot body when it rests on the ground (sphere radius), metres. */
  contactHeight: number;
  /** A foot counts as on the ground below contactHeight + this (m). */
  contactTolerance?: number;
  /** Joint step (rad) that counts as a spike. */
  spikeRad?: number;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/**
 * @param qpos  layout [frame][nq] (free joint first, as RetargetResult stores it)
 * @param footBodies robot foot body ids
 */
export function measureLegMotion(
  robot: RobotModel,
  qpos: Float64Array,
  fps: number,
  footBodies: number[],
  rootBody: number,
  options: LegMotionQualityOptions,
): LegMotionQuality {
  const { mujoco, model, data } = robot;
  const nq = robot.nq;
  const T = Math.floor(qpos.length / nq);
  const dt = 1 / fps;
  const tol = options.contactTolerance ?? 0.01;
  const spikeRad = options.spikeRad ?? 0.25;
  const xpos = data.xpos as Float64Array;
  const xquat = data.xquat as Float64Array;
  const q = data.qpos as Float64Array;

  const feet: number[][] = []; // [frame][foot*3]
  const tilt: number[] = [];
  const ups: number[][] = [];
  for (let f = 0; f < T; f++) {
    q.set(qpos.subarray(f * nq, (f + 1) * nq));
    mujoco.mj_kinematics(model, data);
    feet.push(footBodies.flatMap((b) => [xpos[b * 3], xpos[b * 3 + 1], xpos[b * 3 + 2]]));
    const b4 = rootBody * 4;
    const [w, x, y, z] = [xquat[b4], xquat[b4 + 1], xquat[b4 + 2], xquat[b4 + 3]];
    // Body z axis in world: third column of R(q).
    const up = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
    ups.push(up);
    tilt.push((Math.acos(Math.max(-1, Math.min(1, up[2]))) * 180) / Math.PI);
  }

  let slipSum = 0;
  let slipN = 0;
  const depths: number[] = [];
  for (let f = 0; f < T; f++) {
    for (let k = 0; k < footBodies.length; k++) {
      const z = feet[f][k * 3 + 2];
      depths.push(Math.max(0, options.contactHeight - z));
      if (f > 0 && z < options.contactHeight + tol) {
        const dx = feet[f][k * 3] - feet[f - 1][k * 3];
        const dy = feet[f][k * 3 + 1] - feet[f - 1][k * 3 + 1];
        slipSum += Math.hypot(dx, dy) / dt;
        slipN++;
      }
    }
  }

  // Leg DoFs = everything after the free joint.
  const dofs = nq - 7;
  let v2 = 0;
  let a2 = 0;
  let j2 = 0;
  let nv = 0;
  let na = 0;
  let nj = 0;
  let maxStep = 0;
  let spikes = 0;
  const at = (f: number, i: number) => qpos[f * nq + 7 + i];
  for (let f = 1; f < T; f++) {
    let spiked = false;
    for (let i = 0; i < dofs; i++) {
      const step = Math.abs(at(f, i) - at(f - 1, i));
      if (step > maxStep) maxStep = step;
      if (step > spikeRad) spiked = true;
      const v = (at(f, i) - at(f - 1, i)) / dt;
      v2 += v * v;
      nv++;
      if (f >= 2) {
        const a = (at(f, i) - 2 * at(f - 1, i) + at(f - 2, i)) / (dt * dt);
        a2 += a * a;
        na++;
      }
      if (f >= 3) {
        const j = (at(f, i) - 3 * at(f - 1, i) + 3 * at(f - 2, i) - at(f - 3, i)) / (dt * dt * dt);
        j2 += j * j;
        nj++;
      }
    }
    if (spiked) spikes++;
  }

  let w2 = 0;
  for (let f = 1; f < T; f++) {
    const a = ups[f - 1];
    const b = ups[f];
    const angle = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    w2 += (angle / dt) ** 2;
  }

  return {
    footSlip: slipN ? (slipSum / slipN) * 100 : 0,
    penetrationP95: percentile(depths, 0.95) * 100,
    penetrationMax: Math.max(0, ...depths) * 100,
    jointVelRms: Math.sqrt(v2 / Math.max(1, nv)),
    jointAccRms: Math.sqrt(a2 / Math.max(1, na)),
    jointJerkRms: Math.sqrt(j2 / Math.max(1, nj)),
    maxJointStep: maxStep,
    spikeFrames: spikes,
    tiltMean: tilt.reduce((s, x) => s + x, 0) / Math.max(1, T),
    tiltMax: Math.max(...tilt),
    tiltRateRms: (Math.sqrt(w2 / Math.max(1, T - 1)) * 180) / Math.PI,
  };
}
