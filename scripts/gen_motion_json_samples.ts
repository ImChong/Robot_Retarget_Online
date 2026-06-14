/**
 * Generate the bundled Retarget Motion JSON sample clips
 * (`public/sample_motions/*.motion.json`).
 *
 * Run with vite-node so it reuses the real loader/FK/serializer:
 *   npx vite-node scripts/gen_motion_json_samples.ts
 *
 * Produces:
 *  - walk.motion.json            — a 6 s slice of the bundled LAFAN1 walk clip,
 *    re-encoded into the JSON format (real motion; proves BVH → JSON fidelity).
 *  - wave.motion.json            — procedural: stand + right-arm wave.
 *  - squat.motion.json           — procedural: symmetric squat reps.
 *  - tpose_calibration.motion.json — procedural: arms A-pose → T-pose → A-pose.
 *
 * The procedural clips are authored on a clean, auto-grounded standing pose built
 * from the LAFAN1 rest skeleton via FK-consistent swing rotations (the same idea
 * as src/lib/mocap/landmarksToBvh.ts), so they preview upright and retarget.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseBvh, bvhFk, type BvhAnim } from '../src/lib/bvh/parse';
import { bvhAnimToMotionJson } from '../src/lib/motion/motionJson';
import {
  quatConj,
  quatFromMat3,
  quatFromTo,
  quatMul,
  quatRotate,
  vCross,
  vDot,
  vNorm,
  vScale,
  vSub,
  type Quat,
  type Vec3,
} from '../src/lib/math3d';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public', 'sample_motions');
const FPS = 30;

// ---------------------------------------------------------------- skeleton
const src = parseBvh(readFileSync(join(OUT, 'walk.bvh'), 'utf-8'));
const joints = src.joints;
const J = joints.length;
const nameToIdx = new Map(joints.map((j, i) => [j.name, i] as const));
const idx = (n: string): number => {
  const i = nameToIdx.get(n);
  if (i === undefined) throw new Error(`skeleton is missing joint "${n}"`);
  return i;
};
const rootIdx = joints.findIndex((j) => j.parent < 0);

const norm = (v: Vec3): Vec3 => {
  const n = vNorm(v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

// Primary (main-chain) child per joint; branch joints follow the spine.
const primaryChild = joints.map(() => -1);
for (let j = 0; j < J; j++) {
  const p = joints[j].parent;
  if (p >= 0 && primaryChild[p] < 0) primaryChild[p] = j;
}
primaryChild[idx('Hips')] = idx('Spine');
primaryChild[idx('Spine2')] = idx('Neck');

// Rest direction of each joint's primary bone, in its local frame.
const restDir: Vec3[] = joints.map((_, j) => {
  const c = primaryChild[j];
  return c < 0 ? ([1, 0, 0] as Vec3) : norm(joints[c].offset);
});

const IDENT: Quat = [1, 0, 0, 0];

/** Orthonormal basis (3 column vectors) from a primary + secondary axis. */
function basis(primary: Vec3, secondary: Vec3): [Vec3, Vec3, Vec3] {
  const e1 = norm(primary);
  const e2 = norm(vSub(secondary, vScale(e1, vDot(secondary, e1))));
  const e3 = vCross(e1, e2);
  return [e1, e2, e3];
}

// Pelvis orientation that stands the figure up (Y-up) facing +X (left = +Z).
const ROOT_QUAT: Quat = (() => {
  const localUp = norm(joints[idx('Spine')].offset);
  const localLeft = norm(joints[idx('LeftUpLeg')].offset);
  const W = basis([0, 1, 0], [0, 0, 1]);
  const L = basis(localUp, localLeft);
  const R = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) R[r][c] = W[0][r] * L[0][c] + W[1][r] * L[1][c] + W[2][r] * L[2][c];
  return quatFromMat3(R);
})();

/**
 * Build per-joint local quaternions for a pose specified as desired *global*
 * directions of each joint's primary bone (Y-up, file frame). Joints without an
 * entry keep their rest direction; leaves carry identity.
 */
