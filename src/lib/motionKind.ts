import type { BvhAnim } from './bvh/parse';

/** Humanoid (LAFAN1 / BlazePose) vs quadruped (dog mocap) motion families. */
export type MotionKind = 'humanoid' | 'quadruped';

export function isQuadrupedConfigKey(configKey: string): boolean {
  return configKey === 'bvh_quadruped';
}

export function detectMotionKind(anim: BvhAnim, fileName?: string | null): MotionKind {
  if (fileName && /^dog_/i.test(fileName)) return 'quadruped';
  const names = new Set(anim.joints.map((j) => j.name));
  if (names.has('b_Hips')) return 'quadruped';
  if (names.has('Hips')) return 'humanoid';
  return 'humanoid';
}

export function motionMatchesRobot(kind: MotionKind, configKey: string): boolean {
  return isQuadrupedConfigKey(configKey) === (kind === 'quadruped');
}

export function defaultRobotIdForKind(kind: MotionKind): string {
  return kind === 'quadruped' ? 'unitree_go2' : 'unitree_g1';
}

/** Whether a sample / menu entry should be greyed out for the active motion. */
export function isMotionKindDisabled(active: MotionKind | null, itemKind: MotionKind): boolean {
  return active !== null && active !== itemKind;
}
