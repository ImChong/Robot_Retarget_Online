<script setup lang="ts">
import { computed } from 'vue';
import type { BvhAnim } from '@/lib/bvh/parse';

const props = defineProps<{
  anim: BvhAnim;
  selected: number | null;
}>();
const emit = defineEmits<{ select: [index: number | null] }>();

interface Row {
  index: number;
  name: string;
  depth: number;
  channels: number;
}

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  const depths: number[] = [];
  props.anim.joints.forEach((j, i) => {
    const depth = j.parent < 0 ? 0 : depths[j.parent] + 1;
    depths.push(depth);
    out.push({ index: i, name: j.name, depth, channels: j.channels.length });
  });
  return out;
});

function toggle(index: number) {
  emit('select', props.selected === index ? null : index);
}
</script>

<template>
  <div class="joint-tree">
    <div
      v-for="row in rows"
      :key="row.index"
      class="joint-row text-body-2"
      :class="{ selected: selected === row.index }"
      :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
      @click="toggle(row.index)"
    >
      <span class="joint-dot" :style="{ opacity: row.depth === 0 ? 1 : 0.55 }" />
      {{ row.name }}
      <span class="text-caption text-disabled ml-1">{{ row.channels }}ch</span>
    </div>
  </div>
</template>

<style scoped>
.joint-tree {
  overflow-y: auto;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}
.joint-row {
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.joint-row:hover {
  background: rgba(255, 255, 255, 0.06);
}
.joint-row.selected {
  background: rgba(255, 183, 77, 0.18);
  color: #ffb74d;
}
.joint-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4fc3f7;
  margin-right: 6px;
}
</style>
