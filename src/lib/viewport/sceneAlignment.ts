/**
 * Shared viewport alignment: anchor humanoid roots (Hips / pelvis) at a fixed
 * world point, match facing yaw, and place robot in front of BVH along -Y.
 */

import * as THREE from 'three';
import type { BvhAnim } from '../bvh/parse';
import type { RobotModel } from '../mujoco/runtime';
import type { RobotSceneObject } from '../mujoco/threeScene';
import type { SkeletonView } from './skeletonView';

/** Default world anchor for standing humanoids (Z-up, meters). */
export const VIEWPORT_ANCHOR = new THREE.Vector3(0, 0, 0.9);

/** Robot is slightly toward the camera (-Y); BVH slightly behind (+Y). */
export const ROBOT_DEPTH_Y = -0.1;
export const HUMAN_DEPTH_Y = 0.1;

const FORWARD = new THREE.Vector3(0, 1, 0);
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

export function jointIndexByName(anim: BvhAnim, name: string): number {
  const idx = anim.joints.findIndex((j) => j.name === name);
  if (idx < 0) throw new Error(`BVH joint "${name}" not found`);
  return idx;
}

/** Horizontal facing angle (radians) from a body quaternion in Z-up world. */
export function horizontalYaw(quat: THREE.Quaternion): number {
  const f = FORWARD.clone().applyQuaternion(quat);
  return Math.atan2(f.x, f.y);
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
  const target = anchor.clone().add(new THREE.Vector3(0, depthY, 0));
  scene.root.position.copy(target).sub(tmpPos);
}

/**
 * Match BVH skeleton yaw to the robot pelvis and anchor Hips at anchor + depth.
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
  const robotYaw = horizontalYaw(tmpQuat);

  skeleton.setFrame(frame);
  skeleton.setYaw(0);
  skeleton.lockJointToWorld(hipsIdx, anchor.clone().add(new THREE.Vector3(0, depthY, 0)));

  skeleton.setFrame(frame);
  const hipsQuat = skeleton.getJointWorldQuat(hipsIdx, new THREE.Quaternion());
  const hipsYaw = horizontalYaw(hipsQuat);
  skeleton.setYaw(robotYaw - hipsYaw);

  skeleton.setFrame(frame);
  skeleton.lockJointToWorld(hipsIdx, anchor.clone().add(new THREE.Vector3(0, depthY, 0)));
}
