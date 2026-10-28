/**
 * Contact-aware target planning for animal → quadruped retargeting.
 *
 * The plain keypoint mapping (robot base ← dog pelvis bone, feet scaled about
 * the pelvis) copies everything wrong with raw mocap onto the robot: the
 * pelvis bone jitters at ~150°/s even when the dog stands still, feet sink up
 * to 5 cm into the floor, and planted paws slide at 70–90 cm/s. This module
 * rebuilds the per-frame IK targets from the whole clip before solving:
 *
 * 1. **Trunk frame from positions** (Peng et al., *Learning Agile Robotic
 *    Locomotion Skills by Imitating Animals*, motion_imitation
 *    `retarget_root_pose`): base at the centre of the four leg roots, heading
 *    from hips → shoulders, lateral axis from shoulders and hips with its roll
 *    removed and the clip's mean pitch levelled. Keypoints are low-passed
 *    (zero-phase) first; bone rotations are not used.
 * 2. **Hip-relative feet** (same source, `retarget_pose`): each foot target is
 *    the robot's own hip plus the animal's hip → paw offset, so differences in
 *    trunk length between animal and robot do not stretch the legs; each leg's
 *    stride is centred under the robot hip.
 * 3. **Contact phases + foot locking** (the spatial stage of STMR, T-RO 2025;
 *    the slip / penetration / floating metrics X-Morph's corrector reduces): a
 *    paw that is low and slow is planted. A planted foot is held still on the
 *    ground for the whole phase; the correction is eased in and out over the
 *    swing so nothing jumps, no target goes below the ground, and a swinging
 *    foot keeps a minimum arc above it instead of scuffing along.
 *
 * The solve itself (runner.ts) adds a pull toward the robot's rest keyframe
 * and toward the previous frame (`QUADRUPED_REGULARIZATION`).
 */

import { quatFromMat3, vCross, vNorm, vScale, vSub, type Vec3 } from '../math3d';
import type { HumanFrame, HumanFrameBody } from '../bvh/lafan1';
import type { RobotModel } from '../mujoco/runtime';
import type { GmrIkConfig } from './types';

/** Which source joints play pelvis / shoulders / hips (Lifelike-Agility dog skeleton). */
export interface QuadrupedSkeleton {
  /** The ik_config's human root; the planned trunk target is stored under it. */
  pelvis: string;
  leftShoulder: string;
  rightShoulder: string;
  leftHip: string;
  rightHip: string;
  /** Paw joint (as the ik_config names it) → the joint where that leg meets the trunk. */
  footHips: Record<string, string>;
  /**
   * Paw joint → the joint that actually touches the ground, when it differs
   * (the dog's front "hand" is the wrist, which rides 4–7 cm up even in stance).
   */
  contactJoints: Record<string, string>;
}

export const DOG_SKELETON: QuadrupedSkeleton = {
  pelvis: 'b_Hips',
  leftShoulder: 'b_LeftArm',
  rightShoulder: 'b_RightArm',
  leftHip: 'b_LeftLegUpper',
  rightHip: 'b_RightLegUpper',
  footHips: {
    b_LeftHand: 'b_LeftArm',
    b_RightHand: 'b_RightArm',
    b_LeftToe: 'b_LeftLegUpper',
    b_RightToe: 'b_RightLegUpper',
  },
  contactJoints: {
    b_LeftHand: 'b__LeftFinger',
    b_RightHand: 'b_RightFinger',
  },
};

export interface QuadrupedPlanOptions {
  /** Zero-phase Gaussian low-pass of the source keypoints, in frames (σ). */
  smoothSigma: number;
  /** A paw is planted below this height above its own ground level (m, source scale)… */
  contactHeight: number;
  /** …while slower than this horizontally (m/s, source scale). */
  contactSpeed: number;
  /** Frames over which a locking correction is eased in / out. */
  blendFrames: number;
  /**
   * Minimum swing apex (m, source scale): a swinging paw follows at least a
   * half-sine arc of this height between plants, so it never scuffs along the floor.
   */
  swingClearance: number;
}

export const DEFAULT_QUADRUPED_PLAN: QuadrupedPlanOptions = {
  smoothSigma: 1.5,
  contactHeight: 0.05,
  contactSpeed: 0.6,
  blendFrames: 6,
  swingClearance: 0.06,
};

