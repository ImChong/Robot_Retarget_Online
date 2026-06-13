<script setup lang="ts">
import { ref, watch } from 'vue';
import { mdiClose, mdiUpload } from '@mdi/js';
import { useI18n } from '@/i18n';
import { useRetargetStore } from '@/stores/retarget';

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ imported: [] }>();

const { t } = useI18n();
const store = useRetargetStore();

const dragging = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const ACCEPT_RE = /\.(urdf|xml|zip)$/i;

watch(open, (v) => {
  if (!v) {
    dragging.value = 0;
    loading.value = false;
    error.value = null;
  }
});

function close() {
  open.value = false;
}

function isValidFile(file: File): boolean {
  return ACCEPT_RE.test(file.name);
}

async function importFile(file: File) {
  if (!isValidFile(file)) {
    error.value = t('urdfInvalidFormat');
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    await store.importCustomRobot(file);
    emit('imported');
    close();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function onDrop(e: DragEvent) {
  dragging.value = 0;
  const file = e.dataTransfer?.files?.[0];
  if (file) void importFile(file);
}

function onFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void importFile(file);
  (e.target as HTMLInputElement).value = '';
}
</script>

<template>
  <v-dialog v-model="open" max-width="560" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between py-3">
        <span>{{ t('urdfSpecTitle') }}</span>
        <v-btn :icon="mdiClose" variant="text" size="small" :disabled="loading" @click="close" />
      </v-card-title>

      <v-card-text class="pb-2">
        <ul class="spec-list text-body-2 text-medium-emphasis">
          <li>{{ t('urdfSpecFormats') }}</li>
          <li>{{ t('urdfSpecZip') }}</li>
          <li>{{ t('urdfSpecUrdf') }}</li>
          <li><code class="spec-code">{{ t('urdfSpecCompilerSnippet') }}</code></li>
          <li>{{ t('urdfSpecMeshes') }}</li>
          <li>{{ t('urdfSpecFloating') }}</li>
          <li>{{ t('urdfSpecLimits') }}</li>
          <li>{{ t('urdfSessionHint') }}</li>
        </ul>

        <div
          class="drop-zone mt-4"
          :class="{ 'drop-zone--active': dragging > 0, 'drop-zone--loading': loading }"
          @dragenter.prevent="dragging++"
          @dragleave.prevent="dragging = Math.max(0, dragging - 1)"
          @dragover.prevent
          @drop.prevent="onDrop"
        >
          <input
            ref="fileInput"
            type="file"
            accept=".urdf,.xml,.zip,.URDF,.XML,.ZIP"
            class="d-none"
            @change="onFileChosen"
          />
          <v-progress-circular v-if="loading" indeterminate size="28" width="3" color="primary" class="mb-2" />
          <div v-else class="text-h6 font-weight-medium mb-1">{{ t('urdfDropTitle') }}</div>
          <div class="text-body-2 text-medium-emphasis text-center px-4">{{ t('urdfDropHint') }}</div>
          <v-btn
            v-if="!loading"
            class="mt-3"
            variant="tonal"
            size="small"
            :prepend-icon="mdiUpload"
            @click="fileInput?.click()"
          >
            {{ t('urdfBrowse') }}
          </v-btn>
        </div>

        <v-alert v-if="error" type="error" density="compact" variant="tonal" class="mt-3 text-body-2">
          {{ error }}
        </v-alert>
      </v-card-text>

      <v-card-actions class="px-4 pb-3">
        <v-spacer />
        <v-btn variant="text" :disabled="loading" @click="close">{{ t('close') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.spec-list {
  padding-left: 1.1rem;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.spec-code {
  display: block;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.78rem;
  padding: 0.4rem 0.55rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
}
.drop-zone {
  min-height: 148px;
  border: 2px dashed rgba(79, 195, 247, 0.45);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.25rem 1rem;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}
.drop-zone--active {
  border-color: rgba(79, 195, 247, 0.95);
  background: rgba(79, 195, 247, 0.08);
}
.drop-zone--loading {
  pointer-events: none;
  opacity: 0.85;
}
</style>
