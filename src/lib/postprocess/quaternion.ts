import { quatConj, quatMul, quatNormalize, quatToRotVec, type Quat, type Vec3 } from '../math3d';

export function isQuatFinite(q: readonly number[]): boolean {
  return (
    Number.isFinite(q[0]) &&
    Number.isFinite(q[1]) &&
    Number.isFinite(q[2]) &&
    Number.isFinite(q[3])
  );
}

export function quatNorm(q: readonly number[]): number {
  return Math.hypot(q[0], q[1], q[2], q[3]);
}

export function quatDot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/** Shortest-arc geodesic angle (radians in [0, pi]) between two quaternions. */
export function quatGeodesicAngle(a: Quat, b: Quat): number {
  const na = quatNormalize(a);
  const nb = quatNormalize(b);
  const absDot = Math.min(1, Math.abs(quatDot(na, nb)));
  return 2 * Math.acos(absDot);
}

/** Exponential map from so(3) rotation vector (axis * angle) to unit quaternion [w,x,y,z]. */
export function quatExp(rv: Vec3): Quat {
  const theta = Math.hypot(rv[0], rv[1], rv[2]);
  if (theta < 1e-12) {
    return quatNormalize([1, 0.5 * rv[0], 0.5 * rv[1], 0.5 * rv[2]]);
  }
  const half = 0.5 * theta;
  const s = Math.sin(half) / theta;
  return [Math.cos(half), rv[0] * s, rv[1] * s, rv[2] * s];
}

/** Shortest-arc SLERP between two unit-ish [w,x,y,z] quaternions. */
export function quatSlerp(aIn: Quat, bIn: Quat, t: number): Quat {
  const a = quatNormalize(aIn);
  let b = quatNormalize(bIn);
  let dot = quatDot(a, b);
  if (dot < 0) {
    b = [-b[0], -b[1], -b[2], -b[3]];
    dot = -dot;
  }
  if (dot > 0.9995) {
    return quatNormalize([
      a[0] + t * (b[0] - a[0]),
      a[1] + t * (b[1] - a[1]),
      a[2] + t * (b[2] - a[2]),
      a[3] + t * (b[3] - a[3]),
    ]);
  }
  const theta0 = Math.acos(Math.min(1, dot));
  const theta = theta0 * t;
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - (dot * Math.sin(theta)) / sinTheta0;
  const s1 = Math.sin(theta) / sinTheta0;
  return quatNormalize([
    s0 * a[0] + s1 * b[0],
    s0 * a[1] + s1 * b[1],
    s0 * a[2] + s1 * b[2],
    s0 * a[3] + s1 * b[3],
  ]);
}

/**
 * Normalize quaternions and align consecutive signs (`dot >= 0`) so the sequence
 * stays on a continuous cover of S^3 without antipodal flips.
 */
export function canonicalizeQuatSequence(quats: Quat[]): {
  quats: Quat[];
  normFixedCount: number;
  signFlippedCount: number;
} {
  const out: Quat[] = new Array(quats.length);
  let normFixedCount = 0;
  let signFlippedCount = 0;
  let prevValid: Quat | null = null;

  for (let i = 0; i < quats.length; i++) {
    const q = quats[i];
    if (!isQuatFinite(q)) {
      out[i] = [...q] as Quat;
      continue;
    }
    const n = quatNorm(q);
    if (n < 1e-8) {
      out[i] = [...q] as Quat;
      continue;
    }
    let unit: Quat = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
    if (Math.abs(n - 1) > 1e-5) normFixedCount++;
    if (prevValid && quatDot(prevValid, unit) < 0) {
      unit = [-unit[0], -unit[1], -unit[2], -unit[3]];
      signFlippedCount++;
    }
    prevValid = unit;
    out[i] = unit;
  }

  return { quats: out, normFixedCount, signFlippedCount };
}

/**
 * Intrinsic SO(3) tangent-space weighted smoothing (Fréchet/Karcher mean per frame).
 * Weights can be positive (Gaussian / Moving Average) or signed (Savitzky-Golay)
 * as long as they sum to ~1.
 */
