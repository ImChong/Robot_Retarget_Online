import { describe, expect, it } from 'vitest';
import { useChartZoom } from '@/composables/useChartZoom';

describe('useChartZoom', () => {
  it('starts unzoomed and resets', () => {
    const { zoom, isZoomed, reset, visibleYRange } = useChartZoom();
    expect(isZoomed.value).toBe(false);
    zoom.value = { x0: 0.2, x1: 0.8, yZoom: 2, yPan: 0.1 };
    expect(isZoomed.value).toBe(true);
    reset();
    expect(zoom.value).toEqual({ x0: 0, x1: 1, yZoom: 1, yPan: 0 });
  });

  it('applies y zoom around data center', () => {
    const { visibleYRange } = useChartZoom();
    const r = visibleYRange(0, 10);
    expect(r.lo).toBeCloseTo(0, 5);
    expect(r.hi).toBeCloseTo(10, 5);
  });

  it('maps frame to x with zoom window', () => {
    const { zoom, frameToX } = useChartZoom();
    zoom.value = { x0: 0, x1: 0.5, yZoom: 1, yPan: 0 };
    const pad = { l: 40, r: 8, t: 8, b: 18 };
    const xMid = frameToX(25, 101, 560, pad);
    expect(xMid).toBeGreaterThan(pad.l + 10);
    expect(xMid).toBeLessThan(560 - pad.r - 10);
  });
});
