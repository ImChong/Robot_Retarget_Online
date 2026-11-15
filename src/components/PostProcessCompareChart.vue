<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import type { RetargetResult } from '@/lib/retarget/types';
import type { MotionAnomaly } from '@/lib/postprocess';
import { quatGeodesicAngle } from '@/lib/postprocess';
import type { Quat } from '@/lib/math3d';
import { usePlotlyChart } from '@/composables/usePlotlyChart';
import type { Data } from 'plotly.js';

export type CompareChartMode = 'position' | 'velocity' | 'acceleration' | 'root_pos' | 'root_speed';

const props = defineProps<{
  raw: RetargetResult;
  processed: RetargetResult;
  joints: string[];
  mode: CompareChartMode;
  unit: 'deg' | 'rad';
  anomalies: MotionAnomaly[];
  frame?: number;
}>();

const { t } = useI18n();
const { mdAndUp } = useDisplay();
const chartEl = ref<HTMLElement | null>(null);

const COLORS = ['#4fc3f7', '#81c784', '#ffb74d', '#ba68c8', '#ef5350', '#4dd0e1'];
const RAD2DEG = 180 / Math.PI;

function shortName(name: string): string {
  return name.replace(/_joint$/, '').replace(/^left_/, 'L_').replace(/^right_/, 'R_');
}

function extractJointSeries(
  res: RetargetResult,
  dofIdx: number,
  mode: 'position' | 'velocity' | 'acceleration',
  scale: number,
): Array<number | null> {
  const { qpos, frameCount: T, nq, fps } = res;
  const dt = fps > 0 ? 1 / fps : 1 / 30;
  const dof = 7 + dofIdx;
  const out = new Array<number | null>(T).fill(null);

  if (mode === 'position') {
    for (let f = 0; f < T; f++) {
      const v = qpos[f * nq + dof];
      out[f] = Number.isFinite(v) ? v * scale : null;
    }
    return out;
  }

  if (mode === 'velocity') {
    for (let f = 0; f < T; f++) {
      const next = Math.min(f + 1, T - 1);
      const a = qpos[f * nq + dof];
      const b = qpos[next * nq + dof];
      out[f] = Number.isFinite(a) && Number.isFinite(b) ? ((b - a) / dt) * scale : null;
    }
    return out;
  }

  for (let f = 0; f < T; f++) {
    if (f === 0 || f === T - 1) {
      out[f] = 0;
      continue;
    }
    const prev = qpos[(f - 1) * nq + dof];
    const cur = qpos[f * nq + dof];
    const next = qpos[(f + 1) * nq + dof];
    out[f] =
      Number.isFinite(prev) && Number.isFinite(cur) && Number.isFinite(next)
        ? ((next - 2 * cur + prev) / (dt * dt)) * scale
        : null;
  }
  return out;
}

function extractRootSeries(
  res: RetargetResult,
  mode: 'root_pos' | 'root_speed',
): Array<{ label: string; values: Array<number | null>; color: string }> {
  const { qpos, frameCount: T, nq, fps } = res;
  const dt = fps > 0 ? 1 / fps : 1 / 30;
  if (mode === 'root_pos') {
    const labels = ['X', 'Y', 'Z'];
    return [0, 1, 2].map((axis) => {
      const values = new Array<number | null>(T);
      for (let f = 0; f < T; f++) {
        const v = qpos[f * nq + axis];
        values[f] = Number.isFinite(v) ? v : null;
      }
      return { label: `root_${labels[axis]}`, values, color: COLORS[axis] };
    });
  }

  const linSpeed = new Array<number | null>(T).fill(0);
  const angVel = new Array<number | null>(T).fill(0);
  for (let f = 1; f < T; f++) {
    const b0 = (f - 1) * nq;
    const b1 = f * nq;
    const dx = qpos[b1] - qpos[b0];
    const dy = qpos[b1 + 1] - qpos[b0 + 1];
    const dz = qpos[b1 + 2] - qpos[b0 + 2];
    const dPos = Math.hypot(dx, dy, dz);
    linSpeed[f] = Number.isFinite(dPos) ? dPos / dt : null;

    const q0: Quat = [qpos[b0 + 3], qpos[b0 + 4], qpos[b0 + 5], qpos[b0 + 6]];
    const q1: Quat = [qpos[b1 + 3], qpos[b1 + 4], qpos[b1 + 5], qpos[b1 + 6]];
    const allFin = [...q0, ...q1].every(Number.isFinite);
    const n0 = Math.hypot(q0[0], q0[1], q0[2], q0[3]);
    const n1 = Math.hypot(q1[0], q1[1], q1[2], q1[3]);
    angVel[f] = allFin && n0 > 1e-8 && n1 > 1e-8 ? quatGeodesicAngle(q0, q1) / dt : null;
  }
  return [
    { label: 'root_speed (m/s)', values: linSpeed, color: COLORS[0] },
    { label: 'root_ang_vel (rad/s)', values: angVel, color: COLORS[2] },
  ];
}

const yUnit = computed(() => {
  if (props.mode === 'position') return props.unit === 'deg' ? '°' : ' rad';
  if (props.mode === 'velocity') return props.unit === 'deg' ? '°/s' : ' rad/s';
  if (props.mode === 'acceleration') return props.unit === 'deg' ? '°/s²' : ' rad/s²';
  if (props.mode === 'root_pos') return ' m';
  return '';
});

