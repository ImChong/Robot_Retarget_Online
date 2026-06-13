import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseBvh } from '../src/lib/bvh/parse';
import { buildSkeletonView } from '../src/lib/viewport/skeletonView';
import { getMujoco, type RobotModel } from '../src/lib/mujoco/runtime';
import { buildRobotScene } from '../src/lib/mujoco/threeScene';
import {
  alignRobotRoot,
  alignSkeletonToRobot,
  bodyForwardYaw,
  BVH_FORWARD,
  facingDelta,
  followOrbitCamera,
  HUMAN_VIEW_DEPTH,
  jointIndexByName,
  ROBOT_FORWARD,
  ROBOT_VIEW_DEPTH,
  VIEWPORT_ANCHOR,
} from '../src/lib/viewport/sceneAlignment';
import type { SceneManager } from '../src/lib/viewport/SceneManager';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WALK_BVH = readFileSync(join(ROOT, 'public', 'sample_motions', 'walk.bvh'), 'utf-8');

async function loadG1(): Promise<RobotModel> {
  const mujoco = await getMujoco();
  const dir = join(ROOT, 'public', 'robots', 'unitree_g1');
  const vdir = '/working/viewport_g1';
  if (!mujoco.FS.analyzePath(vdir).exists) {
    mujoco.FS.mkdir(vdir);
    mujoco.FS.mkdir(`${vdir}/meshes`);
    for (const f of readdirSync(join(dir, 'meshes'))) {
      mujoco.FS.writeFile(`${vdir}/meshes/${f}`, readFileSync(join(dir, 'meshes', f)));
    }
    mujoco.FS.writeFile(`${vdir}/g1_mocap_29dof.xml`, readFileSync(join(dir, 'g1_mocap_29dof.xml')));
  }
  const model = mujoco.MjModel.loadFromXML(`${vdir}/g1_mocap_29dof.xml`);
  const data = new mujoco.MjData(model);
  const bodyIds = new Map<string, number>();
  const bodyNames: string[] = [];
  for (let b = 0; b < model.nbody; b++) {
    const name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, b) ?? `body_${b}`;
    bodyNames.push(name);
    bodyIds.set(name, b);
  }
  return {
    id: 'unitree_g1',
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

const MINI_BVH = `HIERARCHY
ROOT Hips
{
  OFFSET 0 90 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation
  JOINT Chest
  {
    OFFSET 0 40 0
    CHANNELS 3 Zrotation Yrotation Xrotation
    End Site
    {
      OFFSET 0 20 0
    }
  }
}
MOTION
Frames: 2
Frame Time: 0.033333
0 0 0 0 0 0 0 0 0 0 0 0
10 5 0 0 0 0 0 0 0 0 0 0
`;

describe('skeleton hip lock', () => {
  it('keeps Hips at a fixed world anchor across frames', () => {
    const anim = parseBvh(MINI_BVH);
    const sk = buildSkeletonView(anim, 0.01);
    const hips = jointIndexByName(anim, 'Hips');
    const anchor = VIEWPORT_ANCHOR.clone();
    const out = new THREE.Vector3();

    for (const frame of [0, 1]) {
      sk.setFrame(frame);
      sk.lockJointToWorld(hips, anchor);
      sk.getJointWorldPos(hips, out);
      expect(out.x).toBeCloseTo(anchor.x, 4);
      expect(out.y).toBeCloseTo(anchor.y, 4);
      expect(out.z).toBeCloseTo(anchor.z, 4);
    }
  });
});

describe('followOrbitCamera', () => {
  it('moves camera and target toward the tracked point', () => {
    const target = new THREE.Vector3(0, 0, 0);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(2, -2, 1);
    const sm = {
      controls: { target },
      camera,
    } as Pick<SceneManager, 'controls' | 'camera'> as SceneManager;

    followOrbitCamera(sm, new THREE.Vector3(1, 0.5, 0.9), 1);

    expect(target.x).toBeCloseTo(1, 5);
    expect(target.y).toBeCloseTo(0.5, 5);
    expect(target.z).toBeCloseTo(0.9, 5);
    expect(camera.position.x).toBeCloseTo(3, 5);
    expect(camera.position.y).toBeCloseTo(-1.5, 5);
    expect(camera.position.z).toBeCloseTo(1.9, 5);
  });
});

describe('config overlay alignment', () => {
  it('aligns walk BVH yaw with G1 and keeps depth separation', async () => {
    const robot = await loadG1();
    const scene = buildRobotScene(robot);
    (robot.data.qpos as Float64Array).set(robot.model.qpos0 as Float64Array);
    robot.mujoco.mj_kinematics(robot.model, robot.data);
    scene.update(robot.data);

    const anim = parseBvh(WALK_BVH);
    const sk = buildSkeletonView(anim, 0.01);

    alignRobotRoot(scene, robot, 'pelvis', VIEWPORT_ANCHOR);
    alignSkeletonToRobot(sk, anim, 'Hips', scene, robot, 'pelvis', VIEWPORT_ANCHOR);

    const pelvisId = robot.bodyIds.get('pelvis')!;
    const hipsIdx = jointIndexByName(anim, 'Hips');
    const pelvisPos = new THREE.Vector3();
    const hipsPos = new THREE.Vector3();

    scene.bodyGroups.get(pelvisId)!.getWorldPosition(pelvisPos);
    sk.getJointWorldPos(hipsIdx, hipsPos);

    const pelvisQuat = new THREE.Quaternion();
    scene.bodyGroups.get(pelvisId)!.getWorldQuaternion(pelvisQuat);
    const robotYaw = bodyForwardYaw(pelvisQuat, ROBOT_FORWARD);
    const hipsQuat = new THREE.Quaternion();
    sk.getJointWorldQuat(hipsIdx, hipsQuat);
    const bvhYaw = bodyForwardYaw(hipsQuat, BVH_FORWARD);
    expect(Math.abs(facingDelta(bvhYaw, robotYaw))).toBeLessThan(0.08);
    expect(pelvisPos.distanceTo(hipsPos)).toBeCloseTo(ROBOT_VIEW_DEPTH + HUMAN_VIEW_DEPTH, 2);
  });
});

describe('bodyForwardYaw', () => {
  it('returns 0 for identity facing +Y', () => {
    expect(bodyForwardYaw(new THREE.Quaternion(), new THREE.Vector3(0, 1, 0))).toBeCloseTo(0, 5);
  });

  it('returns π/2 for +X local axis at identity', () => {
    expect(bodyForwardYaw(new THREE.Quaternion(), new THREE.Vector3(1, 0, 0))).toBeCloseTo(
      Math.PI / 2,
      4,
    );
  });
});
