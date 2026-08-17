<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { mdiChevronDown, mdiChevronUp, mdiMagnifyRemoveOutline, mdiDragHorizontalVariant } from '@mdi/js';
import { useI18n } from '@/i18n';
import type { RetargetResult } from '@/lib/retarget/types';
import ErrorChart from '@/components/ErrorChart.vue';
import { ERROR_SERIES_MAX, ERROR_SERIES_MEAN } from '@/components/errorChartConstants';
import JointSeriesChart from '@/components/JointSeriesChart.vue';

const props = defineProps<{
  result: RetargetResult;
  frame: number;
}>();

const emit = defineEmits<{
  resize: [];
}>();

const { t } = useI18n();

const activeTab = ref<'error' | 'position' | 'velocity'>('error');
const expanded = ref(true);
const selectedJoints = ref<string[]>([]);
const selectedErrorSeries = ref<string[]>([]);
const angleUnit = ref<'deg' | 'rad'>('deg');

const errorChartRef = ref<InstanceType<typeof ErrorChart> | null>(null);
const jointChartRef = ref<InstanceType<typeof JointSeriesChart> | null>(null);

const MIN_BODY_H = 168;
/** Survives keep-alive deactivation and MetricsPanel remounts within the session. */
let savedPanelBodyH = MIN_BODY_H;
const panelBodyH = ref(savedPanelBodyH);
const dragging = ref(false);
const panelRoot = ref<HTMLElement | null>(null);
const resizeHandleEl = ref<HTMLElement | null>(null);
const maxBodyH = ref(MIN_BODY_H * 3);
let capturedPointerId: number | null = null;
let dragStartY = 0;
let dragStartH = MIN_BODY_H;

const JOINT_PREFS = [
  'left_knee',
  'right_knee',
  'left_hip_pitch',
  'left_ankle_pitch',
  'left_elbow',
  'waist_yaw',
];

function defaultJoints(names: string[]): string[] {
  const found: string[] = [];
  for (const pref of JOINT_PREFS) {
    const match = names.find((n) => n.includes(pref));
    if (match && !found.includes(match)) found.push(match);
    if (found.length >= 4) break;
  }
  if (found.length < 2) return names.slice(0, Math.min(4, names.length));
  return found;
}

function defaultErrorSeries(_taskNames: string[]): string[] {
  return [ERROR_SERIES_MEAN, ERROR_SERIES_MAX];
}

watch(
  () => props.result.dofNames,
  (names) => {
    selectedJoints.value = defaultJoints(names);
  },
  { immediate: true },
);

watch(
  () => props.result.taskNames,
  (names) => {
    selectedErrorSeries.value = defaultErrorSeries(names);
  },
  { immediate: true },
);

const jointItems = computed(() =>
  props.result.dofNames.map((name) => ({
    title: name.replace(/_joint$/, ''),
    value: name,
  })),
);

const errorSeriesItems = computed(() => [
  { title: t('meanError'), value: ERROR_SERIES_MEAN },
  { title: t('maxError'), value: ERROR_SERIES_MAX },
  ...props.result.taskNames.map((name) => ({
    title: name.replace(/_link$/, ''),
    value: name,
  })),
]);

const showJointPicker = computed(() => activeTab.value !== 'error' && expanded.value);
const showErrorPicker = computed(() => activeTab.value === 'error' && expanded.value);
const showUnitToggle = computed(() => activeTab.value !== 'error' && expanded.value);

const activeChartZoomed = computed(() => {
  if (activeTab.value === 'error') return errorChartRef.value?.isZoomed ?? false;
  return jointChartRef.value?.isZoomed ?? false;
});

function resetActiveChartZoom() {
  if (activeTab.value === 'error') errorChartRef.value?.resetZoom();
  else jointChartRef.value?.resetZoom();
}

function resizeActiveChart() {
  nextTick(() => {
    if (activeTab.value === 'error') errorChartRef.value?.resize();
    else jointChartRef.value?.resize();
  });
}

function updateMaxHeight() {
  const root = panelRoot.value?.closest('.main-col') as HTMLElement | null;
  if (!root) return;
  const colH = root.clientHeight;
  // keep-alive hides inactive views (clientHeight 0); don't clamp the saved height then.
  if (colH < MIN_BODY_H) return;
  maxBodyH.value = Math.max(MIN_BODY_H, Math.floor(colH * 0.5));
  if (panelBodyH.value > maxBodyH.value) panelBodyH.value = maxBodyH.value;
}

function detachWindowPointerListeners() {
  window.removeEventListener('pointerup', onWindowPointerEnd);
  window.removeEventListener('pointercancel', onWindowPointerEnd);
  window.removeEventListener('blur', onWindowPointerEnd);
}

