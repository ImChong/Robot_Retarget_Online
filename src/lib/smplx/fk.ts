/**
 * SMPL-X forward kinematics → GMR human keypoints.
 *
 * Mirrors the role of `bvh/lafan1.ts` for the BVH path: turns source motion into
 * `HumanFrame`s (Z-up, meters) keyed by the joint names the `smplx_to_*`
 * ik_configs use, so the existing retargeting engine consumes SMPL-X exactly
 * like BVH.
 *
 * Joint computation follows SMPL's `lbs` joint path (no mesh skinning needed):
 *   1. shape the rest joints:   J = J_regressor @ (v_template + shapedirs·betas)
 *   2. rigid kinematic chain:   batch_rigid_transform(axis-angle pose, J, parents)
 *   3. add root translation, then convert the SMPL-X (Y-up) frame to GMR Z-up.
 */

import { quatFromMat3, quatMul, quatRotate, type Quat, type Vec3 } from '../math3d';
import type { HumanFrame } from '../bvh/lafan1';
import {
  SMPLX_BODY_JOINT_NAMES,
  SMPLX_NUM_BODY_JOINTS,
  type SmplxBodyModel,
  type SmplxFrameParams,
  type SmplxMotion,
} from './model';

// SMPL-X canonical frame is Y-up; GMR works in Z-up. Same mapping as the BVH
// path (bvh/lafan1.ts): M = [[1,0,0],[0,0,-1],[0,1,0]] → (x, y, z) ↦ (x, -z, y).
const CONV_QUAT = quatFromMat3([
  [1, 0, 0],
  [0, 0, -1],
  [0, 1, 0],
]);

/** Axis-angle (rotation vector) → quaternion [w,x,y,z]. */
export function axisAngleToQuat(x: number, y: number, z: number): Quat {
  const angle = Math.hypot(x, y, z);
  if (angle < 1e-8) return [1, 0, 0, 0];
  const half = angle / 2;
  const s = Math.sin(half) / angle;
  return [Math.cos(half), x * s, y * s, z * s];
}

/**
 * Rest-pose joint locations for the given shape coefficients.
 * Returns the first `numBody` joints as a flat [j*3 + c] array.
 */
export function restJoints(
  model: SmplxBodyModel,
  betas: ArrayLike<number>,
  numBody = Math.min(SMPLX_NUM_BODY_JOINTS, model.numJoints),
): Float64Array {
  const { numVerts, numShape, vTemplate, shapeDirs, jRegressor } = model;
  const nb = Math.min(betas.length, numShape);

  // Shaped vertices: v_template + shapedirs·betas  (only where regressor is nonzero
  // would be cheaper, but V is small enough to shape the whole template once).
  const vShaped = new Float64Array(numVerts * 3);
  for (let i = 0; i < numVerts * 3; i++) {
    let acc = vTemplate[i];
    const base = i * numShape;
    for (let b = 0; b < nb; b++) acc += shapeDirs[base + b] * betas[b];
    vShaped[i] = acc;
  }

  // J = J_regressor @ vShaped, first `numBody` rows.
  const J = new Float64Array(numBody * 3);
  for (let j = 0; j < numBody; j++) {
    const rBase = j * numVerts;
    let jx = 0, jy = 0, jz = 0;
    for (let v = 0; v < numVerts; v++) {
      const w = jRegressor[rBase + v];
      if (w === 0) continue;
      jx += w * vShaped[v * 3];
      jy += w * vShaped[v * 3 + 1];
      jz += w * vShaped[v * 3 + 2];
    }
    J[j * 3] = jx;
    J[j * 3 + 1] = jy;
    J[j * 3 + 2] = jz;
  }
  return J;
}

/** Global per-joint pose (position + orientation) in the SMPL-X frame. */
export interface PosedJoints {
  pos: Float64Array; // [j*3 + c]
  quat: Float64Array; // [j*4 + c], wxyz
  numBody: number;
}

/**
 * Rigid kinematic-chain transform: posed global joint transforms from local
 * axis-angle rotations and the (shape-dependent) rest joints.
 */
