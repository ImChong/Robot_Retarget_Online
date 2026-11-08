import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseBvh } from '../src/lib/bvh/parse';
import { buildSkeletonView } from '../src/lib/viewport/skeletonView';
import { loadRobotFromXmlString } from '../src/lib/mujoco/runtime';
import { buildRobotScene } from '../src/lib/mujoco/threeScene';
import {
  defaultPlace,
  FACING_YAW,
  HUMAN_DEPTH_Y,
  placeRobotRoot,
  placeSkeleton,
  ROBOT_DEPTH_Y,
  VIEWPORT_ANCHOR,
} from '../src/lib/viewport/sceneAlignment';
import {
  clampPlace,
  dragPlace,
  floorPoint,
  PLACE_REACH,
  snapped,
  startGrab,
  yawDegrees,
} from '../src/lib/viewport/stagePlacement';
import { buildPlacementGizmo } from '../src/lib/viewport/placementGizmo';

const down = (x: number, y: number) => new THREE.Ray(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));

describe('placement math', () => {
  it('snaps, wraps headings and keeps placements on the visible floor', () => {
    expect(snapped(0.124, 0.05)).toBeCloseTo(0.1);
    expect(snapped(0.124, 0)).toBe(0.124);
    expect(yawDegrees(Math.PI / 2)).toBe(90);
    expect(yawDegrees(-Math.PI)).toBe(180);
    expect(yawDegrees((7 * Math.PI) / 4)).toBe(-45);
    expect(clampPlace({ x: 100, y: -100, yaw: 1 })).toEqual({ x: PLACE_REACH, y: -PLACE_REACH, yaw: 1 });
  });

  it('defaults to the old layout: robot in front, BVH behind', () => {
    expect(defaultPlace('robot')).toEqual({ x: VIEWPORT_ANCHOR.x, y: VIEWPORT_ANCHOR.y + ROBOT_DEPTH_Y, yaw: 0 });
    expect(defaultPlace('human')).toEqual({ x: VIEWPORT_ANCHOR.x, y: VIEWPORT_ANCHOR.y + HUMAN_DEPTH_Y, yaw: 0 });
  });

  it('reads a drag on the level plane at the grab height', () => {
    const ray = new THREE.Ray(new THREE.Vector3(0, -4, 2), new THREE.Vector3(0, 1, -1).normalize());
    expect(floorPoint(ray, 1)).toEqual({ x: 0, y: expect.closeTo(-3, 9) });
    expect(floorPoint(ray, 0)).toEqual({ x: 0, y: expect.closeTo(-2, 9) });
    // A ray above the horizon never meets the plane.
    expect(floorPoint(new THREE.Ray(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0.1)), 0)).toBeNull();
  });

  it('slides with the pointer without jumping, snapped, and arrows keep to their axis', () => {
    const place = { x: 1, y: 0, yaw: 0 };
    const grab = startGrab('robot', null, place, { x: 1.2, y: 0.1 }, 0.5);
    expect(dragPlace(grab, place, { x: 1.2, y: 0.1 }, false, true)).toEqual({ x: 1, y: 0, yaw: 0 });
    const moved = dragPlace(grab, place, { x: 1.53, y: 0.71 }, false, true);
    expect(moved.x).toBeCloseTo(1.35);
    expect(moved.y).toBeCloseTo(0.6);
    const xOnly = dragPlace(startGrab('robot', 'x', place, { x: 1.4, y: 0 }, 0), place, { x: 2.4, y: 3 }, false, false);
    expect(xOnly).toEqual({ x: 2, y: 0, yaw: 0 });
    const yOnly = dragPlace(startGrab('robot', 'y', place, { x: 1, y: 0.4 }, 0), place, { x: 5, y: 1.4 }, false, false);
    expect(yOnly).toEqual({ x: 1, y: expect.closeTo(1, 9), yaw: 0 });
  });

  it('turns about the mark from the ring, or from the figure with Shift', () => {
    const place = { x: 0, y: 0, yaw: 0 };
    const ring = startGrab('human', 'turn', place, { x: 1, y: 0 }, 0);
    expect(dragPlace(ring, place, { x: 0, y: 1 }, false, false).yaw).toBeCloseTo(Math.PI / 2);
    expect(dragPlace(ring, place, { x: 1, y: 0.1 }, false, true).yaw).toBe(0); // 5.7° snaps to 0
    expect(dragPlace(ring, place, { x: 1, y: 0.2 }, false, true).yaw).toBeCloseTo(Math.PI / 12); // 11.3° → 15°
    const body = startGrab('human', null, place, { x: 1, y: 0 }, 1);
    const turned = dragPlace(body, place, { x: 0, y: -1 }, true, true);
    expect(turned).toEqual({ x: 0, y: 0, yaw: expect.closeTo(-Math.PI / 2, 9) });
  });
});

