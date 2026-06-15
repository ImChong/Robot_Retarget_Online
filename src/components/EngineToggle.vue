<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/i18n';
import { useRetargetStore, type RetargetEngineId } from '@/stores/retarget';

defineProps<{ disabled?: boolean }>();

const { t } = useI18n();
const store = useRetargetStore();

const desc = computed(() =>
  store.engine === 'omniretarget' ? t('engineOmniDesc') : t('engineGmrDesc'),
);

function onSelect(value: unknown) {
  if (value === 'gmr' || value === 'omniretarget') {
    store.setEngine(value as RetargetEngineId);
  }
}
</script>

<template>
  <div class="engine-toggle">
    <div class="text-caption text-medium-emphasis mb-1">{{ t('engine') }}</div>
    <v-btn-toggle
      :model-value="store.engine"
      mandatory
      density="comfortable"
      color="primary"
      variant="outlined"
      divided
      class="engine-btns"
      :disabled="disabled"
      @update:model-value="onSelect"
    >
      <v-btn value="gmr" size="small" class="flex-grow-1">{{ t('engineGmr') }}</v-btn>
      <v-btn value="omniretarget" size="small" class="flex-grow-1">{{ t('engineOmni') }}</v-btn>
    </v-btn-toggle>
    <div class="text-caption text-medium-emphasis mt-1 engine-desc">{{ desc }}</div>
  </div>
</template>

<style scoped>
.engine-btns {
  width: 100%;
}
.engine-desc {
  line-height: 1.35;
}
</style>
