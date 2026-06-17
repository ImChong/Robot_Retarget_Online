<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { mdiPlay, mdiPause, mdiSkipPrevious, mdiSkipNext, mdiRestart } from '@mdi/js';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useAppTheme } from '@/composables/useAppTheme';
import type { PlaybackController } from '@/composables/usePlayback';

const props = defineProps<{ controller: PlaybackController }>();
const { t } = useI18n();
const { isDark } = useAppTheme();
const { smAndDown } = useDisplay();

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

const frameShort = computed(
  () => `${Math.floor(state.frame)} / ${Math.max(state.frameCount - 1, 0)}`,
);

const speeds = [0.25, 0.5, 1, 1.5, 2];

function step(delta: number) {
  props.controller.pause();
  const f = Math.floor(state.frame) + delta;
  props.controller.seek(Math.max(0, Math.min(f, state.frameCount - 1)));
}

function togglePlayback() {
  props.controller.toggle();
}

function shouldIgnorePlaybackKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="option"]',
    )
  ) {
    return true;
  }
  return !!document.querySelector('.v-overlay--active');
}

function onKeyDown(e: KeyboardEvent) {
  if (shouldIgnorePlaybackKeys(e.target)) return;
  if (state.frameCount <= 0) return;

  if (e.code === 'Space') {
    e.preventDefault();
    togglePlayback();
    return;
  }
  if (e.code === 'ArrowLeft') {
    e.preventDefault();
    step(-1);
    return;
  }
  if (e.code === 'ArrowRight') {
    e.preventDefault();
    step(1);
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template>
  <div
    class="playback-bar"
    :class="{ 'playback-bar--compact': smAndDown, 'playback-bar--light': !isDark }"
  >
    <div class="playback-row playback-row--transport d-flex align-center ga-1">
      <v-btn
        :icon="mdiSkipPrevious"
        size="small"
        variant="text"
        :title="t('prevFrame')"
        @click="step(-1)"
      />
      <v-btn
        :icon="state.playing ? mdiPause : mdiPlay"
        color="primary"
        size="small"
        variant="tonal"
        :title="state.playing ? t('pause') : t('play')"
        @click="togglePlayback"
      />
      <v-btn :icon="mdiSkipNext" size="small" variant="text" :title="t('nextFrame')" @click="step(1)" />

      <v-slider
        v-model="sliderValue"
        class="flex-grow-1 mx-1"
        :min="0"
        :max="Math.max(state.frameCount - 1, 0)"
        :step="1"
        color="primary"
        track-size="3"
        thumb-size="12"
        hide-details
      />

      <v-btn
        :icon="mdiRestart"
        size="small"
        variant="text"
        :color="state.loop ? 'primary' : undefined"
        :title="t('loop')"
        @click="state.loop = !state.loop"
      />
    </div>

    <div class="playback-row playback-row--meta d-flex align-center ga-2 px-1">
      <span class="text-caption text-medium-emphasis frame-label">
        <template v-if="smAndDown">{{ frameShort }} · {{ timeLabel }}</template>
        <template v-else>
          {{ t('frame') }} {{ Math.floor(state.frame) }} / {{ Math.max(state.frameCount - 1, 0) }}
          · {{ timeLabel }}
        </template>
      </span>

      <v-spacer v-if="smAndDown" />

      <v-select
        v-model="state.speed"
        :items="speeds"
        class="speed-select"
        density="compact"
        variant="outlined"
        hide-details
      >
        <template #selection="{ item }">{{ item.value }}×</template>
      </v-select>
    </div>
  </div>
</template>

<style scoped>
.playback-bar {
  background: rgba(29, 32, 38, 0.92);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 4px 8px 6px;
  flex-shrink: 0;
  position: relative;
  z-index: 3;
}
.playback-bar--light {
  background: rgba(255, 255, 255, 0.94);
  border-top: 1px solid rgba(0, 0, 0, 0.1);
}
.playback-row--transport {
  min-width: 0;
}
.playback-row--meta {
  margin-top: 2px;
}
.frame-label {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.speed-select {
  flex: 0 0 auto;
  max-width: 92px;
}
.playback-bar--compact .speed-select {
  max-width: 76px;
}
</style>
