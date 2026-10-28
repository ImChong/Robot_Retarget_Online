<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '@/i18n';

const emit = defineEmits<{ load: [text: string, fileName: string] }>();
const { t } = useI18n();
const dragging = ref(0);

function onDrop(e: DragEvent) {
  dragging.value = 0;
  const file = e.dataTransfer?.files?.[0];
  if (file) readFile(file);
}

async function readFile(file: File) {
  const text = await file.text();
  emit('load', text, file.name);
}

defineExpose({ readFile });
</script>

<template>
  <div
    class="drop-root"
    @dragenter.prevent="dragging++"
    @dragleave.prevent="dragging = Math.max(0, dragging - 1)"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <slot />
    <Transition name="drop-fade">
      <div v-if="dragging > 0" class="drop-overlay d-flex align-center justify-center">
        <div class="text-h5 text-primary">{{ t('dropNow') }}</div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.drop-root {
  position: relative;
  width: 100%;
  height: 100%;
}
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  margin: 8px;
  border-radius: var(--rro-radius-lg);
  background: rgba(var(--v-theme-background), 0.88);
  border: 2px dashed rgba(var(--v-theme-primary), 0.7);
  pointer-events: none;
}
.drop-fade-enter-active,
.drop-fade-leave-active {
  transition: opacity var(--rro-dur-color) var(--rro-ease);
}
.drop-fade-enter-from,
.drop-fade-leave-to {
  opacity: 0;
}
</style>
