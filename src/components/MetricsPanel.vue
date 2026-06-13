<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { mdiChevronDown, mdiChevronUp } from '@mdi/js';
import { useI18n } from '@/i18n';
import type { RetargetResult } from '@/lib/retarget/types';
import ErrorChart from '@/components/ErrorChart.vue';
import JointSeriesChart from '@/components/JointSeriesChart.vue';

const props = defineProps<{
  result: RetargetResult;
  frame: number;
}>();

const { t } = useI18n();

const activeTab = ref<'error' | 'position' | 'velocity'>('error');
const expanded = ref(true);
const selectedJoints = ref<string[]>([]);

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
</script>

<template>
  <div class="metrics-panel">
    <div class="metrics-header d-flex align-center">
      <v-tabs v-model="activeTab" density="compact" color="primary" show-arrows class="flex-grow-1">
        <v-tab value="error">{{ t('errorChart') }}</v-tab>
        <v-tab value="position">{{ t('jointPositionChart') }}</v-tab>
        <v-tab value="velocity">{{ t('jointVelocityChart') }}</v-tab>
      </v-tabs>
      <v-btn
        variant="text"
        size="small"
        density="compact"
        :icon="expanded ? mdiChevronDown : mdiChevronUp"
        :title="expanded ? t('collapseMetrics') : t('expandMetrics')"
        @click="expanded = !expanded"
      />
    </div>

    <div v-show="expanded" class="metrics-body px-3 pb-2">
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
        class="joint-select mt-2 mb-1"
        :menu-props="{ maxHeight: 280 }"
      />
      <v-window v-model="activeTab" class="mt-1">
        <v-window-item value="error">
          <ErrorChart :result="result" :frame="frame" />
        </v-window-item>
        <v-window-item value="position">
          <JointSeriesChart :result="result" :joints="selectedJoints" mode="position" :frame="frame" />
        </v-window-item>
        <v-window-item value="velocity">
          <JointSeriesChart :result="result" :joints="selectedJoints" mode="velocity" :frame="frame" />
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
.joint-select {
  max-width: 100%;
}
.joint-select :deep(.v-field__input) {
  flex-wrap: wrap;
  gap: 4px;
}
</style>
