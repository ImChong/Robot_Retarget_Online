import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBvh } from '../src/lib/bvh/parse';
import {
  detectMotionKind,
  isMotionKindDisabled,
  motionMatchesRobot,
} from '../src/lib/motionKind';
import { useMotionStore } from '../src/stores/motion';

const ROOT = join(import.meta.dirname, '..');

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('motionKind', () => {
  it('classifies LAFAN1 and dog samples', () => {
    const walk = parseBvh(readFileSync(join(ROOT, 'public/sample_motions/walk.bvh'), 'utf-8'));
    const dog = parseBvh(readFileSync(join(ROOT, 'public/sample_motions/dog_walk.bvh'), 'utf-8'));
    expect(detectMotionKind(walk, 'walk.bvh')).toBe('humanoid');
    expect(detectMotionKind(dog, 'dog_walk.bvh')).toBe('quadruped');
  });

  it('pairs robots with the matching motion family', () => {
    expect(motionMatchesRobot('humanoid', 'bvh_lafan1')).toBe(true);
    expect(motionMatchesRobot('humanoid', 'bvh_quadruped')).toBe(false);
    expect(motionMatchesRobot('quadruped', 'bvh_quadruped')).toBe(true);
    expect(motionMatchesRobot('quadruped', 'bvh_lafan1')).toBe(false);
    // SMPL-X robots match only SMPL-X motion, and never a BVH/quadruped motion.
    expect(motionMatchesRobot('smplx', 'smplx')).toBe(true);
    expect(motionMatchesRobot('smplx', 'bvh_lafan1')).toBe(false);
    expect(motionMatchesRobot('humanoid', 'smplx')).toBe(false);
    expect(motionMatchesRobot('quadruped', 'smplx')).toBe(false);
  });

  it('greys out the other family once a motion is loaded', () => {
    expect(isMotionKindDisabled(null, 'humanoid')).toBe(false);
    expect(isMotionKindDisabled('quadruped', 'humanoid')).toBe(true);
    expect(isMotionKindDisabled('quadruped', 'quadruped')).toBe(false);
    expect(isMotionKindDisabled('humanoid', 'quadruped')).toBe(true);
  });

  it('stores motionKind on load', () => {
    const motion = useMotionStore();
    const text = readFileSync(join(ROOT, 'public/sample_motions/dog_walk.bvh'), 'utf-8');
    motion.loadBvhText(text, 'dog_walk.bvh');
    expect(motion.motionKind).toBe('quadruped');
    motion.clear();
    expect(motion.motionKind).toBeNull();
  });
});
