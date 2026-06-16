<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { mdiChevronDown, mdiChevronUp, mdiMagnifyRemoveOutline, mdiDragHorizontalVariant } from '@mdi/js';
import { useI18n } from '@/i18n';
import type { RetargetResult } from '@/lib/retarget/types';
import ErrorChart from '@/components/ErrorChart.vue';
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
const angleUnit = ref<'deg' | 'rad'>('deg');

const errorChartRef = ref<InstanceType<typeof ErrorChart> | null>(null);
const jointChartRef = ref<InstanceType<typeof JointSeriesChart> | null>(null);

const MIN_BODY_H = 168;
const panelBodyH = ref(MIN_BODY_H);
const dragging = ref(false);
const panelRoot = ref<HTMLElement | null>(null);
const maxBodyH = ref(MIN_BODY_H * 3);

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

watch(
  () => props.result.dofNames,
  (names) => {
    selectedJoints.value = defaultJoints(names);
  },
  { immediate: true },
);

const jointItems = computed(() =>
  props.result.dofNames.map((name) => ({
    title: name.replace(/_joint$/, ''),
    value: name,
  })),
);

const showJointPicker = computed(() => activeTab.value !== 'error' && expanded.value);
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
  maxBodyH.value = Math.max(MIN_BODY_H, Math.floor(root.clientHeight * 0.5));
  if (panelBodyH.value > maxBodyH.value) panelBodyH.value = maxBodyH.value;
}

function onResizeDragStart(e: PointerEvent) {
  if (!expanded.value) return;
  dragging.value = true;
  updateMaxHeight();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onResizeDragMove(e: PointerEvent) {
  if (!dragging.value) return;
  const root = panelRoot.value;
  if (!root) return;
  const rect = root.getBoundingClientRect();
  const next = rect.bottom - e.clientY - 36;
  panelBodyH.value = Math.max(MIN_BODY_H, Math.min(maxBodyH.value, next));
  emit('resize');
  resizeActiveChart();
}

function onResizeDragEnd(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
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
onUnmounted(() => ro?.disconnect());

watch(panelBodyH, () => {
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
      class="resize-handle d-flex align-center justify-center"
      :title="t('dragResizeMetrics')"
      @pointerdown="onResizeDragStart"
      @pointermove="onResizeDragMove"
      @pointerup="onResizeDragEnd"
      @pointercancel="onResizeDragEnd"
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
          class="joint-select flex-grow-1"
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
      <v-window v-model="activeTab" class="chart-window mt-1">
        <v-window-item value="error">
          <ErrorChart ref="errorChartRef" :result="result" :frame="frame" />
        </v-window-item>
        <v-window-item value="position">
          <JointSeriesChart
            ref="jointChartRef"
            :result="result"
            :joints="selectedJoints"
            mode="position"
            :unit="angleUnit"
            :frame="frame"
          />
        </v-window-item>
        <v-window-item value="velocity">
          <JointSeriesChart
            ref="jointChartRef"
            :result="result"
            :joints="selectedJoints"
            mode="velocity"
            :unit="angleUnit"
            :frame="frame"
          />
        </v-window-item>
      </v-window>
    </div>
  </div>
</template>

<style scoped>
.metrics-panel {
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.12);
  position: relative;
}
.metrics-panel.dragging {
  user-select: none;
}
.resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 8px;
  cursor: ns-resize;
  z-index: 2;
  transform: translateY(-4px);
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
.joint-select {
  min-width: 0;
  max-width: 100%;
}
.joint-select :deep(.v-field__input) {
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
}
.chart-window :deep(.v-window) {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.chart-window :deep(.v-window__container) {
  flex: 1 1 0;
  min-height: 0;
  height: auto;
}
.chart-window :deep(.v-window-item) {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
