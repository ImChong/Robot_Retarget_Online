import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseBvh } from '../src/lib/bvh/parse';
import { buildSkeletonView } from '../src/lib/viewport/skeletonView';
import { nearestScreenAnchor } from '../src/lib/viewport/scenePick';
import { onViewportTap, type ViewportTap } from '../src/lib/viewport/viewportTap';
import { loadRobotFromXmlString } from '../src/lib/mujoco/runtime';
import { buildRobotScene } from '../src/lib/mujoco/threeScene';

const BVH = `HIERARCHY
ROOT Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation
  JOINT Chest
  {
    OFFSET 0 50 0
    CHANNELS 3 Zrotation Yrotation Xrotation
    JOINT Head
    {
      OFFSET 0 50 0
      CHANNELS 3 Zrotation Yrotation Xrotation
      End Site
      {
        OFFSET 0 10 0
      }
    }
  }
}
MOTION
Frames: 1
Frame Time: 0.033333
0 0 0 0 0 0 0 0 0 0 0 0
`;

/** Ray straight down the world -Y axis through (x, z), i.e. looking at the skeleton's X-Z plane. */
function rayAt(x: number, z: number): THREE.Raycaster {
  return new THREE.Raycaster(new THREE.Vector3(x, -5, z), new THREE.Vector3(0, 1, 0));
}

describe('skeleton joint picking', () => {
  // BVH is Y-up: after the view's Y-up → Z-up turn, Hips is at z=0, Chest z=0.5, Head z=1.
  const anim = parseBvh(BVH);
  const sk = buildSkeletonView(anim, 0.01);
  sk.root.updateMatrixWorld(true);
  const name = (hit: { joint: number } | null) => (hit ? anim.joints[hit.joint].name : null);

  it('picks the joint whose sphere is hit', () => {
    expect(name(sk.pickJoint(rayAt(0, 0.5)))).toBe('Chest');
    expect(name(sk.pickJoint(rayAt(0, 1.0)))).toBe('Head');
  });

  it('picks the nearer end of a hit bone', () => {
    expect(name(sk.pickJoint(rayAt(0, 0.12)))).toBe('Hips');
    expect(name(sk.pickJoint(rayAt(0, 0.4)))).toBe('Chest');
    expect(name(sk.pickJoint(rayAt(0, 0.85)))).toBe('Head');
  });

  it('misses empty space', () => {
    expect(sk.pickJoint(rayAt(1, 0.5))).toBeNull();
  });

  it('ignores a hidden skeleton', () => {
    sk.root.visible = false;
    expect(sk.pickJoint(rayAt(0, 0.5))).toBeNull();
    sk.root.visible = true;
  });
});

describe('robot body picking', () => {
  const XML = `<mujoco model="pick">
  <worldbody>
    <body name="base" pos="0 0 1">
      <geom type="box" size="0.1 0.1 0.1" contype="0" conaffinity="0" rgba="1 1 1 1"/>
      <body name="arm" pos="0.5 0 0">
        <geom type="sphere" size="0.05" contype="0" conaffinity="0" rgba="1 1 1 1"/>
      </body>
      <body name="marker" pos="-0.5 0 0">
        <geom type="sphere" size="0.05" rgba="1 1 1 1"/>
      </body>
    </body>
  </worldbody>
</mujoco>`;

  it('finds the body of the visual geom under the ray and tints only that body', async () => {
    const robot = await loadRobotFromXmlString('pick_test', XML);
    robot.mujoco.mj_kinematics(robot.model, robot.data);
    const scene = buildRobotScene(robot);
    scene.update(robot.data);
    const hit = (x: number) => {
      // Slightly off-centre: a ray through a sphere's pole vertex grazes degenerate triangles.
      const r = scene.pickBody(rayAt(x, 1.02));
      return r ? robot.bodyNames[r.bodyId] : null;
    };
    expect(hit(0)).toBe('base');
    expect(hit(0.5)).toBe('arm');
    expect(hit(-0.5)).toBeNull(); // collision-only geom: not drawn, not pickable
    expect(hit(0.25)).toBeNull();

    const emissive = (body: string) => {
      const mesh = scene.bodyGroups.get(robot.bodyIds.get(body)!)!.children[0] as THREE.Mesh;
      return (mesh.material as THREE.MeshStandardMaterial).emissive.getHex();
    };
    scene.setHighlightedBody(robot.bodyIds.get('arm')!);
    expect(emissive('arm')).not.toBe(0);
    expect(emissive('base')).toBe(0);
    scene.setHighlightedBody(robot.bodyIds.get('base')!);
    expect(emissive('arm')).toBe(0);
    expect(emissive('base')).not.toBe(0);
    scene.setHighlightedBody(null);
    expect(emissive('base')).toBe(0);
    scene.dispose();
  });
});

