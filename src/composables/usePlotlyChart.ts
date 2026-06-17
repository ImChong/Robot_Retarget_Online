import { onMounted, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue';
import type { Config, Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import { buildDarkLayout, frameCursorShape } from '@/lib/plotlyTheme';
import { isCoarsePointerDevice } from '@/lib/plotlyTouch';

type PlotlyModule = typeof import('plotly.js-dist-min');

let plotlyLoad: Promise<PlotlyModule> | null = null;

function loadPlotly(): Promise<PlotlyModule> {
  if (!plotlyLoad) plotlyLoad = import('plotly.js-dist-min');
  return plotlyLoad;
}

function buildPlotConfig(): Partial<Config> {
  const touch = isCoarsePointerDevice();
  return {
    responsive: true,
    displayModeBar: false,
    scrollZoom: !touch,
    // Touch: disable double-tap zoom so Plotly does not keep a full-viewport drag layer active.
    doubleClick: touch ? false : 'reset+autosize',
  };
}

export function usePlotlyChart(
  elRef: Ref<HTMLElement | null>,
  buildFigure: () => { data: Data[]; layout?: Partial<Layout> },
  frameRef?: Ref<number | undefined>,
) {
  const isZoomed = ref(false);
  const plotly = shallowRef<PlotlyModule['default'] | null>(null);
  const plotEl = shallowRef<PlotlyHTMLElement | null>(null);
  let ro: ResizeObserver | null = null;
  let lastCursorFrame = Number.NaN;

  function onRelayout(ev: Record<string, unknown>) {
    if (ev['xaxis.autorange'] === true || ev['yaxis.autorange'] === true) {
      isZoomed.value = false;
      return;
    }
    if ('xaxis.range[0]' in ev || 'yaxis.range[0]' in ev) {
      isZoomed.value = true;
    }
  }

  async function draw() {
    const el = elRef.value;
    if (!el) return;
    const mod = await loadPlotly();
    plotly.value = mod.default;
    const { data, layout } = buildFigure();
    const touch = isCoarsePointerDevice();
    const merged = buildDarkLayout({
      ...layout,
      dragmode: touch ? false : (layout?.dragmode ?? 'zoom'),
    });
    const config = buildPlotConfig();
    if (plotEl.value === el && (el as PlotlyHTMLElement).data) {
      await mod.default.react(el, data, merged, config);
    } else {
      await mod.default.newPlot(el, data, merged, config);
      plotEl.value = el as PlotlyHTMLElement;
      (el as PlotlyHTMLElement).on('plotly_relayout', onRelayout as Parameters<PlotlyHTMLElement['on']>[1]);
      (el as PlotlyHTMLElement).on('plotly_doubleclick', () => {
        isZoomed.value = false;
      });
    }
    await syncCursor();
  }

  async function syncCursor() {
    const frame = frameRef?.value;
    if (frame === lastCursorFrame) return;
    lastCursorFrame = frame ?? Number.NaN;
    const el = elRef.value;
    const P = plotly.value;
    if (!el || !P) return;
    const shapes = frame === undefined ? [] : [frameCursorShape(frame)];
    await P.relayout(el, { shapes });
  }

  async function resetZoom() {
    const el = elRef.value;
    const P = plotly.value;
    if (!el || !P) return;
    await P.relayout(el, { 'xaxis.autorange': true, 'yaxis.autorange': true });
    isZoomed.value = false;
  }

  function resize() {
    const el = elRef.value;
    const P = plotly.value;
    if (!el || !P) return;
    P.Plots.resize(el);
  }

  onMounted(async () => {
    await draw();
    const el = elRef.value;
    if (el) {
      ro = new ResizeObserver(() => resize());
      ro.observe(el);
    }
  });

  onUnmounted(() => {
    ro?.disconnect();
    const el = elRef.value;
    const P = plotly.value;
    if (el && P) P.purge(el);
    plotEl.value = null;
  });

  if (frameRef) {
    watch(frameRef, () => {
      void syncCursor();
    });
  }

  return { isZoomed, resetZoom, draw, resize };
}
