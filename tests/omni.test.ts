/**
 * OmniRetarget engine integration test (runs the real mujoco-js WASM in Node).
 *
 *  - meshWeight = 0 must reproduce the GMR engine bit-for-bit (strict superset).
 *  - meshWeight > 0 must stay finite + in joint range and measurably reduce the
 *    interaction-mesh (Laplacian) distortion vs. GMR on a real sample motion.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getMujoco, type RobotModel } from '../src/lib/mujoco/runtime';
import { parseBvh } from '../src/lib/bvh/parse';
import { bvhToLafan1Frames, type HumanFrame } from '../src/lib/bvh/lafan1';
import { GmrRetargetEngine, type IkTask } from '../src/lib/retarget/engine';
import {
  OmniRetargetEngine,
  knnLaplacianWeights,
  meanLaplacianResidual,
} from '../src/lib/retarget/omniEngine';
import { getDefaultConfig } from '../src/lib/retarget/defaults';
import { DEFAULT_SOLVER_OPTIONS } from '../src/lib/retarget/types';
import type { Vec3 } from '../src/lib/math3d';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FRAMES = 90; // first N frames of the walk sample, enough + fast

let robot: RobotModel;
let frames: HumanFrame[];

beforeAll(async () => {
  const mujoco = await getMujoco();
  const dir = join(ROOT, 'public', 'robots', 'unitree_g1');
  const vdir = '/working/omni_g1';
  mujoco.FS.mkdir(vdir);
  mujoco.FS.mkdir(`${vdir}/meshes`);
  for (const f of readdirSync(join(dir, 'meshes'))) {
    mujoco.FS.writeFile(`${vdir}/meshes/${f}`, readFileSync(join(dir, 'meshes', f)));
  }
  mujoco.FS.writeFile(`${vdir}/g1_mocap_29dof.xml`, readFileSync(join(dir, 'g1_mocap_29dof.xml')));
  const model = mujoco.MjModel.loadFromXML(`${vdir}/g1_mocap_29dof.xml`);
  const data = new mujoco.MjData(model);
  const bodyIds = new Map<string, number>();
  const bodyNames: string[] = [];
  for (let b = 0; b < model.nbody; b++) {
    const name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, b) ?? `body_${b}`;
    bodyNames.push(name);
    bodyIds.set(name, b);
  }
  robot = {
    id: 'unitree_g1',
    mujoco,
    model,
    data,
    bodyNames,
    bodyIds,
    jointNames: [],
    dofJointNames: [],
    nq: model.nq,
    nv: model.nv,
  };

  const text = readFileSync(join(ROOT, 'public', 'sample_motions', 'walk.bvh'), 'utf-8');
  frames = bvhToLafan1Frames(parseBvh(text), 0.01).frames.slice(0, FRAMES);
});

/** Mean interaction-mesh residual of an engine's stage-2 bodies over the frames. */
function runPass(engine: GmrRetargetEngine, k: number) {
  const qpos: Float64Array[] = [];
  let residual = 0;
  const xpos = robot.data.xpos as Float64Array;
  for (const frame of frames) {
    qpos.push(engine.retargetFrame(frame));
    const tasks = engine.tasks2 as IkTask[];
    const robotPts: Vec3[] = [];
    const humanPts: Vec3[] = [];
    for (const task of tasks) {
      const target = engine.lastScaledHuman.get(task.humanBody);
      if (!target) continue;
      const b = task.bodyId * 3;
      robotPts.push([xpos[b], xpos[b + 1], xpos[b + 2]]);
      humanPts.push(target.pos);
    }
    const W = knnLaplacianWeights(humanPts, k);
    residual += meanLaplacianResidual(robotPts, humanPts, W);
  }
  return { qpos, residual: residual / frames.length };
}

describe('OmniRetargetEngine', () => {
  it('reduces to GMR exactly when meshWeight = 0', () => {
    const config = getDefaultConfig('unitree_g1');
    const gmr = new GmrRetargetEngine(robot, config, { ...DEFAULT_SOLVER_OPTIONS });
    const gmrPass = runPass(gmr, 4);
    gmr.dispose();

    const omni = new OmniRetargetEngine(robot, getDefaultConfig('unitree_g1'), {
      ...DEFAULT_SOLVER_OPTIONS,
      meshWeight: 0,
    });
    const omniPass = runPass(omni, 4);
    omni.dispose();

    let maxDiff = 0;
    for (let f = 0; f < frames.length; f++) {
      for (let i = 0; i < robot.nq; i++) {
        maxDiff = Math.max(maxDiff, Math.abs(gmrPass.qpos[f][i] - omniPass.qpos[f][i]));
      }
    }
    expect(maxDiff).toBeLessThan(1e-9);
  });

  it('stays finite + in range and lowers interaction-mesh distortion', () => {
    const k = DEFAULT_SOLVER_OPTIONS.meshNeighbors;
    const gmr = new GmrRetargetEngine(robot, getDefaultConfig('unitree_g1'), {
      ...DEFAULT_SOLVER_OPTIONS,
    });
    const gmrPass = runPass(gmr, k);
    gmr.dispose();

    const omni = new OmniRetargetEngine(robot, getDefaultConfig('unitree_g1'), {
      ...DEFAULT_SOLVER_OPTIONS,
      meshWeight: 16,
    });
    const omniPass = runPass(omni, k);
    omni.dispose();

    // finite + within joint limits
    const model = robot.model;
    const jntType = model.jnt_type as Int32Array;
    const jntLimited = model.jnt_limited as Uint8Array;
    const jntQposadr = model.jnt_qposadr as Int32Array;
    const jntRange = model.jnt_range as Float64Array;
    for (const q of omniPass.qpos) {
      for (const v of q) expect(Number.isFinite(v)).toBe(true);
      for (let j = 0; j < model.njnt; j++) {
        if (jntType[j] === 0 || !jntLimited[j]) continue;
        const adr = jntQposadr[j];
        expect(q[adr]).toBeGreaterThanOrEqual(jntRange[j * 2] - 1e-3);
        expect(q[adr]).toBeLessThanOrEqual(jntRange[j * 2 + 1] + 1e-3);
      }
    }

    // The interaction-mesh objective should reduce relative-structure distortion.
    expect(omniPass.residual).toBeLessThan(gmrPass.residual);
  });
});

describe('knnLaplacianWeights', () => {
  it('builds row-normalised weights with a zero diagonal', () => {
    const pts: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [2, 2, 2],
    ];
    const N = pts.length;
    const W = knnLaplacianWeights(pts, 3);
    for (let i = 0; i < N; i++) {
      expect(W[i * N + i]).toBe(0); // no self-edge
      let sum = 0;
      for (let j = 0; j < N; j++) sum += W[i * N + j];
      expect(sum).toBeCloseTo(1, 9); // each row sums to 1
    }
  });
});
