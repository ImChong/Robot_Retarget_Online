/**
 * Structural ik_config templates for imported robots that no bundled GMR
 * preset fits (most Robot Description Gallery URDFs, issue #98).
 *
 * Body names differ wildly between URDFs (`left_knee_link`, `L_KNEE`,
 * `leg_l4_link`, `LLeg3` …), so the template reads the kinematic tree instead:
 * at the rest pose, the two lowest limb chains that meet high on the body are
 * the legs, the two chains that branch off sideways above them are the arms.
 * On each limb it picks the bodies GMR's own presets track — thigh, knee and
 * ankle; upper arm, elbow and wrist — so the result looks like a hand-made
 * GMR config.
 *
 * Rotation offsets are where name templates fail: GMR's offsets encode how
 * each LAFAN1 bone frame sits relative to a robot body frame. The template
 * carries the offsets of the Unitree G1 preset over, corrected for how this
 * robot's body frames and limb directions differ from G1's at rest:
 *
 *   offset = offset_G1 ⊗ R_G1⁻¹ ⊗ C ⊗ R_robot
 *
 * with R the bodies' rest orientations and C the swing that turns this robot's
 * rest limb segment (e.g. a T-posed upper arm) onto G1's, after a yaw that
 * turns the robot to face +x. For G1 itself this reproduces the preset exactly.
 *
 * Scales come from the robot's own proportions (pelvis height, pelvis → ankle
 * drop, shoulder reach) against the LAFAN1 skeleton, so feet land on the floor
 * whatever the robot's size.
 */

import { extremeZ } from '../mujoco/geometry';
import type { RobotModel } from '../mujoco/runtime';
import {
  quatConj,
  quatFromAxisAngle,
  quatFromMat3,
  quatFromTo,
  quatMul,
  quatNormalize,
  quatRotate,
  vCross,
  vDot,
  type Quat,
  type Vec3,
} from '../math3d';
import { getDefaultConfig } from './defaults';
import type { GmrIkConfig, IkMatchEntry } from './types';

const MJ_JNT_FREE = 0;
const MJ_JNT_HINGE = 3;

/** Rotation weight of the upper-arm tasks in the structural template (G1's preset: 100). */
const ARM_ROT_WEIGHT = 10;

/** LAFAN1 skeleton at rest (metres, Z-up): heights above the floor and reach. */
export const LAFAN1_REST = {
  hips: 0.92,
  ankle: 0.072,
  spine2: 1.236,
  /** |LeftArm − Hips| */
  shoulderReach: 0.55,
};

/**
 * Unitree G1 (29 DoF, `public/robots/unitree_g1`) at qpos0, the reference the
 * offsets of its GMR preset were tuned on: rest orientation of each mapped body
 * and, for limb bones, the rest direction of the limb segment the body drives
 * (hip → knee, knee → ankle, shoulder → elbow, elbow → wrist) and the flex
 * axis of the knee / elbow that bends it, as `analyzeHumanoid` / `restPose`
 * measure them (tests/autoConfig.test.ts re-measures and compares).
 */
export const G1_REFERENCE: Record<string, { quat: Quat; dir?: Vec3; flex?: Vec3 }> = {
  Hips: { quat: [1, 0, 0, 0] },
  Spine2: { quat: [1, 0, 0, 0] },
  LeftUpLeg: { quat: [0.99618, 0, -0.08734, 0], dir: [0, 0.1588, -0.9873], flex: [0, 1, 0] },
  RightUpLeg: { quat: [0.99618, 0, -0.08734, 0], dir: [0, -0.1588, -0.9873], flex: [0, 1, 0] },
  LeftLeg: { quat: [1, 0, 0, 0], dir: [0, 0, -1], flex: [0, 1, 0] },
  RightLeg: { quat: [1, 0, 0, 0], dir: [0, 0, -1], flex: [0, 1, 0] },
  LeftFootMod: { quat: [1, 0, 0, 0] },
  RightFootMod: { quat: [1, 0, 0, 0] },
  LeftArm: { quat: [1, 0, 0, 0], dir: [0.0818, 0.2415, -0.9669], flex: [0, -1, 0] },
  RightArm: { quat: [1, 0, 0, 0], dir: [0.0818, -0.2415, -0.9669], flex: [0, -1, 0] },
  LeftForeArm: { quat: [1, 0, 0, 0], dir: [0.9985, 0.0101, -0.0543], flex: [0, -1, 0] },
  RightForeArm: { quat: [1, 0, 0, 0], dir: [0.9985, -0.0101, -0.0543], flex: [0, -1, 0] },
  LeftHand: { quat: [1, 0, 0, 0], dir: [0.9985, 0.0101, -0.0543], flex: [0, -1, 0] },
  RightHand: { quat: [1, 0, 0, 0], dir: [0.9985, -0.0101, -0.0543], flex: [0, -1, 0] },
};

