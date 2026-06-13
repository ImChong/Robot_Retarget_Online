/** Min/max Y range for plotted series within a visible frame window, with padding. */
export function computeVisibleDataYRange(
  series: Float32Array[],
  frameCount: number,
  f0: number,
  f1: number,
): { lo: number; hi: number } {
  const fStart = Math.max(0, Math.floor(f0));
  const fEnd = Math.min(frameCount - 1, Math.ceil(f1));
  let lo = Infinity;
  let hi = -Infinity;

  for (const values of series) {
    for (let f = fStart; f <= fEnd; f++) {
      const v = values[f];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }

  if (!Number.isFinite(lo)) return { lo: 0, hi: 1 };
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }

  const pad = (hi - lo) * 0.1 || 1;
  return { lo: lo - pad, hi: hi + pad };
}
