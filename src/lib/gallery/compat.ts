/**
 * End-to-end compatibility check of one Robot Description Gallery URDF version
 * (issue #98): the same code path the "Pick URDF from Gallery" dialog runs, one
 * stage at a time, followed by checks on the retargeted motion itself — a model
 * that loads is not a robot that retargets.
 *
 *   fetch    URDF + meshes from the pinned upstream commit (404s, dropped refs)
 *   compile  normalisation + MuJoCo compile under a free joint
 *   parse    joints / bodies vs the gallery's declared DoF, URDF edge cases
 *   config   the ik_config the UI would start from (GMR preset or template)
 *   solve    retarget a sample clip (LAFAN1 walk / dog walk)
 *   validate shape, finite values, joint limits, tracking, ground, posture
 *   preview  render representative frames (browser only, injected)
 *   export   NPZ / CSV / JSON, read back and checked
 *
 * Runs in the browser (`scripts/gallery_matrix.mjs` drives it in Chromium
 * against the dev server); with an injected fetch / mesh converter it also
 * runs in Node (tests/galleryCompat.test.ts).
 */

import { parseBvh, estimateSkeletonSize } from '../bvh/parse';
import { bvhToLafan1Frames, findMissingBodies, type HumanFrame } from '../bvh/lafan1';
import { exportCsv, exportJson, exportNpz } from '../export/motion';
import { clearCustomRobotCache, loadCustomRobot, type CustomRobotBundle } from '../mujoco/customRobot';
import type { RobotModel } from '../mujoco/runtime';
import { extremeAlong, extremeZ } from '../mujoco/geometry';
import { analyzeHumanoid } from '../retarget/autoConfig';
import { chooseCustomConfig } from '../retarget/customConfig';
import { runRetarget } from '../retarget/runner';
import { DEFAULT_SOLVER_OPTIONS, type GmrIkConfig, type RetargetResult, type SolverOptions } from '../retarget/types';
import { parseNpz } from '../smplx/npy';
import { inventoryKey } from './inventory';
import { galleryVariantView, type GalleryRobot } from './registry';
import { fetchGalleryRobotBundle, stripXmlComments, type GalleryFetchOptions, type GalleryFetchStats } from './urdfBundle';

export const COMPAT_STAGES = ['fetch', 'compile', 'parse', 'config', 'solve', 'validate', 'preview', 'export'] as const;
export type CompatStage = (typeof COMPAT_STAGES)[number];

export interface StageOutcome {
  ok: boolean;
  ms: number;
  error?: string;
  /** Stage did not run (an earlier stage failed, or no renderer was given). */
  skipped?: boolean;
}

export type CheckSeverity = 'fail' | 'warn';

export interface CompatCheck {
  id: string;
  ok: boolean;
  severity: CheckSeverity;
  /** Measured value (units in `detail`). */
  value: number | string | boolean | null;
  limit: number | string | null;
  detail: string;
}

/** What the raw upstream URDF looks like (edge cases the issue asks to cover). */
export interface UrdfAnalysis {
  links: number;
  joints: Record<string, number>;
  mimicJoints: number;
  /** Links that are no joint's child (a proper tree has exactly one). */
  rootLinks: string[];
  worldLink: boolean;
  packageRefs: number;
  meshRefs: number;
  /** `xacro:` tags or `${…}` expressions left in the file. */
  xacroLeftovers: number;
  linksWithoutInertial: number;
  /** Inertia tensors MuJoCo would reject (replaced by `normalizeGalleryUrdf`). */
  badInertias: number;
  /** Links whose only geometry is collision (promoted to visuals). */
  collisionOnlyLinks: number;
  hasMujocoBlock: boolean;
}

export interface CompatMetrics {
  frames: number;
  nq: number;
  dof: number;
  /** Robot height at rest (lowest → highest geometry point), metres. */
  restHeight: number;
  /** Size the relative limits use: the height, or a quadruped's largest rest extent. */
  size: number;
  /** Root height above the lowest point at rest, metres. */
  restRootHeight: number;
  /** Key tasks only (root + feet: position weight within 40 % of the strongest). */
  trackingMeanCm: number;
  trackingP95Cm: number;
  /** Every stage-2 task, for information. */
  allTasksP95Cm: number;
  /** Worst task (robot body ← human body) by p95 error. */
  worstTask: { robot: string; human: string; p95Cm: number } | null;
  rootDriftMaxCm: number;
  penetrationP95Cm: number;
  penetrationMaxCm: number;
  /** p95 over frames of the robot's lowest point above the floor (feet in the air). */
  floatP95Cm: number;
  tiltMaxDeg: number;
  tiltMeanDeg: number;
  /** Fraction of moving frames whose heading follows the travel direction (walk clips). */
  headingAgreement: number | null;
  jointLimitViolation: number;
  maxJointStep: number;
  spikeFrames: number;
  solveMs: number;
}

