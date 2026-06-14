import { describe, expect, it } from 'vitest';
import {
  eulerToQuat,
  quatFromTo,
  quatRotate,
  quatToEulerZYX,
  vNorm,
  type Quat,
  type Vec3,
} from '../src/lib/math3d';
import { parseBvh, bvhFk } from '../src/lib/bvh/parse';
import { bvhToLafan1Frames } from '../src/lib/bvh/lafan1';
import { posesToBvh } from '../src/lib/mocap/landmarksToBvh';
import { smoothPoseSequence } from '../src/lib/mocap/smoothing';
import type { PoseFrame } from '../src/lib/mocap/types';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('math helpers for mocap', () => {
  it('quatFromTo produces the minimal rotation between unit vectors', () => {
    const a: Vec3 = [1, 0, 0];
    const b: Vec3 = [0, 1, 0];
    const q = quatFromTo(a, b);
    const r = quatRotate(q, a);
    expect(close(r[0], 0)).toBe(true);
    expect(close(r[1], 1)).toBe(true);
    expect(close(r[2], 0)).toBe(true);
  });

  it('quatFromTo handles parallel and anti-parallel inputs', () => {
    const same = quatFromTo([0, 0, 1], [0, 0, 1]);
    expect(close(same[0], 1)).toBe(true);
    const opp = quatFromTo([0, 0, 1], [0, 0, -1]);
    const r = quatRotate(opp, [0, 0, 1]);
    expect(close(r[2], -1, 1e-6)).toBe(true);
  });

  it('quatToEulerZYX inverts eulerToQuat(.,"zyx")', () => {
    const samples: Quat[] = [
      eulerToQuat([0.3, -0.8, 1.1], 'zyx'),
      eulerToQuat([-1.4, 0.2, 0.05], 'zyx'),
      eulerToQuat([2.0, -1.2, -2.5], 'zyx'),
    ];
    for (const q of samples) {
      const e = quatToEulerZYX(q);
      const q2 = eulerToQuat(e, 'zyx');
      // Quaternions are double-cover; compare up to sign.
      const dot = q[0] * q2[0] + q[1] * q2[1] + q[2] * q2[2] + q[3] * q2[3];
      const s = dot < 0 ? -1 : 1;
      for (let i = 0; i < 4; i++) expect(close(q[i], s * q2[i], 1e-6)).toBe(true);
    }
  });
});

/** A standing T-pose in MediaPipe world coords (x right, y down, z toward camera). */
function tPoseWorld(): Vec3[] {
  const w: Vec3[] = Array.from({ length: 33 }, () => [0, 0, 0] as Vec3);
  w[0] = [0, -0.65, -0.05]; // nose
  w[7] = [0.07, -0.62, 0]; // left ear
  w[8] = [-0.07, -0.62, 0]; // right ear
  w[11] = [0.2, -0.5, 0]; // left shoulder
  w[12] = [-0.2, -0.5, 0]; // right shoulder
  w[13] = [0.5, -0.5, 0]; // left elbow
  w[14] = [-0.5, -0.5, 0]; // right elbow
  w[15] = [0.8, -0.5, 0]; // left wrist
  w[16] = [-0.8, -0.5, 0]; // right wrist
  w[23] = [0.1, 0, 0]; // left hip
  w[24] = [-0.1, 0, 0]; // right hip
  w[25] = [0.1, 0.45, 0]; // left knee
  w[26] = [-0.1, 0.45, 0]; // right knee
  w[27] = [0.1, 0.9, 0]; // left ankle
  w[28] = [-0.1, 0.9, 0]; // right ankle
  w[29] = [0.1, 0.95, 0.05]; // left heel
  w[30] = [-0.1, 0.95, 0.05]; // right heel
  w[31] = [0.1, 0.93, -0.15]; // left foot index
  w[32] = [-0.1, 0.93, -0.15]; // right foot index
  return w;
}

function frame(world: Vec3[]): PoseFrame {
  return { world, visibility: new Array(33).fill(1) };
}

