<script setup lang="ts">
import * as THREE from 'three';
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch, nextTick } from 'vue';
import { icons } from '@/lib/icons';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useMotionStore } from '@/stores/motion';
import { useRetargetStore } from '@/stores/retarget';
import {
  formatRetargetExportBasename,
  formatRetargetHistoryLabel,
  formatRetargetTimestamp,
} from '@/lib/retarget/historyLabel';
import { isRobotModelDisposed, type RobotModel } from '@/lib/mujoco/runtime';
import { buildRobotScene, type RobotSceneObject } from '@/lib/mujoco/threeScene';
import { SceneManager } from '@/lib/viewport/SceneManager';
import { buildKeypointCloud, type KeypointCloud } from '@/lib/viewport/skeletonView';
import { usePlayback } from '@/composables/usePlayback';
import PlaybackBar from '@/components/PlaybackBar.vue';
import MobileSidePanel from '@/components/MobileSidePanel.vue';
import MetricsPanel from '@/components/MetricsPanel.vue';
import WorkflowNavBar from '@/components/WorkflowNavBar.vue';
import { blendQpos } from '@/lib/viewport/poseBlend';
import { exportCsv, exportJson, exportNpz, downloadBlob } from '@/lib/export/motion';
import { isCoarsePointerDevice } from '@/lib/plotlyTouch';

const { t } = useI18n();
const { mdAndUp } = useDisplay();
const motion = useMotionStore();
const store = useRetargetStore();
const playback = usePlayback();
const touchUi = isCoarsePointerDevice();

const viewportEl = ref<HTMLElement | null>(null);
const sceneManager = shallowRef<SceneManager | null>(null);
const robotScene = shallowRef<RobotSceneObject | null>(null);
const robotModel = shallowRef<RobotModel | null>(null);
const ghost = shallowRef<KeypointCloud | null>(null);
const showGhost = ref(true);
const followCamera = ref(true);
const panelOpen = ref(false);
const currentFrame = computed(() => playback.frameIndex.value);
/** iOS WebKit: an actively rendering WebGL canvas can steal touches from HTML overlays. */
const passTouchToOverlays = computed(() => touchUi && playback.state.playing);
const isViewActive = ref(false);
let setupSeq = 0;
let displayedHistoryId: string | null = null;

const stats = computed(() => {
  const r = store.result;
  if (!r) return null;
  return {
    time: (r.elapsedMs / 1000).toFixed(2) + ' s',
    speed: (r.frameCount / (r.elapsedMs / 1000)).toFixed(0) + ' fps',
    frames: r.frameCount,
  };
});

const historyItems = computed(() =>
  store.resultHistory.map((entry) => ({
    title: formatHistoryLabel(entry),
    value: entry.id,
  })),
);

function formatHistoryLabel(entry: (typeof store.resultHistory)[number]): string {
  const engine = entry.engine === 'omniretarget' ? t('engineOmni') : t('engineGmr');
  return formatRetargetHistoryLabel(entry, engine);
}

function onHistorySelect(id: unknown) {
  if (typeof id === 'string') store.selectHistory(id);
}

async function setupResultScene() {
  const seq = ++setupSeq;
  const sm = sceneManager.value;
  const entry = store.activeHistoryEntry;
  const result = entry?.result;
  if (!sm || !entry || !result) return;

  const isNewDisplay = entry.id !== displayedHistoryId;
  const pausedAtSetupStart = playback.userPausedPlayback.value;

  const robot = await store.loadRobotForHistory(entry);
  if (seq !== setupSeq) return;

  robotModel.value = robot;

  robotScene.value?.dispose();
  const scene = buildRobotScene(robot);
  sm.scene.add(scene.root);
  robotScene.value = scene;

  ghost.value?.dispose();
  const cloud = buildKeypointCloud(result.humanBodyNames);
  cloud.root.visible = showGhost.value;
  sm.scene.add(cloud.root);
  ghost.value = cloud;

  if (isNewDisplay) {
    playback.setMotion(result.frameCount, result.fps);
    displayedHistoryId = entry.id;
    store.consumePendingAutoplay(entry.id);
    // Autoplay new results and history switches; only skip if the user paused
    // while this scene was loading (not a pause carried over from before).
    const pausedDuringSetup = playback.userPausedPlayback.value && !pausedAtSetupStart;
    if (!pausedDuringSetup) {
      playback.play();
    }
  }

  applyFrame(playback.poseFrame.value);
  frameSmallRobot(scene.root);
}

/** Pull the camera in for small robots (e.g. quadrupeds) so they aren't a speck. */
function frameSmallRobot(root: THREE.Object3D) {
  const sm = sceneManager.value;
  if (!sm) return;
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (size.z >= 0.9) return; // humanoids keep their default framing
  const d = Math.max(size.x, size.y, size.z) * 2.2;
  sm.setView(
    [center.x + d * 0.55, center.y - d * 0.85, center.z + d * 0.5],
    [center.x, center.y, center.z],
  );
}

