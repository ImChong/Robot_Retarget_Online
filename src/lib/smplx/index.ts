/**
 * SMPL-X / AMASS input track (ROADMAP "Input formats: SMPL-X / AMASS").
 *
 * Turns user-supplied SMPL-X model `.npz` + AMASS motion `.npz` into GMR
 * `HumanFrame`s (Z-up, meters) keyed by SMPL-X joint names, reusing the bundled
 * `smplx_to_<robot>.json` ik_configs and the existing retargeting engine.
 * Pure-frontend: the body model and motion never leave the browser.
 */

export { parseNpy, parseNpz, asNumbers, type NpyArray, type NpyData } from './npy';
export {
  parseSmplxModel,
  parseAmassMotion,
  SMPLX_BODY_JOINT_NAMES,
  SMPLX_BODY_PARENTS,
  SMPLX_NUM_BODY_JOINTS,
  type SmplxBodyModel,
  type SmplxMotion,
  type SmplxFrameParams,
} from './model';
export {
  axisAngleToQuat,
  restJoints,
  forwardKinematics,
  smplxToHumanFrames,
  type SmplxHumanMotion,
  type PosedJoints,
} from './fk';

import { parseSmplxModel, parseAmassMotion } from './model';
import { smplxToHumanFrames, type SmplxHumanMotion } from './fk';

/**
 * One-shot: parse a SMPL-X model `.npz` + AMASS motion `.npz` and produce GMR
 * human frames. Both buffers stay in memory; nothing is persisted or uploaded.
 */
export function loadSmplxMotion(modelNpz: Uint8Array, motionNpz: Uint8Array): SmplxHumanMotion {
  const model = parseSmplxModel(modelNpz);
  const motion = parseAmassMotion(motionNpz);
  return smplxToHumanFrames(model, motion);
}
