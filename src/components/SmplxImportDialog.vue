<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { mdiClose, mdiCubeOutline, mdiRun, mdiUpload } from '@mdi/js';
import { useI18n } from '@/i18n';

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ loaded: [model: Uint8Array, motion: Uint8Array, name: string] }>();

const { t } = useI18n();

const ACCEPT_RE = /\.npz$/i;

const modelFile = ref<File | null>(null);
const motionFile = ref<File | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const modelInput = ref<HTMLInputElement | null>(null);
const motionInput = ref<HTMLInputElement | null>(null);

const canLoad = computed(() => !!modelFile.value && !!motionFile.value && !busy.value);

watch(open, (v) => {
  if (!v) reset();
});

function reset() {
  modelFile.value = null;
  motionFile.value = null;
  error.value = null;
  busy.value = false;
}

function close() {
  open.value = false;
}

function pick(which: 'model' | 'motion', f: File | undefined) {
  if (!f) return;
  if (!ACCEPT_RE.test(f.name)) {
    error.value = t('smplxInvalidFormat');
    return;
  }
  error.value = null;
  if (which === 'model') modelFile.value = f;
  else motionFile.value = f;
}

function onChosen(which: 'model' | 'motion', e: Event) {
  const input = e.target as HTMLInputElement;
  pick(which, input.files?.[0]);
  input.value = '';
}

async function load() {
  if (!modelFile.value || !motionFile.value) return;
  busy.value = true;
  error.value = null;
  try {
    const [model, motion] = await Promise.all([
      modelFile.value.arrayBuffer(),
      motionFile.value.arrayBuffer(),
    ]);
    const name = motionFile.value.name.replace(/\.[^.]+$/, '') + '.bvh';
    emit('loaded', new Uint8Array(model), new Uint8Array(motion), name);
    close();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="560" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between py-3">
        <span class="d-flex align-center ga-2">
          <v-icon :icon="mdiCubeOutline" size="small" />
          {{ t('smplxTitle') }}
        </span>
        <v-btn :icon="mdiClose" variant="text" size="small" @click="close" />
      </v-card-title>

      <v-card-text class="pb-2">
        <p class="text-body-2 text-medium-emphasis mb-3">{{ t('smplxHint') }}</p>

        <!-- SMPL-X model .npz -->
        <div class="pick-row" :class="{ 'pick-row--set': modelFile }">
          <input ref="modelInput" type="file" accept=".npz" class="d-none" @change="(e) => onChosen('model', e)" />
          <v-icon :icon="mdiCubeOutline" size="22" class="text-medium-emphasis" />
          <div class="pick-text">
            <div class="text-body-2 font-weight-medium">{{ t('smplxModelLabel') }}</div>
            <div class="text-caption text-truncate" :class="modelFile ? 'text-high-emphasis' : 'text-disabled'">
              {{ modelFile ? modelFile.name : t('smplxModelDropHint') }}
            </div>
          </div>
          <v-btn variant="tonal" size="small" @click="modelInput?.click()">
            {{ modelFile ? t('smplxChangeFile') : t('smplxSelectFile') }}
          </v-btn>
        </div>

        <!-- AMASS motion .npz -->
        <div class="pick-row mt-2" :class="{ 'pick-row--set': motionFile }">
          <input ref="motionInput" type="file" accept=".npz" class="d-none" @change="(e) => onChosen('motion', e)" />
          <v-icon :icon="mdiRun" size="22" class="text-medium-emphasis" />
          <div class="pick-text">
            <div class="text-body-2 font-weight-medium">{{ t('smplxMotionLabel') }}</div>
            <div class="text-caption text-truncate" :class="motionFile ? 'text-high-emphasis' : 'text-disabled'">
              {{ motionFile ? motionFile.name : t('smplxMotionDropHint') }}
            </div>
          </div>
          <v-btn variant="tonal" size="small" @click="motionInput?.click()">
            {{ motionFile ? t('smplxChangeFile') : t('smplxSelectFile') }}
          </v-btn>
        </div>

        <v-alert v-if="error" type="error" density="compact" variant="tonal" class="mt-3 text-body-2">
          {{ error }}
        </v-alert>

        <p class="text-caption text-disabled mt-3 mb-0">{{ t('smplxLicenseNote') }}</p>
        <p class="text-caption text-disabled mt-1 mb-0">{{ t('smplxPrivacyNote') }}</p>
      </v-card-text>

      <v-card-actions class="px-4 pb-3">
        <v-spacer />
        <v-btn variant="text" @click="close">{{ t('cancel') }}</v-btn>
        <v-btn color="primary" :prepend-icon="mdiUpload" :disabled="!canLoad" :loading="busy" @click="load">
          {{ t('smplxLoad') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.pick-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 8px;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}
.pick-row--set {
  border-color: rgba(79, 195, 247, 0.7);
  background: rgba(79, 195, 247, 0.06);
}
.pick-text {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