describe('posesToBvh', () => {
  it('emits a LAFAN1 skeleton the parser accepts', () => {
    const { bvh, frameCount } = posesToBvh([frame(tPoseWorld())], 30);
    expect(frameCount).toBe(1);
    const anim = parseBvh(bvh);
    const names = anim.joints.map((j) => j.name);
    expect(anim.joints).toHaveLength(22);
    for (const required of [
      'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
      'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToe',
      'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToe',
      'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
      'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    ]) {
      expect(names).toContain(required);
    }
    expect(1 / anim.frameTime).toBeCloseTo(30, 3);
  });

  it('flows through the LAFAN1 conversion without missing joints', () => {
    const { bvh } = posesToBvh([frame(tPoseWorld()), frame(tPoseWorld())], 30);
    const anim = parseBvh(bvh);
    const motion = bvhToLafan1Frames(anim, 0.01);
    expect(motion.missingFootJoints).toHaveLength(0);
    const f0 = motion.frames[0];
    expect(f0.has('LeftFootMod')).toBe(true);
    expect(f0.has('RightFootMod')).toBe(true);
  });

  it('reconstructs an upright, correctly-handed standing pose', () => {
    const { bvh } = posesToBvh([frame(tPoseWorld())], 30);
    const anim = parseBvh(bvh);
    const { globalPos } = bvhFk(anim);
    const J = anim.joints.length;
    const idx = (n: string) => anim.joints.findIndex((j) => j.name === n);
    const posOf = (n: string): Vec3 => {
      const j = idx(n);
      return [globalPos[j * 3], globalPos[j * 3 + 1], globalPos[j * 3 + 2]];
    };
    // BVH is Y-up: head above hips above feet.
    expect(posOf('Head')[1]).toBeGreaterThan(posOf('Hips')[1]);
    expect(posOf('Hips')[1]).toBeGreaterThan(posOf('LeftFoot')[1]);
    // Subject-left side is +X (no mirror): left foot/hand on +X of right.
    expect(posOf('LeftFoot')[0]).toBeGreaterThan(posOf('RightFoot')[0]);
    expect(posOf('LeftHand')[0]).toBeGreaterThan(posOf('RightHand')[0]);
    void J;
  });

  it('reproduces observed bone directions via FK', () => {
    // Bend the left elbow forward (toward camera => -z in MediaPipe => +z skel)
    const w = tPoseWorld();
    w[15] = [0.5, -0.5, -0.3]; // left wrist moved forward of the elbow
    const { bvh } = posesToBvh([frame(w)], 30);
    const anim = parseBvh(bvh);
    const { globalPos } = bvhFk(anim);
    const idx = (n: string) => anim.joints.findIndex((j) => j.name === n);
    const posOf = (n: string): Vec3 => {
      const j = idx(n);
      return [globalPos[j * 3], globalPos[j * 3 + 1], globalPos[j * 3 + 2]];
    };
    // Observed forearm direction in skel space: wrist - elbow, with mpToSkel(x,-y,-z).
    const elbow: Vec3 = [0.5, 0.5, 0]; // mpToSkel of (0.5,-0.5,0)
    const wrist: Vec3 = [0.5, 0.5, 0.3]; // mpToSkel of (0.5,-0.5,-0.3)
    const obs: Vec3 = [wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]];
    const on = vNorm(obs);
    const fore = posOf('LeftHand');
    const arm = posOf('LeftForeArm');
    const fk: Vec3 = [fore[0] - arm[0], fore[1] - arm[1], fore[2] - arm[2]];
    const fn = vNorm(fk);
    const cos = (obs[0] * fk[0] + obs[1] * fk[1] + obs[2] * fk[2]) / (on * fn);
    expect(cos).toBeGreaterThan(0.99); // directions align
  });
});

describe('smoothPoseSequence', () => {
  it('reduces jitter on a noisy stationary landmark', () => {
    const base = tPoseWorld();
    const rng = mulberry32(42);
    const frames: PoseFrame[] = Array.from({ length: 60 }, () => {
      const world = base.map((v) => [v[0] + (rng() - 0.5) * 0.1, v[1], v[2]] as Vec3);
      return { world, visibility: new Array(33).fill(1) };
    });
    const smoothed = smoothPoseSequence(frames, 30, { minCutoff: 0.5, beta: 0 });
    const variance = (arr: PoseFrame[]) => {
      const xs = arr.slice(10).map((f) => f.world[23][0]); // left hip x, after warmup
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
    };
    expect(variance(smoothed)).toBeLessThan(variance(frames) * 0.5);
  });
});

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