interface RestPose {
  names: string[];
  pos: Vec3[];
  quat: Quat[];
  parent: Int32Array;
  children: number[][];
  /** Body carries a hinge / slide joint. */
  moving: boolean[];
  /** Body or a descendant carries a hinge / slide joint. */
  hasMoving: boolean[];
  /** Mean centre of the body's own geoms (null when it has none). */
  geomCenter: (Vec3 | null)[];
  /** World axis and range of the body's first hinge. */
  hinge: ({ axis: Vec3; lo: number; hi: number; limited: boolean } | null)[];
  /** Floor height: lowest geometry point at rest. */
  ground: number;
  top: number;
  root: number;
}

/** Bodies at qpos0 (free joint at its default pose), plus tree bookkeeping. */
export function restPose(robot: RobotModel, rootName?: string): RestPose {
  const { mujoco, model, data } = robot;
  const qpos = data.qpos as Float64Array;
  const saved = new Float64Array(qpos);
  qpos.set(model.qpos0 as Float64Array);
  mujoco.mj_kinematics(model, data);
  const n = model.nbody as number;
  const xpos = data.xpos as Float64Array;
  const xquat = data.xquat as Float64Array;
  const pos: Vec3[] = [];
  const quat: Quat[] = [];
  for (let b = 0; b < n; b++) {
    pos.push([xpos[b * 3], xpos[b * 3 + 1], xpos[b * 3 + 2]]);
    quat.push([xquat[b * 4], xquat[b * 4 + 1], xquat[b * 4 + 2], xquat[b * 4 + 3]]);
  }
  const ground = extremeZ(robot, 1);
  const top = extremeZ(robot, -1);
  const geomCenter: (Vec3 | null)[] = new Array(n).fill(null);
  {
    const gb = model.geom_bodyid as Int32Array;
    const gx = data.geom_xpos as Float64Array;
    const acc = new Map<number, number[]>();
    for (let g = 0; g < model.ngeom; g++) {
      const a = acc.get(gb[g]) ?? [0, 0, 0, 0];
      a[0] += gx[g * 3];
      a[1] += gx[g * 3 + 1];
      a[2] += gx[g * 3 + 2];
      a[3]++;
      acc.set(gb[g], a);
    }
    for (const [b, a] of acc) geomCenter[b] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
  }
  const xaxis = data.xaxis as Float64Array;
  const hinge: RestPose['hinge'] = new Array(n).fill(null);
  {
    const jb = model.jnt_bodyid as Int32Array;
    const jt = model.jnt_type as Int32Array;
    const limited = model.jnt_limited as Uint8Array;
    const range = model.jnt_range as Float64Array;
    for (let j = 0; j < model.njnt; j++) {
      if (jt[j] !== MJ_JNT_HINGE || hinge[jb[j]]) continue;
      hinge[jb[j]] = {
        axis: [xaxis[j * 3], xaxis[j * 3 + 1], xaxis[j * 3 + 2]],
        lo: range[j * 2],
        hi: range[j * 2 + 1],
        limited: !!limited[j],
      };
    }
  }
  qpos.set(saved);
  mujoco.mj_kinematics(model, data);

  const parent = model.body_parentid as Int32Array;
  const children: number[][] = Array.from({ length: n }, () => []);
  for (let b = 1; b < n; b++) children[parent[b]].push(b);
  const jntBody = model.jnt_bodyid as Int32Array;
  const jntType = model.jnt_type as Int32Array;
  const moving = new Array<boolean>(n).fill(false);
  let root = rootName !== undefined ? robot.bodyIds.get(rootName) ?? -1 : -1;
  for (let j = 0; j < model.njnt; j++) {
    if (jntType[j] === MJ_JNT_FREE) {
      if (root < 0) root = jntBody[j];
    } else {
      moving[jntBody[j]] = true;
    }
  }
  if (root < 0) root = 1;
  const hasMoving = [...moving];
  for (let b = n - 1; b > 0; b--) if (hasMoving[b]) hasMoving[parent[b]] = true;
  return { names: robot.bodyNames, pos, quat, parent, children, moving, hasMoving, geomCenter, hinge, ground, top, root };
}

// ---------------- tree helpers ----------------

function pathFrom(rp: RestPose, ancestor: number, b: number): number[] {
  const path: number[] = [];
  for (let c = b; c !== ancestor && c > 0; c = rp.parent[c]) path.push(c);
  return path.reverse();
}

function depth(rp: RestPose, b: number): number {
  let d = 0;
  for (let c = b; c > 0; c = rp.parent[c]) d++;
  return d;
}

function lca(rp: RestPose, a: number, b: number): number {
  let x = a;
  let y = b;
  let dx = depth(rp, x);
  let dy = depth(rp, y);
  while (dx > dy) { x = rp.parent[x]; dx--; }
  while (dy > dx) { y = rp.parent[y]; dy--; }
  while (x !== y) { x = rp.parent[x]; y = rp.parent[y]; }
  return x;
}

function isDescendant(rp: RestPose, b: number, ancestor: number): boolean {
  for (let c = b; c > 0; c = rp.parent[c]) if (c === ancestor) return true;
  return false;
}

