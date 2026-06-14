/**
 * Retarget Motion JSON: parse/serialize round-trips, format detection, and a
 * behavioural check that the bundled JSON sample clips load through the same
 * pipeline as BVH (upright standing pose, feet near the ground, LAFAN1 joints).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBvh, bvhFk } from '../src/lib/bvh/parse';
import { bvhToLafan1Frames } from '../src/lib/bvh/lafan1';
import {
  bvhAnimToMotionJson,
  looksLikeMotionJson,
  parseMotionJson,
  serializeMotionJson,
  type MotionJsonDoc,
} from '../src/lib/motion/motionJson';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JSON_SAMPLES = ['walk', 'wave', 'squat', 'tpose_calibration'];

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

describe('motion json format', () => {
  it('detects motion json by extension and content', () => {
    expect(looksLikeMotionJson('{}', 'foo.json')).toBe(true);
    expect(looksLikeMotionJson('  { "format": "retarget_motion_json" }', 'foo.txt')).toBe(true);
    expect(looksLikeMotionJson('HIERARCHY\nROOT Hips', 'foo.bvh')).toBe(false);
    expect(looksLikeMotionJson('{ "other": 1 }', 'foo.txt')).toBe(false);
  });

  it('parses a hand-written document into a BvhAnim', () => {
    const doc: MotionJsonDoc = {
      format: 'retarget_motion_json',
      version: 1,
      fps: 30,
      skeleton: [
        { name: 'Hips', parent: -1, offset: [0, 0, 0] },
        { name: 'Chest', parent: 0, offset: [0, 10, 0] },
      ],
      rootPositions: [
        [0, 100, 0],
        [0, 100, 0],
      ],
      // frame 1: 90° about Z on the root (wxyz)
      rotations: [
        [
          [1, 0, 0, 0],
          [1, 0, 0, 0],
        ],
        [
          [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
          [1, 0, 0, 0],
        ],
      ],
    };
    const { anim, unitScale } = parseMotionJson(doc);
    expect(anim.joints.map((j) => j.name)).toEqual(['Hips', 'Chest']);
    expect(anim.frameCount).toBe(2);
    expect(unitScale).toBe(0.01);

    const { globalPos } = bvhFk(anim);
    const Jn = 2;
    // frame 0: chest 10 above hips
    expect(globalPos[(0 * Jn + 1) * 3 + 1]).toBeCloseTo(110, 5);
    // frame 1: root yawed 90° about Z → child offset (0,10,0) → (-10,100,0)
    expect(globalPos[(1 * Jn + 1) * 3 + 0]).toBeCloseTo(-10, 4);
    expect(globalPos[(1 * Jn + 1) * 3 + 1]).toBeCloseTo(100, 4);
  });

  it('round-trips a BVH through serialize → parse (FK preserved)', () => {
    const original = parseBvh(MINI_BVH);
    const doc = bvhAnimToMotionJson(original, { unitScale: 0.01 });
    expect(doc.format).toBe('retarget_motion_json');

    const { anim } = parseMotionJson(serializeMotionJson(original));
    expect(anim.frameCount).toBe(original.frameCount);
    expect(anim.joints.map((j) => j.name)).toEqual(original.joints.map((j) => j.name));

    const a = bvhFk(original);
    const b = bvhFk(anim);
    for (let i = 0; i < a.globalPos.length; i++) {
      expect(b.globalPos[i]).toBeCloseTo(a.globalPos[i], 4);
    }
  });

  it('rejects malformed documents with clear errors', () => {
    expect(() => parseMotionJson('{ "skeleton": [] , "rotations": [] }')).toThrow(/non-empty/);
    expect(() =>
      parseMotionJson({
        format: 'retarget_motion_json',
        version: 1,
        fps: 30,
        skeleton: [{ name: 'Hips', parent: -1, offset: [0, 0, 0] }],
        rotations: [[[1, 0, 0, 0], [1, 0, 0, 0]]],
      } as unknown),
    ).toThrow(/must have 1 quaternions/);
    expect(() => parseMotionJson({ format: 'something_else' } as unknown)).toThrow(/unsupported format/);
  });
});

describe('bundled JSON sample clips', () => {
  for (const name of JSON_SAMPLES) {
    it(`${name}.motion.json loads as an upright LAFAN1 motion`, () => {
      const text = readFileSync(join(ROOT, 'public', 'sample_motions', `${name}.motion.json`), 'utf-8');
      expect(looksLikeMotionJson(text, `${name}.motion.json`)).toBe(true);

      const { anim, unitScale } = parseMotionJson(text);
      expect(anim.frameCount).toBeGreaterThan(0);
      expect(unitScale).toBe(0.01);

      const motion = bvhToLafan1Frames(anim, unitScale);
      expect(motion.missingFootJoints).toHaveLength(0);

      // Upright at frame 0: head above hips above feet (Z-up, meters).
      const f0 = motion.frames[0];
      const head = f0.get('Head')!;
      const hips = f0.get('Hips')!;
      const lFoot = f0.get('LeftFootMod')!;
      const rFoot = f0.get('RightFootMod')!;
      expect(head.pos[2]).toBeGreaterThan(hips.pos[2]);
      expect(hips.pos[2]).toBeGreaterThan(lFoot.pos[2]);
      expect(head.pos[2]).toBeGreaterThan(1.3);
      expect(head.pos[2]).toBeLessThan(2.0);

      // Feet stay near the ground across the whole clip; every value finite.
      let minFoot = Infinity;
      for (const frame of motion.frames) {
        for (const body of frame.values()) {
          for (const v of body.pos) expect(Number.isFinite(v)).toBe(true);
          for (const v of body.quat) expect(Number.isFinite(v)).toBe(true);
        }
        minFoot = Math.min(minFoot, frame.get('LeftFootMod')!.pos[2], frame.get('RightFootMod')!.pos[2]);
      }
      expect(minFoot).toBeGreaterThan(-0.06);
      expect(minFoot).toBeLessThan(0.25);
    });
  }
});
