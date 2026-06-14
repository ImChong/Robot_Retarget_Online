/**
 * Convert a sequence of MediaPipe pose frames into a LAFAN1-compatible BVH
 * string that the existing viewer (`parseBvh`) and retargeting pipeline
 * (`bvhToLafan1Frames`) consume unchanged.
 *
 * Approach (position → rotation):
 *  - The output skeleton is the fixed 22-joint LAFAN1 hierarchy (Y-up, cm), so
 *    bone *lengths* come from the rest offsets — we only read bone *directions*
 *    from the landmarks, which neatly removes limb-length jitter.
 *  - Per joint, the local rotation is the minimal (swing-only) rotation that
 *    takes the rest bone direction onto the observed bone direction, expressed
 *    in the parent's frame:  q_local = fromTo(restDir, parent⁻¹ · obsDir).
 *    Forward kinematics then reproduces every bone direction exactly. Twist
 *    about each bone axis is unobservable from positions and left at zero.
 *  - The root (Hips) orientation is built directly from a body frame
 *    (torso-up + pelvis-left). Global translation is not recoverable from
 *    BlazePose world landmarks (they are hip-centered), so the motion is
 *    "in place": horizontal ≈ 0, vertical follows the hip-above-feet height.
 */

import {
  quatConj,
  quatFromMat3,
  quatFromTo,
  quatMul,
  quatRotate,
  quatToEulerZYX,
  vCross,
  vDot,
  vNorm,
  vScale,
  vSub,
  type Quat,
  type Vec3,
} from '../math3d';
import { LM, type PoseFrame } from './types';

interface SkelJoint {
  name: string;
  parent: number; // index into JOINTS, -1 for root
  offset: Vec3; // local rest offset (cm), Y-up
  /** BlazePose-derived world position used as this joint's location. */
  site: (p: Vec3[]) => Vec3;
  /** Leaf joints (with an End Site) carry no rotation. */
  leaf?: boolean;
}

const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// Convenience landmark accessors (already in skeleton/world space when called).
const hipsC = (p: Vec3[]) => mid(p[LM.leftHip], p[LM.rightHip]);
const shouldersC = (p: Vec3[]) => mid(p[LM.leftShoulder], p[LM.rightShoulder]);

/**
 * The LAFAN1 skeleton (offsets in cm, taken from the bundled sample clips).
 * Order is a valid parent-before-child topological order.
 */
const JOINTS: SkelJoint[] = [
  { name: 'Hips', parent: -1, offset: [0, 0, 0], site: hipsC },
  // Left leg
  { name: 'LeftUpLeg', parent: 0, offset: [0.103459, 1.857827, 10.548504], site: (p) => p[LM.leftHip] },
  { name: 'LeftLeg', parent: 1, offset: [43.500008, 0, 0.000004], site: (p) => p[LM.leftKnee] },
  { name: 'LeftFoot', parent: 2, offset: [42.372192, 0.000011, 0], site: (p) => p[LM.leftAnkle] },
  { name: 'LeftToe', parent: 3, offset: [17.299973, -0.000013, -0.00001], site: (p) => p[LM.leftFootIndex], leaf: true },
  // Right leg
  { name: 'RightUpLeg', parent: 0, offset: [0.103454, 1.85783, -10.5485], site: (p) => p[LM.rightHip] },
  { name: 'RightLeg', parent: 5, offset: [43.500038, -0.000038, 0.000004], site: (p) => p[LM.rightKnee] },
  { name: 'RightFoot', parent: 6, offset: [42.372253, 0.000019, 0.000024], site: (p) => p[LM.rightAnkle] },
  { name: 'RightToe', parent: 7, offset: [17.299988, -0.000007, 0.000004], site: (p) => p[LM.rightFootIndex], leaf: true },
  // Spine → head
  { name: 'Spine', parent: 0, offset: [6.901963, -2.603744, 0.000004], site: (p) => lerp(hipsC(p), shouldersC(p), 0.25) },
  { name: 'Spine1', parent: 9, offset: [12.588104, 0.000008, -0.00001], site: (p) => lerp(hipsC(p), shouldersC(p), 0.5) },
  { name: 'Spine2', parent: 10, offset: [12.343202, -0.000005, 0.00001], site: (p) => lerp(hipsC(p), shouldersC(p), 0.75) },
  { name: 'Neck', parent: 11, offset: [25.832897, 0, 0.000001], site: shouldersC },
  { name: 'Head', parent: 12, offset: [11.766611, -0.000006, 0], site: (p) => mid(p[LM.leftEar], p[LM.rightEar]), leaf: true },
  // Left arm
  { name: 'LeftShoulder', parent: 11, offset: [19.745899, -1.480366, 6.000108], site: shouldersC },
  { name: 'LeftArm', parent: 14, offset: [11.284111, -0.000018, -0.000015], site: (p) => p[LM.leftShoulder] },
  { name: 'LeftForeArm', parent: 15, offset: [33.00005, -0.000005, 0.000028], site: (p) => p[LM.leftElbow] },
  { name: 'LeftHand', parent: 16, offset: [25.200012, 0, 0.000002], site: (p) => p[LM.leftWrist], leaf: true },
  // Right arm
  { name: 'RightShoulder', parent: 11, offset: [19.746111, -1.480335, -6.000074], site: shouldersC },
  { name: 'RightArm', parent: 18, offset: [11.284151, 0.000036, 0.000001], site: (p) => p[LM.rightShoulder] },
  { name: 'RightForeArm', parent: 19, offset: [33.000092, -0.000035, 0.000022], site: (p) => p[LM.rightElbow] },
  { name: 'RightHand', parent: 20, offset: [25.199768, 0.000178, 0.000417], site: (p) => p[LM.rightWrist], leaf: true },
];

