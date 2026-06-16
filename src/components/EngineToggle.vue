<script setup lang="ts">
import { useI18n } from '@/i18n';
import { useRetargetStore, type RetargetEngineId } from '@/stores/retarget';

defineProps<{ disabled?: boolean }>();

const { t } = useI18n();
const store = useRetargetStore();

const GMR_URL = 'https://github.com/YanjieZe/GMR';
const OMNI_URL = 'https://omniretarget.github.io/';

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
    <div class="text-caption text-medium-emphasis mt-1 engine-desc">
      <template v-if="store.engine === 'omniretarget'">
        <a
          class="engine-desc-link"
          :href="OMNI_URL"
          target="_blank"
          rel="noopener noreferrer"
          :title="t('engineOmni')"
        >{{ t('engineOmni') }}</a>{{ t('engineOmniDescSuffix') }}
      </template>
      <template v-else>
        <a
          class="engine-desc-link"
          :href="GMR_URL"
          target="_blank"
          rel="noopener noreferrer"
          :title="t('engineGmr')"
        >{{ t('engineGmr') }}</a>{{ t('engineGmrDescSuffix') }}
      </template>
    </div>
  </div>
</template>

<style scoped>
.engine-btns {
  width: 100%;
}
.engine-desc {
  line-height: 1.35;
}

.engine-desc-link {
  color: inherit;
  text-decoration: none;
}

.engine-desc-link:hover {
  text-decoration: underline;
  color: rgb(var(--v-theme-primary));
}
</style>
