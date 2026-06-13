import { computed, ref } from 'vue';

export interface ChartPadding {
  l: number;
  r: number;
  t: number;
  b: number;
}

export interface ChartZoomState {
  /** Visible frame range as fractions of [0, frameCount - 1]. */
  x0: number;
  x1: number;
  /** Y zoom factor (1 = fit data). */
  yZoom: number;
  /** Y pan offset in normalized data-range units (-1..1). */
  yPan: number;
}

const DEFAULT_ZOOM: ChartZoomState = { x0: 0, x1: 1, yZoom: 1, yPan: 0 };

export function useChartZoom() {
  const zoom = ref<ChartZoomState>({ ...DEFAULT_ZOOM });

  const isZoomed = computed(
    () =>
      zoom.value.x0 > 1e-6 ||
      zoom.value.x1 < 1 - 1e-6 ||
      zoom.value.yZoom > 1.001 ||
      Math.abs(zoom.value.yPan) > 1e-6,
  );

  function reset() {
    zoom.value = { ...DEFAULT_ZOOM };
  }

  function visibleYRange(lo: number, hi: number): { lo: number; hi: number } {
    const span = hi - lo || 1;
    const center = (lo + hi) / 2 + zoom.value.yPan * span * 0.5;
    const half = span / (2 * zoom.value.yZoom);
    return { lo: center - half, hi: center + half };
  }

  function frameToX(frame: number, frameCount: number, w: number, pad: ChartPadding): number {
    const innerW = w - pad.l - pad.r;
    const n = Math.max(frameCount - 1, 1);
    const f0 = zoom.value.x0 * n;
    const f1 = zoom.value.x1 * n;
    const span = f1 - f0 || 1;
    return pad.l + ((frame - f0) / span) * innerW;
  }

  function visibleFrameRange(frameCount: number): { f0: number; f1: number } {
    const n = Math.max(frameCount - 1, 1);
    return { f0: zoom.value.x0 * n, f1: zoom.value.x1 * n };
  }

  function onWheel(
    e: WheelEvent,
    rect: DOMRect,
    viewW: number,
    viewH: number,
    pad: ChartPadding,
    frameCount: number,
  ) {
    e.preventDefault();
    const sx = ((e.clientX - rect.left) / rect.width) * viewW;
    const sy = ((e.clientY - rect.top) / rect.height) * viewH;
    const factor = e.deltaY < 0 ? 0.9 : 1.1;

    const onYAxis = sx < pad.l;
    const onXAxis = sy > viewH - pad.b;

    if (onXAxis) {
      const n = Math.max(frameCount - 1, 1);
      const innerW = viewW - pad.l - pad.r;
      const rel = Math.max(0, Math.min(1, (sx - pad.l) / innerW));
      const f0 = zoom.value.x0 * n;
      const f1 = zoom.value.x1 * n;
      const anchor = f0 + rel * (f1 - f0);
      const span = (f1 - f0) * factor;
      const newF0 = Math.max(0, Math.min(anchor - rel * span, n - 0.001));
      const newF1 = Math.min(n, newF0 + span);
      zoom.value = {
        ...zoom.value,
        x0: newF0 / n,
        x1: newF1 / n,
      };
    } else if (onYAxis) {
      zoom.value = {
        ...zoom.value,
        yZoom: Math.max(1, Math.min(64, zoom.value.yZoom * factor)),
      };
    }
  }

  return { zoom, isZoomed, reset, visibleYRange, frameToX, visibleFrameRange, onWheel };
}
