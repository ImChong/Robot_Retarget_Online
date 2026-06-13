import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { parseBvh } from '../src/lib/bvh/parse';
import { buildSkeletonView } from '../src/lib/viewport/skeletonView';
import {
  followOrbitCamera,
  horizontalYaw,
  jointIndexByName,
  VIEWPORT_ANCHOR,
} from '../src/lib/viewport/sceneAlignment';
import type { SceneManager } from '../src/lib/viewport/SceneManager';

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

describe('horizontalYaw', () => {
  it('returns 0 for identity facing +Y', () => {
    expect(horizontalYaw(new THREE.Quaternion())).toBeCloseTo(0, 5);
  });

  it('returns ±π/2 for facing ±X', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    expect(Math.abs(horizontalYaw(q))).toBeCloseTo(Math.PI / 2, 4);
  });
});
