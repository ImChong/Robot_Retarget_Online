<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { icons } from '@/lib/icons';
import { useI18n } from '@/i18n';
import type { RetargetResult } from '@/lib/retarget/types';
import type { AnomalySeverity, MotionAnomaly, PostProcessOutput } from '@/lib/postprocess';
import PostProcessCompareChart, { type CompareChartMode } from '@/components/PostProcessCompareChart.vue';

const props = defineProps<{
  raw: RetargetResult;
  output: PostProcessOutput;
  frame: number;
}>();

const emit = defineEmits<{
  resize: [];
  seekFrame: [frame: number];
}>();

const { t } = useI18n();

const activeTab = ref<'anomalies' | 'position' | 'kinematics' | 'root'>('anomalies');
const expanded = ref(true);
const selectedJoints = ref<string[]>([]);
const angleUnit = ref<'deg' | 'rad'>('deg');
const kinMode = ref<'velocity' | 'acceleration'>('velocity');
const rootMode = ref<'root_pos' | 'root_speed'>('root_pos');
const anomalyStage = ref<'raw' | 'after'>('raw');
const severityFilter = ref<'all' | AnomalySeverity>('all');

const chartRef = ref<InstanceType<typeof PostProcessCompareChart> | null>(null);

const MIN_BODY_H = 180;
let savedPanelBodyH = 220;
const panelBodyH = ref(savedPanelBodyH);
const dragging = ref(false);
const panelRoot = ref<HTMLElement | null>(null);
const resizeHandleEl = ref<HTMLElement | null>(null);
const maxBodyH = ref(MIN_BODY_H * 3);
let capturedPointerId: number | null = null;
let dragStartY = 0;
let dragStartH = 220;

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
    if (found.length >= 3) break;
  }
  if (found.length < 2) return names.slice(0, Math.min(3, names.length));
  return found;
}

watch(
  () => props.raw.dofNames,
  (names) => {
    selectedJoints.value = defaultJoints(names);
  },
  { immediate: true },
);

const jointItems = computed(() =>
  props.raw.dofNames.map((name) => ({
    title: name.replace(/_joint$/, ''),
    value: name,
  })),
);

const currentAnomalies = computed(() =>
  anomalyStage.value === 'raw'
    ? props.output.rawDetection.anomalies
    : props.output.processedDetection.anomalies,
);

const filteredAnomalies = computed(() => {
  if (severityFilter.value === 'all') return currentAnomalies.value;
  return currentAnomalies.value.filter((a) => a.severity === severityFilter.value);
});

const chartMode = computed<CompareChartMode>(() => {
  if (activeTab.value === 'position') return 'position';
  if (activeTab.value === 'kinematics') return kinMode.value;
  return rootMode.value;
});

const activeChartZoomed = computed(() => {
  if (activeTab.value === 'anomalies') return false;
  return chartRef.value?.isZoomed ?? false;
});

function resetActiveChartZoom() {
  chartRef.value?.resetZoom();
}

function resizeActiveChart() {
  nextTick(() => {
    if (activeTab.value !== 'anomalies') chartRef.value?.resize();
  });
}

function anomalyTypeLabel(type: MotionAnomaly['type']): string {
  switch (type) {
    case 'nan_inf': return t('ppTypeNanInf');
    case 'joint_limit': return t('ppTypeJointLimit');
    case 'joint_spike': return t('ppTypeJointSpike');
    case 'excessive_velocity': return t('ppTypeExcessiveVel');
    case 'excessive_accel': return t('ppTypeExcessiveAcc');
    case 'high_freq_jitter': return t('ppTypeJitter');
    case 'root_pos_spike': return t('ppTypeRootPosSpike');
    case 'root_rot_spike': return t('ppTypeRootRotSpike');
    case 'quat_norm': return t('ppTypeQuatNorm');
    case 'quat_sign_flip': return t('ppTypeQuatFlip');
    case 'discontinuity': return t('ppTypeDiscontinuity');
    case 'invalid_sequence': return t('ppTypeInvalidSeq');
  }
}

function repairabilityLabel(rep: MotionAnomaly['repairability']): string {
  if (rep === 'auto') return t('ppRepAuto');
  if (rep === 'confirm') return t('ppRepConfirm');
  return t('ppRepUnrepairable');
}

function repairabilityColor(rep: MotionAnomaly['repairability']): string {
  if (rep === 'auto') return 'success';
  if (rep === 'confirm') return 'warning';
  return 'error';
}

