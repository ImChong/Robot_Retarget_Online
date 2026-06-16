import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBvh, isDecorJoint, resolveMotionRootJoint } from '../src/lib/bvh/parse';
import { buildSkeletonView } from '../src/lib/viewport/skeletonView';
import * as THREE from 'three';

describe('quadruped BVH helpers', () => {
  it('flags Biped helper joints as decor', () => {
    expect(isDecorJoint('Bip01_Footsteps')).toBe(true);
    expect(isDecorJoint('Bip01_HeadNub')).toBe(true);
    expect(isDecorJoint('Dog_LeftArmor001')).toBe(true);
    expect(isDecorJoint('b_Hips')).toBe(false);
    expect(isDecorJoint('b_LeftHand')).toBe(false);
  });

  it('resolves b_Hips as the motion root for dog samples', () => {
    const text = readFileSync(join(import.meta.dirname, '../public/sample_motions/dog_walk.bvh'), 'utf-8');
    const anim = parseBvh(text);
    expect(anim.joints[resolveMotionRootJoint(anim)].name).toBe('b_Hips');
  });

  it('hides decor joints and their bones in the dog skeleton view', () => {
    const text = readFileSync(join(import.meta.dirname, '../public/sample_motions/dog_walk.bvh'), 'utf-8');
    const anim = parseBvh(text);
    const sk = buildSkeletonView(anim, 0.01);

    const decorNames = ['Bip01_Footsteps', 'Bip01_HeadNub', 'Dog_LeftArmor001'];
    let capsuleCount = 0;
    sk.root.traverse((o) => {
      if (o.type === 'Mesh' && (o as THREE.Mesh).geometry.type === 'CapsuleGeometry') capsuleCount++;
    });
    for (const name of decorNames) {
      const idx = anim.joints.findIndex((j) => j.name === name);
      const group = sk.root.getObjectByName(name);
      expect(group, name).toBeTruthy();
      const sphere = group!.children.find((c) => c.type === 'Mesh') as THREE.Mesh | undefined;
      expect(sphere?.visible, `${name} sphere`).toBe(false);
    }
    // Decor filtering removes Footsteps + Nubs + armor bones.
    expect(capsuleCount).toBeLessThan(55);
    expect(capsuleCount).toBeGreaterThanOrEqual(35);

    sk.dispose();
  });
});