function releaseCapturedPointer() {
  const handle = resizeHandleEl.value;
  if (!handle || capturedPointerId === null) return;
  try {
    if (handle.hasPointerCapture(capturedPointerId)) {
      handle.releasePointerCapture(capturedPointerId);
    }
  } catch {
    /* already released */
  }
  capturedPointerId = null;
}

function endResizeDrag() {
  if (!dragging.value) return;
  dragging.value = false;
  releaseCapturedPointer();
  detachWindowPointerListeners();
}

function onWindowPointerEnd() {
  endResizeDrag();
}

function attachWindowPointerListeners() {
  window.addEventListener('pointerup', onWindowPointerEnd);
  window.addEventListener('pointercancel', onWindowPointerEnd);
  window.addEventListener('blur', onWindowPointerEnd);
}

function onResizeDragStart(e: PointerEvent) {
  if (!expanded.value) return;
  dragging.value = true;
  capturedPointerId = e.pointerId;
  resizeHandleEl.value = e.currentTarget as HTMLElement;
  updateMaxHeight();
  dragStartY = e.clientY;
  dragStartH = panelBodyH.value;
  resizeHandleEl.value.setPointerCapture(e.pointerId);
  attachWindowPointerListeners();
  e.preventDefault();
}

function onResizeDragMove(e: PointerEvent) {
  if (!dragging.value) return;
  // Anchored to where the drag began, so the panel edge tracks the pointer
  // whatever the chrome above the body measures — 36px on a mouse, taller on
  // touch, where the handle has its own row and the tabs are 44pt.
  const next = dragStartH + (dragStartY - e.clientY);
  panelBodyH.value = Math.max(MIN_BODY_H, Math.min(maxBodyH.value, next));
  emit('resize');
  resizeActiveChart();
}

function onResizeDragEnd() {
  endResizeDrag();
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  updateMaxHeight();
  const root = panelRoot.value?.closest('.main-col');
  if (root) {
    ro = new ResizeObserver(() => updateMaxHeight());
    ro.observe(root);
  }
});
onActivated(() => {
  updateMaxHeight();
  resizeActiveChart();
});
onDeactivated(() => {
  endResizeDrag();
});
onUnmounted(() => {
  endResizeDrag();
  ro?.disconnect();
});

watch(panelBodyH, (h) => {
  savedPanelBodyH = h;
  emit('resize');
  resizeActiveChart();
});
watch(expanded, () => {
  emit('resize');
  resizeActiveChart();
});
watch(activeTab, () => {
  emit('resize');
  resizeActiveChart();
});
</script>

