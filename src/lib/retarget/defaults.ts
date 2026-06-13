/**
 * Built-in robots and their default GMR ik_configs (copied verbatim from the
 * GMR repository, MIT License — https://github.com/YanjieZe/GMR).
 *
 * Only robots with bundled bvh_lafan1 configs (UI dropdown entries).
 * Regenerate via: python3 scripts/prepare_gmr_robots.py
 */

import bvh_lafan1_to_booster_t1_29dof from './configs/bvh_lafan1_to_booster_t1_29dof.json';
import bvh_lafan1_to_pm01 from './configs/bvh_lafan1_to_pm01.json';
import bvh_lafan1_to_n1 from './configs/bvh_lafan1_to_n1.json';
import bvh_to_talos from './configs/bvh_to_talos.json';
import bvh_lafan1_to_toddy from './configs/bvh_lafan1_to_toddy.json';
import bvh_lafan1_to_unitree_g1 from './configs/bvh_lafan1_to_unitree_g1.json';
import type { GmrIkConfig, IkMatchEntry } from './types';

export const DEFAULT_CONFIGS: Record<string, GmrIkConfig> = {
  booster_t1_29dof: bvh_lafan1_to_booster_t1_29dof as unknown as GmrIkConfig,
  engineai_pm01: bvh_lafan1_to_pm01 as unknown as GmrIkConfig,
  fourier_n1: bvh_lafan1_to_n1 as unknown as GmrIkConfig,
  pal_talos: bvh_to_talos as unknown as GmrIkConfig,
  stanford_toddy: bvh_lafan1_to_toddy as unknown as GmrIkConfig,
  unitree_g1: bvh_lafan1_to_unitree_g1 as unknown as GmrIkConfig,
  unitree_g1_with_hands: bvh_lafan1_to_unitree_g1 as unknown as GmrIkConfig,
};

export function getDefaultConfig(robotId: string): GmrIkConfig {
  const cfg = DEFAULT_CONFIGS[robotId];
  if (!cfg) throw new Error(`No default config for robot ${robotId}`);
  return structuredClone(cfg);
}

/** Minimal ik_config template for a user-imported robot (no GMR preset). */
export function createBlankConfig(baseBody: string, bodyNames: string[]): GmrIkConfig {
  const bodies = bodyNames.filter((n) => n !== 'world' && n !== baseBody);
  const pick = (pred: (n: string) => boolean) => bodies.find(pred);

  const leftThigh = pick((n) => /left.*(thigh|hip|upleg|leg)/i.test(n) && !/arm|hand|foot|ankle|shank|knee/i.test(n));
  const rightThigh = pick((n) => /right.*(thigh|hip|upleg|leg)/i.test(n) && !/arm|hand|foot|ankle|shank|knee/i.test(n));
  const leftShin = pick((n) => /left.*(shank|knee|leg)/i.test(n) && !/thigh|hip|upleg|arm|hand|foot|ankle/i.test(n));
  const rightShin = pick((n) => /right.*(shank|knee|leg)/i.test(n) && !/thigh|hip|upleg|arm|hand|foot|ankle/i.test(n));
  const torso = pick((n) => /(torso|spine|chest|trunk|waist)/i.test(n));

  const identityRot: [number, number, number, number] = [1, 0, 0, 0];
  const zero: [number, number, number] = [0, 0, 0];
  const mk = (human: string, posW: number, rotW: number): IkMatchEntry => [
    human,
    posW,
    rotW,
    zero,
    identityRot,
  ];

  const ik_match_table1: Record<string, IkMatchEntry> = {
    [baseBody]: mk('Hips', 0, 10),
  };
  const ik_match_table2: Record<string, IkMatchEntry> = {
    [baseBody]: mk('Hips', 100, 5),
  };

  if (leftThigh) {
    ik_match_table1[leftThigh] = mk('LeftUpLeg', 0, 10);
    ik_match_table2[leftThigh] = mk('LeftUpLeg', 10, 5);
  }
  if (rightThigh) {
    ik_match_table1[rightThigh] = mk('RightUpLeg', 0, 10);
    ik_match_table2[rightThigh] = mk('RightUpLeg', 10, 5);
  }
  if (leftShin) {
    ik_match_table1[leftShin] = mk('LeftLeg', 0, 10);
    ik_match_table2[leftShin] = mk('LeftLeg', 10, 5);
  }
  if (rightShin) {
    ik_match_table1[rightShin] = mk('RightLeg', 0, 10);
    ik_match_table2[rightShin] = mk('RightLeg', 10, 5);
  }
  if (torso) {
    ik_match_table1[torso] = mk('Spine2', 0, 10);
    ik_match_table2[torso] = mk('Spine2', 10, 5);
  }

  return {
    robot_root_name: baseBody,
    human_root_name: 'Hips',
    ground_height: 0,
    human_height_assumption: 1.8,
    use_ik_match_table1: true,
    use_ik_match_table2: true,
    human_scale_table: {
      Hips: 0.9,
      Spine2: 0.9,
      LeftUpLeg: 0.9,
      RightUpLeg: 0.9,
      LeftLeg: 0.9,
      RightLeg: 0.9,
      LeftFootMod: 0.9,
      RightFootMod: 0.9,
      LeftArm: 0.75,
      RightArm: 0.75,
      LeftForeArm: 0.75,
      RightForeArm: 0.75,
      LeftHand: 0.75,
      RightHand: 0.75,
    },
    ik_match_table1,
    ik_match_table2,
  };
}

export function validateConfig(raw: unknown): GmrIkConfig {
  if (typeof raw !== 'object' || raw === null) throw new Error('Config must be a JSON object');
  const cfg = raw as Partial<GmrIkConfig>;
  const required: (keyof GmrIkConfig)[] = [
    'robot_root_name',
    'human_root_name',
    'human_height_assumption',
    'human_scale_table',
    'ik_match_table1',
    'ik_match_table2',
  ];
  for (const key of required) {
    if (cfg[key] === undefined) throw new Error(`Config missing field "${key}"`);
  }
  return {
    ground_height: 0,
    use_ik_match_table1: true,
    use_ik_match_table2: true,
    ...cfg,
  } as GmrIkConfig;
}
