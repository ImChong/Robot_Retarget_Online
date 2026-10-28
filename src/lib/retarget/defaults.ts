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
import bvh_quadruped_to_unitree_go2 from './configs/bvh_quadruped_to_unitree_go2.json';
import bvh_quadruped_to_unitree_a1 from './configs/bvh_quadruped_to_unitree_a1.json';
// SMPL-X / AMASS configs (GMR smplx_to_*). Used when the loaded motion is SMPL-X.
import smplx_to_h1 from './configs/smplx_to_h1.json';
import smplx_to_h1_2 from './configs/smplx_to_h1_2.json';
import smplx_to_t1 from './configs/smplx_to_t1.json';
import smplx_to_kuavo from './configs/smplx_to_kuavo.json';
import smplx_to_hi from './configs/smplx_to_hi.json';
import smplx_to_bhl from './configs/smplx_to_bhl.json';
import smplx_to_k1 from './configs/smplx_to_k1.json';
import smplx_to_adam from './configs/smplx_to_adam.json';
import smplx_to_tienkung from './configs/smplx_to_tienkung.json';
import smplx_to_gr3 from './configs/smplx_to_gr3.json';
import type { GmrIkConfig, IkMatchEntry } from './types';

export const DEFAULT_CONFIGS: Record<string, GmrIkConfig> = {
  booster_t1_29dof: bvh_lafan1_to_booster_t1_29dof as unknown as GmrIkConfig,
  engineai_pm01: bvh_lafan1_to_pm01 as unknown as GmrIkConfig,
  fourier_n1: bvh_lafan1_to_n1 as unknown as GmrIkConfig,
  pal_talos: bvh_to_talos as unknown as GmrIkConfig,
  stanford_toddy: bvh_lafan1_to_toddy as unknown as GmrIkConfig,
  unitree_g1: bvh_lafan1_to_unitree_g1 as unknown as GmrIkConfig,
  unitree_g1_with_hands: bvh_lafan1_to_unitree_g1 as unknown as GmrIkConfig,
  // Quadrupeds (BVH dog mocap → robot; keypoint IK on root + 4 feet).
  unitree_go2: bvh_quadruped_to_unitree_go2 as unknown as GmrIkConfig,
  unitree_a1: bvh_quadruped_to_unitree_a1 as unknown as GmrIkConfig,
  // SMPL-X / AMASS robots (surface when the loaded motion is SMPL-X).
  unitree_h1: smplx_to_h1 as unknown as GmrIkConfig,
  unitree_h1_2: smplx_to_h1_2 as unknown as GmrIkConfig,
  booster_t1: smplx_to_t1 as unknown as GmrIkConfig,
  kuavo_s45: smplx_to_kuavo as unknown as GmrIkConfig,
  hightorque_hi: smplx_to_hi as unknown as GmrIkConfig,
  berkeley_humanoid_lite: smplx_to_bhl as unknown as GmrIkConfig,
  booster_k1: smplx_to_k1 as unknown as GmrIkConfig,
  pnd_adam_lite: smplx_to_adam as unknown as GmrIkConfig,
  tienkung: smplx_to_tienkung as unknown as GmrIkConfig,
  fourier_gr3: smplx_to_gr3 as unknown as GmrIkConfig,
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

/** Dog-mocap foot joints, in the order of the leg patterns below (see the Go2 preset). */
const QUADRUPED_LEGS: [human: string, leg: RegExp][] = [
  ['b_LeftHand', /(?:^|[_-])(fl|lf)(?:[_-]|$)|front_?left|left_?front/i],
  ['b_RightHand', /(?:^|[_-])(fr|rf)(?:[_-]|$)|front_?right|right_?front/i],
  ['b_LeftToe', /(?:^|[_-])(rl|lh|hl|bl)(?:[_-]|$)|(rear|hind|back)_?left|left_?(rear|hind|back)/i],
  ['b_RightToe', /(?:^|[_-])(rr|rh|hr|br)(?:[_-]|$)|(rear|hind|back)_?right|right_?(rear|hind|back)/i],
];

/**
 * ik_config template for an imported quadruped: the Go2 preset (root + four
 * feet keypoint IK) re-keyed onto this robot's root and the foot bodies found
 * by name — `FL_foot` / `LF_FOOT` / `toe_fl` / `foot_front_left`, else the last body of that
 * leg in tree order (the most distal one). The root rotation offset carries
 * over unchanged: it maps the dog skeleton's hips onto any x-forward, z-up base.
 */
export function createBlankQuadrupedConfig(baseBody: string, bodyNames: string[]): GmrIkConfig {
  const template = getDefaultConfig('unitree_go2');
  const rootEntry = (table: Record<string, IkMatchEntry>) => table[template.robot_root_name];
  const footEntry = Object.values(template.ik_match_table2).find((e) => e[0] !== template.human_root_name)!;
  const bodies = bodyNames.filter((n) => n !== 'world' && n !== baseBody);

  const ik_match_table1: Record<string, IkMatchEntry> = {
    [baseBody]: rootEntry(template.ik_match_table1),
  };
  const ik_match_table2: Record<string, IkMatchEntry> = {
    [baseBody]: rootEntry(template.ik_match_table2),
  };
  for (const [human, leg] of QUADRUPED_LEGS) {
    const legBodies = bodies.filter((n) => leg.test(n));
    const foot = legBodies.find((n) => /foot|toe|tip/i.test(n)) ?? legBodies[legBodies.length - 1];
    if (foot) {
      // A copy per foot: the mapping table edits offsets in place.
      const entry = structuredClone(footEntry);
      entry[0] = human;
      ik_match_table2[foot] = entry;
    }
  }
  return { ...template, robot_root_name: baseBody, ik_match_table1, ik_match_table2 };
}

/**
 * A bundled GMR preset that fits an imported robot: one for the same motion
 * family (`human_root`: `Hips` for LAFAN1 BVH, `b_Hips` for dog mocap) whose
 * robot bodies all exist on it — e.g. the Unitree G1 / Go2 / A1 presets for the
 * gallery's G1 / Go2 / A1 URDFs. `preferred` robot ids are tried first.
 */
export function matchPresetConfig(
  humanRoot: string,
  bodyNames: string[],
  preferred: string[] = [],
): GmrIkConfig | null {
  const have = new Set(bodyNames);
  const ids = [...new Set([...preferred, ...Object.keys(DEFAULT_CONFIGS)])];
  for (const id of ids) {
    const cfg = DEFAULT_CONFIGS[id];
    if (!cfg || cfg.human_root_name !== humanRoot) continue;
    const needed = [cfg.robot_root_name, ...Object.keys(cfg.ik_match_table1), ...Object.keys(cfg.ik_match_table2)];
    if (needed.every((b) => have.has(b))) return structuredClone(cfg);
  }
  return null;
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
