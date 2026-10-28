<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch, nextTick } from 'vue';
import * as THREE from 'three';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useMotionStore } from '@/stores/motion';
import { icons } from '@/lib/icons';
import { usePlayback } from '@/composables/usePlayback';
import { SceneManager } from '@/lib/viewport/SceneManager';
import { QUADRUPED_ENABLED } from '@/lib/features';
import { buildSkeletonView, type SkeletonView } from '@/lib/viewport/skeletonView';
import { followOrbitCamera } from '@/lib/viewport/sceneAlignment';
import { resolveMotionRootJoint } from '@/lib/bvh/parse';
import FileDropZone from '@/components/FileDropZone.vue';
import PlaybackBar from '@/components/PlaybackBar.vue';
import JointTreePanel from '@/components/JointTreePanel.vue';
import MobileSidePanel from '@/components/MobileSidePanel.vue';
import VideoToBvhDialog from '@/components/VideoToBvhDialog.vue';
import SmplxImportDialog from '@/components/SmplxImportDialog.vue';
import WorkflowNavBar from '@/components/WorkflowNavBar.vue';

const { t } = useI18n();
const { mdAndUp } = useDisplay();
const motion = useMotionStore();
const playback = usePlayback();

const viewportEl = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const sceneManager = shallowRef<SceneManager | null>(null);
const skeleton = shallowRef<SkeletonView | null>(null);
const hipsIndex = ref(-1);
const selectedJoint = ref<number | null>(null);
const loadErrorSnack = ref(false);
const panelOpen = ref(false);
const videoDialogOpen = ref(false);
const smplxDialogOpen = ref(false);
const sampleMenuOpen = ref(false);

const HUMANOID_SAMPLES = [
  { title: 'Walk 行走 (LAFAN1)', file: 'walk.bvh' },
  { title: 'Run 跑步 (LAFAN1)', file: 'run.bvh' },
  { title: 'Dance 舞蹈 (LAFAN1)', file: 'dance.bvh' },
  { title: 'Fall & get up 倒地起身 (LAFAN1)', file: 'fall_getup.bvh' },
  { title: 'Jumps 跳跃 (LAFAN1)', file: 'jumps.bvh' },
] as const;

const QUADRUPED_SAMPLES = [
  { title: 'Dog walk 狗·行走 (Quadruped)', file: 'dog_walk.bvh' },
  { title: 'Dog run 狗·奔跑 (Quadruped)', file: 'dog_run.bvh' },
  { title: 'Dog idle 狗·站立 (Quadruped)', file: 'dog_idle.bvh' },
] as const;

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

function onSmplxLoaded(model: Uint8Array, motionNpz: Uint8Array, name: string) {
  try {
    motion.loadSmplx(model, motionNpz, name);
  } catch {
    loadErrorSnack.value = true;
  }
}

async function loadSample(file: string) {
  sampleMenuOpen.value = false;
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
  hipsIndex.value = resolveMotionRootJoint(motion.anim);
  playback.setMotion(motion.frameCount, motion.fps);
  playback.state.playing = true;
  applyFrame(0);
}

const rootTrack = new THREE.Vector3();