function buildPose(targets: Map<number, Vec3>): Quat[] {
  const qG = new Array<Quat>(J);
  const qL = new Array<Quat>(J);
  qL[rootIdx] = ROOT_QUAT;
  qG[rootIdx] = ROOT_QUAT;
  for (let j = 0; j < J; j++) {
    if (j === rootIdx) continue;
    const p = joints[j].parent;
    const child = primaryChild[j];
    if (child < 0) {
      qL[j] = IDENT;
      qG[j] = qG[p];
      continue;
    }
    const target = targets.get(j);
    if (!target) {
      qL[j] = IDENT;
      qG[j] = quatMul(qG[p], IDENT);
      continue;
    }
    const obsInParent = quatRotate(quatConj(qG[p]), norm(target));
    qL[j] = quatFromTo(restDir[j], obsInParent);
    qG[j] = quatMul(qG[p], qL[j]);
  }
  return qL;
}

// Common direction constants (Y-up file frame: +X forward, +Y up, +Z left).
const UP: Vec3 = [0, 1, 0];
const LEFT: Vec3 = [0, 0, 1];
const RIGHT: Vec3 = [0, 0, -1];
const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Neutral standing target directions (arms in a relaxed A-pose). */
function neutralTargets(): Map<number, Vec3> {
  const m = new Map<number, Vec3>();
  for (const n of ['Spine', 'Spine1', 'Spine2', 'Neck']) m.set(idx(n), UP);
  m.set(idx('LeftShoulder'), LEFT);
  m.set(idx('RightShoulder'), RIGHT);
  m.set(idx('LeftArm'), norm([0, -1, 0.4]));
  m.set(idx('RightArm'), norm([0, -1, -0.4]));
  m.set(idx('LeftForeArm'), norm([0, -1, 0.25]));
  m.set(idx('RightForeArm'), norm([0, -1, -0.25]));
  for (const n of ['LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg']) m.set(idx(n), [0, -1, 0]);
  m.set(idx('LeftFoot'), norm([1, -0.15, 0]));
  m.set(idx('RightFoot'), norm([1, -0.15, 0]));
  return m;
}

// ---------------------------------------------------------------- assembly
interface Frame {
  q: Quat[];
  root: Vec3;
}

function buildAnim(frames: Frame[]): BvhAnim {
  const F = frames.length;
  const localPos = new Float64Array(F * J * 3);
  const localQuat = new Float64Array(F * J * 4);
  for (let f = 0; f < F; f++) {
    const { q, root } = frames[f];
    for (let j = 0; j < J; j++) {
      const pb = (f * J + j) * 3;
      localPos[pb] = joints[j].offset[0];
      localPos[pb + 1] = joints[j].offset[1];
      localPos[pb + 2] = joints[j].offset[2];
      const qb = (f * J + j) * 4;
      localQuat[qb] = q[j][0];
      localQuat[qb + 1] = q[j][1];
      localQuat[qb + 2] = q[j][2];
      localQuat[qb + 3] = q[j][3];
    }
    const rb = (f * J + rootIdx) * 3;
    localPos[rb] = root[0];
    localPos[rb + 1] = root[1];
    localPos[rb + 2] = root[2];
  }
  return { joints, endSites: src.endSites, frameCount: F, frameTime: 1 / FPS, localPos, localQuat };
}

/** Root translation that plants the lowest joint on the ground (in place). */
function groundedRoot(q: Quat[]): Vec3 {
  const anim = buildAnim([{ q, root: [0, 0, 0] }]);
  const { globalPos } = bvhFk(anim);
  let minY = Infinity;
  for (let j = 0; j < J; j++) minY = Math.min(minY, globalPos[j * 3 + 1]);
  return [0, -minY, 0];
}

