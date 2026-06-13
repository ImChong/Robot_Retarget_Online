/**
 * Shared viewport alignment: anchor humanoid roots (Hips / pelvis) at a fixed
 * world point, match facing yaw, and place robot in front of BVH along the
 * default config camera view axis.
 */

import * as THREE from 'three';
import type { BvhAnim } from '../bvh/parse';
import type { RobotModel } from '../mujoco/runtime';
import type { RobotSceneObject } from '../mujoco/threeScene';
import type { SceneManager } from './SceneManager';
import type { SkeletonView } from './skeletonView';

/** Default world anchor for standing humanoids (Z-up, meters). */
export const VIEWPORT_ANCHOR = new THREE.Vector3(0, 0, 0.9);

/** Matches RetargetConfigView camera (0,-3.1,1.7) looking at the anchor. */
export const CONFIG_VIEW_DIR = new THREE.Vector3(0, -3.1, 0.8).normalize();

/** Depth along view axis: robot toward camera, BVH away. */
export const ROBOT_VIEW_DEPTH = 0.42;
export const HUMAN_VIEW_DEPTH = 0.42;

/** G1 visual / walking forward in pelvis body frame (+Y, not +X mesh axis). */
export const ROBOT_FORWARD = new THREE.Vector3(0, 1, 0);
/** BVH facing in hips joint frame after Y-up→Z-up (mocap +Z → world −Y). */
export const BVH_FORWARD = new THREE.Vector3(0, -1, 0);

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpFwd = new THREE.Vector3();

/** Smoothly move orbit target and camera together so the view tracks a world point. */
export function followOrbitCamera(sm: SceneManager, worldPos: THREE.Vector3, smooth = 0.08): void {
  const tgt = sm.controls.target;
  const cam = sm.camera;
  const dx = (worldPos.x - tgt.x) * smooth;
  const dy = (worldPos.y - tgt.y) * smooth;
  const dz = (worldPos.z - tgt.z) * smooth;
  tgt.x += dx;
  tgt.y += dy;
  tgt.z += dz;
  cam.position.x += dx;
  cam.position.y += dy;
  cam.position.z += dz;
}

export function jointIndexByName(anim: BvhAnim, name: string): number {
  const idx = anim.joints.findIndex((j) => j.name === name);
  if (idx < 0) throw new Error(`BVH joint "${name}" not found`);
  return idx;
}

/** Horizontal facing angle from a body quaternion and its local forward axis. */
export function bodyForwardYaw(quat: THREE.Quaternion, localForward: THREE.Vector3): number {
  tmpFwd.copy(localForward).applyQuaternion(quat);
  return Math.atan2(tmpFwd.x, tmpFwd.y);
}

/** Facing yaw from left/right hip positions (Z-up, projected to XY). */
export function bodyForwardYawFromLegs(left: THREE.Vector3, right: THREE.Vector3): number {
  tmpFwd.copy(right).sub(left);
  return Math.atan2(-tmpFwd.y, tmpFwd.x);
}

export function depthAnchor(
  anchor: THREE.Vector3,
  alongView: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  return out.copy(CONFIG_VIEW_DIR).multiplyScalar(alongView).add(anchor);
}

export function normalizeAngle(rad: number): number {
  let a = rad;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function pelvisWorldPose(
  scene: RobotSceneObject,
  pelvisId: number,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
): void {
  const group = scene.bodyGroups.get(pelvisId);
  if (!group) throw new Error(`pelvis body id ${pelvisId} missing from scene`);
  group.getWorldPosition(outPos);
  group.getWorldQuaternion(outQuat);
}

function robotFacingYaw(
  scene: RobotSceneObject,
  robot: RobotModel,
  pelvisId: number,
): number {
  pelvisWorldPose(scene, pelvisId, tmpPos, tmpQuat);
  return bodyForwardYaw(tmpQuat, ROBOT_FORWARD);
}

function skeletonFacingYaw(skeleton: SkeletonView, hipsIdx: number): number {
  return bodyForwardYaw(skeleton.getJointWorldQuat(hipsIdx, new THREE.Quaternion()), BVH_FORWARD);
}

/** Pick the shorter rotation so characters face the same way, not opposite. */
export function facingDelta(fromYaw: number, toYaw: number): number {
  let d = normalizeAngle(toYaw - fromYaw);
  if (Math.abs(d) > Math.PI / 2) d -= Math.sign(d) * Math.PI;
  return d;
}

/**
 * Place the robot so its pelvis sits toward the camera along the view axis.
 */
export function alignRobotRoot(
  scene: RobotSceneObject,
  robot: RobotModel,
  pelvisName: string,
  anchor: THREE.Vector3,
  viewDepth = ROBOT_VIEW_DEPTH,
): void {
  const pelvisId = robot.bodyIds.get(pelvisName);
  if (pelvisId === undefined) return;

  scene.root.position.set(0, 0, 0);
  scene.root.rotation.set(0, 0, 0);
  scene.update(robot.data);

  pelvisWorldPose(scene, pelvisId, tmpPos, tmpQuat);
  const pelvisPos = tmpPos.clone();
  depthAnchor(anchor, viewDepth, tmpPos);
  scene.root.position.copy(tmpPos).sub(pelvisPos);
  scene.root.updateMatrixWorld(true);
}

/**
 * Match BVH skeleton yaw to the robot and anchor Hips behind along the view axis.
 */
export function alignSkeletonToRobot(
  skeleton: SkeletonView,
  anim: BvhAnim,
  humanRootName: string,
  robotScene: RobotSceneObject,
  robot: RobotModel,
  pelvisName: string,
  anchor: THREE.Vector3,
  viewDepth = -HUMAN_VIEW_DEPTH,
  frame = 0,
): void {
  const pelvisId = robot.bodyIds.get(pelvisName);
  if (pelvisId === undefined) return;

  const hipsIdx = jointIndexByName(anim, humanRootName);

  robotScene.root.updateMatrixWorld(true);
  const robotYaw = robotFacingYaw(robotScene, robot, pelvisId);

  skeleton.setFrame(frame);
  skeleton.setYaw(0);
  skeleton.root.updateMatrixWorld(true);

  const bvhYaw = skeletonFacingYaw(skeleton, hipsIdx);
  skeleton.setYaw(normalizeAngle(robotYaw - bvhYaw));

  skeleton.setFrame(frame);
  skeleton.lockJointToWorld(hipsIdx, depthAnchor(anchor, viewDepth));
}
