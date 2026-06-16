/**
 * SMPL-X body-model and AMASS-motion parsing.
 *
 * To produce the *joint keypoints* GMR consumes we only need the body model's
 * shape/skeleton terms — `v_template`, `shapedirs`, `J_regressor`,
 * `kintree_table` — not the mesh/skinning terms (`posedirs`, `weights`, faces).
 * Joint positions are `J_regressor @ (v_template + shapedirs·betas)` followed by
 * a rigid kinematic-chain transform (see `fk.ts`); pose blend shapes only move
 * mesh vertices, never joints. So a model file is parsed into the minimum below.
 *
 * SMPL-X body models are license-restricted (https://smpl-x.is.tue.mpg.de) and
 * are NEVER bundled — the user supplies their own `.npz`, kept in memory only.
 */

import { asNumbers, parseNpz, type NpyArray } from './npy';

/**
 * Standard SMPL / SMPL-X *body* joint ordering (indices 0..21). Hands, face and
 * the SMPL-X extras (indices 22+) are not needed for retargeting keypoints.
 * The `smplx_to_*` ik_configs reference a subset of these names.
 */
export const SMPLX_BODY_JOINT_NAMES = [
  'pelvis',        // 0
  'left_hip',      // 1
  'right_hip',     // 2
  'spine1',        // 3
  'left_knee',     // 4
  'right_knee',    // 5
  'spine2',        // 6
  'left_ankle',    // 7
  'right_ankle',   // 8
  'spine3',        // 9
  'left_foot',     // 10
  'right_foot',    // 11
  'neck',          // 12
  'left_collar',   // 13
  'right_collar',  // 14
  'head',          // 15
  'left_shoulder', // 16
  'right_shoulder',// 17
  'left_elbow',    // 18
  'right_elbow',   // 19
  'left_wrist',    // 20
  'right_wrist',   // 21
] as const;

export const SMPLX_NUM_BODY_JOINTS = SMPLX_BODY_JOINT_NAMES.length;

/**
 * Canonical SMPL/SMPL-X parents for the 22 body joints. Used as a fallback when
 * a model file does not expose `kintree_table` (e.g. a minimal test fixture);
 * a real model's `kintree_table[0]` is preferred and matches this.
 */
export const SMPLX_BODY_PARENTS: number[] = [
  -1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19,
];

/** Minimum SMPL-X body model needed to compute joint keypoints. */
export interface SmplxBodyModel {
  numVerts: number;
  numJoints: number; // joints regressed by J_regressor (>= 22)
  numShape: number; // shape coefficients available in shapedirs
  /** v_template, row-major [v*3 + c]. */
  vTemplate: Float64Array;
  /** shapedirs, C-order of (V, 3, B): [(v*3 + c)*numShape + b]. */
  shapeDirs: Float64Array;
  /** J_regressor, row-major [j*numVerts + v]. */
  jRegressor: Float64Array;
  /** Parent index per joint (parents[0] = -1). */
  parents: Int32Array;
}

/** One AMASS frame: axis-angle root + body pose, plus root translation. */
export interface SmplxFrameParams {
  /** Root orientation, axis-angle (3). */
  rootOrient: [number, number, number];
  /** Body pose for joints 1..21, axis-angle, flat length 63. */
  bodyPose: Float64Array;
  /** Root translation (3), meters. */
  trans: [number, number, number];
}

export interface SmplxMotion {
  betas: Float64Array;
  frames: SmplxFrameParams[];
  fps: number;
}

function require2d(npz: Record<string, NpyArray>, name: string): NpyArray {
  const a = npz[name];
  if (!a) throw new Error(`SMPL-X model missing "${name}"`);
  return a;
}

