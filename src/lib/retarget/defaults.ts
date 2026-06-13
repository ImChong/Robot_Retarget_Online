/**
 * Built-in robots and their default GMR ik_configs (copied verbatim from the
 * GMR repository, MIT License — https://github.com/YanjieZe/GMR).
 *
 * Regenerate via: python3 scripts/prepare_gmr_robots.py
 */

import smplx_to_bhl from './configs/smplx_to_bhl.json';
import smplx_to_k1 from './configs/smplx_to_k1.json';
import smplx_to_t1 from './configs/smplx_to_t1.json';
import bvh_lafan1_to_booster_t1_29dof from './configs/bvh_lafan1_to_booster_t1_29dof.json';
import bvh_lafan1_to_pm01 from './configs/bvh_lafan1_to_pm01.json';
import smplx_to_gr3 from './configs/smplx_to_gr3.json';
import bvh_lafan1_to_n1 from './configs/bvh_lafan1_to_n1.json';
import smplx_to_r1pro from './configs/smplx_to_r1pro.json';
import smplx_to_hi from './configs/smplx_to_hi.json';
import smplx_to_kuavo from './configs/smplx_to_kuavo.json';
import bvh_to_talos from './configs/bvh_to_talos.json';
import smplx_to_adam from './configs/smplx_to_adam.json';
import bvh_lafan1_to_toddy from './configs/bvh_lafan1_to_toddy.json';
import smplx_to_tienkung from './configs/smplx_to_tienkung.json';
import bvh_lafan1_to_unitree_g1 from './configs/bvh_lafan1_to_unitree_g1.json';
import smplx_to_h1 from './configs/smplx_to_h1.json';
import smplx_to_h1_2 from './configs/smplx_to_h1_2.json';
import type { GmrIkConfig } from './types';

export const DEFAULT_CONFIGS: Record<string, GmrIkConfig> = {
  berkeley_humanoid_lite: smplx_to_bhl as unknown as GmrIkConfig,
  booster_k1: smplx_to_k1 as unknown as GmrIkConfig,
  booster_t1: smplx_to_t1 as unknown as GmrIkConfig,
  booster_t1_29dof: bvh_lafan1_to_booster_t1_29dof as unknown as GmrIkConfig,
  engineai_pm01: bvh_lafan1_to_pm01 as unknown as GmrIkConfig,
  fourier_gr3: smplx_to_gr3 as unknown as GmrIkConfig,
  fourier_n1: bvh_lafan1_to_n1 as unknown as GmrIkConfig,
  galaxea_r1pro: smplx_to_r1pro as unknown as GmrIkConfig,
  hightorque_hi: smplx_to_hi as unknown as GmrIkConfig,
  kuavo_s45: smplx_to_kuavo as unknown as GmrIkConfig,
  pal_talos: bvh_to_talos as unknown as GmrIkConfig,
  pnd_adam_lite: smplx_to_adam as unknown as GmrIkConfig,
  stanford_toddy: bvh_lafan1_to_toddy as unknown as GmrIkConfig,
  tienkung: smplx_to_tienkung as unknown as GmrIkConfig,
  unitree_g1: bvh_lafan1_to_unitree_g1 as unknown as GmrIkConfig,
  unitree_g1_with_hands: bvh_lafan1_to_unitree_g1 as unknown as GmrIkConfig,
  unitree_h1: smplx_to_h1 as unknown as GmrIkConfig,
  unitree_h1_2: smplx_to_h1_2 as unknown as GmrIkConfig,
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
