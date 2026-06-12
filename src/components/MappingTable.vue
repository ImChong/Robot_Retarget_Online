<script setup lang="ts">
import { computed } from 'vue';
import { mdiChevronDown, mdiChevronUp } from '@mdi/js';
import { ref } from 'vue';
import { useI18n } from '@/i18n';
import type { IkMatchEntry } from '@/lib/retarget/types';

const props = defineProps<{
  table: Record<string, IkMatchEntry>;
  humanJoints: string[];
}>();
const emit = defineEmits<{ highlight: [robotBody: string | null] }>();

const { t } = useI18n();
const expanded = ref<Set<string>>(new Set());

const rows = computed(() => Object.keys(props.table));

const humanOptions = computed(() => {
  const set = new Set(props.humanJoints);
  // virtual joints GMR adds for LAFAN1
  set.add('LeftFootMod');
  set.add('RightFootMod');
  return [...set];
});

function toggleExpand(body: string) {
  const next = new Set(expanded.value);
  if (next.has(body)) next.delete(body);
  else next.add(body);
  expanded.value = next;
}

function num(v: string | number): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
</script>

<template>
  <v-table density="compact" class="mapping-table">
    <thead>
      <tr>
        <th style="width: 28px"></th>
        <th>{{ t('robotBody') }}</th>
        <th>{{ t('humanJoint') }}</th>
        <th style="width: 110px">{{ t('posWeight') }}</th>
        <th style="width: 110px">{{ t('rotWeight') }}</th>
      </tr>
    </thead>
    <tbody>
      <template v-for="body in rows" :key="body">
        <tr @mouseenter="emit('highlight', body)" @mouseleave="emit('highlight', null)">
          <td>
            <v-btn
              :icon="expanded.has(body) ? mdiChevronUp : mdiChevronDown"
              size="x-small"
              variant="text"
              @click="toggleExpand(body)"
            />
          </td>
          <td class="mono">{{ body }}</td>
          <td>
            <v-select
              v-model="table[body][0]"
              :items="humanOptions"
              density="compact"
              variant="plain"
              hide-details
            />
          </td>
          <td>
            <v-text-field
              :model-value="table[body][1]"
              type="number"
              min="0"
              @update:model-value="(v: string) => (table[body][1] = num(v))"
            />
          </td>
          <td>
            <v-text-field
              :model-value="table[body][2]"
              type="number"
              min="0"
              @update:model-value="(v: string) => (table[body][2] = num(v))"
            />
          </td>
        </tr>
        <tr v-if="expanded.has(body)" class="detail-row">
          <td></td>
          <td colspan="4">
            <div class="d-flex flex-wrap ga-2 align-center py-1">
              <span class="text-caption text-medium-emphasis">{{ t('posOffset') }}</span>
              <v-text-field
                v-for="i in 3"
                :key="'p' + i"
                :model-value="table[body][3][i - 1]"
                style="max-width: 86px"
                type="number"
                step="0.01"
                @update:model-value="(v: string) => (table[body][3][i - 1] = num(v))"
              />
              <span class="text-caption text-medium-emphasis ml-3">{{ t('rotOffset') }}</span>
              <v-text-field
                v-for="i in 4"
                :key="'q' + i"
                :model-value="table[body][4][i - 1]"
                style="max-width: 96px"
                type="number"
                step="0.01"
                @update:model-value="(v: string) => (table[body][4][i - 1] = num(v))"
              />
            </div>
          </td>
        </tr>
      </template>
    </tbody>
  </v-table>
</template>

<style scoped>
.mono {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.82rem;
}
.detail-row td {
  background: rgba(255, 255, 255, 0.03);
}
</style>
