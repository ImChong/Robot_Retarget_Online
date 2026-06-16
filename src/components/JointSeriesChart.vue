<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from '@/i18n';
import type { RetargetResult } from '@/lib/retarget/types';
import { usePlotlyChart } from '@/composables/usePlotlyChart';
import type { Data } from 'plotly.js';

const props = defineProps<{
  result: RetargetResult;
  /** Joint names to plot (must exist in result.dofNames). */
  joints: string[];
  mode: 'position' | 'velocity';
  unit: 'deg' | 'rad';
  frame?: number;
}>();

const { t } = useI18n();
const chartEl = ref<HTMLElement | null>(null);

const COLORS = ['#4fc3f7', '#81c784', '#ffb74d', '#ba68c8', '#ef5350', '#4dd0e1'];
const RAD2DEG = 180 / Math.PI;

const unitScale = computed(() => (props.unit === 'deg' ? RAD2DEG : 1));

const jointIndices = computed(() => {
  const { dofNames } = props.result;
  return props.joints
    .map((name) => dofNames.indexOf(name))
    .filter((i) => i >= 0);
});

const series = computed(() => {
  const { qpos, frameCount, nq, fps } = props.result;
  const indices = jointIndices.value;
  const scale = unitScale.value;
  const out: { name: string; values: Float32Array }[] = [];

  for (let s = 0; s < indices.length; s++) {
    const dof = 7 + indices[s];
    const values = new Float32Array(frameCount);

    if (props.mode === 'position') {
      for (let f = 0; f < frameCount; f++) {
        values[f] = qpos[f * nq + dof] * scale;
      }
    } else {
      for (let f = 0; f < frameCount; f++) {
        const next = Math.min(f + 1, frameCount - 1);
        const v = (qpos[next * nq + dof] - qpos[f * nq + dof]) * fps * scale;
        values[f] = v;
      }
    }
    out.push({ name: props.joints[s], values });
  }
  return { items: out, frameCount };
});

const yUnit = computed(() => {
  if (props.mode === 'position') return props.unit === 'deg' ? '°' : ' rad';
  return props.unit === 'deg' ? '°/s' : ' rad/s';
});

function shortName(name: string): string {
  return name.replace(/_joint$/, '').replace(/^left_/, 'L_').replace(/^right_/, 'R_');
}

function formatHoverValue(v: number): string {
  if (props.unit === 'deg') return v.toFixed(1);
  return props.mode === 'position' ? v.toFixed(3) : v.toFixed(2);
}

function buildFigure() {
  const { items, frameCount } = series.value;
  const x = Array.from({ length: frameCount }, (_, i) => i);
  const unit = yUnit.value;
  const data: Data[] = items.map((s, i) => {
    const label = shortName(s.name);
    const color = COLORS[i % COLORS.length];
    return {
      x,
      y: Array.from(s.values),
      type: 'scatter',
      mode: 'lines',
      name: label,
      line: { color, width: 1.3 },
      hovertemplate: `${t('frame')} %{x}<br>${label}: %{customdata}${unit}<extra></extra>`,
      customdata: Array.from(s.values, (v) => formatHoverValue(v)),
    };
  });
  return {
    data,
    layout: {
      xaxis: { title: { text: t('frame') } },
      yaxis: { ticksuffix: unit },
    },
  };
}

const { isZoomed, resetZoom, draw, resize } = usePlotlyChart(chartEl, buildFigure, toRef(props, 'frame'));

watch([series, () => props.mode, () => props.unit], () => {
  void draw();
});

defineExpose({ resetZoom, isZoomed, resize });
</script>

<template>
  <div class="chart-root">
    <div v-if="series.items.length" class="d-flex flex-wrap align-center ga-3 mb-1 text-caption chart-toolbar">
      <span v-for="(s, i) in series.items" :key="s.name">
        <span class="legend" :style="{ background: COLORS[i % COLORS.length] }" />
        {{ shortName(s.name) }}
      </span>
    </div>
    <div v-if="!series.items.length" class="text-caption text-disabled mb-1">{{ t('selectJointsHint') }}</div>
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
</style>
