<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch, nextTick } from 'vue';
import { mdiFolderOpen, mdiRun, mdiTune } from '@mdi/js';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useMotionStore } from '@/stores/motion';
import { usePlayback } from '@/composables/usePlayback';
import { SceneManager } from '@/lib/viewport/SceneManager';
import { buildSkeletonView, type SkeletonView } from '@/lib/viewport/skeletonView';
import FileDropZone from '@/components/FileDropZone.vue';
import PlaybackBar from '@/components/PlaybackBar.vue';
import JointTreePanel from '@/components/JointTreePanel.vue';
import MobileSidePanel from '@/components/MobileSidePanel.vue';

const { t } = useI18n();
const { mdAndUp } = useDisplay();
const motion = useMotionStore();
const playback = usePlayback();

const viewportEl = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const sceneManager = shallowRef<SceneManager | null>(null);
const skeleton = shallowRef<SkeletonView | null>(null);
const selectedJoint = ref<number | null>(null);
const loadErrorSnack = ref(false);
const panelOpen = ref(false);

const samples = [
  { title: 'Walk 行走', file: 'walk.bvh' },
  { title: 'Run 跑步', file: 'run.bvh' },
  { title: 'Wave 挥手', file: 'wave.bvh' },
  { title: 'Fall & get up 倒地起身', file: 'fall_getup.bvh' },
  { title: 'Backflip 后空翻', file: 'backflip.bvh' },
  { title: 'Side flip 侧空翻', file: 'sideflip.bvh' },
];
const sampleLoading = ref(false);

const selectedInfo = computed(() => {
  if (selectedJoint.value === null || !motion.anim) return null;
  const j = motion.anim.joints[selectedJoint.value];
  return {
    name: j.name,
    parent: j.parent >= 0 ? motion.anim.joints[j.parent].name : '—',
    offset: j.offset.map((v) => v.toFixed(3)).join(', '),
    channels: j.channels.join(' ') || '—',
  };
});

function openFilePicker() {
  fileInput.value?.click();
}

function onFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    file.text().then((text) => loadText(text, file.name));
  }
  (e.target as HTMLInputElement).value = '';
}

function loadText(text: string, name: string) {
  try {
    motion.loadBvhText(text, name);
  } catch {
    loadErrorSnack.value = true;
  }
}

async function loadSample(file: string) {
  sampleLoading.value = true;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}sample_motions/${file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    loadText(await res.text(), file);
  } catch {
    loadErrorSnack.value = true;
  } finally {
    sampleLoading.value = false;
  }
}

function rebuildSkeleton() {
  const sm = sceneManager.value;
  if (!sm) return;
  skeleton.value?.dispose();
  skeleton.value = null;
  selectedJoint.value = null;
  if (!motion.anim) return;
  const sk = buildSkeletonView(motion.anim, motion.unitScale);
  sm.scene.add(sk.root);
  skeleton.value = sk;
  playback.setMotion(motion.frameCount, motion.fps);
  playback.state.playing = true;
}

watch(() => motion.anim, rebuildSkeleton);
watch(selectedJoint, (j) => skeleton.value?.setSelected(j));
watch(mdAndUp, () => sceneManager.value?.resize());
watch(panelOpen, () => nextTick(() => sceneManager.value?.resize()));

onMounted(() => {
  const el = viewportEl.value!;
  const sm = new SceneManager(el, { cameraPos: [2.4, -2.6, 1.6], target: [0, 0, 0.9] });
  sm.onTick((dt) => {
    playback.tick(dt);
    skeleton.value?.setFrame(playback.frameIndex.value);
  });
  sm.start();
  sceneManager.value = sm;
  rebuildSkeleton();
});

onActivated(() => sceneManager.value?.start());
onDeactivated(() => sceneManager.value?.stop());
onUnmounted(() => {
  skeleton.value?.dispose();
  sceneManager.value?.dispose();
});
</script>