describe('placing the figures', () => {
  const XML = `<mujoco model="place">
  <worldbody>
    <body name="pelvis" pos="0.3 -0.2 0.8">
      <freejoint/>
      <geom type="box" size="0.1 0.15 0.1" contype="0" conaffinity="0" rgba="1 1 1 1"/>
    </body>
  </worldbody>
</mujoco>`;

  it('stands the robot pelvis on the mark, turned, without touching the MuJoCo state', async () => {
    const robot = await loadRobotFromXmlString('place_test', XML);
    robot.mujoco.mj_kinematics(robot.model, robot.data);
    const xposBefore = Array.from(robot.data.xpos as Float64Array);
    const scene = buildRobotScene(robot);
    scene.update(robot.data);
    const pelvisId = robot.bodyIds.get('pelvis')!;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    for (const yaw of [0, Math.PI / 2, -2]) {
      placeRobotRoot(scene, robot, 'pelvis', { x: 1.5, y: -2, yaw }, 0.9);
      scene.root.updateMatrixWorld(true);
      scene.bodyGroups.get(pelvisId)!.getWorldPosition(pos);
      scene.bodyGroups.get(pelvisId)!.getWorldQuaternion(quat);
      expect(pos.x).toBeCloseTo(1.5);
      expect(pos.y).toBeCloseTo(-2);
      expect(pos.z).toBeCloseTo(0.9);
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
      expect(Math.atan2(fwd.y, fwd.x)).toBeCloseTo(Math.atan2(Math.sin(FACING_YAW + yaw), Math.cos(FACING_YAW + yaw)));
    }
    // Display only: the solver's model state is exactly as it was.
    expect(Array.from(robot.data.xpos as Float64Array)).toEqual(xposBefore);
    // ...and re-placing never re-reads it: a pose the solver leaves behind in
    // the shared MjData does not leak into the config view.
    const xpos = robot.data.xpos as Float64Array;
    xpos[pelvisId * 3] += 10;
    placeRobotRoot(scene, robot, 'pelvis', { x: 0, y: 0, yaw: 0 }, 0.9);
    scene.root.updateMatrixWorld(true);
    scene.bodyGroups.get(pelvisId)!.getWorldPosition(pos);
    expect(pos.x).toBeCloseTo(0);
    xpos[pelvisId * 3] -= 10;
    scene.dispose();
  });

  it('stands the BVH root on the mark and turns it on its own, robot or not', () => {
    const anim = parseBvh(`HIERARCHY
ROOT Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation
  JOINT LeftUpLeg
  {
    OFFSET 10 0 0
    CHANNELS 3 Zrotation Yrotation Xrotation
    End Site
    {
      OFFSET 0 -40 0
    }
  }
  JOINT RightUpLeg
  {
    OFFSET -10 0 0
    CHANNELS 3 Zrotation Yrotation Xrotation
    End Site
    {
      OFFSET 0 -40 0
    }
  }
}
MOTION
Frames: 1
Frame Time: 0.033333
0 0 0 0 0 0 0 0 0 0 0 0
`);
    const sk = buildSkeletonView(anim, 0.01);
    const left = new THREE.Vector3();
    const right = new THREE.Vector3();
    const hips = new THREE.Vector3();
    for (const yaw of [0, Math.PI / 2]) {
      placeSkeleton(sk, anim, 'Hips', { x: -1, y: 2, yaw }, 0.9);
      sk.root.updateMatrixWorld(true);
      sk.getJointWorldPos(0, hips);
      expect(hips.x).toBeCloseTo(-1);
      expect(hips.y).toBeCloseTo(2);
      expect(hips.z).toBeCloseTo(0.9);
      sk.getJointWorldPos(1, left);
      sk.getJointWorldPos(2, right);
      // forward = up × (left → right)
      const fwdYaw = Math.atan2(right.x - left.x, -(right.y - left.y));
      expect(Math.cos(fwdYaw - (FACING_YAW + yaw))).toBeCloseTo(1);
    }
  });
});

describe('placement gizmo', () => {
  const gizmo = buildPlacementGizmo(0.4);
  const scene = new THREE.Scene();
  scene.add(gizmo.root);
  gizmo.place(1, 2, FACING_YAW);
  const at = (x: number, y: number) => gizmo.handleAt(new THREE.Raycaster(down(x, y).origin, down(x, y).direction))?.handle ?? null;

  it('tells the ring from the arrows, and misses the middle', () => {
    expect(at(1 + 0.38 * Math.cos(1), 2 + 0.38 * Math.sin(1))).toBe('turn');
    expect(at(1.62, 2)).toBe('x');
    expect(at(0.38, 2)).toBe('x');
    expect(at(1, 2.62)).toBe('y');
    expect(at(1, 2)).toBeNull();
  });

  it('lights a handle once', () => {
    expect(gizmo.hover('x')).toBe(true);
    expect(gizmo.hover('x')).toBe(false);
    expect(gizmo.hover(null)).toBe(true);
    gizmo.dispose();
    expect(gizmo.root.parent).toBeNull();
  });
});