/** Moving bodies with no moving descendant: the ends of every limb chain. */
function chainEnds(rp: RestPose): number[] {
  const ends: number[] = [];
  for (let b = 1; b < rp.moving.length; b++) {
    if (rp.moving[b] && rp.children[b].every((c) => !rp.hasMoving[c])) ends.push(b);
  }
  return ends;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * The knee / elbow hinge axis, signed so that a positive rotation about it
 * flexes the limb. A limb bent at rest shows the way it flexes (proximal ×
 * distal segment). A straight one uses the anatomical `prior` when the hinge
 * lies along it (knees fold back: flex about the robot's left axis; hanging
 * elbows fold forward: about its right axis), else the larger side of its range.
 */
function flexAxis(rp: RestPose, joint: number, proximal: Vec3, distal: Vec3, prior?: Vec3): Vec3 | null {
  const h = rp.hinge[joint];
  if (!h) return null;
  const bend = vDot(vCross(unit(proximal), unit(distal)), h.axis);
  let sign: number;
  if (Math.abs(bend) > Math.sin((15 * Math.PI) / 180)) sign = Math.sign(bend);
  else if (prior && Math.abs(vDot(h.axis, prior)) > 0.7) sign = Math.sign(vDot(h.axis, prior));
  else sign = h.limited && h.hi < -h.lo ? -1 : 1;
  return [sign * h.axis[0], sign * h.axis[1], sign * h.axis[2]];
}
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

/**
 * How well each candidate fits as the joint between two ends of a limb (knee
 * between hip and ankle, elbow between shoulder and wrist), lower is better:
 * the body the limb bends at if it is bent at rest, else the one closest to
 * half way along it.
 */
function middleJointScores(rp: RestPose, candidates: number[], start: Vec3, end: Vec3): number[] {
  const span = dist(start, end) || 1;
  return candidates.map((b) => {
    const a = dist(start, rp.pos[b]);
    const c = dist(rp.pos[b], end);
    return (Math.abs(a - c) - 3 * (a + c - span)) / span;
  });
}

/**
 * Knees and elbows flex across the limb: drop candidates whose hinge runs
 * along it (an upper-arm or forearm roll), unless nothing would be left.
 */
function acrossLimb(rp: RestPose, candidates: number[], start: Vec3, end: Vec3): number[] {
  const along = unit(sub(end, start));
  const kept = candidates.filter((b) => {
    const h = rp.hinge[b];
    return !h || Math.abs(vDot(h.axis, along)) < Math.SQRT1_2;
  });
  return kept.length ? kept : candidates;
}

function bestIndex(scores: number[]): number {
  return scores.reduce((best, v, i) => (v < scores[best] ? i : best), 0);
}

// ---------------- left / right from names ----------------

const PART = '(leg|arm|hip|knee|kn|ankle|foot|ft|sho|shoulder|elb|elbow|wri|wrist|hand|thigh|shank|shin|calf|toe|upper|up|lower|low|ua|la|ul|ll|f|h)';
const LEFT_TOKEN = new RegExp(`^(left.*|l|l\\d+|l${PART}.*)$`);
const RIGHT_TOKEN = new RegExp(`^(right.*|r|r\\d+|r${PART}.*)$`);

/** +1 for a left-side name, −1 for right, 0 when the name does not say. */
export function sideFromName(name: string): number {
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
  let side = 0;
  for (const t of tokens) {
    if (LEFT_TOKEN.test(t)) side += 1;
    else if (RIGHT_TOKEN.test(t)) side -= 1;
  }
  return Math.sign(side);
}

function sideVote(robot: RobotModel, bodies: number[]): number {
  return Math.sign(bodies.reduce((s, b) => s + sideFromName(robot.bodyNames[b] ?? ''), 0));
}

// ---------------- humanoid ----------------

export interface HumanoidLeg {
  hip: number;
  thigh: number;
  knee: number;
  /** First body of the ankle cluster (the ankle joint centre). */
  ankle: number;
  /** Last body of the ankle cluster (GMR's `ankle_roll_link`). */
  foot: number;
}

export interface HumanoidArm {
  shoulder: number;
  upper: number;
  elbow: number;
  /** Wrist body; null when the arm ends in the elbow link (no wrist joint). */
  hand: number | null;
  /** Far end of the forearm (the wrist, else the elbow link's tip). */
  tip: Vec3;
}

export interface HumanoidSkeleton {
  root: number;
  /** Where the legs meet (GMR's Hips body). */
  pelvis: number;
  /** Where the arms meet, when a waist joint separates it from the pelvis. */
  chest: number | null;
  left: HumanoidLeg;
  right: HumanoidLeg;
  leftArm: HumanoidArm | null;
  rightArm: HumanoidArm | null;
  /** Rotation about z that turns the robot to face +x (radians). */
  yaw: number;
  rest: RestPose;
}

/** The leg's path plus the rigid links (feet, soles) hanging off its last body. */
function legPath(rp: RestPose, pelvis: number, end: number): number[] {
  const path = pathFrom(rp, pelvis, end);
  const extend = (b: number) => {
    const fixed = rp.children[b].filter((c) => !rp.moving[c]);
    if (!fixed.length) return;
    const low = fixed.reduce((a, c) => (rp.pos[c][2] < rp.pos[a][2] ? c : a));
    path.push(low);
    extend(low);
  };
  extend(end);
  return path;
}

function analyzeLeg(rp: RestPose, pelvis: number, end: number): (HumanoidLeg & { choices?: LimbChoices<HumanoidLeg> }) | null {
  const path = legPath(rp, pelvis, end);
  const movingPath = path.filter((b) => rp.moving[b]);
  if (movingPath.length < 2) return null;
  const hip = movingPath[0];
  const hHip = rp.pos[hip][2] - rp.ground;
  if (hHip <= 0) return null;
  // The ankle: first joint near the floor; point feet end in a rigid foot link.
  const near = (b: number) => rp.pos[b][2] - rp.ground < 0.3 * hHip;
  let ankle = movingPath.find((b, i) => i > 0 && near(b));
  if (ankle === undefined) ankle = path.slice(path.indexOf(movingPath[1])).find(near);
  if (ankle === undefined) return null;
  const legLen = dist(rp.pos[hip], rp.pos[ankle]);
  // GMR tracks the last body of the ankle cluster (ankle_pitch → ankle_roll).
  let foot = ankle;
  for (const b of movingPath.slice(movingPath.indexOf(ankle) + 1)) {
    if (dist(rp.pos[b], rp.pos[ankle]) > 0.08 * legLen) break;
    foot = b;
  }
  const upToAnkle = movingPath.filter((b) => !isDescendant(rp, b, ankle) || b === ankle);
  const between = acrossLimb(
    rp,
    upToAnkle.slice(1).filter((b) => b !== ankle && dist(rp.pos[b], rp.pos[hip]) > 0.2 * legLen),
    rp.pos[hip],
    rp.pos[ankle],
  );
  if (!between.length) return null;
  const named = between.find((b) => /knee|shank|shin|calf|tibia/i.test(rp.names[b] ?? ''));
  if (named !== undefined) {
    const kneeIdx = movingPath.indexOf(named);
    return { hip, thigh: movingPath[Math.max(0, kneeIdx - 1)], knee: named, ankle, foot };
  }
  const scores = middleJointScores(rp, between, rp.pos[hip], rp.pos[ankle]);
  const pick = (i: number): HumanoidLeg => {
    const knee = between[i];
    const kneeIdx = movingPath.indexOf(knee);
    return { hip, thigh: movingPath[Math.max(0, kneeIdx - 1)], knee, ankle, foot };
  };
  return { ...pick(bestIndex(scores)), choices: { scores, pick } };
}

/**
 * Far end of a body and the rigid links hanging off it: twice the way from the
 * body origin to the centre of their geometry (a forearm link's hand end).
 */
function bodyTip(rp: RestPose, b: number): Vec3 {
  const centers: Vec3[] = [];
  const visit = (x: number) => {
    if (rp.geomCenter[x]) centers.push(rp.geomCenter[x]!);
    for (const c of rp.children[x]) if (!rp.moving[c]) visit(c);
  };
  visit(b);
  if (!centers.length) return rp.pos[b];
  const c: Vec3 = [0, 1, 2].map((k) => centers.reduce((s, v) => s + v[k], 0) / centers.length) as Vec3;
  return [2 * c[0] - rp.pos[b][0], 2 * c[1] - rp.pos[b][1], 2 * c[2] - rp.pos[b][2]];
}

function analyzeArm(rp: RestPose, chest: number, end: number): (HumanoidArm & { choices?: LimbChoices<HumanoidArm> }) | null {
  const path = pathFrom(rp, chest, end);
  const movingPath = path.filter((b) => rp.moving[b]);
  if (movingPath.length < 2) return null;
  const shoulder = movingPath[0];
  // The hand is where the chain splits into fingers, else its last moving body.
  let hand = movingPath[movingPath.length - 1];
  for (const b of path) {
    if (b === shoulder || isDescendant(rp, shoulder, b)) continue;
    const branches = rp.children[b].filter((c) => rp.hasMoving[c]).length;
    if (branches >= 2) {
      const upTo = path.slice(0, path.indexOf(b) + 1).filter((x) => rp.moving[x]);
      hand = upTo[upTo.length - 1];
      break;
    }
  }
  const handIdx = movingPath.indexOf(hand);
  if (handIdx < 1) return null;
  const make = (elbow: number): HumanoidArm => {
    const elbowIdx = movingPath.indexOf(elbow);
    return {
      shoulder,
      upper: movingPath[Math.max(0, elbowIdx - 1)],
      elbow,
      hand: elbow === hand ? null : hand,
      tip: elbow === hand ? bodyTip(rp, hand) : rp.pos[hand],
    };
  };
  // A body named elbow is the elbow (G1, H1, Mini Pi); with H1 / R1 it is also
  // the last link, the forearm itself.
  const named = movingPath.slice(1, handIdx + 1).find((b) => /elbow/i.test(rp.names[b] ?? ''));
  if (named !== undefined) return make(named);
  // Unnamed: a last link whose geometry reaches a forearm's length past its
  // joint (Booster K1) is the forearm; a hand or wrist is shorter.
  const tipReach = dist(bodyTip(rp, hand), rp.pos[hand]);
  if (tipReach > 0.55 * dist(rp.pos[shoulder], rp.pos[hand])) return make(hand);
  const candidatesFrom = (start: number) =>
    acrossLimb(
      rp,
      movingPath
        .slice(movingPath.indexOf(start) + 1, handIdx)
        .filter((b) => dist(rp.pos[b], rp.pos[start]) > 0.15 * dist(rp.pos[start], rp.pos[hand])),
      rp.pos[start],
      rp.pos[hand],
    );
  let between = candidatesFrom(shoulder);
  if (!between.length) return make(hand);
  let scores = middleJointScores(rp, between, rp.pos[shoulder], rp.pos[hand]);
  // A clavicle joint ahead of the shoulder (Atlas) makes the shoulder itself
  // look like the bend: measure again from there.
  const first = between[bestIndex(scores)];
  if (movingPath.indexOf(first) === 1) {
    const again = candidatesFrom(first);
    if (again.length) {
      between = again;
      scores = middleJointScores(rp, between, rp.pos[first], rp.pos[hand]);
    }
  }
  return { ...make(between[bestIndex(scores)]), choices: { scores, pick: (i) => make(between[i]) } };
}

interface LimbChoices<T> {
  scores: number[];
  pick: (i: number) => T;
}

/**
 * Left and right limbs are built alike: when both offer the same number of
 * candidates, choose the knee / elbow at the same position on both sides by
 * their summed scores (one side's URDF offsets can be off by a few mm).
 */
function symmetric<T>(a: (T & { choices?: LimbChoices<T> }) | null, b: (T & { choices?: LimbChoices<T> }) | null): [T | null, T | null] {
  const strip = (x: (T & { choices?: LimbChoices<T> }) | null): T | null => {
    if (!x) return null;
    const { choices: _c, ...rest } = x;
    void _c;
    return rest as T;
  };
  if (!a?.choices || !b?.choices || a.choices.scores.length !== b.choices.scores.length) return [strip(a), strip(b)];
  const i = bestIndex(a.choices.scores.map((v, k) => v + b.choices!.scores[k]));
  return [a.choices.pick(i), b.choices.pick(i)];
}

/** Legs (and arms, when present) of a biped / humanoid, or null. */
export function analyzeHumanoid(robot: RobotModel, rootName?: string): HumanoidSkeleton | null {
  const rp = restPose(robot, rootName);
  const height = rp.top - rp.ground;
  if (height <= 0) return null;
  const h = (b: number) => rp.pos[b][2] - rp.ground;
  const ends = chainEnds(rp).sort((a, b) => h(a) - h(b));

  // Legs: the two lowest chain ends that meet high up, on opposite sides.
  let legs: [number, number] | null = null;
  for (let i = 0; i < ends.length && !legs; i++) {
    if (h(ends[i]) > 0.3 * height) break;
    for (let j = i + 1; j < ends.length; j++) {
      if (h(ends[j]) > 0.3 * height) break;
      const meet = lca(rp, ends[i], ends[j]);
      // Toes / heel of one foot meet low down; legs meet at the hips, each a
      // chain of joints. (Height alone misleads: TRON 2's arms point up at rest.)
      const joints = (e: number) => pathFrom(rp, meet, e).filter((b) => rp.moving[b]).length;
      if (h(meet) < 0.3 * height || joints(ends[i]) < 2 || joints(ends[j]) < 2) continue;
      const a = rp.pos[ends[i]];
      const b = rp.pos[ends[j]];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.04 * height) continue;
      legs = [ends[i], ends[j]];
      break;
    }
  }
  if (!legs) return null;
  const pelvis = lca(rp, legs[0], legs[1]);
  const [legA, legB] = symmetric(analyzeLeg(rp, pelvis, legs[0]), analyzeLeg(rp, pelvis, legs[1]));
  if (!legA || !legB) return null;

  // Which leg is left: names first, else the +y one (ROS: x forward, y left).
  const voteA = sideVote(robot, pathFrom(rp, pelvis, legA.foot));
  const voteB = sideVote(robot, pathFrom(rp, pelvis, legB.foot));
  let left: HumanoidLeg;
  let right: HumanoidLeg;
  if (voteA > 0 && voteB <= 0) [left, right] = [legA, legB];
  else if (voteB > 0 && voteA <= 0) [left, right] = [legB, legA];
  else if (voteA < 0 && voteB >= 0) [left, right] = [legB, legA];
  else if (voteB < 0 && voteA >= 0) [left, right] = [legA, legB];
  else [left, right] = rp.pos[legA.hip][1] >= rp.pos[legB.hip][1] ? [legA, legB] : [legB, legA];
  const lateral = sub(rp.pos[left.hip], rp.pos[right.hip]);
  // Facing direction = lateral × up; the yaw turns it onto +x.
  const yaw = Math.hypot(lateral[0], lateral[1]) > 1e-6 ? -(Math.atan2(lateral[1], lateral[0]) - Math.PI / 2) : 0;

  // Arms: chain ends off the legs, out to the side above the knees.
  const yawQ = quatFromAxisAngle([0, 0, 1], yaw);
  const mid: Vec3 = [
    (rp.pos[left.hip][0] + rp.pos[right.hip][0]) / 2,
    (rp.pos[left.hip][1] + rp.pos[right.hip][1]) / 2,
    (rp.pos[left.hip][2] + rp.pos[right.hip][2]) / 2,
  ];
  const halfHip = Math.max(0.5 * Math.hypot(lateral[0], lateral[1]), 0.02 * height);
  const sides: { left: number[]; right: number[] } = { left: [], right: [] };
  for (const e of ends) {
    if (isDescendant(rp, e, left.hip) || isDescendant(rp, e, right.hip)) continue;
    if (h(e) < 0.35 * h(pelvis)) continue;
    const y = quatRotate(yawQ, sub(rp.pos[e], mid))[1];
    if (Math.abs(y) < 0.5 * halfHip) continue;
    sides[y > 0 ? 'left' : 'right'].push(e);
  }
  const far = (list: number[]) =>
    list.length ? list.reduce((best, e) => (dist(rp.pos[e], rp.pos[pelvis]) > dist(rp.pos[best], rp.pos[pelvis]) ? e : best)) : null;
  const handL = far(sides.left);
  const handR = far(sides.right);
  let leftArm: HumanoidArm | null = null;
  let rightArm: HumanoidArm | null = null;
  let chest: number | null = null;
  if (handL !== null && handR !== null) {
    const meet = lca(rp, handL, handR);
    if (!isDescendant(rp, meet, left.hip) && !isDescendant(rp, meet, right.hip)) {
      [leftArm, rightArm] = symmetric(analyzeArm(rp, meet, handL), analyzeArm(rp, meet, handR));
      // Spine2 tracks the chest only when a waist joint moves it relative to the pelvis.
      const common = lca(rp, meet, pelvis);
      const waist = [...pathFrom(rp, common, meet), ...pathFrom(rp, common, pelvis)].some((b) => rp.moving[b]);
      if (meet !== pelvis && waist) chest = meet;
    }
  }
  return { root: rp.root, pelvis, chest, left, right, leftArm, rightArm, yaw, rest: rp };
}

