/**
 * Built-in robots and their default GMR ik_configs (copied verbatim from the
 * GMR repository, MIT License — https://github.com/YanjieZe/GMR).
 */

import g1Config from './configs/bvh_lafan1_to_unitree_g1.json';
import t1Config from './configs/bvh_lafan1_to_booster_t1_29dof.json';
import type { GmrIkConfig } from './types';

export const DEFAULT_CONFIGS: Record<string, GmrIkConfig> = {
  unitree_g1: g1Config as unknown as GmrIkConfig,
  booster_t1_29dof: t1Config as unknown as GmrIkConfig,
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
