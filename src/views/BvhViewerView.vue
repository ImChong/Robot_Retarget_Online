<script setup lang="ts">
import { computed, defineAsyncComponent, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch, nextTick } from 'vue';
import type { Vector3 } from 'three';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useMotionStore } from '@/stores/motion';
import { icons } from '@/lib/icons';
import { usePlayback } from '@/composables/usePlayback';
import type { SceneManager } from '@/lib/viewport/SceneManager';
import { QUADRUPED_ENABLED } from '@/lib/features';
import { prefetchConfigStep, prefetchViewport } from '@/lib/prefetch';
import type { SkeletonView } from '@/lib/viewport/skeletonView';
import { resolveMotionRootJoint } from '@/lib/bvh/parse';
import FileDropZone from '@/components/FileDropZone.vue';
import PlaybackBar from '@/components/PlaybackBar.vue';
import JointTreePanel from '@/components/JointTreePanel.vue';
import MobileSidePanel from '@/components/MobileSidePanel.vue';
import WorkflowNavBar from '@/components/WorkflowNavBar.vue';

const { t } = useI18n();
const { mdAndUp } = useDisplay();
const motion = useMotionStore();
const playback = usePlayback();

const viewportEl = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const sceneManager = shallowRef<SceneManager | null>(null);
/** three.js + viewport helpers, loaded after the page's first paint (see onMounted). */
let viewport: typeof import('@/lib/viewport/bvhViewport') | null = null;
const skeleton = shallowRef<SkeletonView | null>(null);
const hipsIndex = ref(-1);
const selectedJoint = ref<number | null>(null);
const loadErrorSnack = ref(false);
const panelOpen = ref(false);
// The import dialogs (and the MediaPipe / SMPL-X code behind them) load on
// first open, not with the page; once loaded they stay mounted.
const VideoToBvhDialog = defineAsyncComponent(() => import('@/components/VideoToBvhDialog.vue'));
const SmplxImportDialog = defineAsyncComponent(() => import('@/components/SmplxImportDialog.vue'));
const videoDialogOpen = ref(false);
const smplxDialogOpen = ref(false);
const videoDialogUsed = ref(false);
const smplxDialogUsed = ref(false);
watch(videoDialogOpen, (open) => open && (videoDialogUsed.value = true));
watch(smplxDialogOpen, (open) => open && (smplxDialogUsed.value = true));
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

