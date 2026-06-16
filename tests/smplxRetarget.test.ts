/**
 * Integration: SMPL-X core → existing retargeting engine → a real bundled robot.
 *
 * Proves the SMPL-X / AMASS input track end-to-end without UI and without any
 * license-restricted asset: a *synthetic* 22-joint SMPL-X model produces human
 * frames that the bundled `smplx_to_h1.json` config retargets onto the real
 * Unitree H1 MJCF (meshes loaded from public/robots). The shipped manifest.json
 * is left untouched — an H1 entry is injected through the fetch stub — so this
 * has no effect on the production robot dropdown.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadRobot, type RobotManifestEntry } from '../src/lib/mujoco/runtime';
import { runRetarget } from '../src/lib/retarget/runner';
import { DEFAULT_SOLVER_OPTIONS, type GmrIkConfig } from '../src/lib/retarget/types';
import { smplxToHumanFrames } from '../src/lib/smplx/fk';
import { SMPLX_BODY_PARENTS, type SmplxBodyModel } from '../src/lib/smplx/model';
import smplxH1 from '../src/lib/retarget/configs/smplx_to_h1.json';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROBOTS_DIR = join(ROOT, 'public', 'robots');

function listFilesRel(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out;
}

// Inject an H1 manifest entry pointing at the real bundled files.
const H1_ENTRY: RobotManifestEntry = {
  id: 'unitree_h1',
  label: 'Unitree H1',
  xml: 'h1.xml',
  baseBody: 'pelvis',
  camDistance: 3.0,
  configKey: 'smplx',
  files: listFilesRel(join(ROBOTS_DIR, 'unitree_h1')),
} as RobotManifestEntry;

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const rel = String(input).replace(/^.*\/robots\//, '');
      if (rel === 'manifest.json') {
        const real = JSON.parse(readFileSync(join(ROBOTS_DIR, 'manifest.json'), 'utf8'));
        return new Response(JSON.stringify([...real, H1_ENTRY]));
      }
      return new Response(readFileSync(join(ROBOTS_DIR, rel)));
    }),
  );
});

/**
 * A synthetic 22-joint SMPL-X model: identity J_regressor (one vertex per
 * joint) at a plausible standing stick-figure rest pose (Y-up, meters), zero
 * shapedirs. Enough to exercise every keypoint the H1 config references.
 */
function syntheticSmplxModel(): SmplxBodyModel {
  // Rest joint positions, SMPL-X order 0..21, Y-up (head +Y, feet -Y).
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
  const jRegressor = new Float64Array(n * n); // identity
  for (let j = 0; j < n; j++) jRegressor[j * n + j] = 1;
  return {
    numVerts: n,
    numJoints: n,
    numShape: 1,
    vTemplate,
    shapeDirs: new Float64Array(n * 3 * 1), // zero: betas irrelevant
    jRegressor,
    parents: Int32Array.from(SMPLX_BODY_PARENTS),
  };
}

describe('smplx → engine → real robot (Unitree H1)', () => {
  it('retargets synthetic SMPL-X frames onto H1 via the bundled config', async () => {
    const model = syntheticSmplxModel();
    // Two frames: T-pose, then a small global translation (stand → shift).
    const zeros = () => new Float64Array(63);
    const motion = {
      betas: new Float64Array(16),
      fps: 30,
      frames: [
        { rootOrient: [0, 0, 0] as [number, number, number], bodyPose: zeros(), trans: [0, 0.9, 0] as [number, number, number] },
        { rootOrient: [0, 0, 0] as [number, number, number], bodyPose: zeros(), trans: [0.1, 0.9, 0] as [number, number, number] },
      ],
    };
    const human = smplxToHumanFrames(model, motion);
    expect(human.frames[0].has('left_foot')).toBe(true);
    expect(human.frames[0].has('spine3')).toBe(true);

    const robot = await loadRobot('unitree_h1');
    expect(robot.bodyNames).toContain('left_ankle_link');

    const result = await runRetarget({
      robot,
      config: smplxH1 as unknown as GmrIkConfig,
      solver: { ...DEFAULT_SOLVER_OPTIONS },
      frames: human.frames,
      fps: human.fps,
      engine: 'gmr',
    });

    // The config's SMPL-X human bodies all matched (no silently-dropped tasks).
    expect(result.taskHumanBodies).toContain('left_foot');
    expect(result.taskHumanBodies).toContain('spine3');
    expect(result.frameCount).toBe(2);
    expect(result.qpos.length).toBe(2 * robot.nq);
    // Output is finite and the floating-base quaternion stays normalized.
    expect(result.qpos.every((v) => Number.isFinite(v))).toBe(true);
    expect(result.posErrors.every((v) => Number.isFinite(v))).toBe(true);
    const q0 = result.qpos.subarray(3, 7);
    const qn = Math.hypot(q0[0], q0[1], q0[2], q0[3]);
    expect(Math.abs(qn - 1)).toBeLessThan(1e-3);
  }, 120_000);
});
