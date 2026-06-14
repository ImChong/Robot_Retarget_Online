<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from '@/i18n';
import type { RetargetResult } from '@/lib/retarget/types';
import { useChartZoom } from '@/composables/useChartZoom';
import { computeVisibleDataYRange } from '@/lib/chartDataRange';

const props = defineProps<{
  result: RetargetResult;
  /** Joint names to plot (must exist in result.dofNames). */
  joints: string[];
  mode: 'position' | 'velocity';
  unit: 'deg' | 'rad';
  frame?: number;
}>();

const { t } = useI18n();
const { isZoomed, reset, visibleYRange, frameToX, visibleFrameRange, onWheel } = useChartZoom();

const svgEl = ref<SVGSVGElement | null>(null);

const W = 560;
const H = 120;
const PAD = { l: 46, r: 8, t: 8, b: 18 };

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
  return out;
});

const dataYRange = computed(() => {
  const { f0, f1 } = visibleFrameRange(props.result.frameCount);
  return computeVisibleDataYRange(
    series.value.map((s) => s.values),
    props.result.frameCount,
    f0,
    f1,
  );
});

const yRange = computed(() => visibleYRange(dataYRange.value.lo, dataYRange.value.hi));

const yUnit = computed(() => {
  if (props.mode === 'position') return props.unit === 'deg' ? '°' : ' rad';
  return props.unit === 'deg' ? '°/s' : ' rad/s';
});

function toPath(values: Float32Array): string {
  const n = values.length;
  if (n === 0) return '';
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const { lo, hi } = yRange.value;
  const span = hi - lo || 1;
  const { f0, f1 } = visibleFrameRange(n);
  let d = '';
  const step = Math.max(1, Math.floor((f1 - f0) / innerW));
  const start = Math.max(0, Math.floor(f0));
  const end = Math.min(n - 1, Math.ceil(f1));
  for (let f = start; f <= end; f += step) {
    const x = frameToX(f, n, W, PAD);
    if (x < PAD.l - 1 || x > W - PAD.r + 1) continue;
    const y = PAD.t + innerH - ((values[f] - lo) / span) * innerH;
    d += (d ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
  }
  return d;
}

const paths = computed(() =>
  series.value.map((s, i) => ({
    name: s.name,
    d: toPath(s.values),
    color: COLORS[i % COLORS.length],
  })),
);

const cursorX = computed(() => {
  if (props.frame === undefined) return null;
  return frameToX(props.frame, props.result.frameCount, W, PAD);
});

const yTicks = computed(() => {
  const { lo, hi } = yRange.value;
  return [lo, (lo + hi) / 2, hi];
});

function shortName(name: string): string {
  return name.replace(/_joint$/, '').replace(/^left_/, 'L_').replace(/^right_/, 'R_');
}

function formatTick(v: number): string {
  if (props.unit === 'deg') return v.toFixed(0);
  return props.mode === 'position' ? v.toFixed(2) : v.toFixed(1);
}

function handleWheel(e: WheelEvent) {
  const el = svgEl.value;
  if (!el) return;
  onWheel(e, el.getBoundingClientRect(), W, H, PAD, props.result.frameCount);
}

defineExpose({ resetZoom: reset, isZoomed });
</script>

<template>
  <div class="chart-root">
    <div v-if="paths.length" class="d-flex flex-wrap align-center ga-3 mb-1 text-caption chart-toolbar">
      <span v-for="p in paths" :key="p.name">
        <span class="legend" :style="{ background: p.color }" />
        {{ shortName(p.name) }}
      </span>
    </div>
    <div v-if="!paths.length" class="text-caption text-disabled mb-1">{{ t('selectJointsHint') }}</div>
    <svg
      ref="svgEl"
      :viewBox="`0 0 ${W} ${H}`"
      class="chart"
      preserveAspectRatio="none"
      @wheel="handleWheel"
    >
      <rect :x="0" :y="0" :width="PAD.l" :height="H" class="axis-hit y-axis-hit" />
      <rect :x="0" :y="H - PAD.b" :width="W" :height="PAD.b" class="axis-hit x-axis-hit" />
      <line
        v-for="(tick, i) in yTicks"
        :key="i"
        :x1="PAD.l"
        :x2="W - PAD.r"
        :y1="PAD.t + (H - PAD.t - PAD.b) * (1 - i / 2)"
        :y2="PAD.t + (H - PAD.t - PAD.b) * (1 - i / 2)"
        stroke="rgba(255,255,255,0.12)"
        stroke-width="1"
      />
      <text
        v-for="(tick, i) in yTicks"
        :key="'t' + i"
        :x="PAD.l - 5"
        :y="PAD.t + (H - PAD.t - PAD.b) * (1 - i / 2) + 3.5"
        fill="rgba(255,255,255,0.55)"
        font-size="9"
        text-anchor="end"
      >
        {{ formatTick(tick) }}{{ yUnit }}
      </text>
      <path
        v-for="p in paths"
        :key="p.name"
        :d="p.d"
        fill="none"
        :stroke="p.color"
        stroke-width="1.3"
      />
      <line
        v-if="cursorX !== null && cursorX >= PAD.l && cursorX <= W - PAD.r"
        :x1="cursorX"
        :x2="cursorX"
        :y1="PAD.t"
        :y2="H - PAD.b"
        stroke="#ffb74d"
        stroke-width="1"
      />
    </svg>
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
  min-height: 0;
  display: block;
  background: rgba(0, 0, 0, 0.18);
  border-radius: 6px;
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
.axis-hit {
  fill: transparent;
  pointer-events: all;
}
.y-axis-hit {
  cursor: ns-resize;
}
.x-axis-hit {
  cursor: ew-resize;
}
</style>
