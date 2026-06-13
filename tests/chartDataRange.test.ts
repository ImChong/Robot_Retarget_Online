import { describe, expect, it } from 'vitest';
import { computeVisibleDataYRange } from '@/lib/chartDataRange';

describe('computeVisibleDataYRange', () => {
  it('fits min/max of visible frames with padding', () => {
    const a = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const b = new Float32Array([0.15, 0.25, 0.35, 0.45]);
    const r = computeVisibleDataYRange([a, b], 4, 1, 2);
    expect(r.lo).toBeCloseTo(0.185, 3);
    expect(r.hi).toBeCloseTo(0.365, 3);
  });

  it('uses the full series when the frame window spans all frames', () => {
    const values = new Float32Array([0.08, 0.12, 0.1]);
    const r = computeVisibleDataYRange([values], 3, 0, 2);
    expect(r.lo).toBeCloseTo(0.076, 3);
    expect(r.hi).toBeCloseTo(0.124, 3);
  });

  it('returns a default range when no samples exist', () => {
    expect(computeVisibleDataYRange([], 0, 0, 0)).toEqual({ lo: 0, hi: 1 });
  });
});
