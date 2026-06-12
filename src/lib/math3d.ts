/**
 * Minimal 3D math utilities.
 *
 * Conventions (matching GMR / MuJoCo):
 * - Quaternions are [w, x, y, z] (scalar-first), Hamilton product.
 * - Vectors are [x, y, z].
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // w x y z

export const QUAT_IDENTITY: Quat = [1, 0, 0, 0];

export function vAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vScale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vDot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vCross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function vNorm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Hamilton product a ⊗ b, both [w,x,y,z]. */
export function quatMul(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

/** Conjugate (= inverse for unit quaternions). */
export function quatConj(q: Quat): Quat {
  return [q[0], -q[1], -q[2], -q[3]];
}

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotate vector v by unit quaternion q. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  // v' = v + w*t + cross(q.xyz, t)
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  return [Math.cos(h), axis[0] * s, axis[1] * s, axis[2] * s];
}

const EULER_AXES: Record<string, Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

/**
 * Euler angles (radians) -> quaternion, matching LAFAN1 vendor code:
 * q = R(axis order[0], e0) ⊗ R(axis order[1], e1) ⊗ R(axis order[2], e2)
 * where `order` is the rotation-channel order from the BVH file (e.g. "zyx").
 */
export function eulerToQuat(e: Vec3, order: string): Quat {
  const q0 = quatFromAxisAngle(EULER_AXES[order[0]], e[0]);
  const q1 = quatFromAxisAngle(EULER_AXES[order[1]], e[1]);
  const q2 = quatFromAxisAngle(EULER_AXES[order[2]], e[2]);
  return quatMul(q0, quatMul(q1, q2));
}

/** Rotation-vector (axis-angle, length = angle) from unit quaternion. */
export function quatToRotVec(q: Quat): Vec3 {
  let [w, x, y, z] = q;
  if (w < 0) {
    w = -w;
    x = -x;
    y = -y;
    z = -z;
  }
  const sinHalf = Math.hypot(x, y, z);
  if (sinHalf < 1e-12) return [2 * x, 2 * y, 2 * z];
  const angle = 2 * Math.atan2(sinHalf, Math.min(w, 1));
  const s = angle / sinHalf;
  return [x * s, y * s, z * s];
}

/** Quaternion from 3x3 rotation matrix (row-major rows m0..m2). */
export function quatFromMat3(m: number[][]): Quat {
  const trace = m[0][0] + m[1][1] + m[2][2];
  let w: number, x: number, y: number, z: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = s / 4;
    x = (m[2][1] - m[1][2]) / s;
    y = (m[0][2] - m[2][0]) / s;
    z = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[2][1] - m[1][2]) / s;
    x = s / 4;
    y = (m[0][1] + m[1][0]) / s;
    z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[0][2] - m[2][0]) / s;
    x = (m[0][1] + m[1][0]) / s;
    y = s / 4;
    z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[1][0] - m[0][1]) / s;
    x = (m[0][2] + m[2][0]) / s;
    y = (m[1][2] + m[2][1]) / s;
    z = s / 4;
  }
  return quatNormalize([w, x, y, z]);
}