function applyFrame(frame: number) {
  const sk = skeleton.value;
  const sm = sceneManager.value;
  if (!sk || hipsIndex.value < 0) return;
  const playing = playback.state.playing;
  const poseFrame = playing
    ? frame
    : Math.max(0, Math.min(Math.floor(frame), motion.frameCount - 1));
  if (playing) sk.setFrameBlend(poseFrame);
  else sk.setFrame(poseFrame);
  if (!sm) return;
  sk.getJointWorldPos(hipsIndex.value, rootTrack);
  followOrbitCamera(sm, rootTrack, playing ? 1 : 0.08);
  sm.setDampingEnabled(!playing);
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
    applyFrame(playback.poseFrame.value);
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
      <v-btn color="primary" variant="flat" :prepend-icon="icons.folderOpen" block @click="openFilePicker">
        {{ t('openBvh') }}
      </v-btn>

      <v-menu
        v-model="sampleMenuOpen"
        :location="mdAndUp ? 'end top' : 'bottom start'"
        :offset="mdAndUp ? 8 : 0"
        content-class="sample-menu-panel"
      >
        <template #activator="{ props: mProps }">
          <v-btn v-bind="mProps" variant="tonal" :prepend-icon="icons.walk" block :loading="sampleLoading">
            {{ t('loadSample') }}
          </v-btn>
        </template>
        <v-list density="compact" class="sample-menu-list">
          <template v-if="QUADRUPED_ENABLED">
            <v-list-subheader class="sample-group-header">{{ t('sampleHumanoid') }}</v-list-subheader>
            <v-list-item
              v-for="s in HUMANOID_SAMPLES"
              :key="s.file"
              :title="s.title"
              @click="loadSample(s.file)"
            />
            <v-list-subheader class="sample-group-header">{{ t('sampleQuadruped') }}</v-list-subheader>
            <v-list-item
              v-for="s in QUADRUPED_SAMPLES"
              :key="s.file"
              :title="s.title"
              @click="loadSample(s.file)"
            />
          </template>
          <template v-else>
            <v-list-item
              v-for="s in HUMANOID_SAMPLES"
              :key="s.file"
              :title="s.title"
              @click="loadSample(s.file)"
            />
          </template>
        </v-list>
      </v-menu>

      <div class="panel-label">{{ t('otherSources') }}</div>
      <div class="source-links d-flex flex-column">
        <v-btn variant="text" :prepend-icon="icons.video" block class="source-link" @click="videoDialogOpen = true">
          {{ t('videoToBvh') }}
        </v-btn>
        <v-btn variant="text" :prepend-icon="icons.cube" block class="source-link" @click="smplxDialogOpen = true">
          {{ t('smplxImport') }}
        </v-btn>
      </div>

      <v-card v-if="motion.hasMotion" variant="tonal" density="compact">
        <v-card-title class="text-subtitle-2">{{ t('motionInfo') }}</v-card-title>
        <v-card-text class="text-body-2">
          <dl class="info-list">
            <div class="info-line"><dt>{{ t('fileName') }}</dt><dd>{{ motion.fileName }}</dd></div>
            <div class="info-line"><dt>{{ t('frames') }}</dt><dd>{{ motion.frameCount }} @ {{ motion.fps.toFixed(0) }} fps</dd></div>
            <div class="info-line"><dt>{{ t('duration') }}</dt><dd>{{ motion.duration.toFixed(2) }} s</dd></div>
            <div class="info-line"><dt>{{ t('joints') }}</dt><dd>{{ motion.jointNames.length }}</dd></div>
            <div class="info-line"><dt>{{ t('estHeight') }}</dt><dd>{{ motion.estHeightMeters.toFixed(2) }} m</dd></div>
            <div class="info-line"><dt>{{ t('units') }}</dt><dd>{{ motion.unitScale === 0.01 ? 'cm' : 'm' }}</dd></div>
          </dl>
        </v-card-text>
      </v-card>

      <template v-if="motion.anim">
        <div class="panel-label">{{ t('jointTree') }}</div>
        <JointTreePanel
          class="joint-tree-grow"
          :anim="motion.anim"
          :selected="selectedJoint"
          @select="(j) => (selectedJoint = j)"
        />
        <v-card v-if="selectedInfo" variant="outlined" density="compact">
          <v-card-text class="text-caption">
            <dl class="info-list">
              <div class="info-line"><dt>{{ t('jointName') }}</dt><dd>{{ selectedInfo.name }}</dd></div>
              <div class="info-line"><dt>{{ t('jointParent') }}</dt><dd>{{ selectedInfo.parent }}</dd></div>
              <div class="info-line"><dt>{{ t('jointOffset') }}</dt><dd class="mono">{{ selectedInfo.offset }}</dd></div>
              <div class="info-line"><dt>{{ t('jointChannels') }}</dt><dd>{{ selectedInfo.channels }}</dd></div>
            </dl>
          </v-card-text>
        </v-card>
      </template>
    </MobileSidePanel>

    <FileDropZone class="main-col flex-grow-1" @load="loadText">
      <div class="viewport-col d-flex flex-column">
        <div class="viewport-wrap flex-grow-1">
          <div ref="viewportEl" class="viewport" />
          <WorkflowNavBar />
          <Transition name="empty-fade">
            <section v-if="!motion.hasMotion" class="empty-hint" aria-labelledby="empty-hint-title">
              <div class="empty-hint__inner">
                <span class="empty-hint__mark" aria-hidden="true">
                  <v-icon :icon="icons.walk" size="24" />
                </span>
                <h2 id="empty-hint-title" class="empty-hint__title">{{ t('noMotion') }}</h2>
                <p class="empty-hint__body">{{ t('dropHint') }}</p>
                <div class="empty-hint__actions">
                  <v-btn class="mobile-open-btn" color="primary" variant="flat" :prepend-icon="icons.folderOpen" @click="openFilePicker">
                    {{ t('openBvh') }}
                  </v-btn>
                  <v-btn variant="tonal" :prepend-icon="icons.walk" :loading="sampleLoading" @click="loadSample('walk.bvh')">
                    {{ t('trySample') }}
                  </v-btn>
                </div>
                <ol class="empty-hint__steps">
                  <li class="is-current"><span class="empty-hint__step">1</span>{{ t('navBvh') }}</li>
                  <li><span class="empty-hint__step">2</span>{{ t('navConfig') }}</li>
                  <li><span class="empty-hint__step">3</span>{{ t('navPreview') }}</li>
                </ol>
              </div>
            </section>
          </Transition>
        </div>
        <PlaybackBar v-if="motion.hasMotion" :controller="playback" />
      </div>
    </FileDropZone>

    <v-btn
      v-if="!mdAndUp"
      class="panel-fab"
      color="primary"
      :icon="icons.sliders"
      size="small"
      elevation="4"
      :title="t('openPanel')"
      @click="panelOpen = true"
    />

    <VideoToBvhDialog v-model="videoDialogOpen" @generated="loadText" />
    <SmplxImportDialog v-model="smplxDialogOpen" @loaded="onSmplxLoaded" />

    <v-snackbar v-model="loadErrorSnack" color="error" timeout="5000">
      {{ motion.loadError ?? t('loadFailed') }}
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
.viewport-wrap {
  position: relative;
  min-height: 0;
}
.viewport {
  position: absolute;
  inset: 0;
}
.empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px 32px;
  /* Click-through, so the empty floor still orbits; only the buttons take taps. */
  pointer-events: none;
  z-index: 1;
}
.empty-hint__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 400px;
  text-align: center;
}
.empty-hint__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  border-radius: var(--rro-radius-lg);
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.empty-hint__title {
  margin: 0;
  font-size: 1.25rem;
  line-height: 1.75rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: rgb(var(--v-theme-on-surface));
}
.empty-hint__body {
  max-width: 26rem;
  /* Break CJK at punctuation rather than mid-phrase. */
  word-break: keep-all;
  overflow-wrap: anywhere;
  margin: 8px 0 0;
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.empty-hint__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 24px;
}
.empty-hint__actions .v-btn {
  pointer-events: auto;
}
.empty-hint__steps {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 16px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.75rem;
  line-height: 1rem;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.empty-hint__steps li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.empty-hint__steps li.is-current {
  color: rgb(var(--v-theme-on-surface));
}
.empty-hint__step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--rro-border);
  font-size: 0.75rem;
  line-height: 1;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.empty-hint__steps li.is-current .empty-hint__step {
  border-color: transparent;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.empty-fade-enter-active,
.empty-fade-leave-active {
  transition:
    opacity var(--rro-dur-color) var(--rro-ease),
    transform var(--rro-dur-move) var(--rro-ease);
}
.empty-fade-enter-from,
.empty-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
/* The side panel carries the same button on wide screens. */
@media (min-width: 960px) {
  .mobile-open-btn {
    display: none;
  }
}
.source-links {
  gap: 2px;
}
.source-link.v-btn {
  justify-content: flex-start;
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
.panel-fab {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 4;
}
</style>

<style>
.sample-menu-panel {
  border: 1px solid var(--rro-border);
  box-shadow: var(--rro-shadow-overlay);
}
.sample-menu-list {
  min-width: 260px;
}
.sample-group-header {
  font-size: 0.75rem;
  line-height: 1rem;
  min-height: 32px;
}
</style>