/**
 * Rotation taking the (direction, flex axis) pair `from` onto `to`: the limb
 * segment onto G1's, twisted so the knee / elbow bends in the same plane and
 * the same way. Falls back to the minimal swing when an axis is missing or
 * runs along the segment.
 */
function alignLimb(fromDir: Vec3, toDir: Vec3, fromFlex?: Vec3 | null, toFlex?: Vec3 | null): Quat {
  const d0 = unit(fromDir);
  const d1 = unit(toDir);
  const frame = (d: Vec3, a: Vec3): Vec3[] | null => {
    const along = vDot(a, d);
    const perp: Vec3 = [a[0] - along * d[0], a[1] - along * d[1], a[2] - along * d[2]];
    if (Math.hypot(perp[0], perp[1], perp[2]) < 0.3) return null;
    const p = unit(perp);
    return [d, p, vCross(d, p)];
  };
  const f0 = fromFlex ? frame(d0, unit(fromFlex)) : null;
  const f1 = toFlex ? frame(d1, unit(toFlex)) : null;
  if (!f0 || !f1) return quatFromTo(d0, d1);
  // C = F1 · F0ᵀ (columns are the frame axes).
  const m = [0, 1, 2].map((i) => [0, 1, 2].map((j) => f1[0][i] * f0[0][j] + f1[1][i] * f0[1][j] + f1[2][i] * f0[2][j]));
  return quatNormalize(quatFromMat3(m));
}