export function forwardKinematics(
  rest: Float64Array,
  parents: Int32Array,
  frame: SmplxFrameParams,
): PosedJoints {
  const numBody = rest.length / 3;
  const pos = new Float64Array(numBody * 3);
  const quat = new Float64Array(numBody * 4);

  const setQ = (j: number, q: Quat) => {
    quat[j * 4] = q[0]; quat[j * 4 + 1] = q[1]; quat[j * 4 + 2] = q[2]; quat[j * 4 + 3] = q[3];
  };
  const getQ = (j: number): Quat => [quat[j * 4], quat[j * 4 + 1], quat[j * 4 + 2], quat[j * 4 + 3]];

  // Root.
  const qRoot = axisAngleToQuat(frame.rootOrient[0], frame.rootOrient[1], frame.rootOrient[2]);
  setQ(0, qRoot);
  pos[0] = rest[0]; pos[1] = rest[1]; pos[2] = rest[2];

  for (let j = 1; j < numBody; j++) {
    const p = parents[j];
    const pp = p >= 0 && p < j ? p : 0;
    const aaBase = (j - 1) * 3; // body_pose holds joints 1..numBody-1
    const qLocal = axisAngleToQuat(
      frame.bodyPose[aaBase], frame.bodyPose[aaBase + 1], frame.bodyPose[aaBase + 2],
    );
    const qParent = getQ(pp);
    setQ(j, quatMul(qParent, qLocal));

    const offset: Vec3 = [
      rest[j * 3] - rest[pp * 3],
      rest[j * 3 + 1] - rest[pp * 3 + 1],
      rest[j * 3 + 2] - rest[pp * 3 + 2],
    ];
    const rotated = quatRotate(qParent, offset);
    pos[j * 3] = pos[pp * 3] + rotated[0];
    pos[j * 3 + 1] = pos[pp * 3 + 1] + rotated[1];
    pos[j * 3 + 2] = pos[pp * 3 + 2] + rotated[2];
  }

  // Global translation.
  for (let j = 0; j < numBody; j++) {
    pos[j * 3] += frame.trans[0];
    pos[j * 3 + 1] += frame.trans[1];
    pos[j * 3 + 2] += frame.trans[2];
  }

  return { pos, quat, numBody };
}

export interface SmplxHumanMotion {
  frames: HumanFrame[];
  fps: number;
  jointNames: string[];
  /** Approximate standing height (m) from the rest skeleton, for solver scaling. */
  humanHeight: number;
}

/** Estimate standing height from the rest joints (Z-up extent, head→foot). */
function estimateHeight(restZup: Float64Array, numBody: number): number {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let j = 0; j < numBody; j++) {
    const z = restZup[j * 3 + 2];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // Rest skeleton is head-to-foot joints; pad for the head top / sole.
  return Number.isFinite(minZ) ? (maxZ - minZ) * 1.18 : 1.75;
}

/**
 * Convert a parsed SMPL-X model + AMASS motion into GMR human frames (Z-up,
 * meters) keyed by SMPL-X body-joint names — drop-in for the retargeting engine.
 */
export function smplxToHumanFrames(model: SmplxBodyModel, motion: SmplxMotion): SmplxHumanMotion {
  const numBody = Math.min(SMPLX_NUM_BODY_JOINTS, model.numJoints);
  const names = SMPLX_BODY_JOINT_NAMES.slice(0, numBody);
  const rest = restJoints(model, motion.betas, numBody);

  const frames: HumanFrame[] = motion.frames.map((fp) => {
    const posed = forwardKinematics(rest, model.parents, fp);
    const frame: HumanFrame = new Map();
    for (let j = 0; j < numBody; j++) {
      // SMPL-X (Y-up) → GMR (Z-up): pos (x,y,z)→(x,-z,y); quat = CONV ⊗ q.
      const pos: Vec3 = [posed.pos[j * 3], -posed.pos[j * 3 + 2], posed.pos[j * 3 + 1]];
      const q: Quat = [posed.quat[j * 4], posed.quat[j * 4 + 1], posed.quat[j * 4 + 2], posed.quat[j * 4 + 3]];
      frame.set(names[j], { pos, quat: quatMul(CONV_QUAT, q) });
    }
    return frame;
  });

  // Height from the rest skeleton in Z-up.
  const restZup = new Float64Array(numBody * 3);
  for (let j = 0; j < numBody; j++) {
    restZup[j * 3] = rest[j * 3];
    restZup[j * 3 + 1] = -rest[j * 3 + 2];
    restZup[j * 3 + 2] = rest[j * 3 + 1];
  }

  return {
    frames,
    fps: motion.fps,
    jointNames: names as unknown as string[],
    humanHeight: estimateHeight(restZup, numBody),
  };
}