<template>
  <div ref="panelRoot" class="metrics-panel" :class="{ dragging }">
    <div
      v-if="expanded"
      ref="resizeHandleEl"
      class="resize-handle d-flex align-center justify-center"
      :title="t('dragResizeMetrics')"
      :aria-label="t('dragResizeMetrics')"
      role="separator"
      aria-orientation="horizontal"
      @pointerdown="onResizeDragStart"
      @pointermove="onResizeDragMove"
      @pointerup="onResizeDragEnd"
      @pointercancel="onResizeDragEnd"
      @lostpointercapture="onResizeDragEnd"
    >
      <v-icon :icon="mdiDragHorizontalVariant" size="small" class="resize-icon" />
    </div>

    <div class="metrics-header d-flex align-center">
      <v-tabs v-model="activeTab" density="compact" color="primary" show-arrows class="flex-grow-1">
        <v-tab value="error">{{ t('errorChart') }}</v-tab>
        <v-tab value="position">{{ t('jointPositionChart') }}</v-tab>
        <v-tab value="velocity">{{ t('jointVelocityChart') }}</v-tab>
      </v-tabs>
      <v-btn
        v-if="expanded && activeChartZoomed"
        variant="text"
        size="small"
        density="compact"
        :icon="mdiMagnifyRemoveOutline"
        :title="t('resetChartZoom')"
        @click="resetActiveChartZoom"
      />
      <v-btn
        variant="text"
        size="small"
        density="compact"
        :icon="expanded ? mdiChevronDown : mdiChevronUp"
        :title="expanded ? t('collapseMetrics') : t('expandMetrics')"
        @click="expanded = !expanded"
      />
    </div>

    <div v-show="expanded" class="metrics-body px-3 pb-2" :style="{ height: panelBodyH + 'px' }">
      <div class="metrics-controls d-flex flex-wrap align-center ga-2 mt-2 mb-1">
        <v-select
          v-if="showJointPicker"
          v-model="selectedJoints"
          :items="jointItems"
          :label="t('selectJoints')"
          density="compact"
          variant="outlined"
          hide-details
          multiple
          chips
          closable-chips
          class="series-select flex-grow-1"
          :menu-props="{ maxHeight: 280 }"
        />
        <v-select
          v-if="showErrorPicker"
          v-model="selectedErrorSeries"
          :items="errorSeriesItems"
          :label="t('selectKeypoints')"
          density="compact"
          variant="outlined"
          hide-details
          multiple
          chips
          closable-chips
          class="series-select flex-grow-1"
          :menu-props="{ maxHeight: 280 }"
        />
        <v-btn-toggle
          v-if="showUnitToggle"
          v-model="angleUnit"
          density="compact"
          variant="outlined"
          divided
          mandatory
          class="unit-toggle"
        >
          <v-btn value="deg" size="small">{{ t('unitDeg') }}</v-btn>
          <v-btn value="rad" size="small">{{ t('unitRad') }}</v-btn>
        </v-btn-toggle>
      </div>
      <div class="chart-window mt-1">
        <ErrorChart
          v-if="activeTab === 'error'"
          ref="errorChartRef"
          :result="result"
          :series="selectedErrorSeries"
          :frame="frame"
        />
        <JointSeriesChart
          v-else-if="activeTab === 'position'"
          ref="jointChartRef"
          :result="result"
          :joints="selectedJoints"
          mode="position"
          :unit="angleUnit"
          :frame="frame"
        />
        <JointSeriesChart
          v-else
          ref="jointChartRef"
          :result="result"
          :joints="selectedJoints"
          mode="velocity"
          :unit="angleUnit"
          :frame="frame"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.metrics-panel {
  flex-shrink: 0;
  border-top: 1px solid var(--rro-border);
  background: rgb(var(--v-theme-surface));
  position: relative;
  z-index: 2;
  overflow: hidden;
}
.metrics-panel.dragging {
  user-select: none;
}
.resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 10px;
  cursor: ns-resize;
  /* Above .metrics-header (z-index 3) so the header no longer swallows the
     drag; kept inside the panel (no negative translate) so .metrics-panel's
     overflow: hidden doesn't clip the grab area. */
  z-index: 4;
  /* The drag runs on pointermove, so the browser must not claim the gesture
     for panning first — on touch it would scroll the metrics body instead. */
  touch-action: none;
}
.resize-handle:hover .resize-icon,
.metrics-panel.dragging .resize-icon {
  opacity: 0.85;
}
.resize-icon {
  opacity: 0.35;
  pointer-events: none;
}
.metrics-header {
  position: relative;
  z-index: 3;
  min-height: 36px;
  padding-right: 4px;
}
.metrics-header :deep(.v-tab) {
  font-size: 0.78rem;
  min-width: 0;
  padding: 0 10px;
  letter-spacing: 0;
  text-transform: none;
}
.metrics-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.metrics-controls {
  flex-shrink: 0;
}
.series-select {
  min-width: 0;
  max-width: 100%;
}
.series-select :deep(.v-field__input) {
  flex-wrap: wrap;
  gap: 4px;
}
.unit-toggle {
  flex-shrink: 0;
}
.chart-window {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
  isolation: isolate;
  contain: paint;
  clip-path: inset(0);
}
.chart-window :deep(.chart-root),
.chart-window :deep(.chart),
.chart-window :deep(.js-plotly-plot) {
  max-height: 100%;
}
.chart-window :deep(.plot-container) {
  overflow: hidden;
}
/*
 * Touch rules, three of them:
 *
 * 1. A finger cannot aim at a 10px strip, and there is no hover to reveal it,
 *    so the handle takes a row of its own above the tabs: grabbable, always
 *    visible, and never overlapping the 44pt tab targets it would sit on.
 * 2. At the smallest panel height the chart is squeezed below the height it
 *    can draw in, and `overflow: hidden` used to clip the axis labels and the
 *    legend with no way to reach them. Give the chart the room it needs and
 *    let the body scroll to it; `pointer-events: none` on the chart means a
 *    finger over it scrolls the body underneath.
 * 3. iOS WebKit: Plotly SVG overlays can extend past the chart and steal
 *    touches from the controls below.
 */
@media (pointer: coarse), (hover: none) {
  .resize-handle {
    position: relative;
    height: 26px;
  }
  .resize-icon {
    opacity: 0.55;
  }
  .metrics-body {
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .chart-window {
    min-height: 220px;
    pointer-events: none;
  }
  .chart-window :deep(.js-plotly-plot),
  .chart-window :deep(.plot-container),
  .chart-window :deep(.svg-container),
  .chart-window :deep(.main-svg),
  .chart-window :deep(.draglayer),
  .chart-window :deep(.draglayer rect),
  .chart-window :deep(.hoverlayer),
  .chart-window :deep(.nsewdrag),
  .chart-window :deep(.nsdrag),
  .chart-window :deep(.ewdrag),
  .chart-window :deep(.wdrag),
  .chart-window :deep(.edrag),
  .chart-window :deep(.swdrag),
  .chart-window :deep(.sedrag) {
    pointer-events: none !important;
    touch-action: none !important;
  }
}
</style>