/** `offset_G1 ⊗ R_G1⁻¹ ⊗ C ⊗ R_robot` (see the module comment). */
function transferOffset(bone: string, rest: Quat, yaw: number, dir?: Vec3, flex?: Vec3 | null): number[] {
  const ref = G1_REFERENCE[bone];
  const g1 = getDefaultConfig('unitree_g1');
  const entry = Object.values(g1.ik_match_table2).find((e) => e[0] === bone)!;
  const yawQ = quatFromAxisAngle([0, 0, 1], yaw);
  let c = yawQ;
  if (dir && ref.dir) {
    const flexYawed = flex ? quatRotate(yawQ, flex) : null;
    c = quatMul(alignLimb(quatRotate(yawQ, dir), ref.dir, flexYawed, ref.flex), yawQ);
  }
  const q = quatMul(quatMul(quatMul(entry[4] as Quat, quatConj(ref.quat)), c), rest);
  const n = quatNormalize(q);
  // Same hemisphere as the preset's, so G1 itself round-trips to its own numbers.
  const flip = n[0] * entry[4][0] + n[1] * entry[4][1] + n[2] * entry[4][2] + n[3] * entry[4][3] < 0 ? -1 : 1;
  return n.map((v) => +(v * flip).toFixed(8));
}

/**
 * GMR-style ik_config for a biped / humanoid from its kinematic tree, or null
 * when no pair of legs can be found.
 */
