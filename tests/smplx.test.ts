import { describe, expect, it } from 'vitest';
import { encodeNpy, encodeNpz } from '../src/lib/export/npz';
import { parseNpy, parseNpz } from '../src/lib/smplx/npy';
import {
  parseSmplxModel,
  parseAmassMotion,
  SMPLX_BODY_JOINT_NAMES,
  type SmplxBodyModel,
  type SmplxFrameParams,
} from '../src/lib/smplx/model';
import { restJoints, forwardKinematics, smplxToHumanFrames } from '../src/lib/smplx/fk';
import { loadSmplxMotion } from '../src/lib/smplx';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const vClose = (a: ArrayLike<number | bigint>, b: number[], eps = 1e-9) => {
  for (let i = 0; i < b.length; i++) expect(close(Number(a[i]), b[i], eps)).toBe(true);
};

/**
 * Tiny hand-checkable model: a 3-joint chain along +Y with an identity
 * J_regressor (each joint = one vertex), so rest joints == shaped vertices.
 * shapedirs moves vertex 1 along +Y by betas[0].
 */
function tinyModel(): SmplxBodyModel {
  const numVerts = 3;
  const numShape = 1;
  const vTemplate = Float64Array.from([0, 0, 0, 0, 1, 0, 0, 2, 0]);
  const shapeDirs = new Float64Array(numVerts * 3 * numShape); // (V,3,B)
  shapeDirs[(1 * 3 + 1) * numShape + 0] = 1; // d(vertex1.y)/d(beta0) = 1
  const jRegressor = Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]); // identity 3x3
  const parents = Int32Array.from([-1, 0, 1]);
  return { numVerts, numJoints: 3, numShape, vTemplate, shapeDirs, jRegressor, parents };
}

const zeroFrame = (): SmplxFrameParams => ({
  rootOrient: [0, 0, 0],
  bodyPose: new Float64Array(63),
  trans: [0, 0, 0],
});

describe('smplx: npy/npz reader', () => {
  it('round-trips a float64 2D array through encodeNpy', () => {
    const arr = Float64Array.from([1.5, -2.25, 3.125, 4, 5, 6]);
    const parsed = parseNpy(encodeNpy(arr, [2, 3]))!;
    expect(parsed.dtype).toBe('<f8');
    expect(parsed.shape).toEqual([2, 3]);
    vClose(parsed.data, [1.5, -2.25, 3.125, 4, 5, 6]);
  });

  it('round-trips int32 and a scalar', () => {
    const i = parseNpy(encodeNpy(Int32Array.from([7, -3, 2147483647]), [3]))!;
    expect(i.dtype).toBe('<i4');
    expect(Array.from(i.data as Int32Array)).toEqual([7, -3, 2147483647]);

    const s = parseNpy(encodeNpy(Float64Array.from([30]), []))!;
    expect(s.shape).toEqual([]);
    expect(s.data[0]).toBe(30);
  });

  it('reads multiple arrays out of an npz', () => {
    const npz = encodeNpz({
      a: { data: Float64Array.from([1, 2, 3]), shape: [3] },
      b: { data: Float64Array.from([9, 8]), shape: [2] },
    });
    const got = parseNpz(npz);
    expect(Object.keys(got).sort()).toEqual(['a', 'b']);
    vClose(got.a.data, [1, 2, 3]);
    vClose(got.b.data, [9, 8]);
  });
});

describe('smplx: rest joints from shape', () => {
  it('returns the rest skeleton at zero betas', () => {
    const J = restJoints(tinyModel(), [0]);
    vClose(J, [0, 0, 0, 0, 1, 0, 0, 2, 0]);
  });

  it('applies shape blend along shapedirs', () => {
    const J = restJoints(tinyModel(), [0.5]);
    vClose(J, [0, 0, 0, 0, 1.5, 0, 0, 2, 0]);
  });
});

