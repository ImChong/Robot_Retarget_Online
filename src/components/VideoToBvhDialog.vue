<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { mdiClose, mdiVideoOutline, mdiAutoFix } from '@mdi/js';
import { useI18n } from '@/i18n';
import { videoToBvh } from '@/lib/mocap';

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ generated: [text: string, name: string] }>();

const { t } = useI18n();

type Phase = 'idle' | 'processing' | 'done' | 'error';

const file = ref<File | null>(null);
const phase = ref<Phase>('idle');
const done = ref(0);
const total = ref(0);
const error = ref<string | null>(null);
const emptyRatio = ref(0);
const dragging = ref(0);
const fileInput = ref<HTMLInputElement | null>(null);
let abort: AbortController | null = null;

const ACCEPT_RE = /\.(mp4|webm|mov|m4v|ogg|ogv)$/i;

const progressPct = computed(() => (total.value ? Math.round((done.value / total.value) * 100) : 0));
const lowQuality = computed(() => emptyRatio.value > 0.4);

watch(open, (v) => {
  if (!v) reset();
});

function reset() {
  abort?.abort();
  abort = null;
  file.value = null;
  phase.value = 'idle';
  done.value = 0;
  total.value = 0;
  error.value = null;
  emptyRatio.value = 0;
  dragging.value = 0;
}

function close() {
  open.value = false;
}

function pickFile(f: File | undefined) {
  if (!f) return;
  if (!ACCEPT_RE.test(f.name)) {
    error.value = t('videoInvalidFormat');
    phase.value = 'error';
    return;
  }
  file.value = f;
  error.value = null;
  phase.value = 'idle';
}

function onFileChosen(e: Event) {
  pickFile((e.target as HTMLInputElement).files?.[0]);
  (e.target as HTMLInputElement).value = '';
}

function onDrop(e: DragEvent) {
  dragging.value = 0;
  pickFile(e.dataTransfer?.files?.[0]);
}

async function generate() {
  if (!file.value) return;
  phase.value = 'processing';
  error.value = null;
  done.value = 0;
  total.value = 0;
  abort = new AbortController();
  try {
    const res = await videoToBvh(file.value, {
      targetFps: 30,
      signal: abort.signal,
      onProgress: (d, tot) => {
        done.value = d;
        total.value = tot;
      },
    });
    emptyRatio.value = res.emptyRatio;
    const name = file.value.name.replace(/\.[^.]+$/, '') + '.bvh';
    emit('generated', res.bvh, name);
    if (lowQuality.value) {
      phase.value = 'done'; // keep open to surface the quality warning
    } else {
      close();
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      phase.value = 'idle';
      return;
    }
    error.value = err instanceof Error ? err.message : String(err);
    phase.value = 'error';
  } finally {
    abort = null;
  }
}

function cancel() {
  abort?.abort();
}
</script>

<template>
  <v-dialog v-model="open" max-width="560" scrollable :persistent="phase === 'processing'">
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between py-3">
        <span class="d-flex align-center ga-2">
          <v-icon :icon="mdiVideoOutline" size="small" />
          {{ t('videoToBvhTitle') }}
        </span>
        <v-btn :icon="mdiClose" variant="text" size="small" :disabled="phase === 'processing'" @click="close" />
      </v-card-title>

      <v-card-text class="pb-2">
        <p class="text-body-2 text-medium-emphasis mb-3">{{ t('videoToBvhHint') }}</p>

        <!-- Drop / pick zone -->
        <div
          class="drop-zone"
          :class="{ 'drop-zone--active': dragging > 0, 'drop-zone--disabled': phase === 'processing' }"
          @dragenter.prevent="dragging++"
          @dragleave.prevent="dragging = Math.max(0, dragging - 1)"
          @dragover.prevent
          @drop.prevent="onDrop"
        >
          <input
            ref="fileInput"
            type="file"
            accept="video/*,.mp4,.webm,.mov,.m4v,.ogv"
            class="d-none"
            @change="onFileChosen"
          />
          <template v-if="file">
            <v-icon :icon="mdiVideoOutline" size="32" class="mb-1 text-medium-emphasis" />
            <div class="text-body-2 font-weight-medium text-truncate file-name">{{ file.name }}</div>
            <v-btn
              v-if="phase !== 'processing'"
              class="mt-2"
              variant="text"
              size="x-small"
              @click="fileInput?.click()"
            >
              {{ t('videoChangeFile') }}
            </v-btn>
          </template>
          <template v-else>
            <div class="text-body-1 font-weight-medium mb-1">{{ t('videoDropTitle') }}</div>
            <div class="text-body-2 text-medium-emphasis text-center px-4">{{ t('videoDropHint') }}</div>
            <v-btn class="mt-3" variant="tonal" size="small" :prepend-icon="mdiVideoOutline" @click="fileInput?.click()">
              {{ t('selectVideo') }}
            </v-btn>
          </template>
        </div>

        <!-- Progress -->
        <div v-if="phase === 'processing'" class="mt-4">
          <div class="d-flex justify-space-between text-body-2 mb-1">
            <span>{{ t('processingVideo') }}</span>
            <span>{{ done }} / {{ total }} ({{ progressPct }}%)</span>
          </div>
          <v-progress-linear :model-value="progressPct" color="primary" height="6" rounded />
        </div>

        <!-- Quality warning after a low-confidence run -->
        <v-alert v-if="phase === 'done' && lowQuality" type="warning" density="compact" variant="tonal" class="mt-3 text-body-2">
          {{ t('videoQualityWarning') }}
        </v-alert>

        <v-alert v-if="phase === 'error' && error" type="error" density="compact" variant="tonal" class="mt-3 text-body-2">
          {{ error }}
        </v-alert>

        <p class="text-caption text-disabled mt-3 mb-0">{{ t('videoPrivacyNote') }}</p>
        <p class="text-caption text-disabled mt-1 mb-0">{{ t('videoLimitations') }}</p>
      </v-card-text>

      <v-card-actions class="px-4 pb-3">
        <v-spacer />
        <template v-if="phase === 'processing'">
          <v-btn variant="text" @click="cancel">{{ t('cancel') }}</v-btn>
        </template>
        <template v-else-if="phase === 'done'">
          <v-btn variant="tonal" color="primary" @click="close">{{ t('close') }}</v-btn>
        </template>
        <template v-else>
          <v-btn variant="text" @click="close">{{ t('cancel') }}</v-btn>
          <v-btn color="primary" :prepend-icon="mdiAutoFix" :disabled="!file" @click="generate">
            {{ t('generateBvh') }}
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.drop-zone {
  min-height: 132px;
  border: 2px dashed rgba(79, 195, 247, 0.45);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}
.drop-zone--active {
  border-color: rgba(79, 195, 247, 0.95);
  background: rgba(79, 195, 247, 0.08);
}
.drop-zone--disabled {
  pointer-events: none;
  opacity: 0.7;
}
.file-name {
  max-width: 100%;
}
</style>
