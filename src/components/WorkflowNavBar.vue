<script setup lang="ts">
import { mdiChevronLeft, mdiChevronRight, mdiPlayCircle, mdiStopCircle } from '@mdi/js';
import { useI18n } from '@/i18n';
import { useWorkflowNav } from '@/composables/useWorkflowNav';

defineProps<{
  /** `bar` = desktop strip; `inline` = compact row above playback bar on mobile */
  variant?: 'bar' | 'inline';
}>();

const { t } = useI18n();
const { step, canGoConfig, isBusy, goToConfig, goToBvh, runRetarget, cancelRetarget } = useWorkflowNav();
</script>

<template>
  <div
    class="workflow-nav"
    :class="{
      'workflow-nav--bar': variant === 'bar',
      'workflow-nav--inline': variant === 'inline',
    }"
  >
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
              v-if="!isBusy"
              color="primary"
              variant="flat"
              size="small"
              :prepend-icon="mdiPlayCircle"
              :disabled="!canGoConfig"
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
  </div>
</template>

<style scoped>
.workflow-nav {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.workflow-nav--bar {
  width: 100%;
}

.workflow-nav--inline {
  padding: 8px 12px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
}

.workflow-nav__activator {
  display: inline-flex;
}
</style>
