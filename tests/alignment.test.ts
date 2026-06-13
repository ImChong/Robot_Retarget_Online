/**
 * Config-view alignment: the robot and the BVH skeleton must face the same
 * canonical world axis, and the robot must sit a fixed distance in front of the
 * BVH (toward the camera) so the two figures never overlap.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getMujoco, type RobotModel } from '../src/lib/mujoco/runtime';
import { buildRobotScene } from '../src/lib/mujoco/threeScene';
import { parseBvh } from '../src/lib/bvh/parse';
import { buildSkeletonView } from '../src/lib/viewport/skeletonView';
import {
  alignRobotRoot,
  alignSkeletonToRobot,
  FACING_YAW,
  HUMAN_DEPTH_Y,
  ROBOT_DEPTH_Y,
  VIEWPORT_ANCHOR,
} from '../src/lib/viewport/sceneAlignment';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function loadG1(): Promise<RobotModel> {
  const mujoco = await getMujoco();
  const id = 'unitree_g1';
  const xml = 'g1_mocap_29dof.xml';
  const dir = join(ROOT, 'public', 'robots', id);
  const vdir = `/working/align_${id}`;
  if (!mujoco.FS.analyzePath(vdir).exists) {
    mujoco.FS.mkdir(vdir);
    mujoco.FS.mkdir(`${vdir}/meshes`);
    for (const f of readdirSync(join(dir, 'meshes'))) {
      mujoco.FS.writeFile(`${vdir}/meshes/${f}`, readFileSync(join(dir, 'meshes', f)));
    }
    mujoco.FS.writeFile(`${vdir}/${xml}`, readFileSync(join(dir, xml)));
  }
  const model = mujoco.MjModel.loadFromXML(`${vdir}/${xml}`);
  const data = new mujoco.MjData(model);
  const bodyIds = new Map<string, number>();
  const bodyNames: string[] = [];
  for (let b = 0; b < model.nbody; b++) {
    const name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, b) ?? `body_${b}`;
    bodyNames.push(name);
    bodyIds.set(name, b);
  }
  return {
    id,
    mujoco,
    model,
    data,
    bodyNames,
    bodyIds,
    jointNames: [],
    dofJointNames: [],
    nq: model.nq,
    nv: model.nv,
  };
}

/** Yaw of a body whose local +X points forward. */
function forwardYaw(q: THREE.Quaternion): number {
  const f = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  return Math.atan2(f.y, f.x);
}

/** Yaw of the skeleton's facing, from its left→right hip vector. */
function hipFacingYaw(sk: ReturnType<typeof buildSkeletonView>, anim: ReturnType<typeof parseBvh>): number {
  const l = new THREE.Vector3();
  const r = new THREE.Vector3();
  sk.getJointWorldPos(anim.joints.findIndex((j) => j.name === 'LeftUpLeg'), l);
  sk.getJointWorldPos(anim.joints.findIndex((j) => j.name === 'RightUpLeg'), r);
  return Math.atan2(r.x - l.x, -(r.y - l.y));
}

describe('robot + BVH config alignment', () => {
  it('faces both figures on one axis and puts the robot in front of the BVH', async () => {
    const robot = await loadG1();
    (robot.data.qpos as Float64Array).set(robot.model.qpos0 as Float64Array);
    robot.mujoco.mj_kinematics(robot.model, robot.data);

    const scene = buildRobotScene(robot);
    alignRobotRoot(scene, robot, 'pelvis', VIEWPORT_ANCHOR);
    scene.root.updateMatrixWorld(true);

    const anim = parseBvh(readFileSync(join(ROOT, 'public', 'sample_motions', 'walk.bvh'), 'utf-8'));
    const sk = buildSkeletonView(anim, 0.01);
    alignSkeletonToRobot(sk, anim, 'Hips', scene, robot, 'pelvis', VIEWPORT_ANCHOR);
    sk.root.updateMatrixWorld(true);

    // Robot pelvis: faces the canonical axis, anchored in front of the BVH (-Y).
    const pelvisId = robot.bodyIds.get('pelvis')!;
    const rPos = new THREE.Vector3();
    const rQuat = new THREE.Quaternion();
    scene.bodyGroups.get(pelvisId)!.getWorldPosition(rPos);
    scene.bodyGroups.get(pelvisId)!.getWorldQuaternion(rQuat);
    expect(forwardYaw(rQuat)).toBeCloseTo(FACING_YAW, 3);
    expect(rPos.x).toBeCloseTo(VIEWPORT_ANCHOR.x, 3);
    expect(rPos.y).toBeCloseTo(VIEWPORT_ANCHOR.y + ROBOT_DEPTH_Y, 3);
    expect(rPos.z).toBeCloseTo(VIEWPORT_ANCHOR.z, 3);

    // BVH Hips: anchored behind the robot (+Y), facing the same axis as the robot.
    const hipsIdx = anim.joints.findIndex((j) => j.name === 'Hips');
    const hPos = new THREE.Vector3();
    sk.getJointWorldPos(hipsIdx, hPos);
    expect(hPos.x).toBeCloseTo(VIEWPORT_ANCHOR.x, 3);
    expect(hPos.y).toBeCloseTo(VIEWPORT_ANCHOR.y + HUMAN_DEPTH_Y, 3);
    expect(hPos.z).toBeCloseTo(VIEWPORT_ANCHOR.z, 3);
    expect(hipFacingYaw(sk, anim)).toBeCloseTo(FACING_YAW, 2);

    // Robot sits in front of the BVH (closer to the -Y camera) by the configured gap.
    expect(rPos.y).toBeLessThan(hPos.y);
    expect(hPos.y - rPos.y).toBeCloseTo(HUMAN_DEPTH_Y - ROBOT_DEPTH_Y, 3);

    sk.dispose();
    scene.dispose();
  });
});
