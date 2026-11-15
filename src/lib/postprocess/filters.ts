import type { SmoothingMethod } from './types';

export interface WindowTap {
  index: number;
  weight: number;
}

const sgKernelCache = new Map<string, number[]>();

/** Solve A x = b for small dense square matrix A (row-major n x n) via partial pivoting. */
function solveLinearSmall(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > maxVal) {
        maxVal = v;
        pivot = r;
      }
    }
    if (maxVal < 1e-12) return null;
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    const diag = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= diag;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * Compute Savitzky-Golay evaluation weights at offset 0 for arbitrary relative
 * integer offsets (including asymmetric boundary windows).
 */
export function savitzkyGolayWeights(offsets: number[], polyOrder: number): number[] {
  const m = offsets.length;
  if (m === 0) return [];
  if (m === 1) return [1];
  const p = Math.max(0, Math.min(polyOrder, m - 1));
  const key = `${offsets[0]}:${offsets[m - 1]}:${m}:${p}`;
  const cached = sgKernelCache.get(key);
  if (cached) return cached;

  const cols = p + 1;
  const ata: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0));
  for (let r = 0; r < m; r++) {
    const x = offsets[r];
    let xp = 1;
    const powers = new Array(cols);
    for (let c = 0; c < cols; c++) {
      powers[c] = xp;
      xp *= x;
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < cols; j++) {
        ata[i][j] += powers[i] * powers[j];
      }
    }
  }

  const e0 = new Array(cols).fill(0);
  e0[0] = 1;
  const c = solveLinearSmall(ata, e0);
  if (!c) {
    const uniform = new Array(m).fill(1 / m);
    sgKernelCache.set(key, uniform);
    return uniform;
  }

  const weights = offsets.map((x) => {
    let w = 0;
    let xp = 1;
    for (let k = 0; k < cols; k++) {
      w += c[k] * xp;
      xp *= x;
    }
    return w;
  });
  sgKernelCache.set(key, weights);
  return weights;
}

export function buildWindowTapGetter(
  method: Exclude<SmoothingMethod, 'one_euro'>,
  windowSize: number,
  polyOrder: number,
  gaussianSigma: number,
): (center: number, length: number) => WindowTap[] {
  const win = Math.max(3, windowSize | 1);
  const half = Math.floor(win / 2);

  return (center: number, length: number): WindowTap[] => {
    const lo = Math.max(0, center - half);
    const hi = Math.min(length - 1, center + half);
    const offsets: number[] = [];
    for (let idx = lo; idx <= hi; idx++) offsets.push(idx - center);

    if (method === 'moving_average') {
      const w = 1 / offsets.length;
      return offsets.map((off) => ({ index: center + off, weight: w }));
    }

    if (method === 'gaussian') {
      const sigma = Math.max(0.25, gaussianSigma);
      const raw = offsets.map((off) => Math.exp(-(off * off) / (2 * sigma * sigma)));
      const sum = raw.reduce((a, b) => a + b, 0) || 1;
      return offsets.map((off, i) => ({ index: center + off, weight: raw[i] / sum }));
    }

    const weights = savitzkyGolayWeights(offsets, polyOrder);
    return offsets.map((off, i) => ({ index: center + off, weight: weights[i] }));
  };
}

function alphaFromCutoff(cutoff: number, freq: number): number {
  const tau = 1 / (2 * Math.PI * Math.max(1e-4, cutoff));
  const te = 1 / Math.max(1e-4, freq);
  return 1 / (1 + tau / te);
}

function causalOneEuro1D(values: Float64Array, fps: number, minCutoff: number, beta: number): Float64Array {
  const T = values.length;
  const out = new Float64Array(T);
  if (T === 0) return out;
  const freq = fps > 0 ? fps : 30;
  let started = false;
  let xPrev = 0;
  let dxPrev = 0;
  const dCutoff = 1.0;

  for (let i = 0; i < T; i++) {
    const x = values[i];
    if (!Number.isFinite(x)) {
      out[i] = x;
      continue;
    }
    if (!started) {
      started = true;
      xPrev = x;
      dxPrev = 0;
      out[i] = x;
      continue;
    }
    const dx = (x - xPrev) * freq;
    const aD = alphaFromCutoff(dCutoff, freq);
    const dxHat = aD * dx + (1 - aD) * dxPrev;
    const cutoff = minCutoff + beta * Math.abs(dxHat);
    const a = alphaFromCutoff(cutoff, freq);
    const xHat = a * x + (1 - a) * xPrev;
    xPrev = xHat;
    dxPrev = dxHat;
    out[i] = xHat;
  }
  return out;
}