export interface CompatReport {
  key: string;
  robotId: string;
  variantId: string | null;
  kind: 'humanoid' | 'quadruped';
  clip: string;
  /**
   * `unsupported`: offered, but the robot lacks what the motion family needs
   * (see `limitation`); the stages still run, for information.
   */
  status: 'passed' | 'failed' | 'unsupported';
  limitation: { id: string; reason: string; followUp: string } | null;
  /** First failing stage / check, with a problem class for the report. */
  failure: { stage: CompatStage; category: string; message: string } | null;
  stages: Partial<Record<CompatStage, StageOutcome>>;
  checks: CompatCheck[];
  warnings: string[];
  fetch: Omit<GalleryFetchStats, 'rawUrdf'> | null;
  urdf: UrdfAnalysis | null;
  model: {
    nq: number;
    nv: number;
    nbody: number;
    njnt: number;
    hinge: number;
    slide: number;
    ball: number;
    nmesh: number;
    ngeom: number;
    declaredDof: number;
    rootBody: string;
  } | null;
  config: { source: string; mapped: Record<string, string>; root: string } | null;
  metrics: CompatMetrics | null;
  /** Frames the preview rendered, and the images (data URLs) when a renderer ran. */
  preview: { frames: number[]; images: string[] } | null;
  exports: { npzBytes: number; csvBytes: number; jsonBytes: number } | null;
}

export interface CompatMotion {
  clip: string;
  kind: 'humanoid' | 'quadruped';
  frames: HumanFrame[];
  fps: number;
}

export interface CompatOptions {
  fetchImpl?: typeof fetch;
  convert?: GalleryFetchOptions['convert'];
  solver?: Partial<SolverOptions>;
  /** Render the retargeted robot at `frames`; returns image data URLs (e.g. one contact sheet). */
  renderPreview?: (robot: RobotModel, result: RetargetResult, frames: number[]) => Promise<string[]>;
  log?: (message: string) => void;
}

/** Thresholds of the motion checks (see `validateRetarget`). */
export const COMPAT_LIMITS = {
  /** p95 position error of the key stage-2 tasks (root, feet), relative to robot height. */
  trackingP95Rel: 0.1,
  trackingWarnRel: 0.05,
  /** Root position error (horizontal), relative to robot height. */
  rootDriftRel: 0.1,
  /** Deepest 5 % of frames below the floor (cm, for robots up to 1.8 m; scaled up beyond). */
  penetrationP95Cm: 4,
  penetrationWarnCm: 2,
  /** Lowest point above the floor at the 95th percentile, relative to robot height. */
  floatP95Rel: 0.12,
  floatWarnRel: 0.06,
  /** Trunk tilt from its rest orientation (deg). */
  tiltMaxDeg: { humanoid: 60, quadruped: 40 },
  /** Joint step in one frame that counts as a spike (rad), and the tolerated share of frames. */
  spikeRad: 0.5,
  spikeShare: 0.02,
  headingWarn: 0.6,
  jointLimitTol: 1e-6,
};