async function onSmplxLoaded(model: Uint8Array, motionNpz: Uint8Array, name: string) {
  try {
    await motion.loadSmplx(model, motionNpz, name);
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
  if (!sm || !viewport) return;
  skeleton.value?.dispose();
  skeleton.value = null;
  selectedJoint.value = null;
  if (!motion.anim) return;
  const sk = viewport.buildSkeletonView(motion.anim, motion.unitScale);
  sm.scene.add(sk.root);
  skeleton.value = sk;
  hipsIndex.value = resolveMotionRootJoint(motion.anim);
  playback.setMotion(motion.frameCount, motion.fps);
  playback.state.playing = true;
  applyFrame(0);
}

let rootTrack: Vector3 | null = null;
let posedSkeleton: SkeletonView | null = null;
let posedFrame = Number.NaN;

/** Pose the skeleton for `frame`; returns whether the pose changed (i.e. a redraw is due). */
function applyFrame(frame: number): boolean {
  const sk = skeleton.value;
  const sm = sceneManager.value;
  if (!sk || hipsIndex.value < 0) return false;
  const playing = playback.state.playing;
  const poseFrame = playing
    ? frame
    : Math.max(0, Math.min(Math.floor(frame), motion.frameCount - 1));
  // Paused on the same frame: the pose is already up to date.
  const changed = playing || sk !== posedSkeleton || poseFrame !== posedFrame;
  if (changed) {
    if (playing) sk.setFrameBlend(poseFrame);
    else sk.setFrame(poseFrame);
    posedSkeleton = sk;
    posedFrame = playing ? Number.NaN : poseFrame;
  }
  if (!sm || !viewport || !rootTrack) return changed;
  sk.getJointWorldPos(hipsIndex.value, rootTrack);
  viewport.followOrbitCamera(sm, rootTrack, playing ? 1 : 0.08);
  sm.setDampingEnabled(!playing);
  return changed;
}

watch(() => motion.anim, (anim) => {
  rebuildSkeleton();
  if (!anim) return;
  void ensureViewport();
  // With a motion loaded, the config page (and its 11 MB MuJoCo module) is next.
  prefetchConfigStep();
});
watch(selectedJoint, (j) => {
  skeleton.value?.setSelected(j);
  sceneManager.value?.invalidate();
});
watch(mdAndUp, () => sceneManager.value?.resize());
watch(panelOpen, () => nextTick(() => sceneManager.value?.resize()));

let isActive = true;
let isUnmounted = false;

/** Resolves once the browser has painted the current DOM. */
function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

let viewportReady: Promise<void> | null = null;

/**
 * Create the 3D viewport on demand: when a motion is loaded, or as soon as the
 * pointer reaches the empty viewport (someone about to orbit or drop a file).
 * The empty landing page has nothing to draw, and creating a WebGL context is
 * the single most expensive thing this page does, so a visitor who only reads
 * it never pays for one. three.js itself is prefetched at idle (see onMounted).
 */
function ensureViewport(): Promise<void> {
  viewportReady ??= createViewport();
  return viewportReady;
}

async function createViewport() {
  // Let the page paint before the WebGL context + first-shader long task.
  const [mod] = await Promise.all([import('@/lib/viewport/bvhViewport'), afterNextPaint()]);
  const el = viewportEl.value;
  if (isUnmounted || !el) return;
  viewport = mod;
  rootTrack = mod.createVector3();
  const sm = new mod.SceneManager(el, { cameraPos: [2.4, -2.6, 1.6], target: [0, 0, 0.9] });
  sm.onTick((dt) => {
    playback.tick(dt);
    return applyFrame(playback.poseFrame.value);
  });
  if (isActive) sm.start();
  sceneManager.value = sm;
  rebuildSkeleton();
}

onMounted(() => {
  if (motion.anim) void ensureViewport();
  else prefetchViewport();
});

onActivated(() => {
  isActive = true;
  sceneManager.value?.start();
});
onDeactivated(() => {
  isActive = false;
  sceneManager.value?.stop();
});
onUnmounted(() => {
  isUnmounted = true;
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
        <div
          class="viewport-wrap flex-grow-1"
          @pointerenter="ensureViewport"
          @pointerdown="ensureViewport"
          @dragenter="ensureViewport"
        >
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

    <VideoToBvhDialog v-if="videoDialogUsed" v-model="videoDialogOpen" @generated="loadText" />
    <SmplxImportDialog v-if="smplxDialogUsed" v-model="smplxDialogOpen" @loaded="onSmplxLoaded" />

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
  /* The scene's own background, shown until the viewport is created on demand. */
  background: var(--rro-viewport-bg);
}
.viewport :deep(canvas) {
  animation: viewport-in var(--rro-dur-color) var(--rro-ease);
}
@keyframes viewport-in {
  from {
    opacity: 0;
  }
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
  /* Stronger than medium emphasis: it sits on the light viewport grey, where
     0.7 alpha fell to 3.4:1. */
  color: rgba(var(--v-theme-on-surface), 0.8);
  /* Break CJK at punctuation rather than mid-phrase. */
  word-break: keep-all;
  overflow-wrap: anywhere;
  margin: 8px 0 0;
  font-size: 0.875rem;
  line-height: 1.25rem;
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
  color: rgba(var(--v-theme-on-surface), 0.8);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 16px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.75rem;
  line-height: 1rem;
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