describe('smplx: forward kinematics', () => {
  const model = tinyModel();
  const rest = restJoints(model, [0]);

  it('zero pose reproduces the rest skeleton', () => {
    const p = forwardKinematics(rest, model.parents, zeroFrame());
    vClose(p.pos, [0, 0, 0, 0, 1, 0, 0, 2, 0]);
    vClose(p.quat, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  });

  it('rotates the whole chain about the root', () => {
    const p = forwardKinematics(rest, model.parents, {
      ...zeroFrame(),
      rootOrient: [0, 0, Math.PI / 2], // +90° about Z
    });
    vClose([p.pos[3], p.pos[4], p.pos[5]], [-1, 0, 0], 1e-9); // joint 1
    vClose([p.pos[6], p.pos[7], p.pos[8]], [-2, 0, 0], 1e-9); // joint 2
  });

  it('rotates a child by its local pose, propagating to descendants', () => {
    const bodyPose = new Float64Array(63);
    bodyPose[2] = Math.PI / 2; // joint 1 local: +90° about Z
    const p = forwardKinematics(rest, model.parents, { ...zeroFrame(), bodyPose });
    vClose([p.pos[3], p.pos[4], p.pos[5]], [0, 1, 0], 1e-9); // joint 1 unmoved
    vClose([p.pos[6], p.pos[7], p.pos[8]], [-1, 1, 0], 1e-9); // joint 2 swung
  });

  it('applies global translation to every joint', () => {
    const p = forwardKinematics(rest, model.parents, { ...zeroFrame(), trans: [1, 2, 3] });
    vClose([p.pos[0], p.pos[1], p.pos[2]], [1, 2, 3]);
    vClose([p.pos[6], p.pos[7], p.pos[8]], [1, 4, 3]);
  });
});

describe('smplx: human frames (Y-up → Z-up)', () => {
  it('maps positions into the GMR Z-up frame and keys by joint name', () => {
    const motion = { betas: new Float64Array([0]), frames: [zeroFrame()], fps: 30 };
    const out = smplxToHumanFrames(tinyModel(), motion);
    expect(out.fps).toBe(30);
    expect(out.jointNames).toEqual(['pelvis', 'left_hip', 'right_hip']);
    const frame = out.frames[0];
    vClose(frame.get('pelvis')!.pos, [0, 0, 0]); // (x,-z,y) of (0,0,0)
    vClose(frame.get('left_hip')!.pos, [0, 0, 1]); // (x,-z,y) of (0,1,0)
    vClose(frame.get('right_hip')!.pos, [0, 0, 2]); // (x,-z,y) of (0,2,0)
    expect(out.humanHeight).toBeGreaterThan(0);
  });
});

/** Build a model .npz the way an official SMPL-X file is laid out. */
function modelNpz(withKintree: boolean): Uint8Array {
  const m = tinyModel();
  const arrays: Record<string, { data: Float64Array | Int32Array; shape: number[] }> = {
    v_template: { data: m.vTemplate, shape: [3, 3] },
    shapedirs: { data: m.shapeDirs, shape: [3, 3, 1] },
    J_regressor: { data: m.jRegressor, shape: [3, 3] },
  };
  if (withKintree) {
    // kintree_table[0] = parents (root sentinel), [1] = child ids.
    arrays.kintree_table = { data: Int32Array.from([2147483647, 0, 1, 0, 1, 2]), shape: [2, 3] };
  }
  return encodeNpz(arrays);
}

describe('smplx: model parsing', () => {
  it('reads shape/skeleton terms and parents from kintree_table', () => {
    const m = parseSmplxModel(modelNpz(true));
    expect(m.numVerts).toBe(3);
    expect(m.numJoints).toBe(3);
    expect(m.numShape).toBe(1);
    expect(Array.from(m.parents)).toEqual([-1, 0, 1]);
    vClose(restJoints(m, [1]), [0, 0, 0, 0, 2, 0, 0, 2, 0]); // beta blend
  });

  it('falls back to canonical parents when kintree_table is absent', () => {
    const m = parseSmplxModel(modelNpz(false));
    expect(m.parents[0]).toBe(-1);
    expect(m.parents[1]).toBe(0);
    expect(m.parents[2]).toBe(0);
  });

  it('throws on a model missing required arrays', () => {
    const bad = encodeNpz({ v_template: { data: Float64Array.from([0, 0, 0]), shape: [1, 3] } });
    expect(() => parseSmplxModel(bad)).toThrow();
  });
});

describe('smplx: AMASS motion parsing', () => {
  it('parses the pose_body / root_orient / trans layout', () => {
    const npz = encodeNpz({
      betas: { data: new Float64Array(16).fill(0.1), shape: [16] },
      root_orient: { data: Float64Array.from([0, 0, 1, 0, 0, 2]), shape: [2, 3] },
      pose_body: { data: new Float64Array(2 * 63).fill(0.01), shape: [2, 63] },
      trans: { data: Float64Array.from([1, 2, 3, 4, 5, 6]), shape: [2, 3] },
      mocap_frame_rate: { data: Float64Array.from([60]), shape: [] },
    });
    const mo = parseAmassMotion(npz);
    expect(mo.fps).toBe(60);
    expect(mo.betas.length).toBe(16);
    expect(mo.frames.length).toBe(2);
    expect(mo.frames[1].rootOrient).toEqual([0, 0, 2]);
    expect(mo.frames[1].trans).toEqual([4, 5, 6]);
    expect(mo.frames[0].bodyPose.length).toBe(63);
  });

  it('parses the combined poses layout (root = poses[:3], body = poses[3:66])', () => {
    const cols = 66;
    const poses = new Float64Array(1 * cols);
    poses[0] = 0.5; // root x
    poses[3] = 0.9; // first body-joint x
    const npz = encodeNpz({
      poses: { data: poses, shape: [1, cols] },
      trans: { data: Float64Array.from([7, 8, 9]), shape: [1, 3] },
    });
    const mo = parseAmassMotion(npz);
    expect(mo.fps).toBe(30); // default when frame rate absent
    expect(mo.frames[0].rootOrient).toEqual([0.5, 0, 0]);
    expect(mo.frames[0].bodyPose[0]).toBe(0.9);
    expect(mo.frames[0].trans).toEqual([7, 8, 9]);
  });

  it('throws when neither pose layout is present', () => {
    const npz = encodeNpz({ betas: { data: new Float64Array(16), shape: [16] } });
    expect(() => parseAmassMotion(npz)).toThrow();
  });
});

describe('smplx: end-to-end loadSmplxMotion', () => {
  it('produces engine-ready human frames from model + motion npz', () => {
    const motion = encodeNpz({
      betas: { data: new Float64Array(16), shape: [16] },
      root_orient: { data: new Float64Array(3), shape: [1, 3] },
      pose_body: { data: new Float64Array(63), shape: [1, 63] },
      trans: { data: new Float64Array(3), shape: [1, 3] },
    });
    const out = loadSmplxMotion(modelNpz(true), motion);
    expect(out.frames.length).toBe(1);
    const frame = out.frames[0];
    expect(frame.has('pelvis')).toBe(true);
    expect(frame.get('pelvis')!.quat.length).toBe(4);
    vClose(frame.get('left_hip')!.pos, [0, 0, 1]);
  });
});

describe('smplx: joint table covers all config keypoints', () => {
  it('includes every human body name referenced by smplx_to_* configs', () => {
    const needed = [
      'pelvis', 'spine3', 'head',
      'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_foot', 'right_foot',
      'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
      'left_wrist', 'right_wrist',
    ];
    for (const n of needed) expect(SMPLX_BODY_JOINT_NAMES).toContain(n);
  });
});
