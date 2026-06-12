/**
 * LAFAN1-format conversion: BVH (Y-up, cm) -> GMR human frames (Z-up, meters).
 *
 * Mirrors GMR general_motion_retargeting/utils/lafan1.py:
 *  - global transforms via FK
 *  - rotate by M = [[1,0,0],[0,0,-1],[0,1,0]] (Y-up -> Z-up), divide positions by 100
 *  - add virtual joints LeftFootMod/RightFootMod (foot position + toe orientation)
 *  - actual human height fixed at 1.75 m (GMR convention)
 */

import { quatFromMat3, quatMul, type Quat, type Vec3 } from '../math3d';
import { bvhFk, type BvhAnim } from './parse';

export interface HumanFrameBody {
  pos: Vec3;
  quat: Quat; // wxyz
}

export type HumanFrame = Map<string, HumanFrameBody>;

export const GMR_HUMAN_HEIGHT = 1.75;

const CONV_MAT = [
  [1, 0, 0],
  [0, 0, -1],
  [0, 1, 0],
];
const CONV_QUAT = quatFromMat3(CONV_MAT); // +90° about X

/** Required LAFAN1 joints for the FootMod augmentation. */
const FOOT_JOINTS = ['LeftFoot', 'LeftToe', 'RightFoot', 'RightToe'];

export interface Lafan1Motion {
  frames: HumanFrame[];
  fps: number;
  humanHeight: number;
  jointNames: string[];
  /** Joints referenced by configs but missing from the BVH. */
  missingFootJoints: string[];
}

export function bvhToLafan1Frames(anim: BvhAnim, unitScale = 0.01): Lafan1Motion {
  const { globalPos, globalQuat } = bvhFk(anim);
  const J = anim.joints.length;
  const names = anim.joints.map((j) => j.name);
  const frames: HumanFrame[] = [];

  for (let f = 0; f < anim.frameCount; f++) {
    const frame: HumanFrame = new Map();
    for (let j = 0; j < J; j++) {
      const gp: Vec3 = [
        globalPos[(f * J + j) * 3],
        globalPos[(f * J + j) * 3 + 1],
        globalPos[(f * J + j) * 3 + 2],
      ];
      const gq: Quat = [
        globalQuat[(f * J + j) * 4],
        globalQuat[(f * J + j) * 4 + 1],
        globalQuat[(f * J + j) * 4 + 2],
        globalQuat[(f * J + j) * 4 + 3],
      ];
      // position = (M @ p) * unitScale ; orientation = q_conv ⊗ q
      const pos: Vec3 = [gp[0] * unitScale, -gp[2] * unitScale, gp[1] * unitScale];
      const quat = quatMul(CONV_QUAT, gq);
      frame.set(names[j], { pos, quat });
    }

    // Virtual foot joints: foot position + toe orientation.
    const lf = frame.get('LeftFoot');
    const lt = frame.get('LeftToe');
    const rf = frame.get('RightFoot');
    const rt = frame.get('RightToe');
    if (lf && lt) frame.set('LeftFootMod', { pos: lf.pos, quat: lt.quat });
    if (rf && rt) frame.set('RightFootMod', { pos: rf.pos, quat: rt.quat });

    frames.push(frame);
  }

  const present = new Set(names);
  const missingFootJoints = FOOT_JOINTS.filter((n) => !present.has(n));

  return {
    frames,
    fps: anim.frameTime > 0 ? 1 / anim.frameTime : 30,
    humanHeight: GMR_HUMAN_HEIGHT,
    jointNames: names,
    missingFootJoints,
  };
}

/** Names of human bodies a config needs that are absent from the motion. */
export function findMissingBodies(
  frames: HumanFrame[],
  requiredBodies: string[],
): string[] {
  if (frames.length === 0) return requiredBodies;
  const first = frames[0];
  return requiredBodies.filter((b) => !first.has(b));
}
