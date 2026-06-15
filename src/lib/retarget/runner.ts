/**
 * Chunked batch retargeting on the main thread: processes frames in slices and
 * yields to the event loop so the UI stays responsive.
 */

import type { HumanFrame } from '../bvh/lafan1';
import type { RobotModel } from '../mujoco/runtime';
import { GmrRetargetEngine } from './engine';
import { OmniRetargetEngine } from './omniEngine';
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