/**
 * Joint-space regularization used with planned targets (diagonal weights next
 * to ~10²–10³ from the 60-weight foot tasks): a gentle pull toward the rest
 * keyframe and a stronger one toward the previous frame.
 */
export const QUADRUPED_REGULARIZATION = { posture: 2, smooth: 20 };

/** The model's first keyframe (e.g. Menagerie's `home` crouch), if it has one. */
export function restKeyframe(robot: RobotModel): Float64Array | null {
  const { model } = robot;
  if (!model.nkey) return null;
  return new Float64Array((model.key_qpos as Float64Array).subarray(0, robot.nq));
}

export interface QuadrupedPlan {
  /** Per-frame IK targets keyed by the config's human body names. */
  targets: Map<string, HumanFrameBody>[];
  /** Per-paw planted flags, keyed by source paw joint. */
  contacts: Map<string, boolean[]>;
  /** Height of the robot's foot bodies when they touch the ground (m). */
  footContactHeight: number;
}

interface LegBinding {
  paw: string;
  hip: string;
  /** Point under the robot hip where the foot sits with the leg straight, in the root frame. */
  anchor: Vec3;
}

const GEOM_SPHERE = 2;

function gaussianSmooth(series: Vec3[], sigma: number): Vec3[] {
  if (sigma <= 0) return series.map((v) => [...v] as Vec3);
  const radius = Math.ceil(3 * sigma);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const T = series.length;
  return series.map((_, t) => {
    const acc: Vec3 = [0, 0, 0];
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const s = t + k;
      if (s < 0 || s >= T) continue; // truncated window at the clip ends (no edge reflection)
      const w = kernel[k + radius];
      acc[0] += w * series[s][0];
      acc[1] += w * series[s][1];
      acc[2] += w * series[s][2];
      wsum += w;
    }
    return [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum];
  });
}

const normalize = (v: Vec3): Vec3 => vScale(v, 1 / (vNorm(v) || 1));

