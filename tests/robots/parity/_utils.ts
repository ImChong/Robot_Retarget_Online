import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { parseBvh } from '../../../src/lib/bvh/parse';
import { bvhToLafan1Frames } from '../../../src/lib/bvh/lafan1';
import { GmrRetargetEngine } from '../../../src/lib/retarget/engine';
import { getDefaultConfig } from '../../../src/lib/retarget/defaults';
import { DEFAULT_SOLVER_OPTIONS } from '../../../src/lib/retarget/types';
import { ROOT, entryById, loadRobotFromDisk } from '../_utils';

export interface ParityRef {
  robot: string;
  human_height: number;
  targets0: Record<string, { pos: number[]; quat: number[] }>;
  qpos: number[][];
}

const WALK_BVH = join(ROOT, 'public', 'sample_motions', 'walk.bvh');
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'gmr_parity');

/** Legacy path used by the original single-robot parity test. */
const LEGACY_REF: Record<string, string> = {
  unitree_g1: '/tmp/gmr_ref_walk_g1.json',
};

export function parityRefPath(robotId: string): string {
  return join(FIXTURE_DIR, `walk_${robotId}.json`);
}

export function refAvailable(robotId: string): boolean {
  const path = parityRefPath(robotId);
  if (existsSync(path)) return true;
  const legacy = LEGACY_REF[robotId];
  return legacy !== undefined && existsSync(legacy);
}

function loadRef(robotId: string, path: string): ParityRef {
  const legacy = LEGACY_REF[robotId];
  const file = existsSync(path) ? path : legacy!;
  return JSON.parse(readFileSync(file, 'utf-8')) as ParityRef;
}

function loadWalkFrames() {
  return bvhToLafan1Frames(parseBvh(readFileSync(WALK_BVH, 'utf-8')), 0.01);
}

export async function runParitySuite(robotId: string, refPath: string) {
  const ref = loadRef(robotId, refPath);
  const robot = await loadRobotFromDisk(entryById(robotId));
  const motion = loadWalkFrames();
  const solver = { ...DEFAULT_SOLVER_OPTIONS, actualHumanHeight: ref.human_height };

  const engine = new GmrRetargetEngine(robot, getDefaultConfig(robotId), solver);
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
    const dot = rq[0] * mine!.quat[0] + rq[1] * mine!.quat[1] + rq[2] * mine!.quat[2] + rq[3] * mine!.quat[3];
    const s = dot < 0 ? -1 : 1;
    for (let i = 0; i < 4; i++) worstQuat = Math.max(worstQuat, Math.abs(s * mine!.quat[i] - rq[i]));
  }
  expect(worstPos).toBeLessThan(1e-6);
  expect(worstQuat).toBeLessThan(1e-6);

  const T = Math.min(motion.frames.length, ref.qpos.length);
  expect(T).toBeGreaterThan(0);
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
  expect(dofRmse).toBeLessThan(0.05);
  expect(rootRmse).toBeLessThan(0.02);
  engine.dispose();
}