export function createStructuralHumanoidConfig(robot: RobotModel, rootName: string): GmrIkConfig | null {
  const sk = analyzeHumanoid(robot, rootName);
  if (!sk) return null;
  const rp = sk.rest;
  const g1 = getDefaultConfig('unitree_g1');
  const weights = (table: Record<string, IkMatchEntry>, bone: string) => {
    const e = Object.values(table).find((x) => x[0] === bone)!;
    return [e[1], e[2]] as const;
  };
  const name = (b: number) => robot.bodyNames[b];
  const h = (b: number) => rp.pos[b][2] - rp.ground;

  // bone → [robot body, limb direction at rest, the limb's flex axis]
  const bones: [string, number, Vec3?, (Vec3 | null)?][] = [['Hips', sk.pelvis]];
  const leftward = quatRotate(quatConj(quatFromAxisAngle([0, 0, 1], sk.yaw)), [0, 1, 0]);
  const rightward: Vec3 = [-leftward[0], -leftward[1], -leftward[2]];
  for (const [prefix, leg] of [['Left', sk.left], ['Right', sk.right]] as const) {
    const thigh = sub(rp.pos[leg.knee], rp.pos[leg.hip]);
    const shank = sub(rp.pos[leg.ankle], rp.pos[leg.knee]);
    const knee = flexAxis(rp, leg.knee, thigh, shank, leftward);
    bones.push([`${prefix}UpLeg`, leg.thigh, thigh, knee]);
    bones.push([`${prefix}Leg`, leg.knee, shank, knee]);
    bones.push([`${prefix}FootMod`, leg.foot]);
  }
  if (sk.chest !== null) bones.push(['Spine2', sk.chest]);
  for (const [prefix, arm] of [['Left', sk.leftArm], ['Right', sk.rightArm]] as const) {
    if (!arm) continue;
    const upper = sub(rp.pos[arm.elbow], rp.pos[arm.shoulder]);
    const fore = sub(arm.tip, rp.pos[arm.elbow]);
    const hanging = unit(upper)[2] < -0.7;
    const elbow = flexAxis(rp, arm.elbow, upper, fore, hanging ? rightward : undefined);
    bones.push([`${prefix}Arm`, arm.upper, upper, elbow]);
    bones.push([`${prefix}ForeArm`, arm.elbow, fore, elbow]);
    if (arm.hand !== null) bones.push([`${prefix}Hand`, arm.hand, fore, elbow]);
  }

  // Scales: pelvis height and pelvis → ankle drop against LAFAN1's, so the
  // feet land on the floor; shoulder reach for the arms (weighted lightly, as in
  // GMR). The drop is measured with the legs straight — the rotation targets
  // straighten them — which is not the zero pose of every robot (Star1 stands
  // with its knees bent).
  const ankleH = (h(sk.left.ankle) + h(sk.right.ankle)) / 2;
  const straightDrop = (leg: HumanoidLeg) =>
    h(sk.pelvis) - h(leg.hip) + dist(rp.pos[leg.hip], rp.pos[leg.knee]) + dist(rp.pos[leg.knee], rp.pos[leg.ankle]);
  const drop = (straightDrop(sk.left) + straightDrop(sk.right)) / 2;
  const hipsScale = (ankleH + drop) / LAFAN1_REST.hips;
  const legScale = drop / (LAFAN1_REST.hips - LAFAN1_REST.ankle);
  const arms = [sk.leftArm, sk.rightArm].filter((a): a is HumanoidArm => !!a);
  const armScale = arms.length
    ? arms.reduce((s, a) => s + dist(rp.pos[a.shoulder], rp.pos[sk.pelvis]), 0) / arms.length / LAFAN1_REST.shoulderReach
    : legScale;
  const round = (v: number) => +v.toFixed(4);
  const human_scale_table: Record<string, number> = {
    Hips: round(hipsScale),
    Spine2: round(legScale),
    LeftUpLeg: round(legScale),
    RightUpLeg: round(legScale),
    LeftLeg: round(legScale),
    RightLeg: round(legScale),
    LeftFootMod: round(legScale),
    RightFootMod: round(legScale),
  };
  if (arms.length) {
    for (const bone of ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand']) {
      human_scale_table[bone] = round(armScale);
    }
  }

  const ik_match_table1: Record<string, IkMatchEntry> = {};
  const ik_match_table2: Record<string, IkMatchEntry> = {};
  for (const [bone, body, dir, flex] of bones) {
    const rot = transferOffset(bone, rp.quat[body], sk.yaw, dir, flex);
    let [p1, r1] = weights(g1.ik_match_table1, bone);
    let [p2, r2] = weights(g1.ik_match_table2, bone);
    // G1's preset holds the upper arms with rotation weight 100; on a robot
    // whose shoulders cannot follow (T-posed zero pose, narrow ranges) that
    // drags the whole torso over, so the template holds them like the forearms.
    if (/Arm$/.test(bone) && !/ForeArm$/.test(bone)) {
      r1 = Math.min(r1, ARM_ROT_WEIGHT);
      r2 = Math.min(r2, ARM_ROT_WEIGHT);
    }
    ik_match_table1[name(body)] = [bone, p1, r1, [0, 0, 0], rot];
    ik_match_table2[name(body)] = [bone, p2, r2, [0, 0, 0], [...rot]];
  }

  return {
    robot_root_name: rootName,
    human_root_name: 'Hips',
    ground_height: 0,
    // Scales above are absolute for a 1.75 m subject (the solver's default height).
    human_height_assumption: 1.75,
    use_ik_match_table1: true,
    use_ik_match_table2: true,
    human_scale_table,
    ik_match_table1,
    ik_match_table2,
  };
}

