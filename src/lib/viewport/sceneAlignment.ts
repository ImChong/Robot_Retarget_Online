/**
 * Shared viewport alignment: face every humanoid (robot + BVH skeleton) toward a
 * single canonical world axis, then place the robot a fixed distance in front of
 * the BVH so the two read as separate figures instead of overlapping.
 */

import * as THREE from 'three';
import { bvhFk, resolveMotionRootJoint, type BvhAnim } from '../bvh/parse';
import type { RobotModel } from '../mujoco/runtime';
import type { RobotSceneObject } from '../mujoco/threeScene';
import type { SceneManager } from './SceneManager';
import type { SkeletonView } from './skeletonView';

/** Default world anchor for standing humanoids (Z-up, meters). */
export const VIEWPORT_ANCHOR = new THREE.Vector3(0, 0, 0.9);

/**
 * Canonical facing yaw (radians). Both the robot and the BVH skeleton are
 * rotated so their front points along world -Y, toward the default camera.
 * Pinning every robot to the same axis means switching robots never changes
 * which way the figure looks.
 */
export const FACING_YAW = -Math.PI / 2;

/** Robot sits in front of the BVH (toward the camera, -Y); BVH stays behind (+Y). */
export const ROBOT_DEPTH_Y = -0.45;
export const HUMAN_DEPTH_Y = 0.45;

/** Anatomical left/right joint pairs used to read the BVH facing direction. */
const HUMAN_LATERAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['LeftUpLeg', 'RightUpLeg'],
  ['LeftArm', 'RightArm'],
  ['LeftShoulder', 'RightShoulder'],
  // Quadruped dog mocap (Lifelike Agility / Biped-style naming).
  ['b_LeftHand', 'b_RightHand'],
  ['b_LeftArm', 'b_RightArm'],
  ['b_LeftClav', 'b_RightClav'],
];

const FORWARD_X = new THREE.Vector3(1, 0, 0);
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpLeft = new THREE.Vector3();
const tmpRight = new THREE.Vector3();

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

/** World anchor (Z-up, meters) for the motion root on frame 0. */
export function motionRootAnchor(anim: BvhAnim, unitScale: number): THREE.Vector3 {
  const idx = resolveMotionRootJoint(anim);
  const J = anim.joints.length;
  const { globalPos } = bvhFk({
    ...anim,
    frameCount: 1,
    localPos: anim.localPos.slice(0, J * 3),
    localQuat: anim.localQuat.slice(0, J * 4),
  });
  // BVH Y-up -> Z-up: world z = bvh y.
  return new THREE.Vector3(0, 0, globalPos[idx * 3 + 1] * unitScale);
}

/** Horizontal facing angle (radians) of a body's local +Y axis in Z-up world. */
export function horizontalYaw(quat: THREE.Quaternion): number {
  const f = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
  return Math.atan2(f.x, f.y);
}

/**
 * Facing yaw (radians) of a body whose local +X points forward — the MuJoCo
 * humanoid convention shared by the bundled robot roots (pelvis / Trunk).
 */
function robotFacingYaw(quat: THREE.Quaternion): number {
  const f = FORWARD_X.clone().applyQuaternion(quat);
  return Math.atan2(f.y, f.x);
}

/**
 * Facing yaw (radians) of the BVH skeleton, read from a horizontal left→right
 * hip (or shoulder) vector: forward = worldUp × lateral. This stays robust where
 * the root quaternion does not, because the BVH root's own local +Y axis points
 * up rather than forward. Returns null when no usable pair is present.
 */
function humanFacingYaw(skeleton: SkeletonView, anim: BvhAnim): number | null {
  for (const [leftName, rightName] of HUMAN_LATERAL_PAIRS) {
    const li = anim.joints.findIndex((j) => j.name === leftName);
    const ri = anim.joints.findIndex((j) => j.name === rightName);
    if (li < 0 || ri < 0) continue;
    skeleton.getJointWorldPos(li, tmpLeft);
    skeleton.getJointWorldPos(ri, tmpRight);
    const latX = tmpRight.x - tmpLeft.x;
    const latY = tmpRight.y - tmpLeft.y;
    if (Math.hypot(latX, latY) < 1e-6) continue;
    // forward = (0,0,1) × (latX, latY, 0) = (-latY, latX, 0)
    return Math.atan2(latX, -latY);
  }
  return null;
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
 * Rotate the robot about world Z so its pelvis faces FACING_YAW, then translate
 * so the pelvis sits at anchor + (0, depthY, 0) (in front of the BVH along -Y).
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

  // Yaw the whole robot so its (local +X) forward points along FACING_YAW.
  pelvisWorldPose(scene, pelvisId, tmpPos, tmpQuat);
  scene.root.rotation.z = FACING_YAW - robotFacingYaw(tmpQuat);
  scene.root.updateMatrixWorld(true);

  // Then anchor the (now rotated) pelvis at the target world position.
  pelvisWorldPose(scene, pelvisId, tmpPos, tmpQuat);
  const target = anchor.clone().add(new THREE.Vector3(0, depthY, 0));
  scene.root.position.copy(target).sub(tmpPos);
}

/**
 * Match the BVH skeleton yaw to the robot's facing and anchor Hips at
 * anchor + (0, depthY, 0) (behind the robot along +Y).
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

  // Tolerate a config/motion root-name mismatch (e.g. a stale `Hips` while the
  // robot is still syncing to a SMPL-X clip whose root is `pelvis`).
  const named = anim.joints.findIndex((j) => j.name === humanRootName);
  const hipsIdx = named >= 0 ? named : resolveMotionRootJoint(anim);

  robotScene.root.updateMatrixWorld(true);
  pelvisWorldPose(robotScene, pelvisId, tmpPos, tmpQuat);
  const robotYaw = robotFacingYaw(tmpQuat);

  // Read the skeleton's native facing with no extra yaw, then turn it to match.
  skeleton.setFrame(frame);
  skeleton.setYaw(0);
  const humanYaw = humanFacingYaw(skeleton, anim);
  skeleton.setYaw(humanYaw === null ? 0 : robotYaw - humanYaw);

  skeleton.setFrame(frame);
  skeleton.lockJointToWorld(hipsIdx, anchor.clone().add(new THREE.Vector3(0, depthY, 0)));
}
