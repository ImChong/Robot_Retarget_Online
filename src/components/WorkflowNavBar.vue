<script setup lang="ts">
import { mdiChevronLeft, mdiChevronRight, mdiPlayCircle, mdiStopCircle } from '@mdi/js';
import { useI18n } from '@/i18n';
import { useWorkflowNav } from '@/composables/useWorkflowNav';

const { t } = useI18n();
const {
  step,
  canGoConfig,
  isLoadingRobot,
  isRetargetRunning,
  goToConfig,
  goToBvh,
  runRetarget,
  cancelRetarget,
} = useWorkflowNav();
</script>

<template>
  <div class="workflow-nav">
    <template v-if="step === 'bvh'">
      <v-tooltip :text="canGoConfig ? t('workflowNextHint') : t('workflowNextDisabledHint')" location="bottom">
        <template #activator="{ props: tipProps }">
          <span v-bind="tipProps" class="workflow-nav__activator">
            <v-btn
              color="primary"
              variant="flat"
              size="small"
              :append-icon="mdiChevronRight"
              :disabled="!canGoConfig"
              @click="goToConfig"
            >
              {{ t('workflowNext') }}
            </v-btn>
          </span>
        </template>
      </v-tooltip>
    </template>

    <template v-else-if="step === 'config'">
      <v-tooltip :text="t('workflowPrevHint')" location="bottom">
        <template #activator="{ props: tipProps }">
          <span v-bind="tipProps" class="workflow-nav__activator">
            <v-btn variant="tonal" size="small" :prepend-icon="mdiChevronLeft" @click="goToBvh">
              {{ t('workflowPrev') }}
            </v-btn>
          </span>
        </template>
      </v-tooltip>

      <v-tooltip :text="canGoConfig ? t('runRetarget') : t('noMotionHint')" location="bottom">
        <template #activator="{ props: tipProps }">
          <span v-bind="tipProps" class="workflow-nav__activator">
            <v-btn
              v-if="!isRetargetRunning"
              color="primary"
              variant="flat"
              size="small"
              :prepend-icon="mdiPlayCircle"
              :disabled="!canGoConfig || isLoadingRobot"
              @click="runRetarget"
            >
              {{ t('runRetarget') }}
            </v-btn>
            <v-btn
              v-else
              color="error"
              variant="tonal"
              size="small"
              :prepend-icon="mdiStopCircle"
              @click="cancelRetarget"
            >
              {{ t('cancel') }}
            </v-btn>
          </span>
        </template>
      </v-tooltip>
    </template>

    <template v-else-if="step === 'preview'">
      <v-tooltip :text="t('workflowPrevHint')" location="bottom">
        <template #activator="{ props: tipProps }">
          <span v-bind="tipProps" class="workflow-nav__activator">
            <v-btn variant="tonal" size="small" :prepend-icon="mdiChevronLeft" @click="goToBvh">
              {{ t('workflowBackBvh') }}
            </v-btn>
          </span>
        </template>
      </v-tooltip>

      <v-tooltip :text="t('workflowBackConfigHint')" location="bottom">
        <template #activator="{ props: tipProps }">
          <span v-bind="tipProps" class="workflow-nav__activator">
            <v-btn
              variant="tonal"
              size="small"
              :prepend-icon="mdiChevronLeft"
              :disabled="!canGoConfig"
              @click="goToConfig"
            >
              {{ t('workflowBackConfig') }}
            </v-btn>
          </span>
        </template>
      </v-tooltip>
    </template>
  </div>
</template>

<style scoped>
.workflow-nav {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 10px;
  pointer-events: none;
  background: rgba(var(--v-theme-surface), 0.78);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.28);
}

.workflow-nav__activator {
  display: inline-flex;
  pointer-events: auto;
}
</style>
