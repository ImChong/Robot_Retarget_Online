import type { BvhAnim } from './bvh/parse';

/**
 * Motion source families. `humanoid` = LAFAN1 BVH / BlazePose; `quadruped` = dog
 * mocap; `smplx` = SMPL-X / AMASS (keyed by SMPL-X joint names). The retarget
 * configs are convention-specific, so a robot only matches its own family.
 */
export type MotionKind = 'humanoid' | 'quadruped' | 'smplx';

export function isQuadrupedConfigKey(configKey: string): boolean {
  return configKey === 'bvh_quadruped';
}

export function isSmplxConfigKey(configKey: string): boolean {
  return configKey === 'smplx';
}

/**
 * Classify a *BVH* motion. SMPL-X is not detected here — it never arrives as a
 * dropped `.bvh`; the SMPL-X loader (`useMotionStore().loadSmplx`) sets the
 * `smplx` kind explicitly after converting the uploaded `.npz` files.
 */
export function detectMotionKind(anim: BvhAnim, fileName?: string | null): MotionKind {
  if (fileName && /^dog_/i.test(fileName)) return 'quadruped';
  const names = new Set(anim.joints.map((j) => j.name));
  if (names.has('b_Hips')) return 'quadruped';
  if (names.has('Hips')) return 'humanoid';
  return 'humanoid';
}

export function motionMatchesRobot(kind: MotionKind, configKey: string): boolean {
  if (isQuadrupedConfigKey(configKey)) return kind === 'quadruped';
  if (isSmplxConfigKey(configKey)) return kind === 'smplx';
  return kind === 'humanoid'; // bvh_lafan1 / bvh
}

export function defaultRobotIdForKind(kind: MotionKind): string {
  if (kind === 'quadruped') return 'unitree_go2';
  if (kind === 'smplx') return 'unitree_h1';
  return 'unitree_g1';
}

/** Whether a sample / menu entry should be greyed out for the active motion. */
export function isMotionKindDisabled(active: MotionKind | null, itemKind: MotionKind): boolean {
  return active !== null && active !== itemKind;
}