<template>
  <div class="page-root d-flex">
    <input ref="fileInput" type="file" accept=".bvh" class="d-none" @change="onFileChosen" />

    <MobileSidePanel v-model="panelOpen">
      <v-btn color="primary" :prepend-icon="mdiFolderOpen" block @click="openFilePicker">
        {{ t('openBvh') }}
      </v-btn>

      <v-menu>
        <template #activator="{ props: mProps }">
          <v-btn v-bind="mProps" variant="tonal" :prepend-icon="mdiRun" block :loading="sampleLoading">
            {{ t('loadSample') }}
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item v-for="s in samples" :key="s.file" :title="s.title" @click="loadSample(s.file)" />
        </v-list>
      </v-menu>

      <v-card v-if="motion.hasMotion" variant="tonal" density="compact">
        <v-card-title class="text-subtitle-2">{{ t('motionInfo') }}</v-card-title>
        <v-card-text class="text-body-2">
          <div class="info-line"><span>{{ t('fileName') }}</span><b class="text-truncate">{{ motion.fileName }}</b></div>
          <div class="info-line"><span>{{ t('frames') }}</span><b>{{ motion.frameCount }} @ {{ motion.fps.toFixed(0) }} fps</b></div>
          <div class="info-line"><span>{{ t('duration') }}</span><b>{{ motion.duration.toFixed(2) }} s</b></div>
          <div class="info-line"><span>{{ t('joints') }}</span><b>{{ motion.jointNames.length }}</b></div>
          <div class="info-line"><span>{{ t('estHeight') }}</span><b>{{ motion.estHeightMeters.toFixed(2) }} m</b></div>
          <div class="info-line"><span>{{ t('units') }}</span><b>{{ motion.unitScale === 0.01 ? 'cm' : 'm' }}</b></div>
        </v-card-text>
      </v-card>

      <template v-if="motion.anim">
        <div class="text-subtitle-2 mt-1">{{ t('jointTree') }}</div>
        <JointTreePanel
          class="joint-tree-grow"
          :anim="motion.anim"
          :selected="selectedJoint"
          @select="(j) => (selectedJoint = j)"
        />
        <v-card v-if="selectedInfo" variant="outlined" density="compact">
          <v-card-text class="text-caption">
            <div class="info-line"><span>Joint</span><b>{{ selectedInfo.name }}</b></div>
            <div class="info-line"><span>Parent</span><b>{{ selectedInfo.parent }}</b></div>
            <div class="info-line"><span>Offset</span><b>{{ selectedInfo.offset }}</b></div>
            <div class="info-line"><span>Channels</span><b class="text-truncate">{{ selectedInfo.channels }}</b></div>
          </v-card-text>
        </v-card>
      </template>
    </MobileSidePanel>

    <FileDropZone class="main-col flex-grow-1" @load="loadText">
      <div class="viewport-col d-flex flex-column">
        <div ref="viewportEl" class="viewport flex-grow-1" />
        <div v-if="!motion.hasMotion" class="empty-hint d-flex flex-column align-center justify-center">
          <div class="text-h6 text-medium-emphasis mb-1">{{ t('noMotion') }}</div>
          <div class="text-body-2 text-disabled px-4 text-center">{{ t('dropHint') }}</div>
          <v-btn class="mt-4 mobile-open-btn" color="primary" variant="tonal" :prepend-icon="mdiFolderOpen" @click="openFilePicker">
            {{ t('openBvh') }}
          </v-btn>
        </div>
        <PlaybackBar v-if="motion.hasMotion" :controller="playback" />
      </div>
    </FileDropZone>

    <v-btn
      v-if="!mdAndUp"
      class="panel-fab"
      color="primary"
      :icon="mdiTune"
      size="small"
      elevation="4"
      :title="t('openPanel')"
      @click="panelOpen = true"
    />

    <v-snackbar v-model="loadErrorSnack" color="error" timeout="5000">
      {{ motion.loadError ?? 'Failed to load BVH' }}
    </v-snackbar>
  </div>
</template>

<style scoped>
.page-root {
  height: 100%;
  min-height: 0;
  position: relative;
}
.main-col {
  min-width: 0;
  min-height: 0;
}
.viewport-col {
  height: 100%;
  position: relative;
}
.viewport {
  position: relative;
  min-height: 0;
}
.empty-hint {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.empty-hint .mobile-open-btn {
  pointer-events: auto;
}
@media (min-width: 960px) {
  .mobile-open-btn {
    display: none;
  }
}
.joint-tree-grow {
  flex: 1 1 auto;
  min-height: 120px;
  max-height: 40vh;
}
@media (min-width: 960px) {
  .joint-tree-grow {
    max-height: none;
  }
}
.info-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.info-line b {
  max-width: 60%;
  text-align: right;
}
.panel-fab {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 4;
}
</style>