// ---------------- quadruped ----------------

/**
 * Leg length (sum of the leg's segments, so a folded zero pose does not
 * matter) of the bundled quadruped presets: thigh + calf.
 */
export const QUADRUPED_PRESET_LEG_LENGTH: Record<string, number> = { unitree_go2: 0.426, unitree_a1: 0.4 };

/** Bodies the config tracks as feet (every stage-2 task but the root). */
function configFeet(robot: RobotModel, config: GmrIkConfig): number[] {
  return Object.entries(config.ik_match_table2)
    .filter(([, e]) => e[0] !== config.human_root_name && e[1] > 0)
    .map(([b]) => robot.bodyIds.get(b))
    .filter((b): b is number => b !== undefined);
}

/**
 * Mean leg length of a quadruped: from the leg's second joint (the one after
 * the hip abduction) along every joint down to the foot body.
 */
export function quadrupedLegLength(robot: RobotModel, config: GmrIkConfig): number | null {
  const rp = restPose(robot, config.robot_root_name);
  const root = robot.bodyIds.get(config.robot_root_name);
  const feet = configFeet(robot, config);
  if (root === undefined || !feet.length) return null;
  const lengths = feet.map((foot) => {
    const chain = pathFrom(rp, root, foot).filter((b, i, all) => rp.moving[b] || i === all.length - 1);
    let len = 0;
    for (let i = 1; i + 1 < chain.length; i++) len += dist(rp.pos[chain[i]], rp.pos[chain[i + 1]]);
    return len;
  });
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  return mean > 0 ? mean : null;
}

