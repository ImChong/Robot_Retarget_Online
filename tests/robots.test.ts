/**
 * Per-robot smoke test: every robot in public/robots/manifest.json must load
 * in MuJoCo, match its default ik_config body names, and retarget a few
 * frames of the bundled walk sample to finite, in-range qpos.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getMujoco, type RobotModel } from '../src/lib/mujoco/runtime';
import { parseBvh } from '../src/lib/bvh/parse';
import { bvhToLafan1Frames } from '../src/lib/bvh/lafan1';
import { GmrRetargetEngine } from '../src/lib/retarget/engine';
import { getDefaultConfig } from '../src/lib/retarget/defaults';
import { DEFAULT_SOLVER_OPTIONS } from '../src/lib/retarget/types';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface ManifestEntry {
  id: string;
  xml: string;
  files: string[];
}

const manifest: ManifestEntry[] = JSON.parse(
  readFileSync(join(ROOT, 'public', 'robots', 'manifest.json'), 'utf-8'),
);

async function loadRobotFromDisk(entry: ManifestEntry): Promise<RobotModel> {
  const mujoco = await getMujoco();
  const dir = join(ROOT, 'public', 'robots', entry.id);
  const vdir = `/working/test_${entry.id}`;
  if (!mujoco.FS.analyzePath(vdir).exists) {
    mujoco.FS.mkdir(vdir);
    mujoco.FS.mkdir(`${vdir}/meshes`);
    for (const f of readdirSync(join(dir, 'meshes'))) {
      mujoco.FS.writeFile(`${vdir}/meshes/${f}`, readFileSync(join(dir, 'meshes', f)));
    }
    mujoco.FS.writeFile(`${vdir}/${entry.xml}`, readFileSync(join(dir, entry.xml)));
  }
  const model = mujoco.MjModel.loadFromXML(`${vdir}/${entry.xml}`);
  const data = new mujoco.MjData(model);
  const bodyIds = new Map<string, number>();
  const bodyNames: string[] = [];
  for (let b = 0; b < model.nbody; b++) {
    const name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY.value, b) ?? `body_${b}`;
    bodyNames.push(name);
    bodyIds.set(name, b);
  }
  return {
    id: entry.id,
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
}

describe('all bundled robots', () => {
  const motionText = readFileSync(join(ROOT, 'public', 'sample_motions', 'walk.bvh'), 'utf-8');

  for (const entry of manifest) {
    it(`${entry.id}: loads, config matches model, retargets sample frames`, async () => {
      const robot = await loadRobotFromDisk(entry);
      const config = getDefaultConfig(entry.id);

      // config robot bodies must all exist in the model (engine throws otherwise)
      const engine = new GmrRetargetEngine(robot, config, { ...DEFAULT_SOLVER_OPTIONS });

      const motion = bvhToLafan1Frames(parseBvh(motionText), 0.01);
      let qpos: Float64Array | null = null;
      for (let f = 0; f < 12; f++) {
        qpos = engine.retargetFrame(motion.frames[f]);
        for (const v of qpos) expect(Number.isFinite(v)).toBe(true);
      }

      // robot ends up standing near the human root (sane retarget)
      expect(qpos![2]).toBeGreaterThan(0.3); // base height
      expect(qpos![2]).toBeLessThan(1.2);
      const errs = engine.taskPositionErrors();
      const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
      expect(mean).toBeLessThan(0.35);
      engine.dispose();
    });
  }
});
