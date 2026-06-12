<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import type { RetargetResult } from '@/lib/retarget/types';

const props = defineProps<{
  result: RetargetResult;
  /** current playback frame to draw a cursor at */
  frame?: number;
}>();

const { t } = useI18n();

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

const yMax = computed(() => {
  let m = 0.02;
  for (const v of series.value.max) if (v > m) m = v;
  return m * 1.1;
});

function toPath(values: Float32Array): string {
  const n = values.length;
  if (n === 0) return '';
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  let d = '';
  const step = Math.max(1, Math.floor(n / innerW));
  for (let f = 0; f < n; f += step) {
    const x = PAD.l + (f / Math.max(n - 1, 1)) * innerW;
    const y = PAD.t + innerH - (values[f] / yMax.value) * innerH;
    d += (d ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
  }
  return d;
}

const meanPath = computed(() => toPath(series.value.mean));
const maxPath = computed(() => toPath(series.value.max));

const cursorX = computed(() => {
  if (props.frame === undefined) return null;
  const n = props.result.frameCount;
  return PAD.l + (props.frame / Math.max(n - 1, 1)) * (W - PAD.l - PAD.r);
});

const stats = computed(() => {
  const m = series.value.mean;
  let sum = 0;
  let mx = 0;
  for (const v of m) {
    sum += v;
    if (v > mx) mx = v;
  }
  let mxAll = 0;
  for (const v of series.value.max) if (v > mxAll) mxAll = v;
  return { mean: m.length ? sum / m.length : 0, maxAll: mxAll };
});
</script>

<template>
  <div>
    <div class="d-flex align-center ga-4 mb-1 text-caption">
      <span><span class="legend mean" /> {{ t('meanError') }}: {{ (stats.mean * 100).toFixed(2) }} cm</span>
      <span><span class="legend max" /> {{ t('maxError') }}: {{ (stats.maxAll * 100).toFixed(2) }} cm</span>
    </div>
    <svg :viewBox="`0 0 ${W} ${H}`" class="chart" preserveAspectRatio="none">
      <line
        v-for="frac in [0, 0.5, 1]"
        :key="frac"
        :x1="PAD.l"
        :x2="W - PAD.r"
        :y1="PAD.t + (H - PAD.t - PAD.b) * (1 - frac)"
        :y2="PAD.t + (H - PAD.t - PAD.b) * (1 - frac)"
        stroke="rgba(255,255,255,0.12)"
        stroke-width="1"
      />
      <text
        v-for="frac in [0, 0.5, 1]"
        :key="'t' + frac"
        :x="PAD.l - 5"
        :y="PAD.t + (H - PAD.t - PAD.b) * (1 - frac) + 3.5"
        fill="rgba(255,255,255,0.55)"
        font-size="9"
        text-anchor="end"
      >
        {{ (yMax * frac * 100).toFixed(1) }}cm
      </text>
      <path :d="maxPath" fill="none" stroke="#ef5350" stroke-width="1" opacity="0.75" />
      <path :d="meanPath" fill="none" stroke="#4fc3f7" stroke-width="1.4" />
      <line
        v-if="cursorX !== null"
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
  height: 120px;
  display: block;
  background: rgba(0, 0, 0, 0.18);
  border-radius: 6px;
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