/**
 * Rescale a dog-mocap ik_config (Go2 / A1 preset or the Go2-based template)
 * to this robot's leg length, so a B2 or an ANYmal stands at its own height
 * instead of crouching to a Go2's. `referenceLength` is the leg length the
 * config was made for.
 */
export function fitQuadrupedScale(robot: RobotModel, config: GmrIkConfig, referenceLength: number): GmrIkConfig {
  const length = quadrupedLegLength(robot, config);
  if (!length) return config;
  const ratio = length / referenceLength;
  if (Math.abs(ratio - 1) < 0.03) return config;
  const human_scale_table = Object.fromEntries(
    Object.entries(config.human_scale_table).map(([k, v]) => [k, +(v * ratio).toFixed(4)]),
  );
  return { ...config, human_scale_table };
}

/**
 * Wheel-legged robots (Go2-W, LimX W1): a foot link fixed to the wheel spins
 * with it, so the solver could "move the foot" by turning the wheel. Track the
 * wheel's centre instead; the planner then keeps it a wheel radius up.
 */
export function wheelCentreFeet(robot: RobotModel, config: GmrIkConfig): GmrIkConfig {
  const { model } = robot;
  const rp = restPose(robot, config.robot_root_name);
  const limited = model.jnt_limited as Uint8Array;
  const range = model.jnt_range as Float64Array;
  const jntType = model.jnt_type as Int32Array;
  const jntBody = model.jnt_bodyid as Int32Array;
  // A wheel spins freely and its geometry sits round its axle — on the axle
  // line, maybe outboard along it (MagicDog-W) — while Mini Cheetah, which
  // declares every leg joint continuous, has its shank hanging off the knee.
  const wheels = new Set<number>();
  for (let j = 0; j < model.njnt; j++) {
    const b = jntBody[j];
    const free = !limited[j] || range[j * 2 + 1] - range[j * 2] > 2 * Math.PI;
    const centre = rp.geomCenter[b];
    const axis = rp.hinge[b]?.axis;
    if (jntType[j] !== MJ_JNT_HINGE || !free || !centre || !axis) continue;
    const d = sub(centre, rp.pos[b]);
    const along = vDot(d, axis);
    if (Math.hypot(d[0] - along * axis[0], d[1] - along * axis[1], d[2] - along * axis[2]) < 0.02) wheels.add(b);
  }
  if (!wheels.size) return config;
  const remap = (table: Record<string, IkMatchEntry>) => {
    const out: Record<string, IkMatchEntry> = {};
    for (const [body, entry] of Object.entries(table)) {
      let b = robot.bodyIds.get(body);
      let wheel: number | undefined;
      for (let up = 0; b !== undefined && b > 0 && up < 3; up++, b = rp.parent[b]) {
        if (wheels.has(b)) { wheel = b; break; }
        if (rp.moving[b] && up > 0) break;
      }
      out[wheel !== undefined && entry[0] !== config.human_root_name ? robot.bodyNames[wheel] : body] = entry;
    }
    return out;
  };
  return { ...config, ik_match_table1: remap(config.ik_match_table1), ik_match_table2: remap(config.ik_match_table2) };
}
