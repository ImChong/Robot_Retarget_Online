<script setup lang="ts">
import { computed, ref } from 'vue';
import { icons } from '@/lib/icons';
import { useI18n } from '@/i18n';
import type { IkMatchEntry } from '@/lib/retarget/types';

const props = defineProps<{
  table: Record<string, IkMatchEntry>;
  humanJoints: string[];
  robotBodies: string[];
  /** Row (robot body) selected on the page — from this table or from the 3D view. */
  selectedBody?: string | null;
}>();
const emit = defineEmits<{
  /** Mouse hover preview (touch never hovers, so a tap cannot leave one behind). */
  hover: [robotBody: string | null];
  /** Row tapped (null: the selected row was tapped again). */
  select: [robotBody: string | null];
}>();

const { t } = useI18n();
const expanded = ref<Set<string>>(new Set());

const rows = computed(() => Object.keys(props.table));

const humanOptions = computed(() => {
  const set = new Set(props.humanJoints);
  set.add('LeftFootMod');
  set.add('RightFootMod');
  return [...set];
});

const robotOptions = computed(() => {
  const set = new Set(props.robotBodies.filter((name) => name !== 'world'));
  for (const body of rows.value) set.add(body);
  return [...set].sort();
});

function onRobotBodyChange(oldBody: string, newBody: string) {
  if (oldBody === newBody || !newBody || props.table[newBody] !== undefined) return;
  props.table[newBody] = props.table[oldBody];
  delete props.table[oldBody];
  if (expanded.value.has(oldBody)) {
    const next = new Set(expanded.value);
    next.delete(oldBody);
    next.add(newBody);
    expanded.value = next;
  }
  if (props.selectedBody === oldBody) emit('select', newBody);
}

function toggleExpand(body: string) {
  const next = new Set(expanded.value);
  if (next.has(body)) next.delete(body);
  else next.add(body);
  expanded.value = next;
}

/**
 * A tap on the row selects it; a second tap on its blank space clears it. A tap
 * on one of its controls (to edit it) only ever selects, never clears.
 */
function onRowTap(e: MouseEvent, body: string) {
  const onControl = (e.target as Element | null)?.closest('input, textarea, button, .v-btn, .v-field');
  if (onControl) {
    if (props.selectedBody !== body) emit('select', body);
    return;
  }
  emit('select', props.selectedBody === body ? null : body);
}

function onRowPointer(e: PointerEvent, body: string | null) {
  if (e.pointerType === 'mouse') emit('hover', body);
}

function num(v: string | number): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
</script>

<template>
  <div class="table-x-scroll">
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
          <tr
            class="mapping-row"
            :class="{ highlighted: selectedBody === body }"
            :data-robot-body="body"
            :aria-selected="selectedBody === body"
            @pointerenter="onRowPointer($event, body)"
            @pointerleave="onRowPointer($event, null)"
            @click="onRowTap($event, body)"
          >
            <td>
              <v-btn
                :icon="expanded.has(body) ? icons.caretUp : icons.caretDown"
                size="x-small"
                variant="text"
                @click="toggleExpand(body)"
              />
            </td>
            <td>
              <v-select
                :model-value="body"
                :items="robotOptions"
                density="compact"
                variant="plain"
                hide-details
                class="mono-select"
                @update:model-value="(v: string) => onRobotBodyChange(body, v)"
              />
            </td>
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
              <div class="detail-fields d-flex flex-wrap ga-2 align-center py-1">
                <span class="text-caption text-medium-emphasis">{{ t('posOffset') }}</span>
                <v-text-field
                  v-for="i in 3"
                  :key="'p' + i"
                  :model-value="table[body][3][i - 1]"
                  class="offset-field"
                  type="number"
                  step="0.01"
                  @update:model-value="(v: string) => (table[body][3][i - 1] = num(v))"
                />
                <span class="text-caption text-medium-emphasis detail-rot-label">{{ t('rotOffset') }}</span>
                <v-text-field
                  v-for="i in 4"
                  :key="'q' + i"
                  :model-value="table[body][4][i - 1]"
                  class="offset-field offset-field--rot"
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
  </div>
</template>

<style scoped>
.table-x-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.mapping-table {
  min-width: 520px;
}
.mapping-row {
  cursor: pointer;
}
.mapping-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.mapping-row.highlighted {
  background: rgba(var(--v-theme-primary), 0.16);
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-primary));
}
.mono {
  font-family: var(--rro-font-mono);
  font-size: 0.75rem;
}
.mono-select :deep(.v-field__input) {
  font-family: var(--rro-font-mono);
  font-size: 0.75rem;
}
.detail-row td {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.offset-field {
  max-width: 86px;
}
.offset-field--rot {
  max-width: 96px;
}
.detail-rot-label {
  margin-left: 0;
}
@media (min-width: 600px) {
  .detail-rot-label {
    margin-left: 12px;
  }
}
</style>
