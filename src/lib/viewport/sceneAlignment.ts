/**
 * Shared viewport alignment: anchor humanoid roots (Hips / pelvis) at a fixed
 * world point, match root yaw to pelvis, and separate depth along the view axis.
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

/** G1 mesh forward in pelvis frame. */
const ROBOT_VISUAL_FORWARD = new THREE.Vector3(0, 1, 0);
/** BVH skeleton forward in hips frame (after Y-up→Z-up coord). */
const BVH_VISUAL_FORWARD = new THREE.Vector3(0, 0, -1);
const tmpFwdA = new THREE.Vector3();
const tmpFwdB = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

export function horizontalForward(
  quat: THREE.Quaternion,
  localForward: THREE.Vector3,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  out.copy(localForward).applyQuaternion(quat);
  out.z = 0;
  if (out.lengthSq() < 1e-10) return out.set(0, 1, 0);
  return out.normalize();
}

export function signedAngleXY(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(from.x * to.y - from.y * to.x, from.dot(to));
}

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

/** Yaw (radians) about world Z from a Z-up quaternion. */
export function zUpYaw(quat: THREE.Quaternion): number {
  const sinYaw = 2 * (quat.w * quat.z + quat.x * quat.y);
  const cosYaw = 1 - 2 * (quat.y * quat.y + quat.z * quat.z);
  return Math.atan2(sinYaw, cosYaw);
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
 * Rotate BVH skeleton yaw so hips root orientation matches robot pelvis (display only).
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
  pelvisWorldPose(robotScene, pelvisId, tmpPos, tmpQuat);
  const robotFwd = horizontalForward(tmpQuat, ROBOT_VISUAL_FORWARD, tmpFwdA);

  skeleton.setFrame(frame);
  skeleton.setYaw(0);
  skeleton.root.updateMatrixWorld(true);
  const skelFwd = horizontalForward(
    skeleton.getJointWorldQuat(hipsIdx, new THREE.Quaternion()),
    BVH_VISUAL_FORWARD,
    tmpFwdB,
  );

  skeleton.setYaw(signedAngleXY(skelFwd, robotFwd));

  skeleton.setFrame(frame);
  skeleton.lockJointToWorld(hipsIdx, depthAnchor(anchor, viewDepth));
}