function write(name: string, anim: BvhAnim) {
  const doc = bvhAnimToMotionJson(anim, { unitScale: 0.01, name });
  const path = join(OUT, `${name}.motion.json`);
  writeFileSync(path, JSON.stringify(doc));
  const kb = (JSON.stringify(doc).length / 1024).toFixed(0);
  console.log(`wrote ${path}  (${anim.frameCount} frames, ${kb} KiB)`);
}

// ---------------------------------------------------------------- clips
function makeProcedural(seconds: number, targetsAt: (t: number) => Map<number, Vec3>): BvhAnim {
  const F = Math.round(seconds * FPS);
  const frames: Frame[] = [];
  for (let f = 0; f < F; f++) {
    const q = buildPose(targetsAt(f / FPS));
    frames.push({ q, root: groundedRoot(q) });
  }
  return buildAnim(frames);
}

// 1) Walk — re-encode a slice of the LAFAN1 walk clip (real motion + translation).
function walkClip(frameCount: number): BvhAnim {
  const F = Math.min(frameCount, src.frameCount);
  const localPos = src.localPos.slice(0, F * J * 3);
  const localQuat = src.localQuat.slice(0, F * J * 4);
  // Re-zero horizontal root so the clip starts at the origin (vertical kept).
  const x0 = localPos[rootIdx * 3];
  const z0 = localPos[rootIdx * 3 + 2];
  for (let f = 0; f < F; f++) {
    localPos[(f * J + rootIdx) * 3] -= x0;
    localPos[(f * J + rootIdx) * 3 + 2] -= z0;
  }
  return { joints, endSites: src.endSites, frameCount: F, frameTime: src.frameTime, localPos, localQuat };
}

// 2) Wave — raise the right arm and wave the forearm side to side.
function waveTargets(t: number): Map<number, Vec3> {
  const m = neutralTargets();
  const raise = smooth(clamp01(t / 0.6)); // lift over the first 0.6 s
  m.set(idx('RightArm'), norm(lerpV([0, -1, -0.4], [0, 0.25, -1], raise)));
  const swing = Math.sin(2 * Math.PI * 1.1 * t) * 0.6;
  m.set(idx('RightForeArm'), norm([swing, 1, -0.3]));
  return m;
}

// 3) Squat — bend hip + knee symmetrically (thigh forward, shin back) so the
// ankle stays under the hip; FK grounding lowers the hips. Torso stays upright.
function squatTargets(t: number): Map<number, Vec3> {
  const m = neutralTargets();
  const reps = 3;
  const depth = (1 - Math.cos((2 * Math.PI * reps * t) / 6)) / 2; // 0..1 over 6 s
  const thigh = norm([0.3 * depth, -1, 0]); // hip → knee tips forward
  const shin = norm([-0.3 * depth, -1, 0]); // knee → ankle tips back (knee bends)
  m.set(idx('LeftUpLeg'), thigh);
  m.set(idx('RightUpLeg'), thigh);
  m.set(idx('LeftLeg'), shin);
  m.set(idx('RightLeg'), shin);
  return m;
}

// 4) T-pose calibration — arms sweep A-pose → T-pose → A-pose.
function tposeTargets(t: number): Map<number, Vec3> {
  const m = neutralTargets();
  // Triangle 0→1→0 over 4 s, eased.
  const raise = smooth(1 - Math.abs((t % 4) / 2 - 1));
  m.set(idx('LeftArm'), norm(lerpV([0, -1, 0.4], LEFT, raise)));
  m.set(idx('RightArm'), norm(lerpV([0, -1, -0.4], RIGHT, raise)));
  m.set(idx('LeftForeArm'), norm(lerpV([0, -1, 0.25], LEFT, raise)));
  m.set(idx('RightForeArm'), norm(lerpV([0, -1, -0.25], RIGHT, raise)));
  return m;
}

write('walk', walkClip(180));
write('wave', makeProcedural(5, waveTargets));
write('squat', makeProcedural(6, squatTargets));
write('tpose_calibration', makeProcedural(4, tposeTargets));
console.log('done.');
