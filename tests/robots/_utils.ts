import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect } from 'vitest';
import { getMujoco, type RobotModel } from '../../src/lib/mujoco/runtime';
import { GmrRetargetEngine } from '../../src/lib/retarget/engine';
import { getDefaultConfig } from '../../src/lib/retarget/defaults';
import { DEFAULT_SOLVER_OPTIONS } from '../../src/lib/retarget/types';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface ManifestEntry {
  id: string;
  xml: string;
  files: string[];
  configKey?: string;
}

export const manifest: ManifestEntry[] = JSON.parse(
  readFileSync(join(ROOT, 'public', 'robots', 'manifest.json'), 'utf-8'),
);

function ensureDir(mujoco: Awaited<ReturnType<typeof getMujoco>>, path: string) {
  const parts = path.split('/').filter(Boolean);
  let cur = '';
  for (const p of parts) {
    cur += '/' + p;
    if (!mujoco.FS.analyzePath(cur).exists) mujoco.FS.mkdir(cur);
  }
}

export async function loadRobotFromDisk(entry: ManifestEntry): Promise<RobotModel> {
  const mujoco = await getMujoco();
  const dir = join(ROOT, 'public', 'robots', entry.id);
  const vdir = `/working/test_${entry.id}`;
  ensureDir(mujoco, vdir);
  for (const rel of entry.files) {
    const path = `${vdir}/${rel}`;
    ensureDir(mujoco, path.substring(0, path.lastIndexOf('/')));
    mujoco.FS.writeFile(path, readFileSync(join(dir, rel)));
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

/** Load once; BVH-ready robots also verify ik_config body names against the model. */
export async function smokeLoad(entry: ManifestEntry) {
  const robot = await loadRobotFromDisk(entry);
  const config = getDefaultConfig(entry.id);
  expect(robot.bodyIds.has(config.robot_root_name)).toBe(true);
  if (entry.configKey === 'bvh_lafan1') {
    const engine = new GmrRetargetEngine(robot, config, { ...DEFAULT_SOLVER_OPTIONS });
    expect(engine.tasks1.length).toBeGreaterThan(0);
    engine.dispose();
  }
}

export function entryById(id: string): ManifestEntry {
  const entry = manifest.find((e) => e.id === id);
  if (!entry) throw new Error(`missing manifest entry: ${id}`);
  return entry;
}
