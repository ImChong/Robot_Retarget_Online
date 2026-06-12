/**
 * Parity test against the ORIGINAL Python GMR pipeline.
 *
 * Generate the reference first:
 *   python3 scripts/gmr_reference.py public/sample_motions/walk.bvh unitree_g1 /tmp/gmr_ref_walk_g1.json
 * The test is skipped when the reference file is absent (e.g. in CI).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getMujoco, type RobotModel } from '../src/lib/mujoco/runtime';
import { parseBvh } from '../src/lib/bvh/parse';
import { bvhToLafan1Frames } from '../src/lib/bvh/lafan1';
import { GmrRetargetEngine } from '../src/lib/retarget/engine';
import { getDefaultConfig } from '../src/lib/retarget/defaults';
import { DEFAULT_SOLVER_OPTIONS } from '../src/lib/retarget/types';

const REF_PATH = '/tmp/gmr_ref_walk_g1.json';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Ref {
  robot: string;
  human_height: number;
  targets0: Record<string, { pos: number[]; quat: number[] }>;
  qpos: number[][];
}

describe.skipIf(!existsSync(REF_PATH))('parity with Python GMR (unitree_g1 / walk.bvh)', () => {
  let robot: RobotModel;
  let ref: Ref;

  beforeAll(async () => {
    ref = JSON.parse(readFileSync(REF_PATH, 'utf-8'));

    const mujoco = await getMujoco();
    const dir = join(ROOT, 'public', 'robots', 'unitree_g1');
    mujoco.FS.mkdir('/working/g1');
    mujoco.FS.mkdir('/working/g1/meshes');
    for (const f of readdirSync(join(dir, 'meshes'))) {
      mujoco.FS.writeFile(`/working/g1/meshes/${f}`, readFileSync(join(dir, 'meshes', f)));
    }
    mujoco.FS.writeFile('/working/g1/g1_mocap_29dof.xml', readFileSync(join(dir, 'g1_mocap_29dof.xml')));
    const model = mujoco.MjModel.loadFromXML('/working/g1/g1_mocap_29dof.xml');
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
  });

  function loadFrames() {
    const text = readFileSync(join(ROOT, 'public', 'sample_motions', 'walk.bvh'), 'utf-8');
    return bvhToLafan1Frames(parseBvh(text), 0.01);
  }

  it('frame-0 preprocessed targets match GMR exactly', () => {
    const motion = loadFrames();
    const engine = new GmrRetargetEngine(robot, getDefaultConfig('unitree_g1'), {
      ...DEFAULT_SOLVER_OPTIONS,
      actualHumanHeight: ref.human_height,
    });
    const processed = engine.preprocessHuman(motion.frames[0]);

    const refBodies = Object.keys(ref.targets0);
    expect(refBodies.length).toBeGreaterThan(0);
    let worstPos = 0;
    let worstQuat = 0;
    for (const name of refBodies) {
      const mine = processed.get(name);
      expect(mine, `missing body ${name}`).toBeDefined();
      const rp = ref.targets0[name].pos;
      const rq = ref.targets0[name].quat;
      for (let i = 0; i < 3; i++) worstPos = Math.max(worstPos, Math.abs(mine!.pos[i] - rp[i]));
      // quaternion sign normalize
      const dot = rq[0] * mine!.quat[0] + rq[1] * mine!.quat[1] + rq[2] * mine!.quat[2] + rq[3] * mine!.quat[3];
      const s = dot < 0 ? -1 : 1;
      for (let i = 0; i < 4; i++) worstQuat = Math.max(worstQuat, Math.abs(s * mine!.quat[i] - rq[i]));
    }
    console.log(`targets0 parity: max pos diff=${worstPos.toExponential(2)}, max quat diff=${worstQuat.toExponential(2)}`);
    expect(worstPos).toBeLessThan(1e-6);
    expect(worstQuat).toBeLessThan(1e-6);
    engine.dispose();
  });

  it('full-motion qpos stays close to GMR output', () => {
    const motion = loadFrames();
    const engine = new GmrRetargetEngine(robot, getDefaultConfig('unitree_g1'), {
      ...DEFAULT_SOLVER_OPTIONS,
      actualHumanHeight: ref.human_height,
    });

    const T = motion.frames.length;
    expect(ref.qpos.length).toBe(T);
    const nq = robot.nq;

    let dofSq = 0;
    let dofN = 0;
    let dofMax = 0;
    let rootSq = 0;
    let rootMax = 0;
    for (let f = 0; f < T; f++) {
      const q = engine.retargetFrame(motion.frames[f]);
      const r = ref.qpos[f];
      for (let i = 7; i < nq; i++) {
        const d = Math.abs(q[i] - r[i]);
        dofSq += d * d;
        dofN++;
        if (d > dofMax) dofMax = d;
      }
      const dr = Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]);
      rootSq += dr * dr;
      if (dr > rootMax) rootMax = dr;
    }
    const dofRmse = Math.sqrt(dofSq / dofN);
    const rootRmse = Math.sqrt(rootSq / T);
    console.log(
      `qpos parity: dof RMSE=${dofRmse.toFixed(4)} rad, dof max=${dofMax.toFixed(4)} rad, ` +
        `root RMSE=${(rootRmse * 100).toFixed(2)} cm, root max=${(rootMax * 100).toFixed(2)} cm`,
    );
    // DLS vs daqp QP won't be bit-identical; require close agreement.
    expect(dofRmse).toBeLessThan(0.05);
    expect(rootRmse).toBeLessThan(0.02);
    engine.dispose();
  });
});