const hasJointSelection = computed(
  () => props.mode === 'root_pos' || props.mode === 'root_speed' || props.joints.length > 0,
);

function buildFigure() {
  const T = props.raw.frameCount;
  const x = Array.from({ length: T }, (_, i) => i);
  const unit = yUnit.value;
  const data: Data[] = [];
  const rawLabel = t('ppRawTraceSuffix');
  const procLabel = t('ppProcessedTraceSuffix');

  if (props.mode === 'root_pos' || props.mode === 'root_speed') {
    const rawSeries = extractRootSeries(props.raw, props.mode);
    const procSeries = extractRootSeries(props.processed, props.mode);
    for (let i = 0; i < rawSeries.length; i++) {
      data.push({
        x,
        y: rawSeries[i].values,
        type: 'scatter',
        mode: 'lines',
        name: `${rawSeries[i].label} (${rawLabel})`,
        line: { color: rawSeries[i].color, width: 1.1, dash: 'dot' },
        opacity: 0.65,
      });
      data.push({
        x,
        y: procSeries[i].values,
        type: 'scatter',
        mode: 'lines',
        name: `${procSeries[i].label} (${procLabel})`,
        line: { color: rawSeries[i].color, width: 1.7 },
      });
    }

    // Mark root anomalies along the primary trace
    const rootAnoms = props.anomalies.filter(
      (a) => a.target === 'root_pos' || a.target === 'root_rot',
    );
    if (rootAnoms.length > 0 && procSeries.length > 0) {
      const mx: number[] = [];
      const my: number[] = [];
      const mText: string[] = [];
      const mColor: string[] = [];
      for (const a of rootAnoms) {
        const yVal = procSeries[0].values[a.frame] ?? rawSeries[0].values[a.frame] ?? 0;
        mx.push(a.frame);
        my.push(yVal);
        mText.push(a.detail);
        mColor.push(a.severity === 'error' ? '#ef5350' : a.severity === 'warning' ? '#ffb74d' : '#4fc3f7');
      }
      data.push({
        x: mx,
        y: my,
        text: mText,
        type: 'scatter',
        mode: 'markers',
        name: t('ppTabAnomalies'),
        marker: { size: 7, color: mColor, symbol: 'diamond' },
        hovertemplate: `${t('frame')} %{x}<br>%{text}<extra></extra>`,
      });
    }
  } else {
    const scale = props.unit === 'deg' ? RAD2DEG : 1;
    const { dofNames } = props.raw;
    const indices = props.joints.map((name) => dofNames.indexOf(name)).filter((i) => i >= 0);

    const traceFirstValues = new Map<string, Array<number | null>>();
    for (let i = 0; i < indices.length; i++) {
      const dofIdx = indices[i];
      const name = dofNames[dofIdx];
      const label = shortName(name);
      const color = COLORS[i % COLORS.length];
      const rawY = extractJointSeries(props.raw, dofIdx, props.mode, scale);
      const procY = extractJointSeries(props.processed, dofIdx, props.mode, scale);
      traceFirstValues.set(name, procY);

      data.push({
        x,
        y: rawY,
        type: 'scatter',
        mode: 'lines',
        name: `${label} (${rawLabel})`,
        line: { color, width: 1.1, dash: 'dot' },
        opacity: 0.6,
      });
      data.push({
        x,
        y: procY,
        type: 'scatter',
        mode: 'lines',
        name: `${label} (${procLabel})`,
        line: { color, width: 1.6 },
      });
    }

    const selectedSet = new Set(props.joints);
    const matchingAnoms = props.anomalies.filter(
      (a) => a.dofIndex !== null && selectedSet.has(a.target),
    );
    if (matchingAnoms.length > 0) {
      const mx: number[] = [];
      const my: number[] = [];
      const mText: string[] = [];
      const mColor: string[] = [];
      for (const a of matchingAnoms) {
        const seriesY = traceFirstValues.get(a.target);
        const yVal = seriesY?.[a.frame] ?? 0;
        mx.push(a.frame);
        my.push(yVal);
        mText.push(a.detail);
        mColor.push(a.severity === 'error' ? '#ef5350' : a.severity === 'warning' ? '#ffb74d' : '#4fc3f7');
      }
      data.push({
        x: mx,
        y: my,
        text: mText,
        type: 'scatter',
        mode: 'markers',
        name: t('ppTabAnomalies'),
        marker: { size: 7, color: mColor, symbol: 'diamond' },
        hovertemplate: `${t('frame')} %{x}<br>%{text}<extra></extra>`,
      });
    }
  }

  return {
    data,
    layout: {
      showlegend: mdAndUp.value,
      xaxis: { title: { text: t('frame') } },
      yaxis: { ticksuffix: unit },
    },
  };
}

const { isZoomed, resetZoom, draw, resize } = usePlotlyChart(
  chartEl,
  buildFigure,
  toRef(props, 'frame'),
);

watch(
  [() => props.raw, () => props.processed, () => props.joints, () => props.mode, () => props.unit, () => props.anomalies, mdAndUp],
  () => {
    void draw();
  },
);

defineExpose({ resetZoom, isZoomed, resize });
</script>

<template>
  <div class="chart-root">
    <div v-if="!hasJointSelection" class="text-caption text-disabled mb-1">{{ t('selectJointsHint') }}</div>
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
  border-radius: var(--rro-radius);
  overflow: hidden;
}
</style>