/** Parse a bundled sample clip the way the motion store does. */
export function loadCompatMotion(
  text: string,
  clip: string,
  kind: 'humanoid' | 'quadruped',
  maxFrames = Infinity,
): CompatMotion {
  const anim = parseBvh(text);
  const unitScale = estimateSkeletonSize(anim) > 10 ? 0.01 : 1.0;
  const lafan = bvhToLafan1Frames(anim, unitScale);
  const fps = anim.frameTime > 0 ? 1 / anim.frameTime : 30;
  return { clip, kind, frames: lafan.frames.slice(0, Math.min(lafan.frames.length, maxFrames)), fps };
}

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function percentile(values: ArrayLike<number>, p: number): number {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

const LINK_RE = /<link\b[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*?(\/>|>([\s\S]*?)<\/link>)/g;
const JOINT_RE = /<joint\b[^>]*?\btype\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/joint>/g;

/** Edge cases in a raw upstream URDF (before `normalizeGalleryUrdf`). */
export function analyzeUrdf(raw: string): UrdfAnalysis {
  const xml = stripXmlComments(raw);
  const links: string[] = [];
  let withoutInertial = 0;
  let collisionOnly = 0;
  for (const m of xml.matchAll(LINK_RE)) {
    links.push(m[1]);
    const body = m[3] ?? '';
    if (!/<inertial\b/.test(body)) withoutInertial++;
    if (/<collision\b/.test(body) && !/<visual\b/.test(body)) collisionOnly++;
  }
  const joints: Record<string, number> = {};
  let mimic = 0;
  const children = new Set<string>();
  for (const m of xml.matchAll(JOINT_RE)) {
    joints[m[1]] = (joints[m[1]] ?? 0) + 1;
    if (/<mimic\b/.test(m[2])) mimic++;
    const child = /<child\s+link\s*=\s*["']([^"']+)["']/.exec(m[2]);
    if (child) children.add(child[1]);
  }
  let badInertias = 0;
  for (const m of xml.matchAll(/<inertia\b[^>]*>/g)) {
    const v = ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'].map((k) => {
      const a = new RegExp(`\\b${k}\\s*=\\s*["']([^"']*)["']`).exec(m[0]);
      return parseFloat(a?.[1] ?? '0');
    });
    const [xx, xy, xz, yy, yz, zz] = v;
    const scale = Math.max(Math.abs(xx), Math.abs(yy), Math.abs(zz));
    const det = xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
    const ok = v.every(Number.isFinite) && scale >= 1e-9 && xx > 0 && xx * yy - xy * xy > 1e-9 * scale * scale && det > 1e-9 * scale ** 3;
    if (!ok) badInertias++;
  }
  const meshRefs = [...xml.matchAll(/<mesh\b[^>]*?\bfilename\s*=\s*["']([^"']*)["']/g)].map((m) => m[1]);
  return {
    links: links.length,
    joints,
    mimicJoints: mimic,
    rootLinks: links.filter((l) => !children.has(l)),
    worldLink: links.includes('world'),
    packageRefs: meshRefs.filter((r) => r.startsWith('package://')).length,
    meshRefs: meshRefs.length,
    xacroLeftovers: (xml.match(/<xacro:|\$\{/g) ?? []).length,
    linksWithoutInertial: withoutInertial,
    badInertias,
    collisionOnlyLinks: collisionOnly,
    hasMujocoBlock: /<mujoco\b/.test(xml),
  };
}

function quatToMat(q: ArrayLike<number>, o = 0): number[] {
  const [w, x, y, z] = [q[o], q[o + 1], q[o + 2], q[o + 3]];
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

const HUMANOID_FEET = ['LeftFootMod', 'RightFootMod'];
const QUADRUPED_PAWS = ['b_LeftHand', 'b_RightHand', 'b_LeftToe', 'b_RightToe'];

/**
 * Measure a retargeted clip on the robot's own forward kinematics and turn
 * the measures into checks. Leaves the robot at its last frame.
 */
export function validateRetarget(
  robot: RobotModel,
  config: GmrIkConfig,
  result: RetargetResult,
  kind: 'humanoid' | 'quadruped',
  expectedFrames: number,
  /** The robot's forward direction at rest (world); default: the root task body's +x. */
  restForward?: [number, number, number],
): { metrics: CompatMetrics; checks: CompatCheck[] } {
  const { mujoco, model, data } = robot;
  const L = COMPAT_LIMITS;
  const checks: CompatCheck[] = [];
  const add = (id: string, ok: boolean, severity: CheckSeverity, value: CompatCheck['value'], limit: CompatCheck['limit'], detail: string) =>
    checks.push({ id, ok, severity, value, limit, detail });

  const T = result.frameCount;
  const nq = robot.nq;
  const dof = nq - 7;
  add('shape', T === expectedFrames && result.qpos.length === T * nq && result.dofNames.length === dof, 'fail',
    `${T}×${nq}`, `${expectedFrames}×${nq}`, 'output frames × qpos width (free joint + DoFs)');

  let finite = true;
  for (let i = 0; i < result.qpos.length; i++) if (!Number.isFinite(result.qpos[i])) { finite = false; break; }
  add('finite', finite, 'fail', finite, 'true', 'every qpos / root pose / dof_pos value is finite');

  let quatErr = 0;
  for (let f = 0; f < T; f++) {
    const o = f * nq + 3;
    quatErr = Math.max(quatErr, Math.abs(Math.hypot(result.qpos[o], result.qpos[o + 1], result.qpos[o + 2], result.qpos[o + 3]) - 1));
  }
  add('root_quat', quatErr < 1e-6, 'fail', quatErr, 1e-6, 'root quaternion stays unit length');

  // Joint ranges (the solver clamps, so any violation is a bug).
  const jntType = model.jnt_type as Int32Array;
  const limited = model.jnt_limited as Uint8Array;
  const range = model.jnt_range as Float64Array;
  const qadr = model.jnt_qposadr as Int32Array;
  let violation = 0;
  for (let j = 0; j < model.njnt; j++) {
    if (!limited[j] || (jntType[j] !== 2 && jntType[j] !== 3)) continue;
    const lo = range[j * 2];
    const hi = range[j * 2 + 1];
    for (let f = 0; f < T; f++) {
      const v = result.qpos[f * nq + qadr[j]];
      violation = Math.max(violation, lo - v, v - hi);
    }
  }
  add('joint_limits', violation <= L.jointLimitTol, 'fail', Math.max(0, violation), L.jointLimitTol, 'largest excursion beyond a joint range (rad or m)');

  // Feet mapped: the clip is a gait, so without feet there is no retargeting.
  const mapped = new Set(
    Object.values(config.ik_match_table2).filter((e) => e[1] > 0).map((e) => e[0]),
  );
  const feet = kind === 'quadruped' ? QUADRUPED_PAWS : HUMANOID_FEET;
  const missingFeet = feet.filter((f) => !mapped.has(f));
  add('feet_mapped', missingFeet.length === 0, 'fail', missingFeet.length ? missingFeet.join(', ') : 'all', feet.join(', '),
    'the ik_config tracks every foot of the motion family');

  // Rest geometry.
  const qpos = data.qpos as Float64Array;
  // The body the human root drives (GMR's Hips / b_Hips task): the free-joint
  // body when the URDF root is the pelvis, else the pelvis below a torso root.
  const rootTask = Object.entries(config.ik_match_table2).find(([, e]) => e[0] === config.human_root_name)?.[0];
  const rootId = robot.bodyIds.get(rootTask ?? config.robot_root_name) ?? robot.bodyIds.get(config.robot_root_name) ?? 1;
  qpos.set(model.qpos0 as Float64Array);
  mujoco.mj_kinematics(model, data);
  const restLow = extremeZ(robot, 1);
  const restHigh = extremeZ(robot, -1);
  const restHeight = Math.max(1e-3, restHigh - restLow);
  // Size the relative limits go by: a humanoid's height; a quadruped's largest
  // extent (Barkour's zero pose folds its legs to 16 cm of height).
  const extent = (axis: 0 | 1) => extremeAlong(robot, axis, -1) - extremeAlong(robot, axis, 1);
  const size = kind === 'quadruped' ? Math.max(restHeight, extent(0), extent(1)) : restHeight;
  const xpos = data.xpos as Float64Array;
  const xquat = data.xquat as Float64Array;
  const restRootHeight = xpos[rootId * 3 + 2] - restLow;
  const restRoot = quatToMat(xquat, rootId * 4);
  // Root-frame up / forward axes at rest (world z / x seen from the root).
  const upLocal = [restRoot[6], restRoot[7], restRoot[8]];
  const f0 = restForward ?? [restRoot[0], restRoot[3], restRoot[6]];
  const fwdLocal = [
    restRoot[0] * f0[0] + restRoot[3] * f0[1] + restRoot[6] * f0[2],
    restRoot[1] * f0[0] + restRoot[4] * f0[1] + restRoot[7] * f0[2],
    restRoot[2] * f0[0] + restRoot[5] * f0[1] + restRoot[8] * f0[2],
  ];

  // Per-frame measures.
  const low = new Float64Array(T);
  const tilt = new Float64Array(T);
  const heading: number[] = [];
  const rootXY: [number, number][] = [];
  let drift = 0;
  const rootHuman = result.humanBodyNames.indexOf(config.human_root_name);
  const K = result.humanBodyNames.length;
  for (let f = 0; f < T; f++) {
    qpos.set(result.qpos.subarray(f * nq, (f + 1) * nq));
    mujoco.mj_kinematics(model, data);
    low[f] = extremeZ(robot, 1);
    const R = quatToMat(xquat, rootId * 4);
    const up = [
      R[0] * upLocal[0] + R[1] * upLocal[1] + R[2] * upLocal[2],
      R[3] * upLocal[0] + R[4] * upLocal[1] + R[5] * upLocal[2],
      R[6] * upLocal[0] + R[7] * upLocal[1] + R[8] * upLocal[2],
    ];
    tilt[f] = (Math.acos(Math.max(-1, Math.min(1, up[2]))) * 180) / Math.PI;
    const fwd = [
      R[0] * fwdLocal[0] + R[1] * fwdLocal[1] + R[2] * fwdLocal[2],
      R[3] * fwdLocal[0] + R[4] * fwdLocal[1] + R[5] * fwdLocal[2],
    ];
    heading.push(Math.atan2(fwd[1], fwd[0]));
    rootXY.push([xpos[rootId * 3], xpos[rootId * 3 + 1]]);
    if (rootHuman >= 0) {
      const h = (f * K + rootHuman) * 3;
      drift = Math.max(drift, Math.hypot(result.scaledHuman[h] - xpos[rootId * 3], result.scaledHuman[h + 1] - xpos[rootId * 3 + 1]));
    }
  }

  // Heading vs travel direction over 0.5 s windows while moving (> 0.2 m/s).
  const win = Math.max(1, Math.round(result.fps / 2));
  let agree = 0;
  let moving = 0;
  for (let f = win; f < T; f += win) {
    const dx = rootXY[f][0] - rootXY[f - win][0];
    const dy = rootXY[f][1] - rootXY[f - win][1];
    if (Math.hypot(dx, dy) * (result.fps / win) < 0.2 * restHeight) continue;
    moving++;
    const travel = Math.atan2(dy, dx);
    if (Math.cos(travel - heading[f]) > 0.5) agree++;
  }
  const headingAgreement = moving >= 4 ? agree / moving : null;

  // Joint steps.
  let maxStep = 0;
  let spikes = 0;
  for (let f = 1; f < T; f++) {
    let spiked = false;
    for (let i = 7; i < nq; i++) {
      const step = Math.abs(result.qpos[f * nq + i] - result.qpos[(f - 1) * nq + i]);
      if (step > maxStep) maxStep = step;
      if (step > L.spikeRad) spiked = true;
    }
    if (spiked) spikes++;
  }

  // Tracking: the key position tasks (root + feet in every preset — the ones
  // weighted within 40 % of the strongest). GMR presets also pull intermediate
  // bodies (thighs, elbows) with small weights whose targets sit 20+ cm from the
  // robot body by design, so their error says nothing about success.
  const nTask = result.taskNames.length;
  const weights = result.taskNames.map((name) => config.ik_match_table2[name]?.[1] ?? 0);
  const maxW = Math.max(0, ...weights);
  const all: number[] = [];
  const key: number[] = [];
  let worst: CompatMetrics['worstTask'] = null;
  for (let k = 0; k < nTask; k++) {
    const series: number[] = [];
    for (let f = 0; f < T; f++) series.push(result.posErrors[f * nTask + k]);
    all.push(...series);
    if (maxW <= 0 || weights[k] < 0.4 * maxW) continue;
    key.push(...series);
    const p = percentile(series, 0.95) * 100;
    if (!worst || p > worst.p95Cm) worst = { robot: result.taskNames[k], human: result.taskHumanBodies[k], p95Cm: p };
  }
  const trackingMeanCm = key.length ? (key.reduce((a, b) => a + b, 0) / key.length) * 100 : 0;
  const trackingP95Cm = percentile(key, 0.95) * 100;
  const allTasksP95Cm = percentile(all, 0.95) * 100;

  const depth = Array.from(low, (z) => Math.max(0, -z));
  const above = Array.from(low, (z) => Math.max(0, z));
  const metrics: CompatMetrics = {
    frames: T,
    nq,
    dof,
    restHeight,
    size,
    restRootHeight,
    trackingMeanCm,
    trackingP95Cm,
    allTasksP95Cm,
    worstTask: worst,
    rootDriftMaxCm: drift * 100,
    penetrationP95Cm: percentile(depth, 0.95) * 100,
    penetrationMaxCm: Math.max(0, ...depth) * 100,
    floatP95Cm: percentile(above, 0.95) * 100,
    tiltMaxDeg: Math.max(0, ...tilt),
    tiltMeanDeg: tilt.reduce((a, b) => a + b, 0) / Math.max(1, T),
    headingAgreement,
    jointLimitViolation: Math.max(0, violation),
    maxJointStep: maxStep,
    spikeFrames: spikes,
    solveMs: result.elapsedMs,
  };

  const H = size * 100; // cm
  const trackRel = trackingP95Cm / H;
  add('tracking', trackRel <= L.trackingP95Rel, 'fail', +trackRel.toFixed(4), L.trackingP95Rel,
    `p95 key-task (root, feet) position error / robot size (${trackingP95Cm.toFixed(1)} cm of ${H.toFixed(0)} cm${worst ? `; worst ${worst.robot} ← ${worst.human} ${worst.p95Cm.toFixed(1)} cm` : ''})`);
  if (trackRel > L.trackingWarnRel && trackRel <= L.trackingP95Rel) {
    add('tracking_warn', false, 'warn', +trackRel.toFixed(4), L.trackingWarnRel, 'task error is high but within the limit');
  }
  add('root_drift', metrics.rootDriftMaxCm / H <= L.rootDriftRel, 'fail', +metrics.rootDriftMaxCm.toFixed(2), +(L.rootDriftRel * H).toFixed(1),
    'largest horizontal gap between the body the human root drives and its target (cm)');
  // Absolute for human-sized robots; grows with anything taller than 1.8 m
  // (motion is scaled up with the robot, and so is every foot wobble).
  const big = Math.max(1, size / 1.8);
  const penLimit = +(L.penetrationP95Cm * big).toFixed(1);
  add('penetration', metrics.penetrationP95Cm <= penLimit, 'fail', +metrics.penetrationP95Cm.toFixed(2), penLimit,
    `p95 depth of the lowest geometry below the floor (cm; max ${metrics.penetrationMaxCm.toFixed(1)})`);
  if (metrics.penetrationP95Cm > L.penetrationWarnCm * big && metrics.penetrationP95Cm <= penLimit) {
    add('penetration_warn', false, 'warn', +metrics.penetrationP95Cm.toFixed(2), +(L.penetrationWarnCm * big).toFixed(1), 'feet dip into the floor');
  }
  const floatRel = metrics.floatP95Cm / H;
  add('floating', floatRel <= L.floatP95Rel, 'fail', +floatRel.toFixed(4), L.floatP95Rel,
    `p95 height of the lowest geometry above the floor / robot size (${metrics.floatP95Cm.toFixed(1)} cm)`);
  if (floatRel > L.floatWarnRel && floatRel <= L.floatP95Rel) {
    add('floating_warn', false, 'warn', +floatRel.toFixed(4), L.floatWarnRel, 'feet hover above the floor');
  }
  const tiltLimit = L.tiltMaxDeg[kind];
  add('upright', metrics.tiltMaxDeg <= tiltLimit, 'fail', +metrics.tiltMaxDeg.toFixed(1), tiltLimit,
    'largest tilt of the root-task body away from its rest orientation (deg)');
  add('spikes', spikes / Math.max(1, T - 1) <= L.spikeShare, 'fail', spikes, Math.floor(L.spikeShare * (T - 1)),
    `frames with a joint jumping more than ${L.spikeRad} rad (largest step ${maxStep.toFixed(2)} rad)`);
  if (headingAgreement !== null) {
    add('heading', headingAgreement >= L.headingWarn, 'warn', +headingAgreement.toFixed(2), L.headingWarn,
      'share of walking windows in which the root faces its direction of travel');
  }
  return { metrics, checks };
}

/** NPZ / CSV / JSON exports, read back and checked against the result. */
export async function checkExports(result: RetargetResult): Promise<{ npzBytes: number; csvBytes: number; jsonBytes: number }> {
  const T = result.frameCount;
  const nDof = result.nq - 7;
  const npz = new Uint8Array(await exportNpz(result).arrayBuffer());
  const arrays = parseNpz(npz);
  const shape = (k: string) => arrays[k]?.shape.join('×') ?? 'missing';
  const expect: Record<string, string> = { fps: '1', root_pos: `${T}×3`, root_rot: `${T}×4`, dof_pos: `${T}×${nDof}` };
  for (const [k, s] of Object.entries(expect)) {
    if (shape(k) !== s) throw new Error(`NPZ ${k}: shape ${shape(k)}, expected ${s}`);
    const data = arrays[k].data as Float64Array;
    for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) throw new Error(`NPZ ${k}: non-finite value`);
  }

  const csv = await exportCsv(result).text();
  const lines = csv.split('\n');
  if (lines.length !== T + 1) throw new Error(`CSV: ${lines.length - 1} rows, expected ${T}`);
  const width = 9 + nDof;
  if (lines[0].split(',').length !== width) throw new Error(`CSV header has ${lines[0].split(',').length} columns, expected ${width}`);
  for (const line of [lines[1], lines[Math.ceil(T / 2)], lines[T]]) {
    const cells = line.split(',');
    if (cells.length !== width || cells.some((c) => !Number.isFinite(Number(c)))) throw new Error('CSV: malformed row');
  }

  const jsonText = await exportJson(result).text();
  const json = JSON.parse(jsonText) as { frame_count: number; root_pos: number[]; root_rot_xyzw: number[]; dof_pos: number[]; dof_names: string[] };
  if (json.frame_count !== T || json.root_pos.length !== 3 * T || json.root_rot_xyzw.length !== 4 * T || json.dof_pos.length !== nDof * T || json.dof_names.length !== nDof) {
    throw new Error('JSON: array lengths do not match the frame count / DoFs');
  }
  return { npzBytes: npz.byteLength, csvBytes: csv.length, jsonBytes: jsonText.length };
}

/** Problem class of a failure, for grouping in the report. */
export function classifyFailure(stage: CompatStage, message: string): string {
  if (stage === 'fetch') {
    if (/URDF .*HTTP/.test(message)) return 'urdf-download';
    if (/mesh/i.test(message)) return 'mesh-download';
    return 'download';
  }
  if (stage === 'compile') {
    if (/mesh|stl|obj/i.test(message)) return 'mujoco-mesh';
    if (/inertia|mass/i.test(message)) return 'mujoco-inertia';
    if (/root link|Ambiguous/i.test(message)) return 'multi-root';
    return 'mujoco-compile';
  }
  if (stage === 'config') return 'ik-config';
  if (stage === 'solve') return 'solver';
  if (stage === 'validate') return `motion:${message.split(':')[0]}`;
  if (stage === 'export') return 'export';
  if (stage === 'preview') return 'preview';
  return stage;
}

/** Run every stage for one gallery robot version. Never throws. */
export async function checkGalleryVersion(
  robot: GalleryRobot,
  variantId: string | null,
  motion: CompatMotion,
  options: CompatOptions = {},
): Promise<CompatReport> {
  const log = options.log ?? (() => undefined);
  const view = galleryVariantView(robot, variantId);
  const report: CompatReport = {
    key: inventoryKey(robot.id, view.variant?.id ?? null),
    robotId: robot.id,
    variantId: view.variant?.id ?? null,
    kind: motion.kind,
    clip: motion.clip,
    status: 'failed',
    limitation: null,
    failure: null,
    stages: {},
    checks: [],
    warnings: [],
    fetch: null,
    urdf: null,
    model: null,
    config: null,
    metrics: null,
    preview: null,
    exports: null,
  };

  const fail = (stage: CompatStage, message: string) => {
    report.failure ??= { stage, category: classifyFailure(stage, message), message };
  };
  async function stage<T>(name: CompatStage, fn: () => Promise<T> | T): Promise<T | undefined> {
    const t0 = performance.now();
    try {
      const value = await fn();
      report.stages[name] = { ok: true, ms: Math.round(performance.now() - t0) };
      log(`${report.key}: ${name} ok (${report.stages[name]!.ms} ms)`);
      return value;
    } catch (err) {
      const message = errMessage(err);
      report.stages[name] = { ok: false, ms: Math.round(performance.now() - t0), error: message };
      log(`${report.key}: ${name} FAILED — ${message}`);
      fail(name, message);
      return undefined;
    }
  }
  const skipRest = (from: CompatStage) => {
    for (const s of COMPAT_STAGES.slice(COMPAT_STAGES.indexOf(from))) {
      report.stages[s] ??= { ok: false, ms: 0, skipped: true };
    }
    report.status = report.limitation ? 'unsupported' : 'failed';
    return report;
  };

  // Capability gaps no ik_config can paper over (the stages still run).
  if ((robot as GalleryRobot & { loops?: unknown[] | null }).loops?.length) {
    report.limitation = {
      id: 'closed-loop',
      reason:
        'Closed kinematic loops (the gallery closes them with point welds, e.g. five-bar legs): the solver moves each ' +
        'open half of a loop on its own, so the paw is not where both halves meet.',
      followUp: 'Loop-closure tasks in the IK (pull the two welded points together each step), driven by the registry `loops`.',
    };
  }
  // fetch
  const stats: Partial<GalleryFetchStats> = {};
  const bundle = await stage('fetch', () =>
    fetchGalleryRobotBundle(robot, view.variant?.id ?? null, { fetchImpl: options.fetchImpl, convert: options.convert, stats }),
  );
  if (stats.rawUrdf) report.urdf = analyzeUrdf(stats.rawUrdf);
  if (stats.meshTargets !== undefined) {
    const { rawUrdf: _raw, ...rest } = stats as GalleryFetchStats;
    void _raw;
    report.fetch = rest;
    if (rest.meshFailed?.length) report.warnings.push(`${rest.meshFailed.length} mesh file(s) could not be loaded: ${rest.meshFailed.slice(0, 3).join('; ')}`);
    if (rest.meshDropped?.length) report.warnings.push(`${rest.meshDropped.length} mesh reference(s) have no source: ${rest.meshDropped.slice(0, 3).join(', ')}`);
  }
  if (!bundle) return skipRest('compile');

  // compile
  clearCustomRobotCache();
  const model = await stage('compile', () => loadCustomRobot(bundle as CustomRobotBundle));
  if (!model) return skipRest('parse');

  // parse
  await stage('parse', () => {
    const m = model.model;
    const jt = m.jnt_type as Int32Array;
    let hinge = 0;
    let slide = 0;
    let ball = 0;
    for (let j = 0; j < m.njnt; j++) {
      if (jt[j] === 3) hinge++;
      else if (jt[j] === 2) slide++;
      else if (jt[j] === 1) ball++;
    }
    report.model = {
      nq: model.nq,
      nv: model.nv,
      nbody: m.nbody,
      njnt: m.njnt,
      hinge,
      slide,
      ball,
      nmesh: m.nmesh,
      ngeom: m.ngeom,
      declaredDof: view.dof,
      rootBody: bundle.baseBody,
    };
    if ((jt[0] ?? -1) !== 0) throw new Error('root body has no free joint');
    if (!model.bodyIds.has(bundle.baseBody)) throw new Error(`root body ${bundle.baseBody} missing after compile`);
    const moving = hinge + slide;
    if (moving === 0) throw new Error('no moving joints');
    if (ball > 0) report.warnings.push(`${ball} ball joint(s)`);
    if (moving !== view.dof) {
      report.warnings.push(`MuJoCo counts ${moving} moving joints, the gallery declares ${view.dof} DoF`);
    }
    const u = report.urdf;
    if (u) {
      if (u.rootLinks.length > 1 && !(u.worldLink && u.rootLinks.length === 1)) {
        // `world` roots are removed by normalisation; anything else is a forest.
        const real = u.rootLinks.filter((l) => l !== 'world');
        if (real.length > 1) report.warnings.push(`URDF has ${real.length} root links: ${real.join(', ')}`);
      }
      if (u.mimicJoints) report.warnings.push(`${u.mimicJoints} mimic joint(s) solved as independent joints`);
      if (u.xacroLeftovers) report.warnings.push(`${u.xacroLeftovers} xacro leftover(s) in the URDF`);
      if (u.badInertias) report.warnings.push(`${u.badInertias} inertia tensor(s) MuJoCo rejects were replaced`);
    }
  });

  // A humanoid without legs: nothing for a walking clip to drive.
  if (motion.kind === 'humanoid' && !analyzeHumanoid(model, bundle.baseBody)) {
    report.limitation = {
      id: 'no-legs',
      reason:
        'The structural template finds no pair of legs ending near the floor: a wheeled or lift-base upper body ' +
        '(TianYi 2.0), or point / wheel feet it does not map yet. A walking clip has nothing to drive.',
      followUp:
        'Upper-body mode for legless humanoids (root on the human pelvis path, torso and arms only); foot tips for point-foot legs.',
    };
  }

  // config
  const choice = await stage('config', () => {
    const c = chooseCustomConfig(model, bundle);
    const required = new Set<string>([c.config.human_root_name]);
    for (const e of [...Object.values(c.config.ik_match_table1), ...Object.values(c.config.ik_match_table2)]) required.add(e[0]);
    const missing = findMissingBodies(motion.frames, [...required]);
    if (missing.length) throw new Error(`motion lacks ${missing.join(', ')}`);
    for (const b of [c.config.robot_root_name, ...Object.keys(c.config.ik_match_table1), ...Object.keys(c.config.ik_match_table2)]) {
      if (!model.bodyIds.has(b)) throw new Error(`config names body ${b}, which the model lacks`);
    }
    report.config = {
      source: c.source,
      root: c.config.robot_root_name,
      mapped: Object.fromEntries(Object.entries(c.config.ik_match_table2).map(([robotBody, e]) => [e[0], robotBody])),
    };
    return c;
  });
  if (!choice) return skipRest('solve');

  // solve
  const solver: SolverOptions = { ...DEFAULT_SOLVER_OPTIONS, ...options.solver };
  const result = await stage('solve', () =>
    runRetarget({ robot: model, config: choice.config, solver, frames: motion.frames, fps: motion.fps }),
  );
  if (!result) return skipRest('validate');

  // validate
  await stage('validate', () => {
    // Which way the robot faces at rest (a URDF may face +y): from the legs.
    const sk = motion.kind === 'humanoid' ? analyzeHumanoid(model, bundle.baseBody) : null;
    const forward: [number, number, number] | undefined = sk ? [Math.cos(-sk.yaw), Math.sin(-sk.yaw), 0] : undefined;
    const { metrics, checks } = validateRetarget(model, choice.config, result, motion.kind, motion.frames.length, forward);
    report.metrics = metrics;
    report.checks = checks;
    for (const c of checks) if (!c.ok && c.severity === 'warn') report.warnings.push(`${c.id}: ${c.detail} (${c.value} vs ${c.limit})`);
    const failed = checks.filter((c) => !c.ok && c.severity === 'fail');
    if (failed.length) throw new Error(failed.map((c) => `${c.id}: ${c.value} (limit ${c.limit})`).join('; '));
  });

  // preview
  const T = result.frameCount;
  const frames = [0, Math.round(T / 3), Math.round((2 * T) / 3), T - 1].filter((f, i, a) => f >= 0 && a.indexOf(f) === i);
  if (options.renderPreview) {
    const images = await stage('preview', () => options.renderPreview!(model, result, frames));
    if (images) {
      if (!images.length || images.some((s) => !s || s.length < 1000)) {
        report.stages.preview = { ok: false, ms: report.stages.preview?.ms ?? 0, error: 'blank or missing preview image' };
        fail('preview', 'blank or missing preview image');
      }
      report.preview = { frames, images };
    }
  } else {
    report.stages.preview = { ok: true, ms: 0, skipped: true };
  }

  // export
  report.exports = (await stage('export', () => checkExports(result))) ?? null;

  report.status = report.limitation ? 'unsupported' : report.failure ? 'failed' : 'passed';
  return report;
}
