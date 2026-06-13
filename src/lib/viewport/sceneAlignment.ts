/**
 * Shared viewport alignment: anchor humanoid roots (Hips / pelvis) at a fixed
 * world point, match facing yaw, and place robot in front of BVH along -Y.
 */

import * as THREE from 'three';
import type { BvhAnim } from '../bvh/parse';
import type { RobotModel } from '../mujoco/runtime';
import type { RobotSceneObject } from '../mujoco/threeScene';
import type { SceneManager } from './SceneManager';
import type { SkeletonView } from './skeletonView';

/** Default world anchor for standing humanoids (Z-up, meters). */
export const VIEWPORT_ANCHOR = new THREE.Vector3(0, 0, 0.9);

/** Robot is toward the camera (-Y); BVH behind (+Y). */
export const ROBOT_DEPTH_Y = -0.28;
export const HUMAN_DEPTH_Y = 0.28;

/** MuJoCo humanoid forward in pelvis body frame. */
export const ROBOT_FORWARD = new THREE.Vector3(1, 0, 0);
/** LAFAN1 BVH walking direction in hips joint frame (Y-up). */
export const BVH_FORWARD = new THREE.Vector3(0, 0, 1);

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

/** @deprecated Use bodyForwardYaw with an explicit local forward axis. */
export function horizontalYaw(quat: THREE.Quaternion): number {
  return bodyForwardYaw(quat, new THREE.Vector3(0, 1, 0));
}

export function depthAnchor(anchor: THREE.Vector3, depthY: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(anchor.x, anchor.y + depthY, anchor.z);
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
 * Place the robot so its pelvis sits at anchor + (0, depthY, 0) with root at origin.
 */
export function alignRobotRoot(
  scene: RobotSceneObject,
  robot: RobotModel,
  pelvisName: string,
  anchor: THREE.Vector3,
  depthY = ROBOT_DEPTH_Y,
): void {
  const pelvisId = robot.bodyIds.get(pelvisName);
  if (pelvisId === undefined) return;

  scene.root.position.set(0, 0, 0);
  scene.root.rotation.set(0, 0, 0);
  scene.update(robot.data);

  pelvisWorldPose(scene, pelvisId, tmpPos, tmpQuat);
  const pelvisPos = tmpPos.clone();
  depthAnchor(anchor, depthY, tmpPos);
  scene.root.position.copy(tmpPos).sub(pelvisPos);
  scene.root.updateMatrixWorld(true);
}

/**
 * Match BVH skeleton yaw to the robot pelvis and anchor Hips behind the robot.
 */
export function alignSkeletonToRobot(
  skeleton: SkeletonView,
  anim: BvhAnim,
  humanRootName: string,
  robotScene: RobotSceneObject,
  robot: RobotModel,
  pelvisName: string,
  anchor: THREE.Vector3,
  depthY = HUMAN_DEPTH_Y,
  frame = 0,
): void {
  const pelvisId = robot.bodyIds.get(pelvisName);
  if (pelvisId === undefined) return;

  const hipsIdx = jointIndexByName(anim, humanRootName);

  robotScene.root.updateMatrixWorld(true);
  pelvisWorldPose(robotScene, pelvisId, tmpPos, tmpQuat);
  const robotYaw = bodyForwardYaw(tmpQuat, ROBOT_FORWARD);

  skeleton.setFrame(frame);
  skeleton.setYaw(0);
  skeleton.root.updateMatrixWorld(true);

  const hipsQuat = skeleton.getJointWorldQuat(hipsIdx, new THREE.Quaternion());
  const bvhYaw = bodyForwardYaw(hipsQuat, BVH_FORWARD);
  skeleton.setYaw(normalizeAngle(robotYaw - bvhYaw));

  skeleton.setFrame(frame);
  skeleton.lockJointToWorld(hipsIdx, depthAnchor(anchor, depthY));
}