let blendedQpos = new Float64Array(0);
let posedScene: RobotSceneObject | null = null;
let posedResult: typeof store.result = null;
let posedFrame = Number.NaN;

/** Pose robot + keypoints for frame `f`; returns whether anything moved (a redraw is due). */
function applyFrame(f: number): boolean {
  const result = store.result;
  const robot = robotModel.value;
  const scene = robotScene.value;
  // Another page may have freed this robot's WASM objects (only one robot is
  // kept alive — see prepareRobotSlot); touching them would throw.
  if (!result || !robot || !scene || isRobotModelDisposed(robot)) return false;
  const playing = playback.state.playing;
  const frame = playing ? f : Math.max(0, Math.min(Math.floor(f), result.frameCount - 1));
  const qpos = robot.data.qpos as Float64Array;
  // Paused on an already-posed frame: skip the kinematics and the redraw.
  const changed = playing || scene !== posedScene || result !== posedResult || frame !== posedFrame;
  if (changed) {
    if (blendedQpos.length !== result.nq) blendedQpos = new Float64Array(result.nq);
    if (playing) blendQpos(blendedQpos, result.qpos, result.nq, result.frameCount, frame);
    else blendedQpos.set(result.qpos.subarray(frame * result.nq, (frame + 1) * result.nq));
    qpos.set(blendedQpos);
    robot.mujoco.mj_kinematics(robot.model, robot.data);
    scene.update(robot.data);
    if (playing) ghost.value?.updateBlend(result.scaledHuman, frame, result.humanBodyNames.length, result.frameCount);
    else ghost.value?.update(result.scaledHuman, frame, result.humanBodyNames.length);
    posedScene = scene;
    posedResult = result;
    posedFrame = playing ? Number.NaN : frame;
  }

  if (followCamera.value && sceneManager.value) {
    const sm = sceneManager.value;
    const tx = qpos[0];
    const ty = qpos[1];
    const ex = tx - sm.controls.target.x;
    const ey = ty - sm.controls.target.y;
    // Ease while paused, but land within 0.1 mm instead of creeping (each step is a redraw).
    const smooth = playing || ex * ex + ey * ey < 1e-8 ? 1 : 0.08;
    const dx = ex * smooth;
    const dy = ey * smooth;
    sm.controls.target.x += dx;
    sm.controls.target.y += dy;
    // Rigidly pan the camera with the target so a translating robot (e.g. a
    // walking quadruped) stays framed, preserving the current orbit/zoom.
    sm.camera.position.x += dx;
    sm.camera.position.y += dy;
    sm.setDampingEnabled(!playing);
  }
  return changed;
}

function onExport(kind: 'npz' | 'csv' | 'json') {
  const entry = store.activeHistoryEntry;
  const result = entry?.result;
  if (!entry || !result) return;
  const name = formatRetargetExportBasename(entry);
  if (kind === 'npz') downloadBlob(exportNpz(result), `${name}.npz`);
  else if (kind === 'csv') downloadBlob(exportCsv(result), `${name}.csv`);
  else downloadBlob(exportJson(result), `${name}.json`);
}

watch(showGhost, (v) => {
  if (ghost.value) ghost.value.root.visible = v;
  sceneManager.value?.invalidate();
});
watch(
  () => store.activeHistoryId,
  (id) => {
    if (id && isViewActive.value) void setupResultScene();
  },
);
watch(mdAndUp, () => sceneManager.value?.resize());
watch(panelOpen, () => nextTick(() => sceneManager.value?.resize()));

function syncCanvasTouchTarget() {
  const canvas = sceneManager.value?.renderer.domElement;
  if (!canvas || !touchUi) return;
  canvas.style.pointerEvents = playback.state.playing ? 'none' : 'auto';
}

watch(() => playback.state.playing, syncCanvasTouchTarget);

function onMetricsResize() {
  nextTick(() => sceneManager.value?.resize());
}

onMounted(() => {
  isViewActive.value = true;
  const sm = new SceneManager(viewportEl.value!, {
    cameraPos: [2.6, -2.6, 1.7],
    target: [0, 0, 0.8],
  });
  sm.onTick((dt) => {
    if (!robotScene.value) return false;
    playback.tick(dt);
    return applyFrame(playback.poseFrame.value);
  });
  sm.start();
  sceneManager.value = sm;
  syncCanvasTouchTarget();
  if (store.activeHistoryId) void setupResultScene();
});

