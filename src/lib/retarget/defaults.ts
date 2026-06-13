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
import type { GmrIkConfig } from './types';

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
