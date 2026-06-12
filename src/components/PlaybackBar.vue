<script setup lang="ts">
import { computed } from 'vue';
import { mdiPlay, mdiPause, mdiSkipPrevious, mdiSkipNext, mdiRestart } from '@mdi/js';
import { useI18n } from '@/i18n';
import type { PlaybackController } from '@/composables/usePlayback';

const props = defineProps<{ controller: PlaybackController }>();
const { t } = useI18n();

const state = props.controller.state;

const sliderValue = computed({
  get: () => Math.floor(state.frame),
  set: (v: number) => props.controller.seek(v),
});

const timeLabel = computed(() => {
  const cur = state.fps > 0 ? state.frame / state.fps : 0;
  const total = state.fps > 0 ? state.frameCount / state.fps : 0;
  return `${cur.toFixed(2)}s / ${total.toFixed(2)}s`;
});

const speeds = [0.25, 0.5, 1, 1.5, 2];

function step(delta: number) {
  state.playing = false;
  const f = Math.floor(state.frame) + delta;
  props.controller.seek(Math.max(0, Math.min(f, state.frameCount - 1)));
}
</script>

<template>
  <div class="playback-bar d-flex align-center px-3 py-1 ga-2">
    <v-btn :icon="mdiSkipPrevious" size="small" variant="text" @click="step(-1)" />
    <v-btn
      :icon="state.playing ? mdiPause : mdiPlay"
      color="primary"
      size="small"
      variant="tonal"
      @click="controller.toggle()"
    />
    <v-btn :icon="mdiSkipNext" size="small" variant="text" @click="step(1)" />

    <v-slider
      v-model="sliderValue"
      class="flex-grow-1 mx-2"
      :min="0"
      :max="Math.max(state.frameCount - 1, 0)"
      :step="1"
      color="primary"
      track-size="3"
      thumb-size="12"
    />

    <span class="text-caption text-medium-emphasis frame-label">
      {{ t('frame') }} {{ Math.floor(state.frame) }} / {{ Math.max(state.frameCount - 1, 0) }}
      · {{ timeLabel }}
    </span>

    <v-select
      v-model="state.speed"
      :items="speeds"
      style="max-width: 92px"
      density="compact"
      variant="outlined"
      hide-details
    >
      <template #selection="{ item }">{{ item.value }}×</template>
    </v-select>

    <v-btn
      :icon="mdiRestart"
      size="small"
      variant="text"
      :color="state.loop ? 'primary' : undefined"
      :title="t('loop')"
      @click="state.loop = !state.loop"
    />
  </div>
</template>

<style scoped>
.playback-bar {
  background: rgba(29, 32, 38, 0.92);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.frame-label {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
