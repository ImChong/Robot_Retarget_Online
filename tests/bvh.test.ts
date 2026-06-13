import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBvh, bvhFk } from '../src/lib/bvh/parse';
import { bvhToLafan1Frames } from '../src/lib/bvh/lafan1';

const MINI_BVH = `HIERARCHY
ROOT Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation
  JOINT Chest
  {
    OFFSET 0 10 0
    CHANNELS 3 Zrotation Yrotation Xrotation
    End Site
    {
      OFFSET 0 5 0
    }
  }
}
MOTION
Frames: 2
Frame Time: 0.033333
0 100 0 0 0 0 0 0 0
0 100 0 90 0 0 0 0 0
`;

describe('bvh parser', () => {
  it('parses hierarchy, channels and frames', () => {
    const anim = parseBvh(MINI_BVH);
    expect(anim.joints.map((j) => j.name)).toEqual(['Hips', 'Chest']);
    expect(anim.joints[1].parent).toBe(0);
    expect(anim.joints[1].offset).toEqual([0, 10, 0]);
    expect(anim.frameCount).toBe(2);
    expect(anim.endSites).toHaveLength(1);
    expect(anim.joints[0].channels).toHaveLength(6);
    expect(anim.joints[1].channels).toHaveLength(3);
  });

  it('runs FK with rotations applied', () => {
    const anim = parseBvh(MINI_BVH);
    const { globalPos } = bvhFk(anim);
    const J = 2;
    // frame 0: chest above hips
    expect(globalPos[(0 * J + 1) * 3 + 1]).toBeCloseTo(110, 5);
    // frame 1: root rotated 90° about Z -> child offset (0,10,0) maps to (-10,0,0)
    expect(globalPos[(1 * J + 1) * 3 + 0]).toBeCloseTo(-10, 4);
    expect(globalPos[(1 * J + 1) * 3 + 1]).toBeCloseTo(100, 4);
  });
});

describe('sample motions (LAFAN1-compatible)', () => {
  const walkPath = fileURLToPath(new URL('../public/sample_motions/walk.bvh', import.meta.url));
  const text = readFileSync(walkPath, 'utf-8');

  it('walk.bvh parses with the LAFAN1 skeleton', () => {
    const anim = parseBvh(text);
    const names = anim.joints.map((j) => j.name);
    for (const required of [
      'Hips',
      'Spine2',
      'LeftUpLeg',
      'LeftLeg',
      'LeftFoot',
      'LeftToe',
      'RightUpLeg',
      'RightLeg',
      'RightFoot',
      'RightToe',
      'LeftArm',
      'LeftForeArm',
      'LeftHand',
      'RightArm',
      'RightForeArm',
      'RightHand',
    ]) {
      expect(names).toContain(required);
    }
    expect(anim.frameCount).toBe(900);
    expect(1 / anim.frameTime).toBeCloseTo(30, 3);
  });

  it('converts to Z-up meters with plausible proportions', () => {
    const anim = parseBvh(text);
    const motion = bvhToLafan1Frames(anim, 0.01);
    expect(motion.frames).toHaveLength(900);
    expect(motion.missingFootJoints).toHaveLength(0);

    const f0 = motion.frames[0];
    expect(f0.has('LeftFootMod')).toBe(true);
    expect(f0.has('RightFootMod')).toBe(true);

    const head = f0.get('Head')!;
    const hips = f0.get('Hips')!;
    const lFoot = f0.get('LeftFootMod')!;
    // Z-up: head above hips above feet
    expect(head.pos[2]).toBeGreaterThan(hips.pos[2]);
    expect(hips.pos[2]).toBeGreaterThan(lFoot.pos[2]);
    // human scale sane (meters)
    expect(head.pos[2]).toBeGreaterThan(1.3);
    expect(head.pos[2]).toBeLessThan(2.0);
    // feet near the ground over the whole motion
    let minFoot = Infinity;
    for (const frame of motion.frames) {
      const l = frame.get('LeftFootMod')!.pos[2];
      const r = frame.get('RightFootMod')!.pos[2];
      minFoot = Math.min(minFoot, l, r);
    }
    expect(minFoot).toBeGreaterThan(-0.05);
    expect(minFoot).toBeLessThan(0.2);
  });
});
