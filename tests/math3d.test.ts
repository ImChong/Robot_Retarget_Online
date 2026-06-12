import { describe, expect, it } from 'vitest';
import {
  eulerToQuat,
  quatConj,
  quatFromMat3,
  quatMul,
  quatNormalize,
  quatRotate,
  quatToRotVec,
  type Quat,
  type Vec3,
} from '../src/lib/math3d';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe('math3d', () => {
  it('quatMul matches Hamilton product', () => {
    const qx = eulerToQuat([Math.PI / 2, 0, 0], 'xyz'); // 90° about x
    const v: Vec3 = [0, 1, 0];
    const r = quatRotate(qx, v);
    expect(close(r[0], 0)).toBe(true);
    expect(close(r[1], 0)).toBe(true);
    expect(close(r[2], 1)).toBe(true);
  });

  it('eulerToQuat composes in channel order (zyx)', () => {
    // R = Rz(90°) * Ry(90°): applied to +X axis -> Rz first maps... compose explicitly
    const q = eulerToQuat([Math.PI / 2, Math.PI / 2, 0], 'zyx');
    const manual = quatMul(
      eulerToQuat([Math.PI / 2, 0, 0], 'zxy'), // pure z rotation
      eulerToQuat([Math.PI / 2, 0, 0], 'yxz'), // pure y rotation
    );
    for (let i = 0; i < 4; i++) expect(close(q[i], manual[i])).toBe(true);
  });

  it('quatToRotVec inverts axis-angle', () => {
    const axis = quatNormalize([0, 0.26726, 0.53452, 0.80178] as Quat); // not a quat, reuse normalize
    const a: Vec3 = [axis[1], axis[2], axis[3]];
    const angle = 1.234;
    const q: Quat = [
      Math.cos(angle / 2),
      a[0] * Math.sin(angle / 2),
      a[1] * Math.sin(angle / 2),
      a[2] * Math.sin(angle / 2),
    ];
    const rv = quatToRotVec(q);
    const n = Math.hypot(rv[0], rv[1], rv[2]);
    expect(close(n, angle, 1e-7)).toBe(true);
    expect(close(rv[0] / n, a[0], 1e-7)).toBe(true);
  });

  it('quatFromMat3 matches the Y-up->Z-up conversion quaternion', () => {
    const q = quatFromMat3([
      [1, 0, 0],
      [0, 0, -1],
      [0, 1, 0],
    ]);
    // +90° about X
    expect(close(q[0], Math.SQRT1_2, 1e-9)).toBe(true);
    expect(close(q[1], Math.SQRT1_2, 1e-9)).toBe(true);
    // rotating (0,1,0) [bvh up] must give (0,0,1) [world up]
    const up = quatRotate(q, [0, 1, 0]);
    expect(close(up[2], 1, 1e-9)).toBe(true);
  });

  it('conjugate inverts rotations', () => {
    const q = eulerToQuat([0.3, -0.8, 1.1], 'zyx');
    const v: Vec3 = [0.2, -0.5, 0.9];
    const back = quatRotate(quatConj(q), quatRotate(q, v));
    for (let i = 0; i < 3; i++) expect(close(back[i], v[i], 1e-9)).toBe(true);
  });
});
