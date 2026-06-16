/**
 * Integration: SMPL-X core → existing retargeting engine → the real bundled
 * SMPL-X robots.
 *
 * Proves the SMPL-X / AMASS input track end-to-end without UI and without any
 * license-restricted asset: a *synthetic* 22-joint SMPL-X model produces human
 * frames that the bundled `smplx_to_*` configs retarget onto the real MJCF
 * models (meshes loaded from public/robots). Loads every robot whose manifest
 * `configKey` is `smplx`, so registering a new SMPL-X robot is covered here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getRobotManifest, loadRobot, unloadRobot } from '../src/lib/mujoco/runtime';
import { runRetarget } from '../src/lib/retarget/runner';
import { getDefaultConfig } from '../src/lib/retarget/defaults';
import { DEFAULT_SOLVER_OPTIONS, type GmrIkConfig } from '../src/lib/retarget/types';
import { smplxToHumanFrames } from '../src/lib/smplx/fk';
import { SMPLX_BODY_PARENTS, type SmplxBodyModel } from '../src/lib/smplx/model';
import type { HumanFrame } from '../src/lib/bvh/lafan1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROBOTS_DIR = join(ROOT, 'public', 'robots');

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const rel = String(input).replace(/^.*\/robots\//, '');
      return new Response(readFileSync(join(ROBOTS_DIR, rel)));
    }),
  );
});

/**
 * A synthetic 22-joint SMPL-X model: identity J_regressor (one vertex per
 * joint) at a plausible standing stick-figure rest pose (Y-up, meters), zero
 * shapedirs. Enough to exercise every keypoint the SMPL-X configs reference.
 */
function syntheticSmplxModel(): SmplxBodyModel {
  const rest: [number, number, number][] = [
    [0, 0, 0],          // 0 pelvis
    [0.09, -0.06, 0],   // 1 left_hip
    [-0.09, -0.06, 0],  // 2 right_hip
    [0, 0.12, 0],       // 3 spine1
    [0.09, -0.45, 0],   // 4 left_knee
    [-0.09, -0.45, 0],  // 5 right_knee
    [0, 0.25, 0],       // 6 spine2
    [0.09, -0.85, 0],   // 7 left_ankle
    [-0.09, -0.85, 0],  // 8 right_ankle
    [0, 0.38, 0],       // 9 spine3
    [0.09, -0.90, 0.12],// 10 left_foot
    [-0.09, -0.90, 0.12],// 11 right_foot
    [0, 0.50, 0],       // 12 neck
    [0.06, 0.42, 0],    // 13 left_collar
    [-0.06, 0.42, 0],   // 14 right_collar
    [0, 0.62, 0],       // 15 head
    [0.17, 0.45, 0],    // 16 left_shoulder
    [-0.17, 0.45, 0],   // 17 right_shoulder
    [0.42, 0.45, 0],    // 18 left_elbow
    [-0.42, 0.45, 0],   // 19 right_elbow
    [0.65, 0.45, 0],    // 20 left_wrist
    [-0.65, 0.45, 0],   // 21 right_wrist
  ];
  const n = rest.length;
  const vTemplate = new Float64Array(n * 3);
  rest.forEach((p, j) => { vTemplate[j * 3] = p[0]; vTemplate[j * 3 + 1] = p[1]; vTemplate[j * 3 + 2] = p[2]; });
  const jRegressor = new Float64Array(n * n);
  for (let j = 0; j < n; j++) jRegressor[j * n + j] = 1;
  return {
    numVerts: n, numJoints: n, numShape: 1,
    vTemplate, shapeDirs: new Float64Array(n * 3 * 1),
    jRegressor, parents: Int32Array.from(SMPLX_BODY_PARENTS),
  };
}

function syntheticHumanFrames(): HumanFrame[] {
  const zeros = () => new Float64Array(63);
  const motion = {
    betas: new Float64Array(16),
    fps: 30,
    frames: [
      { rootOrient: [0, 0, 0] as [number, number, number], bodyPose: zeros(), trans: [0, 0.9, 0] as [number, number, number] },
      { rootOrient: [0, 0, 0] as [number, number, number], bodyPose: zeros(), trans: [0.1, 0.9, 0] as [number, number, number] },
    ],
  };
  return smplxToHumanFrames(syntheticSmplxModel(), motion).frames;
}

describe('smplx → engine → real Unitree H1 (detailed)', () => {
  it('retargets synthetic SMPL-X frames onto H1 via the bundled config', async () => {
    const frames = syntheticHumanFrames();
    expect(frames[0].has('left_foot')).toBe(true);
    expect(frames[0].has('spine3')).toBe(true);

    const robot = await loadRobot('unitree_h1');
    expect(robot.bodyNames).toContain('left_ankle_link');

    const result = await runRetarget({
      robot,
      config: getDefaultConfig('unitree_h1') as unknown as GmrIkConfig,
      solver: { ...DEFAULT_SOLVER_OPTIONS },
      frames,
      fps: 30,
      engine: 'gmr',
    });

    expect(result.taskHumanBodies).toContain('left_foot');
    expect(result.taskHumanBodies).toContain('spine3');
    expect(result.frameCount).toBe(2);
    expect(result.qpos.length).toBe(2 * robot.nq);
    expect(result.qpos.every((v) => Number.isFinite(v))).toBe(true);
    const q0 = result.qpos.subarray(3, 7);
    expect(Math.abs(Math.hypot(q0[0], q0[1], q0[2], q0[3]) - 1)).toBeLessThan(1e-3);
    unloadRobot('unitree_h1');
  }, 120_000);
});

describe('smplx → engine → every registered SMPL-X robot', () => {
  it('loads each smplx-configKey robot and produces finite qpos', async () => {
    const frames = syntheticHumanFrames();
    const manifest = await getRobotManifest();
    const smplxRobots = manifest.filter((m) => m.configKey === 'smplx').map((m) => m.id);
    expect(smplxRobots.length).toBeGreaterThanOrEqual(10);

    for (const id of smplxRobots) {
      const robot = await loadRobot(id);
      const result = await runRetarget({
        robot,
        config: getDefaultConfig(id) as unknown as GmrIkConfig,
        solver: { ...DEFAULT_SOLVER_OPTIONS },
        frames,
        fps: 30,
        engine: 'gmr',
      });
      expect(result.qpos.length, id).toBe(2 * robot.nq);
      expect(result.qpos.every((v) => Number.isFinite(v)), id).toBe(true);
      unloadRobot(id); // bound WASM memory across the loop
    }
  }, 300_000);
});