/** Parse a user-supplied SMPL-X model `.npz` into the minimal `SmplxBodyModel`. */
export function parseSmplxModel(bytes: Uint8Array): SmplxBodyModel {
  const npz = parseNpz(bytes);

  const vt = require2d(npz, 'v_template');
  const sd = require2d(npz, 'shapedirs');
  const jr = require2d(npz, 'J_regressor');

  const numVerts = vt.shape[0];
  if (vt.shape[1] !== 3) throw new Error('v_template must be (V, 3)');
  // shapedirs is (V, 3, B).
  if (sd.shape.length !== 3 || sd.shape[0] !== numVerts || sd.shape[1] !== 3) {
    throw new Error('shapedirs must be (V, 3, B)');
  }
  const numShape = sd.shape[2];
  // J_regressor is (J, V).
  if (jr.shape.length !== 2 || jr.shape[1] !== numVerts) {
    throw new Error('J_regressor must be (J, V)');
  }
  const numJoints = jr.shape[0];

  let parents: Int32Array;
  const kt = npz['kintree_table'];
  if (kt && kt.shape.length === 2 && kt.shape[0] >= 1) {
    // kintree_table[0] = parents; the root's parent is a sentinel (large/neg).
    const row = asNumbers(kt).slice(0, kt.shape[1]);
    parents = Int32Array.from(row, (p) => (p > 1e6 || p < 0 ? -1 : p));
    if (parents.length > 0) parents[0] = -1;
  } else {
    parents = Int32Array.from(SMPLX_BODY_PARENTS);
  }

  return {
    numVerts,
    numJoints,
    numShape,
    vTemplate: Float64Array.from(asNumbers(vt)),
    shapeDirs: Float64Array.from(asNumbers(sd)),
    jRegressor: Float64Array.from(asNumbers(jr)),
    parents,
  };
}

/** Read a scalar numeric field (e.g. a frame rate) if present. */
function readScalar(npz: Record<string, NpyArray>, ...names: string[]): number | undefined {
  for (const n of names) {
    const a = npz[n];
    if (a && a.data.length >= 1) {
      const v = a.data[0];
      return typeof v === 'bigint' ? Number(v) : v;
    }
  }
  return undefined;
}

/**
 * Parse an AMASS motion `.npz`. Supports both the SMPL-X layout
 * (`pose_body` + `root_orient` + `trans`) and the combined `poses` array
 * (root = poses[:3], body = poses[3:66]).
 */
export function parseAmassMotion(bytes: Uint8Array): SmplxMotion {
  const npz = parseNpz(bytes);

  const betasArr = npz['betas'];
  const betas = betasArr ? Float64Array.from(asNumbers(betasArr)) : new Float64Array(16);

  const fps = readScalar(npz, 'mocap_frame_rate', 'mocap_framerate', 'fps') ?? 30;

  const transArr = npz['trans'];

  const poseBody = npz['pose_body'];
  const rootOrient = npz['root_orient'];
  const poses = npz['poses'];

  const frames: SmplxFrameParams[] = [];

  if (poseBody && rootOrient) {
    const N = poseBody.shape[0];
    const bodyCols = poseBody.shape[1]; // 63
    const pb = asNumbers(poseBody);
    const ro = asNumbers(rootOrient);
    const tr = transArr ? asNumbers(transArr) : null;
    for (let f = 0; f < N; f++) {
      const body = new Float64Array(63);
      for (let c = 0; c < 63 && c < bodyCols; c++) body[c] = pb[f * bodyCols + c];
      frames.push({
        rootOrient: [ro[f * 3], ro[f * 3 + 1], ro[f * 3 + 2]],
        bodyPose: body,
        trans: tr ? [tr[f * 3], tr[f * 3 + 1], tr[f * 3 + 2]] : [0, 0, 0],
      });
    }
  } else if (poses) {
    const N = poses.shape[0];
    const cols = poses.shape[1];
    if (cols < 66) throw new Error(`AMASS "poses" has too few columns (${cols} < 66)`);
    const p = asNumbers(poses);
    const tr = transArr ? asNumbers(transArr) : null;
    for (let f = 0; f < N; f++) {
      const base = f * cols;
      const body = new Float64Array(63);
      for (let c = 0; c < 63; c++) body[c] = p[base + 3 + c];
      frames.push({
        rootOrient: [p[base], p[base + 1], p[base + 2]],
        bodyPose: body,
        trans: tr ? [tr[f * 3], tr[f * 3 + 1], tr[f * 3 + 2]] : [0, 0, 0],
      });
    }
  } else {
    throw new Error('AMASS motion missing "pose_body"/"root_orient" or "poses"');
  }

  return { betas, frames, fps };
}
