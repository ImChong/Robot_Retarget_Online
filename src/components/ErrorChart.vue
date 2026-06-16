<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from '@/i18n';
import type { RetargetResult } from '@/lib/retarget/types';
import { usePlotlyChart } from '@/composables/usePlotlyChart';
import type { Data } from 'plotly.js';

const props = defineProps<{
  result: RetargetResult;
  /** current playback frame to draw a cursor at */
  frame?: number;
}>();

const { t } = useI18n();
const chartEl = ref<HTMLElement | null>(null);

const series = computed(() => {
  const { posErrors, frameCount, taskNames } = props.result;
  const nT = taskNames.length;
  const mean = new Float32Array(frameCount);
  const max = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    let sum = 0;
    let mx = 0;
    for (let k = 0; k < nT; k++) {
      const v = posErrors[f * nT + k];
      sum += v;
      if (v > mx) mx = v;
    }
    mean[f] = nT > 0 ? sum / nT : 0;
    max[f] = mx;
  }
  return { mean, max, frameCount };
});

const stats = computed(() => {
  const m = series.value.mean;
  let sum = 0;
  for (const v of m) sum += v;
  let mxAll = 0;
  for (const v of series.value.max) if (v > mxAll) mxAll = v;
  return { mean: m.length ? sum / m.length : 0, maxAll: mxAll };
});

function buildFigure() {
  const { mean, max, frameCount } = series.value;
  const x = Array.from({ length: frameCount }, (_, i) => i);
  const meanY = Array.from(mean, (v) => v * 100);
  const maxY = Array.from(max, (v) => v * 100);
  const data: Data[] = [
    {
      x,
      y: maxY,
      type: 'scatter',
      mode: 'lines',
      name: t('maxError'),
      line: { color: '#ef5350', width: 1 },
      opacity: 0.75,
      hovertemplate: `${t('frame')} %{x}<br>${t('maxError')}: %{y:.2f} cm<extra></extra>`,
    },
    {
      x,
      y: meanY,
      type: 'scatter',
      mode: 'lines',
      name: t('meanError'),
      line: { color: '#4fc3f7', width: 1.4 },
      hovertemplate: `${t('frame')} %{x}<br>${t('meanError')}: %{y:.2f} cm<extra></extra>`,
    },
  ];
  return {
    data,
    layout: {
      xaxis: { title: { text: t('frame') } },
      yaxis: { ticksuffix: ' cm' },
    },
  };
}

const { isZoomed, resetZoom, draw, resize } = usePlotlyChart(chartEl, buildFigure, toRef(props, 'frame'));

watch(series, () => {
  void draw();
});

defineExpose({ resetZoom, isZoomed, resize });
</script>

<template>
  <div class="chart-root">
    <div class="d-flex align-center ga-4 mb-1 text-caption chart-toolbar">
      <span><span class="legend mean" /> {{ t('meanError') }}: {{ (stats.mean * 100).toFixed(2) }} cm</span>
      <span><span class="legend max" /> {{ t('maxError') }}: {{ (stats.maxAll * 100).toFixed(2) }} cm</span>
    </div>
    <div ref="chartEl" class="chart" />
  </div>
</template>

<style scoped>
.chart-root {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.chart {
  flex: 1 1 0;
  width: 100%;
  min-height: 120px;
  border-radius: 6px;
  overflow: hidden;
}
.chart-toolbar {
  flex-shrink: 0;
  min-height: 20px;
}
.legend {
  display: inline-block;
  width: 14px;
  height: 3px;
  vertical-align: middle;
  margin-right: 4px;
}
.legend.mean {
  background: #4fc3f7;
}
.legend.max {
  background: #ef5350;
}
</style>