/** Zero-phase (forward + backward) 1D One-Euro filter. */
export function zeroPhaseOneEuro1D(
  values: Float64Array,
  fps: number,
  minCutoff: number,
  beta: number,
): Float64Array {
  const fwd = causalOneEuro1D(values, fps, minCutoff, beta);
  const revIn = new Float64Array(fwd.length);
  for (let i = 0; i < fwd.length; i++) revIn[i] = fwd[fwd.length - 1 - i];
  const revOut = causalOneEuro1D(revIn, fps, minCutoff, beta);
  const out = new Float64Array(fwd.length);
  for (let i = 0; i < out.length; i++) out[i] = revOut[out.length - 1 - i];
  return out;
}

/** Apply a weighted window filter to a 1D sequence, skipping non-finite samples safely. */
export function smoothSeries1D(
  values: Float64Array,
  fps: number,
  method: SmoothingMethod,
  options: { windowSize: number; polyOrder: number; gaussianSigma: number; oneEuroMinCutoff: number; oneEuroBeta: number },
): Float64Array {
  const T = values.length;
  if (T <= 2) return new Float64Array(values);
  if (method === 'one_euro') {
    return zeroPhaseOneEuro1D(values, fps, options.oneEuroMinCutoff, options.oneEuroBeta);
  }
  const getTaps = buildWindowTapGetter(
    method,
    options.windowSize,
    options.polyOrder,
    options.gaussianSigma,
  );
  const out = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    if (!Number.isFinite(values[t])) {
      out[t] = values[t];
      continue;
    }
    const taps = getTaps(t, T).filter((tap) => Number.isFinite(values[tap.index]));
    if (taps.length === 0) {
      out[t] = values[t];
      continue;
    }
    let wSum = 0;
    let acc = 0;
    for (const tap of taps) {
      wSum += tap.weight;
      acc += tap.weight * values[tap.index];
    }
    out[t] = Math.abs(wSum) > 1e-8 ? acc / wSum : values[t];
  }
  return out;
}

/**
 * Local cubic Hermite (Catmull-Rom) / linear interpolation across an outlier gap `[start, end]`.
 * Uses neighboring clean frames `start - 1` and `end + 1` (plus `start - 2` and `end + 2` for tangents).
 */
export function interpolateGap1D(
  values: Float64Array,
  start: number,
  end: number,
  isBad: (idx: number) => boolean,
): boolean {
  const T = values.length;
  let left = start - 1;
  while (left >= 0 && (isBad(left) || !Number.isFinite(values[left]))) left--;
  let right = end + 1;
  while (right < T && (isBad(right) || !Number.isFinite(values[right]))) right++;

  if (left < 0 && right >= T) return false;
  if (left < 0) {
    // Leading gap: extrapolate linearly if two right points exist, else clamp to right.
    const r2 = right + 1 < T && !isBad(right + 1) && Number.isFinite(values[right + 1]) ? right + 1 : -1;
    for (let f = start; f <= end; f++) {
      values[f] = r2 >= 0 ? values[right] - (values[r2] - values[right]) * (right - f) : values[right];
    }
    return true;
  }
  if (right >= T) {
    const l2 = left - 1 >= 0 && !isBad(left - 1) && Number.isFinite(values[left - 1]) ? left - 1 : -1;
    for (let f = start; f <= end; f++) {
      values[f] = l2 >= 0 ? values[left] + (values[left] - values[l2]) * (f - left) : values[left];
    }
    return true;
  }

  const p0 = values[left];
  const p1 = values[right];
  const span = right - left;
  const hasLeft2 = left - 1 >= 0 && !isBad(left - 1) && Number.isFinite(values[left - 1]);
  const hasRight2 = right + 1 < T && !isBad(right + 1) && Number.isFinite(values[right + 1]);

  if (hasLeft2 && hasRight2) {
    // Catmull-Rom / cubic Hermite with finite-difference tangents scaled to span.
    const m0 = 0.5 * ((p1 - p0) + (p0 - values[left - 1]));
    const m1 = 0.5 * ((values[right + 1] - p1) + (p1 - p0));
    for (let f = start; f <= end; f++) {
      const s = (f - left) / span;
      const s2 = s * s;
      const s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1;
      const h10 = s3 - 2 * s2 + s;
      const h01 = -2 * s3 + 3 * s2;
      const h11 = s3 - s2;
      values[f] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
    }
  } else {
    for (let f = start; f <= end; f++) {
      const s = (f - left) / span;
      values[f] = p0 + (p1 - p0) * s;
    }
  }
  return true;
}
