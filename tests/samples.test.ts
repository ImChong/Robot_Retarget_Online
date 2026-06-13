/**
 * Behavioural regression for the bundled sample motions: each must parse with
 * the LAFAN1 skeleton and retarget to Unitree G1 with finite, in-range qpos.
 * The acrobatic clips must additionally make the robot pelvis invert and land
 * upright; fall_getup must reach a low/lying pose and end standing.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getMujoco, type RobotModel } from '../src/lib/mujoco/runtime';
import { parseBvh } from '../src/lib/bvh/parse';
import { bvhToLafan1Frames } from '../src/lib/bvh/lafan1';
import { GmrRetargetEngine } from '../src/lib/retarget/engine';
import { getDefaultConfig } from '../src/lib/retarget/defaults';
import { DEFAULT_SOLVER_OPTIONS } from '../src/lib/retarget/types';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAMPLES = ['walk', 'run', 'wave', 'fall_getup', 'backflip', 'sideflip'];

let robot: RobotModel;
let pelvisId: number;

beforeAll(async () => {
  const mujoco = await getMujoco();
  const dir = join(ROOT, 'public', 'robots', 'unitree_g1');
  const vdir = '/working/samples_g1';
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
  pelvisId = bodyIds.get('pelvis')!;
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

/** world-Z component of the pelvis body-Z axis: +1 upright, -1 inverted. */
function pelvisUpright(): number {
  const xmat = robot.data.xmat as Float64Array;
  return xmat[pelvisId * 9 + 8];
}

describe('bundled sample motions retarget to G1', () => {
  for (const name of SAMPLES) {
    it(`${name}: finite, in-range, expected dynamics`, () => {
      const text = readFileSync(join(ROOT, 'public', 'sample_motions', `${name}.bvh`), 'utf-8');
      const motion = bvhToLafan1Frames(parseBvh(text), 0.01);
      expect(motion.missingFootJoints).toHaveLength(0);

      const engine = new GmrRetargetEngine(robot, getDefaultConfig('unitree_g1'), {
        ...DEFAULT_SOLVER_OPTIONS,
      });

      const model = robot.model;
      const jntType = model.jnt_type as Int32Array;
      const jntLimited = model.jnt_limited as Uint8Array;
      const jntQposadr = model.jnt_qposadr as Int32Array;
      const jntRange = model.jnt_range as Float64Array;

      let minUp = Infinity;
      let endUp = 1;
      for (let f = 0; f < motion.frames.length; f++) {
        const q = engine.retargetFrame(motion.frames[f]);
        for (const v of q) expect(Number.isFinite(v)).toBe(true);
        // joint-limit compliance
        for (let j = 0; j < model.njnt; j++) {
          if (jntType[j] === 0 || !jntLimited[j]) continue;
          const adr = jntQposadr[j];
          expect(q[adr]).toBeGreaterThanOrEqual(jntRange[j * 2] - 1e-3);
          expect(q[adr]).toBeLessThanOrEqual(jntRange[j * 2 + 1] + 1e-3);
        }
        const up = pelvisUpright();
        minUp = Math.min(minUp, up);
        endUp = up;
      }
      engine.dispose();

      if (name === 'backflip' || name === 'sideflip') {
        expect(minUp).toBeLessThan(-0.3); // passes through inversion
        expect(endUp).toBeGreaterThan(0.8); // lands upright
      } else if (name === 'fall_getup') {
        expect(minUp).toBeLessThan(0.2); // lies down
        expect(endUp).toBeGreaterThan(0.8); // gets up
      } else {
        expect(minUp).toBeGreaterThan(0.7); // stays upright
      }
    });
  }
});