onActivated(() => {
  isViewActive.value = true;
  // Drop a robot that was freed while another page loaded a different one
  // *before* the render loop ticks: start() runs the first frame synchronously,
  // and an exception there would skip the rebuild below and leave the stale
  // scene (and a blank viewport) in place for good.
  if (robotModel.value && isRobotModelDisposed(robotModel.value)) {
    robotModel.value = null;
    robotScene.value?.dispose();
    robotScene.value = null;
  }
  sceneManager.value?.start();
  if (store.activeHistoryId && (store.activeHistoryId !== displayedHistoryId || !robotScene.value)) {
    void setupResultScene();
  }
});
onDeactivated(() => {
  isViewActive.value = false;
  setupSeq++;
  sceneManager.value?.stop();
});
onUnmounted(() => {
  ghost.value?.dispose();
  robotScene.value?.dispose();
  sceneManager.value?.dispose();
});
</script>

<template>
  <div class="page-root d-flex">
    <MobileSidePanel v-model="panelOpen">
      <v-select
        v-if="store.hasHistory"
        :model-value="store.activeHistoryId"
        :items="historyItems"
        :label="t('historyRetarget')"
        density="compact"
        hide-details
        @update:model-value="onHistorySelect"
      />

      <div v-if="!motion.hasMotion" class="text-caption text-warning text-center">{{ t('noMotionHint') }}</div>

      <v-card v-if="stats" variant="tonal" density="compact">
        <v-card-title class="text-subtitle-2">{{ t('statsTitle') }}</v-card-title>
        <v-card-text class="text-body-2">
          <dl class="info-list">
            <div class="info-line"><dt>{{ t('fileName') }}</dt><dd>{{ store.activeHistoryEntry?.bvhName }}</dd></div>
            <div v-if="store.activeHistoryEntry" class="info-line">
              <dt>{{ t('retargetTime') }}</dt>
              <dd>{{ formatRetargetTimestamp(store.activeHistoryEntry.createdAt) }}</dd>
            </div>
            <div class="info-line"><dt>{{ t('robot') }}</dt><dd>{{ store.activeHistoryEntry?.robotLabel }}</dd></div>
            <div class="info-line">
              <dt>{{ t('engine') }}</dt>
              <dd>{{ store.result?.engine === 'omniretarget' ? t('engineOmni') : t('engineGmr') }}</dd>
            </div>
            <div class="info-line"><dt>{{ t('frames') }}</dt><dd>{{ stats.frames }}</dd></div>
            <div class="info-line"><dt>{{ t('solveTime') }}</dt><dd>{{ stats.time }}</dd></div>
            <div class="info-line"><dt>{{ t('procSpeed') }}</dt><dd>{{ stats.speed }}</dd></div>
          </dl>
        </v-card-text>
      </v-card>

      <template v-if="store.result">
        <v-switch v-model="showGhost" :label="t('showGhost')" color="primary" density="compact" hide-details />
        <v-switch v-model="followCamera" :label="t('followCamera')" color="primary" density="compact" hide-details />

        <div class="panel-label">{{ t('export') }}</div>
        <!-- NPZ is the format GMR training consumes; the other two are for inspection. -->
        <v-btn color="primary" variant="tonal" :prepend-icon="icons.download" block @click="onExport('npz')">
          {{ t('exportNpz') }}
        </v-btn>
        <div class="export-secondary">
          <v-btn variant="text" :prepend-icon="icons.download" @click="onExport('csv')">
            {{ t('exportCsv') }}
          </v-btn>
          <v-btn variant="text" :prepend-icon="icons.download" @click="onExport('json')">
            {{ t('exportJson') }}
          </v-btn>
        </div>
      </template>
      <p v-else class="not-run text-body-2">
        {{ t('notRun') }}
      </p>
    </MobileSidePanel>

    <div class="main-col d-flex flex-column flex-grow-1">
      <div class="viewport-stack flex-grow-1">
        <div class="viewport-wrap">
          <div
            ref="viewportEl"
            class="viewport"
            :class="{ 'viewport--pass-touch': passTouchToOverlays }"
          />
        </div>
        <div class="viewport-overlays">
          <WorkflowNavBar />
        </div>
      </div>
      <MetricsPanel v-if="store.result" :result="store.result" :frame="currentFrame" @resize="onMetricsResize" />
      <PlaybackBar v-if="store.result" :controller="playback" />
    </div>

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
  position: relative;
  isolation: isolate;
}
.viewport-stack {
  position: relative;
  min-height: 0;
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
}
.viewport-wrap {
  flex: 1 1 0;
  min-height: 0;
  position: relative;
  isolation: isolate;
}
.viewport-overlays {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}
.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 0;
}
.viewport :deep(canvas) {
  position: absolute;
  inset: 0;
  z-index: 0;
}
@media (pointer: coarse), (hover: none) {
  .viewport--pass-touch,
  .viewport--pass-touch :deep(canvas) {
    pointer-events: none !important;
  }
}
.export-secondary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.not-run {
  margin: 8px 0 0;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.panel-fab {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 6;
}
</style>