/** Body frame à la motion_imitation: x forward (pitch kept), y left (roll removed), z up. */
function trunkFrame(rear: Vec3, front: Vec3, ls: Vec3, rs: Vec3, lh: Vec3, rh: Vec3): [Vec3, Vec3, Vec3] {
  const forward = normalize(vSub(front, rear));
  const left = normalize([
    0.5 * (normalize(vSub(ls, rs))[0] + normalize(vSub(lh, rh))[0]),
    0.5 * (normalize(vSub(ls, rs))[1] + normalize(vSub(lh, rh))[1]),
    0,
  ]);
  const f = normalize(vSub(forward, vScale(left, forward[0] * left[0] + forward[1] * left[1])));
  const up = normalize(vCross(f, left));
  return [f, left, up];
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/** Planted flags with tiny phases removed and tiny gaps filled. */
function contactPhases(low: boolean[], minLen: number): boolean[] {
  const out = [...low];
  const runs = (value: boolean) => {
    let t = 0;
    while (t < out.length) {
      if (out[t] !== value) { t++; continue; }
      let e = t;
      while (e < out.length && out[e] === value) e++;
      const interior = t > 0 && e < out.length;
      if (e - t < minLen && (value || interior)) for (let i = t; i < e; i++) out[i] = !value;
      t = e;
    }
  };
  runs(false); // fill short gaps inside contact
  runs(true); // drop short contacts
  return out;
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** Minimum height above the floor per frame: 0 when planted, a half-sine arc over each swing. */
function swingFloor(planted: boolean[], apex: number): number[] {
  const T = planted.length;
  const out = new Array<number>(T).fill(0);
  let t = 0;
  while (t < T) {
    if (planted[t]) { t++; continue; }
    let e = t;
    while (e < T && !planted[e]) e++;
    // Clip edges count as boundaries; the arc spans [t-1, e] so it starts and ends on the floor.
    const a = t - 1;
    const len = e - a;
    for (let i = t; i < e; i++) out[i] = apex * Math.sin((Math.PI * (i - a)) / len);
    t = e;
  }
  return out;
}

/**
 * Foot-locking correction per frame: constant inside each planted phase
 * (the paw is held where it was on average), eased between phases.
 */
function lockCorrections(raw: Vec3[], planted: boolean[], groundZ: number, blend: number): Vec3[] {
  const T = raw.length;
  const corr: (Vec3 | null)[] = new Array(T).fill(null);
  let t = 0;
  while (t < T) {
    if (!planted[t]) { t++; continue; }
    let e = t;
    while (e < T && planted[e]) e++;
    const mean: Vec3 = [0, 0, 0];
    for (let i = t; i < e; i++) { mean[0] += raw[i][0]; mean[1] += raw[i][1]; }
    mean[0] /= e - t;
    mean[1] /= e - t;
    for (let i = t; i < e; i++) corr[i] = [mean[0] - raw[i][0], mean[1] - raw[i][1], groundZ - raw[i][2]];
    t = e;
  }
  // Swing frames: ease from the last planted correction to the next one; a swing
  // longer than 2·blend frames passes through zero correction in the middle.
  const out: Vec3[] = new Array(T);
  for (let i = 0; i < T; i++) {
    if (corr[i]) {
      out[i] = corr[i]!;
      continue;
    }
    let a = i - 1;
    while (a >= 0 && !corr[a]) a--;
    let b = i + 1;
    while (b < T && !corr[b]) b++;
    const ca = a >= 0 ? corr[a]! : null;
    const cb = b < T ? corr[b]! : null;
    const wa = ca ? 1 - smoothstep(Math.min(1, (i - a) / blend)) : 0;
    const wb = cb ? 1 - smoothstep(Math.min(1, (b - i) / blend)) : 0;
    const v: Vec3 = [0, 0, 0];
    if (ca && cb && i - a + (b - i) <= 2 * blend) {
      const s = smoothstep((i - a) / (b - a));
      for (let k = 0; k < 3; k++) v[k] = ca[k] * (1 - s) + cb[k] * s;
    } else {
      for (let k = 0; k < 3; k++) v[k] = (ca ? ca[k] * wa : 0) + (cb ? cb[k] * wb : 0);
    }
    out[i] = v;
  }
  return out;
}

/** Height of a robot foot body above the floor when its foot touches it. */
function footContactHeight(robot: RobotModel, footBody: number): number {
  const { model } = robot;
  const parent = (model.body_parentid as Int32Array)[footBody];
  const bodyPos = (model.body_pos as Float64Array).subarray(footBody * 3, footBody * 3 + 3);
  const geomBody = model.geom_bodyid as Int32Array;
  const geomType = model.geom_type as Int32Array;
  const geomPos = model.geom_pos as Float64Array;
  const geomSize = model.geom_size as Float64Array;
  for (let g = 0; g < model.ngeom; g++) {
    if (geomType[g] !== GEOM_SPHERE) continue;
    const onFoot = geomBody[g] === footBody;
    const onParent = geomBody[g] === parent;
    if (!onFoot && !onParent) continue;
    const p = geomPos.subarray(g * 3, g * 3 + 3);
    const ref = onFoot ? [0, 0, 0] : bodyPos;
    if (Math.hypot(p[0] - ref[0], p[1] - ref[1], p[2] - ref[2]) < 0.01) return geomSize[g * 3];
  }
  return 0.02;
}

/**
 * Plan IK targets for a whole quadruped clip. Returns null when the source
 * skeleton or the robot does not have what the planner needs, in which case
 * the caller keeps the plain keypoint mapping.
 */
export function planQuadrupedTargets(args: {
  frames: HumanFrame[];
  fps: number;
  robot: RobotModel;
  config: GmrIkConfig;
  /** Uniform source → robot scale (config scale × height ratio). */
  scale: number;
  skeleton?: QuadrupedSkeleton;
  options?: Partial<QuadrupedPlanOptions>;
}): QuadrupedPlan | null {
  const { frames, fps, robot, config, scale } = args;
  const sk = args.skeleton ?? DOG_SKELETON;
  const opt = { ...DEFAULT_QUADRUPED_PLAN, ...args.options };
  const T = frames.length;
  if (T === 0) return null;
  const f0 = frames[0];
  const needed = [sk.pelvis, sk.leftShoulder, sk.rightShoulder, sk.leftHip, sk.rightHip];
  if (needed.some((j) => !f0.has(j))) return null;
  if (config.human_root_name !== sk.pelvis) return null;

  // Robot side: root body, and each foot task's hip anchor in the root frame.
  const { mujoco, model, data } = robot;
  const rootBody = robot.bodyIds.get(config.robot_root_name);
  if (rootBody === undefined) return null;
  const parentOf = model.body_parentid as Int32Array;
  const feetByPaw = new Map<string, number>();
  for (const table of [config.ik_match_table1, config.ik_match_table2]) {
    for (const [robotBody, entry] of Object.entries(table)) {
      if (!(entry[0] in sk.footHips) || entry[1] <= 0) continue;
      const id = robot.bodyIds.get(robotBody);
      if (id !== undefined) feetByPaw.set(entry[0], id);
    }
  }
  if (feetByPaw.size === 0) return null;

  const qpos = data.qpos as Float64Array;
  const saved = new Float64Array(qpos);
  qpos.set(model.qpos0 as Float64Array);
  mujoco.mj_kinematics(model, data);
  const xpos = data.xpos as Float64Array;
  const xmat = data.xmat as Float64Array;
  const toRoot = (b: number): Vec3 => {
    const d: Vec3 = [xpos[b * 3] - xpos[rootBody * 3], xpos[b * 3 + 1] - xpos[rootBody * 3 + 1], xpos[b * 3 + 2] - xpos[rootBody * 3 + 2]];
    const m = xmat.subarray(rootBody * 9, rootBody * 9 + 9); // row-major R (world ← root)
    return [m[0] * d[0] + m[3] * d[1] + m[6] * d[2], m[1] * d[0] + m[4] * d[1] + m[7] * d[2], m[2] * d[0] + m[5] * d[1] + m[8] * d[2]];
  };
  const legs: LegBinding[] = [];
  let contactZ = Infinity;
  for (const [paw, foot] of feetByPaw) {
    let hip = foot;
    while (parentOf[hip] !== rootBody && parentOf[hip] !== 0) hip = parentOf[hip];
    if (parentOf[hip] !== rootBody) {
      qpos.set(saved);
      mujoco.mj_kinematics(model, data);
      return null;
    }
    const h = toRoot(hip);
    const fpos = toRoot(foot);
    legs.push({ paw, hip: sk.footHips[paw], anchor: [h[0], fpos[1], 0] });
    contactZ = Math.min(contactZ, footContactHeight(robot, foot));
  }
  qpos.set(saved);
  mujoco.mj_kinematics(model, data);

  // Source side: smoothed keypoint tracks.
  const track = (name: string) =>
    gaussianSmooth(frames.map((f) => [...(f.get(name)?.pos ?? [0, 0, 0])] as Vec3), opt.smoothSigma);
  const LS = track(sk.leftShoulder);
  const RS = track(sk.rightShoulder);
  const LH = track(sk.leftHip);
  const RH = track(sk.rightHip);
  // The trunk spans the four leg roots, as the robot's base spans its hip joints.
  // (motion_imitation uses pelvis → neck; this dog's neck joint follows the
  // head, so looking up would pitch the whole robot.)
  const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const P = LH.map((l, t) => mid(l, RH[t]));
  const N = LS.map((l, t) => mid(l, RS[t]));

  // Each paw's own floor level: its lowest heights over the clip (mocap floors
  // are rarely at exactly z = 0, and differ from paw to paw).
  const contactJoint = (paw: string) => {
    const j = sk.contactJoints[paw];
    return j && f0.has(j) ? j : paw;
  };
  const pawTracks = new Map(legs.map((leg) => [leg.paw, track(contactJoint(leg.paw))]));
  const grounds = new Map(
    legs.map((leg) => [leg.paw, percentile(pawTracks.get(leg.paw)!.map((p) => p[2]), 0.05)]),
  );
  const meanGround = [...grounds.values()].reduce((a, b) => a + b, 0) / grounds.size;

  // The dog's shoulder joints sit lower than its hips, which pitches the trunk
  // frame ~6° nose-down on average; remove the clip's mean pitch so the robot
  // stands level and only the pitching *motion* carries over (motion_imitation
  // hand-tunes the same thing per robot as FORWARD_DIR_OFFSET).
  const rawAxes = P.map((_, t) => trunkFrame(P[t], N[t], LS[t], RS[t], LH[t], RH[t]));
  const meanPitch = rawAxes.reduce((sum, [f]) => sum + Math.asin(Math.max(-1, Math.min(1, f[2]))), 0) / T;
  const c = Math.cos(-meanPitch);
  const sn = Math.sin(-meanPitch);
  const frameAxes: [Vec3, Vec3, Vec3][] = rawAxes.map(([f, l, u]) => [
    [c * f[0] + sn * u[0], c * f[1] + sn * u[1], c * f[2] + sn * u[2]],
    l,
    [c * u[0] - sn * f[0], c * u[1] - sn * f[1], c * u[2] - sn * f[2]],
  ]);

  const rootTargets: HumanFrameBody[] = [];
  for (let t = 0; t < T; t++) {
    const [f, l, u] = frameAxes[t];
    const quat = quatFromMat3([
      [f[0], l[0], u[0]],
      [f[1], l[1], u[1]],
      [f[2], l[2], u[2]],
    ]);
    const mid: Vec3 = [
      0.5 * (P[t][0] + N[t][0]) * scale,
      0.5 * (P[t][1] + N[t][1]) * scale,
      (0.5 * (P[t][2] + N[t][2]) - meanGround) * scale + contactZ,
    ];
    rootTargets.push({ pos: mid, quat });
  }

  const contacts = new Map<string, boolean[]>();
  const pawTargets = new Map<string, Vec3[]>();
  for (const leg of legs) {
    const paw = pawTracks.get(leg.paw)!;
    const srcHip = track(leg.hip);
    const ground = grounds.get(leg.paw)!;
    const low = paw.map((p, t) => {
      const prev = paw[Math.max(0, t - 1)];
      const next = paw[Math.min(T - 1, t + 1)];
      const speed = (Math.hypot(next[0] - prev[0], next[1] - prev[1]) * fps) / Math.max(1, Math.min(T - 1, t + 1) - Math.max(0, t - 1));
      return p[2] - ground < opt.contactHeight && speed < opt.contactSpeed;
    });
    const planted = contactPhases(low, 3);
    contacts.set(leg.paw, planted);

    // motion_imitation: robot hip + animal hip→paw offset (scaled); height from the paw.
    // The animal's leg-root joints do not sit where a robot's hips do (the dog's
    // hind paws average ~5 cm ahead of its LegUpper joint), so each leg's mean
    // fore-aft offset is removed — the automatic counterpart of motion_imitation's
    // hand-tuned SIM_TOE_OFFSET_LOCAL — and the stride swings about the robot hip.
    const forwardOffset = paw.map((p, t) => {
      const f = frameAxes[t][0];
      return ((p[0] - srcHip[t][0]) * f[0] + (p[1] - srcHip[t][1]) * f[1]) * scale;
    });
    const meanForward = forwardOffset.reduce((a, b) => a + b, 0) / T;
    const raw: Vec3[] = paw.map((p, t) => {
      const [f, l] = frameAxes[t];
      const root = rootTargets[t].pos;
      const ax = leg.anchor[0] - meanForward;
      const hipWorld: Vec3 = [
        root[0] + f[0] * ax + l[0] * leg.anchor[1],
        root[1] + f[1] * ax + l[1] * leg.anchor[1],
        0,
      ];
      return [
        hipWorld[0] + (p[0] - srcHip[t][0]) * scale,
        hipWorld[1] + (p[1] - srcHip[t][1]) * scale,
        (p[2] - ground) * scale + contactZ,
      ];
    });
    const corr = lockCorrections(raw, planted, contactZ, opt.blendFrames);
    const lift = swingFloor(planted, opt.swingClearance * scale);
    pawTargets.set(
      leg.paw,
      raw.map((r, t) => [r[0] + corr[t][0], r[1] + corr[t][1], Math.max(contactZ + lift[t], r[2] + corr[t][2])]),
    );
  }

  const identity: [number, number, number, number] = [1, 0, 0, 0];
  const targets = rootTargets.map((root, t) => {
    const m = new Map<string, HumanFrameBody>();
    m.set(sk.pelvis, root);
    for (const [paw, series] of pawTargets) m.set(paw, { pos: series[t], quat: identity });
    return m;
  });
  return { targets, contacts, footContactHeight: contactZ };
}
