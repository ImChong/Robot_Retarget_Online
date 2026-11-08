/**
 * Starting ik_config for an imported robot (URDF / MJCF upload or a robot
 * picked from Robot Description Gallery Online):
 *   1. a bundled GMR preset when every body it names exists on the robot (the
 *      gallery's G1 / Go2 / A1 match the built-in ones);
 *   2. else a structural template read off the kinematic tree
 *      (`autoConfig.ts`: legs / arms, rotation offsets carried over from G1);
 *   3. else the name-heuristic template of its motion family.
 *
 * Shared by the retarget store and the gallery compatibility matrix
 * (`src/lib/gallery/compat.ts`), so the matrix tests exactly what the UI does.
 */

import { BUILTIN_GALLERY_LINKS } from '../gallery/registry';
import type { CustomRobotBundle } from '../mujoco/customRobot';
import type { RobotModel } from '../mujoco/runtime';
import {
  QUADRUPED_PRESET_LEG_LENGTH,
  createStructuralHumanoidConfig,
  fitQuadrupedScale,
  wheelCentreFeet,
} from './autoConfig';
import { createBlankConfig, createBlankQuadrupedConfig, getDefaultConfig, matchPresetId } from './defaults';
import type { GmrIkConfig } from './types';

/** How far a robot's own pelvis-height scale may sit from a name-matched preset's. */
export const PRESET_SCALE_TOLERANCE = 0.12;

export interface CustomConfigChoice {
  config: GmrIkConfig;
  /** `preset:<robot id>` for a bundled GMR config, `structural`, or `template`. */
  source: string;
}

export function chooseCustomConfig(robot: RobotModel, bundle: CustomRobotBundle): CustomConfigChoice {
  const quadruped = (bundle.kind ?? 'humanoid') === 'quadruped';
  const gallery = bundle.gallery;
  const preferred = gallery
    ? Object.entries(BUILTIN_GALLERY_LINKS)
        .filter(([, link]) => link.id === gallery.id && (!link.variant || link.variant === gallery.variant))
        .map(([robotId]) => robotId)
    : [];
  const preset = matchPresetId(quadruped ? 'b_Hips' : 'Hips', robot.bodyNames, preferred);
  if (quadruped) {
    // Dog-mocap configs are made for a Go2 / A1-sized robot: rescale to this
    // one's legs (Unitree B2 / Aliengo match the Go2 preset by name alone).
    const id = preset ?? 'unitree_go2';
    const base = wheelCentreFeet(
      robot,
      preset ? getDefaultConfig(preset) : createBlankQuadrupedConfig(bundle.baseBody, robot.bodyNames),
    );
    const config = fitQuadrupedScale(robot, base, QUADRUPED_PRESET_LEG_LENGTH[id] ?? QUADRUPED_PRESET_LEG_LENGTH.unitree_go2);
    const scaled = config !== base ? ' (rescaled)' : '';
    return { config, source: preset ? `preset:${preset}${scaled}` : `template${scaled}` };
  }
  const structural = createStructuralHumanoidConfig(robot, bundle.baseBody);
  if (preset) {
    // Body names alone can match a preset of a different robot of the same
    // maker (Unitree H1-2 / H2 use G1's names at 1.4× its size): keep the
    // preset only if its scale fits this robot's proportions.
    const config = getDefaultConfig(preset);
    const presetHips = (config.human_scale_table[config.human_root_name] ?? 1) / config.human_height_assumption;
    const ownHips = structural ? structural.human_scale_table.Hips / structural.human_height_assumption : presetHips;
    if (Math.abs(ownHips / presetHips - 1) <= PRESET_SCALE_TOLERANCE) return { config, source: `preset:${preset}` };
  }
  if (structural) return { config: structural, source: 'structural' };
  return { config: createBlankConfig(bundle.baseBody, robot.bodyNames), source: 'template' };
}

export function initialCustomConfig(robot: RobotModel, bundle: CustomRobotBundle): GmrIkConfig {
  return chooseCustomConfig(robot, bundle).config;
}