function severityColor(sev: AnomalySeverity): string {
  if (sev === 'error') return 'error';
  if (sev === 'warning') return 'warning';
  return 'info';
}

function selectAnomaly(anom: MotionAnomaly) {
  emit('seekFrame', anom.frame);
  if (anom.dofIndex !== null && !selectedJoints.value.includes(anom.target)) {
    selectedJoints.value = [anom.target, ...selectedJoints.value.slice(0, 3)];
  }
}

function stepAnomaly(dir: -1 | 1) {
  const list = filteredAnomalies.value;
  if (!list.length) return;
  if (dir > 0) {
    const next = list.find((a) => a.frame > props.frame) ?? list[0];
    selectAnomaly(next);
  } else {
    const prev = [...list].reverse().find((a) => a.frame < props.frame) ?? list[list.length - 1];
    selectAnomaly(prev);
  }
}

function updateMaxHeight() {
  const root = panelRoot.value?.closest('.main-col') as HTMLElement | null;
  if (!root) return;
  const colH = root.clientHeight;
  if (colH < MIN_BODY_H) return;
  maxBodyH.value = Math.max(MIN_BODY_H, Math.floor(colH * 0.55));
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

function onResizeDragStart(e: PointerEvent) {
  if (!expanded.value) return;
  dragging.value = true;
  capturedPointerId = e.pointerId;
  resizeHandleEl.value = e.currentTarget as HTMLElement;
  updateMaxHeight();
  dragStartY = e.clientY;
  dragStartH = panelBodyH.value;
  resizeHandleEl.value.setPointerCapture(e.pointerId);
  window.addEventListener('pointerup', onWindowPointerEnd);
  window.addEventListener('pointercancel', onWindowPointerEnd);
  window.addEventListener('blur', onWindowPointerEnd);
  e.preventDefault();
}

function onResizeDragMove(e: PointerEvent) {
  if (!dragging.value) return;
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
      <v-icon :icon="icons.dragHandle" size="small" class="resize-icon" />
    </div>

    <div class="metrics-header d-flex align-center">
      <v-tabs v-model="activeTab" density="compact" color="primary" show-arrows class="flex-grow-1">
        <v-tab value="anomalies">
          {{ t('ppTabAnomalies') }} ({{ output.rawDetection.metrics.totalIssues }} → {{ output.processedDetection.metrics.totalIssues }})
        </v-tab>
        <v-tab value="position">{{ t('ppTabCompareJoint') }}</v-tab>
        <v-tab value="kinematics">{{ t('ppTabCompareVel') }}</v-tab>
        <v-tab value="root">{{ t('ppTabCompareRoot') }}</v-tab>
      </v-tabs>
      <v-btn
        v-if="expanded && activeChartZoomed"
        variant="text"
        size="small"
        density="compact"
        :icon="icons.zoomOut"
        :title="t('resetChartZoom')"
        @click="resetActiveChartZoom"
      />
      <v-btn
        variant="text"
        size="small"
        density="compact"
        :icon="expanded ? icons.caretDown : icons.caretUp"
        :title="expanded ? t('collapseMetrics') : t('expandMetrics')"
        @click="expanded = !expanded"
      />
    </div>

    <div v-show="expanded" class="metrics-body px-3 pb-2" :style="{ height: panelBodyH + 'px' }">
      <template v-if="activeTab === 'anomalies'">
        <div class="anomaly-toolbar d-flex flex-wrap align-center ga-2 mt-2 mb-2">
          <v-btn-toggle v-model="anomalyStage" density="compact" variant="outlined" divided mandatory>
            <v-btn value="raw" size="small">
              {{ t('ppShowRawIssues') }} ({{ output.rawDetection.metrics.totalIssues }})
            </v-btn>
            <v-btn value="after" size="small">
              {{ t('ppShowAfterIssues') }} ({{ output.processedDetection.metrics.totalIssues }})
            </v-btn>
          </v-btn-toggle>

          <v-btn-toggle v-model="severityFilter" density="compact" variant="outlined" divided mandatory>
            <v-btn value="all" size="small">{{ t('ppSeverityAll') }}</v-btn>
            <v-btn value="error" size="small">{{ t('ppSeverityError') }}</v-btn>
            <v-btn value="warning" size="small">{{ t('ppSeverityWarning') }}</v-btn>
            <v-btn value="info" size="small">{{ t('ppSeverityInfo') }}</v-btn>
          </v-btn-toggle>

          <v-spacer />

          <div class="d-flex align-center ga-1">
            <v-btn
              size="small"
              variant="tonal"
              :prepend-icon="icons.caretLeft"
              :disabled="!filteredAnomalies.length"
              @click="stepAnomaly(-1)"
            >
              {{ t('ppPrevAnomaly') }}
            </v-btn>
            <v-btn
              size="small"
              variant="tonal"
              :append-icon="icons.caretRight"
              :disabled="!filteredAnomalies.length"
              @click="stepAnomaly(1)"
            >
              {{ t('ppNextAnomaly') }}
            </v-btn>
          </div>
        </div>

        <div class="anomaly-list">
          <div v-if="!filteredAnomalies.length" class="text-caption text-medium-emphasis py-4 text-center">
            {{ t('ppNoAnomalies') }}
          </div>
          <button
            v-for="anom in filteredAnomalies"
            :key="anom.id"
            type="button"
            class="anomaly-row"
            :class="{ 'anomaly-row--active': frame >= anom.frameStart && frame <= anom.frameEnd }"
            @click="selectAnomaly(anom)"
          >
            <v-chip size="x-small" :color="severityColor(anom.severity)" variant="tonal" label>
              {{ anom.severity.toUpperCase() }}
            </v-chip>
            <v-chip size="x-small" :color="repairabilityColor(anom.repairability)" variant="outlined" label>
              {{ repairabilityLabel(anom.repairability) }}
            </v-chip>
            <span class="anomaly-frame mono">
              F{{ anom.frameStart }}<template v-if="anom.frameEnd > anom.frameStart">–{{ anom.frameEnd }}</template>
            </span>
            <span class="anomaly-type">{{ anomalyTypeLabel(anom.type) }}</span>
            <span class="anomaly-target mono">{{ anom.target.replace(/_joint$/, '') }}</span>
            <span class="anomaly-detail">{{ anom.detail }}</span>
          </button>
        </div>
      </template>

      <template v-else>
        <div class="metrics-controls d-flex flex-wrap align-center ga-2 mt-2 mb-1">
          <v-select
            v-if="activeTab !== 'root'"
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
          <v-btn-toggle
            v-if="activeTab === 'kinematics'"
            v-model="kinMode"
            density="compact"
            variant="outlined"
            divided
            mandatory
            class="unit-toggle"
          >
            <v-btn value="velocity" size="small">{{ t('ppMetricModeVel') }}</v-btn>
            <v-btn value="acceleration" size="small">{{ t('ppMetricModeAcc') }}</v-btn>
          </v-btn-toggle>
          <v-btn-toggle
            v-if="activeTab === 'root'"
            v-model="rootMode"
            density="compact"
            variant="outlined"
            divided
            mandatory
            class="unit-toggle"
          >
            <v-btn value="root_pos" size="small">{{ t('ppRootModePos') }}</v-btn>
            <v-btn value="root_speed" size="small">{{ t('ppRootModeSpeed') }}</v-btn>
          </v-btn-toggle>
          <v-btn-toggle
            v-if="activeTab !== 'root'"
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
          <PostProcessCompareChart
            ref="chartRef"
            :raw="raw"
            :processed="output.processedResult"
            :joints="selectedJoints"
            :mode="chartMode"
            :unit="angleUnit"
            :anomalies="currentAnomalies"
            :frame="frame"
          />
        </div>
      </template>
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
  z-index: 4;
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
  font-size: 0.875rem;
  min-width: 0;
  padding: 0 12px;
  letter-spacing: 0;
  text-transform: none;
}
.metrics-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.metrics-controls,
.anomaly-toolbar {
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
.anomaly-list {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.anomaly-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--rro-border);
  border-radius: var(--rro-radius);
  background: transparent;
  color: var(--rro-text);
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}
.anomaly-row:hover {
  background: var(--rro-hover-bg);
}
.anomaly-row--active {
  border-color: var(--rro-accent);
  background: rgba(102, 158, 234, 0.12);
}
.anomaly-frame {
  font-weight: 600;
  min-width: 56px;
}
.anomaly-type {
  font-weight: 600;
}
.anomaly-target {
  color: var(--rro-text-muted);
}
.anomaly-detail {
  color: var(--rro-text-muted);
  flex: 1 1 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  .anomaly-row {
    min-height: var(--rro-tap-target);
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
