<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from '@/i18n';
import type { RetargetResult } from '@/lib/retarget/types';
import { usePlotlyChart } from '@/composables/usePlotlyChart';
import type { Data } from 'plotly.js';
import { ERROR_SERIES_MEAN, ERROR_SERIES_MAX } from './errorChartConstants';

const props = defineProps<{
  result: RetargetResult;
  /** Selected series: aggregate sentinels and/or taskNames from result.taskNames. */
  series: string[];
  /** current playback frame to draw a cursor at */
  frame?: number;
}>();

const { t } = useI18n();
const chartEl = ref<HTMLElement | null>(null);

const COLORS = ['#81c784', '#ffb74d', '#ba68c8', '#4dd0e1', '#a1887f', '#90a4ae'];
const MEAN_COLOR = '#4fc3f7';
const MAX_COLOR = '#ef5350';

const aggregates = computed(() => {
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

const plottedSeries = computed(() => {
  const { posErrors, frameCount, taskNames } = props.result;
  const nT = taskNames.length;
  const { mean, max } = aggregates.value;
  const out: { id: string; label: string; values: Float32Array; color: string }[] = [];
  let colorIdx = 0;

  for (const id of props.series) {
    if (id === ERROR_SERIES_MEAN) {
      out.push({ id, label: t('meanError'), values: mean, color: MEAN_COLOR });
      continue;
    }
    if (id === ERROR_SERIES_MAX) {
      out.push({ id, label: t('maxError'), values: max, color: MAX_COLOR });
      continue;
    }
    const taskIdx = taskNames.indexOf(id);
    if (taskIdx < 0) continue;
    const values = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      values[f] = posErrors[f * nT + taskIdx];
    }
    out.push({
      id,
      label: shortName(id),
      values,
      color: COLORS[colorIdx++ % COLORS.length],
    });
  }
  return { items: out, frameCount };
});

function shortName(name: string): string {
  return name.replace(/_link$/, '').replace(/^left_/, 'L_').replace(/^right_/, 'R_');
}

function buildFigure() {
  const { items, frameCount } = plottedSeries.value;
  const x = Array.from({ length: frameCount }, (_, i) => i);
  const data: Data[] = items.map((s) => ({
    x,
    y: Array.from(s.values, (v) => v * 100),
    type: 'scatter',
    mode: 'lines',
    name: s.label,
    line: { color: s.color, width: s.id === ERROR_SERIES_MEAN ? 1.4 : 1.3 },
    opacity: s.id === ERROR_SERIES_MAX ? 0.75 : 1,
    hovertemplate: `${t('frame')} %{x}<br>${s.label}: %{y:.2f} cm<extra></extra>`,
  }));
  return {
    data,
    layout: {
      xaxis: { title: { text: t('frame') } },
      yaxis: { ticksuffix: ' cm' },
    },
  };
}

const { isZoomed, resetZoom, draw, resize } = usePlotlyChart(chartEl, buildFigure, toRef(props, 'frame'));

watch([plottedSeries, () => props.series], () => {
  void draw();
});

defineExpose({ resetZoom, isZoomed, resize });
</script>

<template>
  <div class="chart-root">
    <div v-if="!plottedSeries.items.length" class="text-caption text-disabled mb-1">{{ t('selectKeypointsHint') }}</div>
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
</style>
