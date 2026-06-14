/**
 * Temporal smoothing for pose sequences.
 *
 * BlazePose world landmarks jitter frame-to-frame (depth especially). A
 * One-Euro filter (Casiez et al., 2012) cuts jitter while keeping fast motion
 * responsive — low cutoff when slow, higher cutoff when moving. Low-visibility
 * landmarks hold their last confident position so dropouts don't inject spikes.
 */

import type { Vec3 } from '../math3d';
import { NUM_LANDMARKS, type PoseFrame } from './types';

class OneEuro {
  private xPrev = 0;
  private dxPrev = 0;
  private started = false;
  constructor(
    private readonly freq: number,
    private readonly minCutoff = 1.0,
    private readonly beta = 0.0,
    private readonly dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    const te = 1 / this.freq;
    return 1 / (1 + tau / te);
  }

  filter(x: number): number {
    if (!this.started) {
      this.started = true;
      this.xPrev = x;
      this.dxPrev = 0;
      return x;
    }
    const dx = (x - this.xPrev) * this.freq;
    const aD = this.alpha(this.dCutoff);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }
}

export interface SmoothingOptions {
  minCutoff?: number;
  beta?: number;
  /** Below this visibility, a landmark holds its last confident position. */
  minVisibility?: number;
}

/**
 * Smooth every landmark coordinate over time. Returns a new array; inputs are
 * not mutated. Visibility values are passed through unchanged.
 */
export function smoothPoseSequence(
  frames: PoseFrame[],
  fps: number,
  opts: SmoothingOptions = {},
): PoseFrame[] {
  const minCutoff = opts.minCutoff ?? 1.2;
  const beta = opts.beta ?? 0.03;
  const minVis = opts.minVisibility ?? 0.3;
  const freq = fps > 0 ? fps : 30;

  // One filter per (landmark, axis).
  const filters: OneEuro[][] = Array.from({ length: NUM_LANDMARKS }, () =>
    Array.from({ length: 3 }, () => new OneEuro(freq, minCutoff, beta)),
  );
  const lastGood: Vec3[] = Array.from({ length: NUM_LANDMARKS }, () => [0, 0, 0]);
  const seen = new Array(NUM_LANDMARKS).fill(false);

  return frames.map((frame) => {
    const world: Vec3[] = new Array(NUM_LANDMARKS);
    for (let i = 0; i < NUM_LANDMARKS; i++) {
      const vis = frame.visibility[i] ?? 1;
      const raw = frame.world[i] ?? [0, 0, 0];
      const src: Vec3 = vis >= minVis || !seen[i] ? raw : lastGood[i];
      const sm: Vec3 = [
        filters[i][0].filter(src[0]),
        filters[i][1].filter(src[1]),
        filters[i][2].filter(src[2]),
      ];
      if (vis >= minVis) {
        lastGood[i] = sm;
        seen[i] = true;
      }
      world[i] = sm;
    }
    return { world, visibility: frame.visibility.slice() };
  });
}
