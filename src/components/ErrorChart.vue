<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from '@/i18n';
import type { RetargetResult } from '@/lib/retarget/types';
import { useChartZoom } from '@/composables/useChartZoom';
import { computeVisibleDataYRange } from '@/lib/chartDataRange';

const props = defineProps<{
  result: RetargetResult;
  /** current playback frame to draw a cursor at */
  frame?: number;
}>();

const { t } = useI18n();
const { isZoomed, reset, visibleYRange, frameToX, visibleFrameRange, onWheel } = useChartZoom();

const svgEl = ref<SVGSVGElement | null>(null);

const W = 560;
const H = 120;
const PAD = { l: 42, r: 8, t: 8, b: 18 };

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
  return { mean, max };
});

const dataYRange = computed(() => {
  const { f0, f1 } = visibleFrameRange(props.result.frameCount);
  const { mean, max } = series.value;
  return computeVisibleDataYRange([mean, max], props.result.frameCount, f0, f1);
});

const yRange = computed(() => visibleYRange(dataYRange.value.lo, dataYRange.value.hi));

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

const meanPath = computed(() => toPath(series.value.mean));
const maxPath = computed(() => toPath(series.value.max));

const cursorX = computed(() => {
  if (props.frame === undefined) return null;
  return frameToX(props.frame, props.result.frameCount, W, PAD);
});

const yTicks = computed(() => {
  const { lo, hi } = yRange.value;
  return [lo, (lo + hi) / 2, hi];
});

const stats = computed(() => {
  const m = series.value.mean;
  let sum = 0;
  for (const v of m) sum += v;
  let mxAll = 0;
  for (const v of series.value.max) if (v > mxAll) mxAll = v;
  return { mean: m.length ? sum / m.length : 0, maxAll: mxAll };
});

function handleWheel(e: WheelEvent) {
  const el = svgEl.value;
  if (!el) return;
  onWheel(e, el.getBoundingClientRect(), W, H, PAD, props.result.frameCount);
}

defineExpose({ resetZoom: reset, isZoomed });
</script>

<template>
  <div>
    <div class="d-flex align-center ga-4 mb-1 text-caption chart-toolbar">
      <span><span class="legend mean" /> {{ t('meanError') }}: {{ (stats.mean * 100).toFixed(2) }} cm</span>
      <span><span class="legend max" /> {{ t('maxError') }}: {{ (stats.maxAll * 100).toFixed(2) }} cm</span>
    </div>
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
        v-for="(tick, i) in [0, 0.5, 1]"
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
        {{ (tick * 100).toFixed(1) }}cm
      </text>
      <path :d="maxPath" fill="none" stroke="#ef5350" stroke-width="1" opacity="0.75" />
      <path :d="meanPath" fill="none" stroke="#4fc3f7" stroke-width="1.4" />
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
.chart {
  width: 100%;
  height: 100%;
  min-height: 120px;
  display: block;
  background: rgba(0, 0, 0, 0.18);
  border-radius: 6px;
}
.chart-toolbar {
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