export function smoothQuatSequenceSO3(
  quats: Quat[],
  getWeights: (center: number, length: number) => Array<{ index: number; weight: number }>,
): Quat[] {
  const T = quats.length;
  if (T === 0) return [];
  const out: Quat[] = new Array(T);

  for (let t = 0; t < T; t++) {
    const center = quats[t];
    if (!isQuatFinite(center) || quatNorm(center) < 1e-8) {
      out[t] = [...center] as Quat;
      continue;
    }
    let ref = quatNormalize(center);
    const taps = getWeights(t, T).filter(
      ({ index }) => isQuatFinite(quats[index]) && quatNorm(quats[index]) >= 1e-8,
    );
    if (taps.length === 0) {
      out[t] = ref;
      continue;
    }
    let weightSum = 0;
    for (const tap of taps) weightSum += tap.weight;
    if (Math.abs(weightSum) < 1e-8) {
      out[t] = ref;
      continue;
    }

    // Two Karcher iterations converge rapidly on the Riemannian manifold SO(3).
    for (let iter = 0; iter < 2; iter++) {
      const invRef = quatConj(ref);
      let dx = 0;
      let dy = 0;
      let dz = 0;
      for (const { index, weight } of taps) {
        const w = weight / weightSum;
        let qk = quatNormalize(quats[index]);
        if (quatDot(ref, qk) < 0) qk = [-qk[0], -qk[1], -qk[2], -qk[3]];
        const rel = quatMul(invRef, qk);
        const rv = quatToRotVec(rel);
        dx += w * rv[0];
        dy += w * rv[1];
        dz += w * rv[2];
      }
      ref = quatNormalize(quatMul(ref, quatExp([dx, dy, dz])));
      if (dx * dx + dy * dy + dz * dz < 1e-16) break;
    }

    if (t > 0 && isQuatFinite(out[t - 1]) && quatDot(out[t - 1], ref) < 0) {
      ref = [-ref[0], -ref[1], -ref[2], -ref[3]];
    }
    out[t] = ref;
  }

  return out;
}

function oneEuroAlpha(cutoff: number, freq: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(1e-4, cutoff));
  const te = 1 / Math.max(1e-4, freq);
  return 1 / (1 + tau / te);
}

function causalSlerpOneEuro(quats: Quat[], fps: number, minCutoff: number, beta: number): Quat[] {
  const T = quats.length;
  if (T === 0) return [];
  const freq = fps > 0 ? fps : 30;
  const out: Quat[] = new Array(T);
  let qHat: Quat | null = null;
  let speedHat = 0;
  const dCutoff = 1.0;

  for (let t = 0; t < T; t++) {
    const raw = quats[t];
    if (!isQuatFinite(raw) || quatNorm(raw) < 1e-8) {
      out[t] = [...raw] as Quat;
      continue;
    }
    const q = quatNormalize(raw);
    if (!qHat) {
      qHat = q;
      out[t] = q;
      continue;
    }
    const speed = quatGeodesicAngle(qHat, q) * freq;
    const aD = oneEuroAlpha(dCutoff, freq);
    speedHat = aD * speed + (1 - aD) * speedHat;
    const cutoff = minCutoff + beta * speedHat;
    const a = oneEuroAlpha(cutoff, freq);
    qHat = quatSlerp(qHat, q, a);
    out[t] = qHat;
  }
  return out;
}

/**
 * Zero-phase (forward + backward) geodesic One-Euro filter on SO(3).
 * Preserves quaternion unit norm, handles antipodal equivalence, and avoids phase lag.
 */
export function smoothQuatOneEuroSO3(
  quats: Quat[],
  fps: number,
  minCutoff: number,
  beta: number,
): Quat[] {
  const fwd = causalSlerpOneEuro(quats, fps, minCutoff, beta);
  const rev = causalSlerpOneEuro([...fwd].reverse(), fps, minCutoff, beta).reverse();
  const out: Quat[] = new Array(quats.length);
  for (let i = 0; i < rev.length; i++) {
    let q = rev[i];
    if (i > 0 && isQuatFinite(out[i - 1]) && isQuatFinite(q) && quatDot(out[i - 1], q) < 0) {
      q = [-q[0], -q[1], -q[2], -q[3]];
    }
    out[i] = q;
  }
  return out;
}