const NAME_TO_INDEX = new Map(JOINTS.map((j, i) => [j.name, i]));
const idx = (name: string) => NAME_TO_INDEX.get(name)!;

// Primary child per joint (the bone used to orient the joint). Branch joints
// (Hips, Spine2) pick their main chain child; the others have a single child.
const PRIMARY_CHILD: number[] = JOINTS.map(() => -1);
{
  for (let j = 0; j < JOINTS.length; j++) {
    const p = JOINTS[j].parent;
    if (p >= 0 && PRIMARY_CHILD[p] < 0) PRIMARY_CHILD[p] = j;
  }
  // Override branch joints so the chain follows spine → neck (not legs/arms).
  PRIMARY_CHILD[idx('Hips')] = idx('Spine');
  PRIMARY_CHILD[idx('Spine2')] = idx('Neck');
}

// Rest bone direction for each joint, in the joint's local frame (= normalized
// offset of its primary child).
const REST_DIR: Vec3[] = JOINTS.map((_, j) => {
  const c = PRIMARY_CHILD[j];
  if (c < 0) return [1, 0, 0];
  return normalize(JOINTS[c].offset);
});

function normalize(v: Vec3): Vec3 {
  const n = vNorm(v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * Convert MediaPipe world axes (x right, y down, z toward camera) into the
 * BVH skeleton's Y-up frame. Sign flags are isolated here so orientation can be
 * corrected in one place if a clip comes out mirrored or upside down.
 */
const AXIS = { x: 1, y: -1, z: -1 };
function mpToSkel(v: Vec3): Vec3 {
  return [AXIS.x * v[0], AXIS.y * v[1], AXIS.z * v[2]];
}

/** Orthonormal basis (as 3 column vectors) from a primary + secondary axis. */
function basis(primary: Vec3, secondary: Vec3): [Vec3, Vec3, Vec3] {
  const e1 = normalize(primary);
  let e2 = vSub(secondary, vScale(e1, vDot(secondary, e1)));
  e2 = normalize(e2);
  const e3 = vCross(e1, e2);
  return [e1, e2, e3];
}

/** Rotation mapping the LAFAN1 Hips-local frame onto the observed body frame. */
function rootQuat(p: Vec3[]): Quat {
  const hips = hipsC(p);
  const worldUp = normalize(vSub(shouldersC(p), hips)); // torso up
  const worldLeft = normalize(vSub(p[LM.leftHip], p[LM.rightHip])); // pelvis → subject-left
  const localUp = normalize(JOINTS[idx('Spine')].offset); // Hips → Spine at rest
  const localLeft = normalize(JOINTS[idx('LeftUpLeg')].offset); // Hips → LeftUpLeg at rest
  const W = basis(worldUp, worldLeft);
  const L = basis(localUp, localLeft);
  // R = W · Lᵀ  (maps local axis k onto world axis k)
  const R: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) R[r][c] = W[0][r] * L[0][c] + W[1][r] * L[1][c] + W[2][r] * L[2][c];
  return quatFromMat3(R);
}

export interface PosesToBvhResult {
  bvh: string;
  fps: number;
  frameCount: number;
}

export interface PosesToBvhOptions {
  /** Frames whose key joints fall below this visibility hold the previous pose. */
  minVisibility?: number;
}

/**
 * Build a LAFAN1 BVH string from pose frames.
 * Returns BVH text ready for `useMotionStore().loadBvhText(text, name)`.
 */
export function posesToBvh(
  frames: PoseFrame[],
  fps: number,
  opts: PosesToBvhOptions = {},
): PosesToBvhResult {
  const minVis = opts.minVisibility ?? 0.3;
  const J = JOINTS.length;
  const DEG = 180 / Math.PI;

  // Per-frame channel rows (root: 6 channels, others: 3).
  const rows: string[] = [];
  let prevLocal: Quat[] | null = null;

  for (const frame of frames) {
    // Landmarks in skeleton (Y-up) space.
    const p = frame.world.map(mpToSkel);
    // Joint world positions from the mapping sites.
    const pos: Vec3[] = JOINTS.map((joint) => joint.site(p));

    const qGlobal: Quat[] = new Array(J);
    const qLocal: Quat[] = new Array(J);

    qLocal[0] = rootQuat(p);
    qGlobal[0] = qLocal[0];

    for (let j = 1; j < J; j++) {
      const parent = JOINTS[j].parent;
      const child = PRIMARY_CHILD[j];
      if (JOINTS[j].leaf || child < 0) {
        qLocal[j] = [1, 0, 0, 0];
        qGlobal[j] = qGlobal[parent];
        continue;
      }
      const vis = Math.min(
        frame.visibility[siteLandmark(j)] ?? 1,
        frame.visibility[siteLandmark(child)] ?? 1,
      );
      if (vis < minVis && prevLocal) {
        // Low confidence: hold the previous frame's local rotation.
        qLocal[j] = prevLocal[j];
        qGlobal[j] = quatMul(qGlobal[parent], qLocal[j]);
        continue;
      }
      const obs = normalize(vSub(pos[child], pos[j]));
      const obsInParent = quatRotate(quatConj(qGlobal[parent]), obs);
      qLocal[j] = quatFromTo(REST_DIR[j], obsInParent);
      qGlobal[j] = quatMul(qGlobal[parent], qLocal[j]);
    }
    prevLocal = qLocal;

    // Root translation: in-place, vertical = hips height above the lowest foot.
    const hips = pos[0];
    const footY = Math.min(
      p[LM.leftAnkle][1],
      p[LM.rightAnkle][1],
      p[LM.leftHeel][1],
      p[LM.rightHeel][1],
      p[LM.leftFootIndex][1],
      p[LM.rightFootIndex][1],
    );
    const rootCm: Vec3 = [hips[0] * 100, (hips[1] - footY) * 100, hips[2] * 100];

    // Channel values follow the hierarchy (depth-first = JOINTS order). Every
    // joint — including leaves, which carry an identity rotation — emits 3
    // rotation channels so counts stay aligned with the declared hierarchy.
    const vals: number[] = [rootCm[0], rootCm[1], rootCm[2]];
    for (let j = 0; j < J; j++) {
      const e = quatToEulerZYX(qLocal[j]); // [z, y, x] radians
      vals.push(e[0] * DEG, e[1] * DEG, e[2] * DEG);
    }
    rows.push(vals.map((v) => fmt(v)).join(' '));
  }

  const header = buildHierarchy();
  const motion = `MOTION\nFrames: ${frames.length}\nFrame Time: ${(1 / fps).toFixed(6)}\n${rows.join('\n')}\n`;
  return { bvh: `${header}${motion}`, fps, frameCount: frames.length };
}

/** Landmark index whose visibility represents a joint's location. */
function siteLandmark(j: number): number {
  // Map joint → a representative landmark for the visibility check.
  const name = JOINTS[j].name;
  const table: Record<string, number> = {
    LeftUpLeg: LM.leftHip, LeftLeg: LM.leftKnee, LeftFoot: LM.leftAnkle, LeftToe: LM.leftFootIndex,
    RightUpLeg: LM.rightHip, RightLeg: LM.rightKnee, RightFoot: LM.rightAnkle, RightToe: LM.rightFootIndex,
    Neck: LM.nose, Head: LM.nose,
    LeftArm: LM.leftShoulder, LeftForeArm: LM.leftElbow, LeftHand: LM.leftWrist,
    RightArm: LM.rightShoulder, RightForeArm: LM.rightElbow, RightHand: LM.rightWrist,
  };
  return table[name] ?? LM.leftHip;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '0.000000';
  return v.toFixed(6);
}

/** Emit the HIERARCHY block for the fixed skeleton. */
function buildHierarchy(): string {
  const childrenOf: number[][] = JOINTS.map(() => []);
  for (let j = 0; j < JOINTS.length; j++) {
    const p = JOINTS[j].parent;
    if (p >= 0) childrenOf[p].push(j);
  }
  const lines: string[] = ['HIERARCHY'];
  const writeJoint = (j: number, depth: number) => {
    const pad = '\t'.repeat(depth);
    const joint = JOINTS[j];
    const kw = joint.parent < 0 ? `ROOT ${joint.name}` : `JOINT ${joint.name}`;
    lines.push(`${pad}${kw}`);
    lines.push(`${pad}{`);
    const o = joint.offset;
    lines.push(`${pad}\tOFFSET ${o[0].toFixed(6)} ${o[1].toFixed(6)} ${o[2].toFixed(6)}`);
    lines.push(
      joint.parent < 0
        ? `${pad}\tCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation`
        : `${pad}\tCHANNELS 3 Zrotation Yrotation Xrotation`,
    );
    if (joint.leaf) {
      lines.push(`${pad}\tEnd Site`);
      lines.push(`${pad}\t{`);
      lines.push(`${pad}\t\tOFFSET 0.000000 0.000000 0.000000`);
      lines.push(`${pad}\t}`);
    } else {
      for (const c of childrenOf[j]) writeJoint(c, depth + 1);
    }
    lines.push(`${pad}}`);
  };
  writeJoint(0, 0);
  return lines.join('\n') + '\n';
}

/** Exposed for tests. */
export const __testing = { JOINTS, PRIMARY_CHILD, REST_DIR, rootQuat, mpToSkel, buildHierarchy };
