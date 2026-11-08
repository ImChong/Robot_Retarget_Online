/**
 * The structural ik_config template (src/lib/retarget/autoConfig.ts) against
 * the hand-tuned GMR presets of the bundled humanoids: same bodies, rotation
 * offsets within a few degrees, scales close to GMR's. G1 is the reference the
 * offsets are carried over from, so it must come back exactly.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { resetMujocoModule } from '../../src/lib/mujoco/runtime';
import {
  G1_REFERENCE,
  analyzeHumanoid,
  createStructuralHumanoidConfig,
  restPose,
} from '../../src/lib/retarget/autoConfig';
import { getDefaultConfig } from '../../src/lib/retarget/defaults';
import type { GmrIkConfig } from '../../src/lib/retarget/types';
import { entryById, loadRobotFromDisk } from './_utils';

const angleDeg = (a: number[], b: number[]) => {
  const d = Math.abs(a.reduce((s, v, i) => s + v * b[i], 0));
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
};

function byBone(config: GmrIkConfig) {
  return new Map(Object.entries(config.ik_match_table2).map(([body, e]) => [e[0], { body, rot: e[4] }]));
}

afterEach(async () => {
  await resetMujocoModule(); // one robot per heap: the meshes are large
});

describe('structural humanoid template', () => {
  it('reproduces the Unitree G1 preset it is calibrated on', async () => {
    const robot = await loadRobotFromDisk(entryById('unitree_g1'));
    const auto = createStructuralHumanoidConfig(robot, 'pelvis')!;
    const preset = byBone(getDefaultConfig('unitree_g1'));
    const mine = byBone(auto);
    expect([...mine.keys()].sort()).toEqual([...preset.keys()].sort());
    for (const [bone, { body, rot }] of mine) {
      expect(body, bone).toBe(preset.get(bone)!.body);
      expect(angleDeg(rot, preset.get(bone)!.rot), bone).toBeLessThan(1);
    }
    // GMR's G1 scale: 0.9 × 1.75 / 1.8 = 0.875.
    expect(auto.human_scale_table.Hips).toBeCloseTo(0.875, 1);
    expect(auto.human_scale_table.LeftFootMod).toBeCloseTo(0.875, 1);

    // The reference table is G1 measured with the same definitions.
    const sk = analyzeHumanoid(robot, 'pelvis')!;
    const rp = restPose(robot, 'pelvis');
    const unit = (a: number[], b: number[]) => {
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const n = Math.hypot(d[0], d[1], d[2]);
      return d.map((x) => x / n);
    };
    expect(unit(rp.pos[sk.left.hip], rp.pos[sk.left.knee])[2]).toBeCloseTo(G1_REFERENCE.LeftUpLeg.dir![2], 2);
    expect(unit(rp.pos[sk.leftArm!.elbow], sk.leftArm!.tip)[0]).toBeCloseTo(G1_REFERENCE.LeftForeArm.dir![0], 2);
  });

  // GMR's own presets for other robots: the template's bodies may sit one
  // joint over (thigh_yaw vs thigh_roll) but must point the same way.
  it.each([
    ['fourier_n1', 15],
    ['booster_t1_29dof', 20],
  ])('agrees with the GMR preset of %s', async (id, maxDeg) => {
    const robot = await loadRobotFromDisk(entryById(id));
    const preset = getDefaultConfig(id);
    const auto = createStructuralHumanoidConfig(robot, preset.robot_root_name)!;
    expect(auto).not.toBeNull();
    const ref = byBone(preset);
    for (const [bone, { rot }] of byBone(auto)) {
      if (!ref.has(bone)) continue;
      expect(angleDeg(rot, ref.get(bone)!.rot), `${id} ${bone}`).toBeLessThan(maxDeg);
    }
    const effective = preset.human_scale_table.Hips * (1.75 / preset.human_height_assumption);
    expect(Math.abs(auto.human_scale_table.Hips / effective - 1)).toBeLessThan(0.1);
  });
});
