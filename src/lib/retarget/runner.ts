/**
 * Chunked batch retargeting on the main thread: processes frames in slices and
 * yields to the event loop so the UI stays responsive.
 */

import type { HumanFrame } from '../bvh/lafan1';
import { extremeZ } from '../mujoco/geometry';
import type { RobotModel } from '../mujoco/runtime';
import { GmrRetargetEngine } from './engine';
import { OmniRetargetEngine } from './omniEngine';
import { QUADRUPED_REGULARIZATION, planQuadrupedTargets, restKeyframe } from './quadruped';
import type {
  GmrIkConfig,
  RetargetEngine,
  RetargetEngineId,
  RetargetResult,
  SolverOptions,
} from './types';

const SLICE_MS = 28; // yield to UI roughly every two display frames

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Instantiate the requested retargeting engine (both share config + solver). */
export function createEngine(
  engineId: RetargetEngineId,
  robot: RobotModel,
  config: GmrIkConfig,
  solver: SolverOptions,
): RetargetEngine {
  return engineId === 'omniretarget'
    ? new OmniRetargetEngine(robot, config, solver)
    : new GmrRetargetEngine(robot, config, solver);
}

/**
 * Swap a dog-mocap clip's per-frame keypoint targets for the contact-aware plan
 * and start the solve from the robot's rest crouch. No-op for other motions.
 */
export function preparePlannedQuadruped(
  engine: GmrRetargetEngine,
  robot: RobotModel,
  config: GmrIkConfig,
  frames: HumanFrame[],
  fps: number,
): boolean {
  const scale = engine.scaleTable.get(config.human_root_name) ?? 1;
  const plan = planQuadrupedTargets({ frames, fps, robot, config, scale });
  if (!plan) return false;
  engine.usePlannedTargets(plan.targets);
  // Start from the rest crouch when the model has one (keeps every knee on its
  // natural side), with the base already at the first planned trunk pose.
  const rest = restKeyframe(robot);
  const qpos = robot.data.qpos as Float64Array;
  if (rest) qpos.set(rest);
  const root = plan.targets[0].get(config.human_root_name);
  const free = (robot.model.jnt_type as Int32Array)[0] === 0; // qpos[0..7] is the free joint
  if (root && free) {
    qpos.set(root.pos, 0);
    qpos.set(root.quat, 3);
  }
  robot.mujoco.mj_kinematics(robot.model, robot.data);
  engine.setRegularization(QUADRUPED_REGULARIZATION.posture, QUADRUPED_REGULARIZATION.smooth, rest);
  return true;
}

/**
 * Length unit for the solve: 1 m for anything up to 2 m tall (every bundled
 * robot — GMR's own behaviour), the robot's height / 2 above that (an 18 m
 * Gundam), where metric LM damping would stall the solver.
 */
export function autoLengthScale(robot: RobotModel): number {
  const { mujoco, model, data } = robot;
  const qpos = data.qpos as Float64Array;
  const saved = new Float64Array(qpos);
  qpos.set(model.qpos0 as Float64Array);
  mujoco.mj_kinematics(model, data);
  const height = extremeZ(robot, -1) - extremeZ(robot, 1);
  qpos.set(saved);
  mujoco.mj_kinematics(model, data);
  return Math.max(1, height / 2);
}

/**
 * Raise the free joint wherever the robot's lowest geometry is below z = 0:
 * the per-frame depth, widened by a ±3-frame running max and eased with a
 * Gaussian (σ = 2 frames) so the base never jumps. Frames clear of the floor
 * get no lift. Leaves the robot at its last frame.
 */
export function liftAboveGround(robot: RobotModel, qpos: Float64Array, frames: number) {
  const { mujoco, model, data } = robot;
  const nq = robot.nq;
  const q = data.qpos as Float64Array;
  const depth = new Float64Array(frames);
  let any = false;
  for (let f = 0; f < frames; f++) {
    q.set(qpos.subarray(f * nq, (f + 1) * nq));
    mujoco.mj_kinematics(model, data);
    depth[f] = Math.max(0, -extremeZ(robot, 1));
    if (depth[f] > 1e-4) any = true;
  }
  if (!any) return;
  const widened = depth.map((_, f) => {
    let m = 0;
    for (let k = Math.max(0, f - 3); k <= Math.min(frames - 1, f + 3); k++) m = Math.max(m, depth[k]);
    return m;
  });
  const sigma = 2;
  const radius = 3 * sigma;
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const i = f + k;
      if (i < 0 || i >= frames) continue;
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      acc += w * widened[i];
      wsum += w;
    }
    qpos[f * nq + 2] += Math.max(depth[f], acc / wsum);
  }
}

export interface RunOptions {
  robot: RobotModel;
  config: GmrIkConfig;
  solver: SolverOptions;
  frames: HumanFrame[];
  fps: number;
  engine?: RetargetEngineId;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export async function runRetarget(options: RunOptions): Promise<RetargetResult> {
  const { robot, config, solver, frames, fps, onProgress, signal } = options;
  const engineId: RetargetEngineId = options.engine ?? 'gmr';
  const engine = createEngine(engineId, robot, config, solver);
  try {
    const planned =
      solver.quadrupedPlanner && engine instanceof GmrRetargetEngine
        ? preparePlannedQuadruped(engine, robot, config, frames, fps)
        : false;
    if (engine instanceof GmrRetargetEngine) engine.setLengthScale(autoLengthScale(robot));
    if (!planned && solver.seedRoot && frames.length && engine instanceof GmrRetargetEngine) {
      engine.seedRoot(frames[0]);
    }
    const T = frames.length;
    const nq = robot.nq;
    const qpos = new Float64Array(T * nq);
    const taskNames = engine.tasks2.map((t) => t.robotBody);
    const taskHumanBodies = engine.tasks2.map((t) => t.humanBody);
    const posErrors = new Float32Array(T * taskNames.length);

    const humanBodyNames = engine.requiredHumanBodies();
    const K = humanBodyNames.length;
    const scaledHuman = new Float32Array(T * K * 3);

    const start = performance.now();
    let sliceStart = start;

    for (let f = 0; f < T; f++) {
      if (signal?.aborted) throw new DOMException('Retargeting cancelled', 'AbortError');

      const q = engine.retargetFrame(frames[f]);
      qpos.set(q, f * nq);

      const errs = engine.taskPositionErrors();
      posErrors.set(errs, f * taskNames.length);

      for (let k = 0; k < K; k++) {
        const body = engine.lastScaledHuman.get(humanBodyNames[k]);
        if (body) scaledHuman.set(body.pos, (f * K + k) * 3);
      }

      const now = performance.now();
      if (now - sliceStart > SLICE_MS) {
        onProgress?.(f + 1, T);
        await nextTick();
        sliceStart = performance.now();
      }
    }
    onProgress?.(T, T);
    if (!planned && solver.liftAboveGround && T > 0 && (robot.model.jnt_type as Int32Array)[0] === 0) {
      liftAboveGround(robot, qpos, T);
    }

    return {
      robotId: robot.id,
      engine: engineId,
      fps,
      frameCount: T,
      nq,
      qpos,
      dofNames: robot.dofJointNames,
      taskNames,
      taskHumanBodies,
      posErrors,
      scaledHuman,
      humanBodyNames,
      elapsedMs: performance.now() - start,
    };
  } finally {
    engine.dispose();
  }
}
