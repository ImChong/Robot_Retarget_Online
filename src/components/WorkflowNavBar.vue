<script setup lang="ts">
import { computed } from 'vue';
import { icons } from '@/lib/icons';
import { useI18n } from '@/i18n';
import { useWorkflowNav } from '@/composables/useWorkflowNav';
import { useRetargetStore } from '@/stores/retarget';

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
const retarget = useRetargetStore();

const progressPct = computed(() =>
  retarget.runProgress.total > 0
    ? (100 * retarget.runProgress.done) / retarget.runProgress.total
    : 0,
);

const runRetargetTooltip = computed(() => {
  if (!canGoConfig.value) return t('noMotionHint');
  if (isLoadingRobot.value) {
    return retarget.isCustomRobot ? t('loadingUrdfHint') : t('loadingRobot');
  }
  return t('runRetarget');
});
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
              :append-icon="icons.caretRight"
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
      <div class="workflow-nav__config-group">
        <div class="workflow-nav__actions">
          <v-tooltip :text="t('workflowPrevHint')" location="bottom">
            <template #activator="{ props: tipProps }">
              <span v-bind="tipProps" class="workflow-nav__activator">
                <v-btn variant="tonal" size="small" :prepend-icon="icons.caretLeft" @click="goToBvh">
                  {{ t('workflowPrev') }}
                </v-btn>
              </span>
            </template>
          </v-tooltip>

          <v-tooltip :text="runRetargetTooltip" location="bottom">
            <template #activator="{ props: tipProps }">
              <span v-bind="tipProps" class="workflow-nav__activator workflow-nav__run-slot">
                <v-btn
                  color="primary"
                  variant="flat"
                  size="small"
                  :prepend-icon="icons.play"
                  :disabled="!canGoConfig || isLoadingRobot"
                  :class="{ 'workflow-nav__run-btn--hidden': isRetargetRunning }"
                  @click="runRetarget"
                >
                  {{ t('runRetarget') }}
                </v-btn>
                <v-btn
                  color="error"
                  variant="tonal"
                  size="small"
                  :prepend-icon="icons.stop"
                  :class="{ 'workflow-nav__run-btn--hidden': !isRetargetRunning }"
                  @click="cancelRetarget"
                >
                  {{ t('cancel') }}
                </v-btn>
              </span>
            </template>
          </v-tooltip>
        </div>

        <v-progress-linear
          v-if="isRetargetRunning"
          :model-value="progressPct"
          color="primary"
          height="16"
          rounded
          class="workflow-nav__progress"
        >
          <span class="text-caption">
            {{ t('retargeting') }} {{ retarget.runProgress.done }}/{{ retarget.runProgress.total }}
          </span>
        </v-progress-linear>
      </div>
    </template>

    <template v-else-if="step === 'preview'">
      <v-tooltip :text="t('workflowPrevHint')" location="bottom">
        <template #activator="{ props: tipProps }">
          <span v-bind="tipProps" class="workflow-nav__activator">
            <v-btn variant="tonal" size="small" :prepend-icon="icons.caretLeft" @click="goToBvh">
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
              :prepend-icon="icons.caretLeft"
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
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  /* Concentric corners: 12px outside, 4px gap, so the 8px buttons inside line up. */
  padding: 4px;
  border-radius: var(--rro-radius-lg);
  /* Opaque pill, so it takes its own taps rather than passing them through.
     It used to be pointer-events: none with the children opting back in, which
     left every button here under a pointer-events: none ancestor — a pattern
     iOS was observed treating as non-activatable. .viewport-overlays above it
     stays click-through, so the rest of the 3D viewport still orbits. */
  pointer-events: auto;
  /* No backdrop-filter: this floats over the WebGL canvas, which backdrop-filter
     cannot blur anyway (the reason src/lib/sponsorCanvasBlur.ts exists), so it
     only cost a compositing layer. Raise the tint to stay legible without it. */
  background: rgba(var(--v-theme-surface), 0.9);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: var(--rro-shadow-float);
}

.workflow-nav__activator {
  display: inline-flex;
}

.workflow-nav__config-group {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.workflow-nav__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.workflow-nav__run-slot {
  display: inline-grid;
}

.workflow-nav__run-slot > .v-btn {
  grid-area: 1 / 1;
  width: 100%;
}

.workflow-nav__run-btn--hidden {
  visibility: hidden;
  pointer-events: none;
}

.workflow-nav__progress {
  pointer-events: none;
}
</style>
