import type { RobotModel } from '../mujoco/runtime';
import type { JointLimitInfo } from './types';

const MJ_JNT_FREE = 0;
const MJ_JNT_SLIDE = 2;
const MJ_JNT_HINGE = 3;

/**
 * Extract per-DoF joint limits aligned with `RetargetResult.dofNames` / `qpos[7..]`.
 * Models without a free joint or with extra non-1-DoF joints are handled safely by
 * mapping through `jnt_qposadr`.
 */
export function extractJointLimits(robot: RobotModel): JointLimitInfo[] {
  const { model, jointNames, dofJointNames } = robot;
  const jntType = model.jnt_type as Int32Array;
  const jntLimited = model.jnt_limited as Uint8Array;
  const jntQposadr = model.jnt_qposadr as Int32Array;
  const jntRange = model.jnt_range as Float64Array;

  const freeOffset = model.njnt > 0 && jntType[0] === MJ_JNT_FREE ? 7 : 0;
  const limits: JointLimitInfo[] = [];

  for (let j = 0; j < model.njnt; j++) {
    const type = jntType[j];
    if (type !== MJ_JNT_HINGE && type !== MJ_JNT_SLIDE) continue;
    const dofIndex = jntQposadr[j] - freeOffset;
    if (dofIndex < 0) continue;
    const limited = Boolean(jntLimited[j]);
    const min = jntRange[j * 2];
    const max = jntRange[j * 2 + 1];
    limits.push({
      dofIndex,
      name: dofJointNames[dofIndex] ?? jointNames[j] ?? `dof_${dofIndex}`,
      type: type === MJ_JNT_SLIDE ? 'slide' : 'hinge',
      limited: limited && Number.isFinite(min) && Number.isFinite(max) && max >= min,
      min,
      max,
    });
  }

  return limits;
}