describe('screen-space anchors', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, -5, 0);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const anchors = [
    { id: 'center', world: new THREE.Vector3(0, 0, 0) },
    { id: 'up', world: new THREE.Vector3(0, 0, 1) },
    { id: 'behind', world: new THREE.Vector3(0, -10, 0) },
  ];

  it('takes the anchor drawn nearest the pixel, within the radius', () => {
    expect(nearestScreenAnchor(anchors, camera, 400, 400, 205, 198, 12)).toBe('center');
    expect(nearestScreenAnchor(anchors, camera, 400, 400, 200, 130, 12)).toBe('up');
    expect(nearestScreenAnchor(anchors, camera, 400, 400, 260, 260, 12)).toBeNull();
  });
});

describe('viewport tap detection', () => {
  function pointer(type: string, init: Record<string, number | string>): Event {
    return Object.assign(new Event(type), { pointerId: 1, pointerType: 'mouse', button: 0, ...init });
  }
  function setup() {
    const target = new EventTarget();
    const taps: ViewportTap[] = [];
    const off = onViewportTap(target, (tap) => taps.push(tap));
    return { target, taps, off };
  }

  it('reports a click that did not move the camera', () => {
    const { target, taps } = setup();
    target.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }));
    target.dispatchEvent(pointer('pointerup', { clientX: 12, clientY: 11 }));
    expect(taps).toEqual([{ clientX: 12, clientY: 11, pointerType: 'mouse' }]);
  });

  it('ignores an orbit drag, even one that returns to where it started', () => {
    const { target, taps } = setup();
    target.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }));
    target.dispatchEvent(pointer('pointermove', { clientX: 80, clientY: 10 }));
    target.dispatchEvent(pointer('pointerup', { clientX: 10, clientY: 10 }));
    expect(taps).toEqual([]);
  });

  it('ignores right / middle buttons (pan) and pinch gestures', () => {
    const { target, taps } = setup();
    target.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10, button: 2 }));
    target.dispatchEvent(pointer('pointerup', { clientX: 10, clientY: 10, button: 2 }));
    const touch = { pointerType: 'touch' };
    target.dispatchEvent(pointer('pointerdown', { ...touch, pointerId: 5, clientX: 10, clientY: 10 }));
    target.dispatchEvent(pointer('pointerdown', { ...touch, pointerId: 6, clientX: 90, clientY: 90 }));
    target.dispatchEvent(pointer('pointerup', { ...touch, pointerId: 6, clientX: 90, clientY: 90 }));
    target.dispatchEvent(pointer('pointerup', { ...touch, pointerId: 5, clientX: 10, clientY: 10 }));
    expect(taps).toEqual([]);
  });

  it('gives a finger more slop than a mouse, and stops after unbinding', () => {
    const { target, taps, off } = setup();
    target.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 }));
    target.dispatchEvent(pointer('pointerup', { pointerType: 'touch', clientX: 18, clientY: 10 }));
    target.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }));
    target.dispatchEvent(pointer('pointerup', { clientX: 18, clientY: 10 }));
    expect(taps.map((t) => t.pointerType)).toEqual(['touch']);
    off();
    target.dispatchEvent(pointer('pointerdown', { clientX: 10, clientY: 10 }));
    target.dispatchEvent(pointer('pointerup', { clientX: 10, clientY: 10 }));
    expect(taps).toHaveLength(1);
  });
});
