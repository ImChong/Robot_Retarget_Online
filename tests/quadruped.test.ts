import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBvh } from '../src/lib/bvh/parse';
import { bvhToLafan1Frames } from '../src/lib/bvh/lafan1';
import { GmrRetargetEngine } from '../src/lib/retarget/engine';
import { getDefaultConfig } from '../src/lib/retarget/defaults';
import { DEFAULT_SOLVER_OPTIONS } from '../src/lib/retarget/types';
import { quatRotate, type Quat } from '../src/lib/math3d';
import { loadRobotFromDisk, entryById, ROOT } from './robots/_utils';

const DOG_CLIPS = ['dog_walk.bvh', 'dog_run.bvh', 'dog_idle.bvh'] as const;
const QUADRUPEDS = [
  ['unitree_go2', 'base'],
  ['unitree_a1', 'trunk'],
] as const;

function dogFrames(name: string) {
  const text = readFileSync(join(ROOT, `public/sample_motions/${name}`), 'utf-8');
  return bvhToLafan1Frames(parseBvh(text));
}

describe('quadruped retargeting (dog mocap → robot)', () => {
  for (const clip of DOG_CLIPS) {
    it(`${clip} carries the expected quadruped keypoints`, () => {
      const m = dogFrames(clip);
      expect(m.frames.length).toBeGreaterThan(50);
      const f0 = m.frames[0];
      for (const j of ['b_Hips', 'b_LeftHand', 'b_RightHand', 'b_LeftToe', 'b_RightToe']) {
        expect(f0.has(j), `frame missing ${j}`).toBe(true);
      }
    });
  }

  for (const [robotId, root] of QUADRUPEDS) {
    for (const clip of DOG_CLIPS) {
      it(`${robotId} / ${clip}: stands and tracks the 4 feet`, async () => {
        const robot = await loadRobotFromDisk(entryById(robotId));
        const engine = new GmrRetargetEngine(robot, getDefaultConfig(robotId), {
          ...DEFAULT_SOLVER_OPTIONS,
        });
        const m = dogFrames(clip);
        const xpos = robot.data.xpos as Float64Array;
        const xquat = robot.data.xquat as Float64Array;
        const bb = robot.bodyIds.get(root)!;

        let baseZ = 0;
        let footErr = 0;
        let maxFootErr = 0;
        let tilt = 0;
        const N = m.frames.length;
        for (let i = 0; i < N; i++) {
          engine.retargetFrame(m.frames[i]);
          baseZ += xpos[bb * 3 + 2];
          const bq: Quat = [xquat[bb * 4], xquat[bb * 4 + 1], xquat[bb * 4 + 2], xquat[bb * 4 + 3]];
          const up = quatRotate(bq, [0, 0, 1]);
          tilt += Math.acos(Math.max(-1, Math.min(1, up[2])));
          const fe = engine.taskPositionErrors();
          let fsum = 0;
          for (let k = 1; k < fe.length; k++) {
            fsum += fe[k]; // tasks beyond the base are the 4 feet
            if (fe[k] > maxFootErr) maxFootErr = fe[k];
          }
          footErr += fsum / (fe.length - 1);
        }
        engine.dispose();

        const meanBaseZ = baseZ / N;
        const meanFoot = footErr / N;
        const meanTilt = (tilt / N) * 180 / Math.PI;
        console.info(
          `[quadruped] ${robotId} ${clip}: frames=${N} baseZ=${meanBaseZ.toFixed(3)} m ` +
            `foot=${(meanFoot * 100).toFixed(2)} cm (max ${(maxFootErr * 100).toFixed(2)} cm) tilt=${meanTilt.toFixed(1)}°`,
        );
        // Standing height around the robot's natural crouch, feet near their targets, roughly upright.
        expect(meanBaseZ, 'mean base height').toBeGreaterThan(0.2);
        expect(meanBaseZ, 'mean base height').toBeLessThan(0.4);
        expect(meanFoot, 'mean foot error').toBeLessThan(0.05);
        expect(meanTilt, 'mean trunk tilt').toBeLessThan(25);
      });
    }
  }
});
