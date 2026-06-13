<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch, nextTick } from 'vue';
import { mdiPlayCircle, mdiStopCircle, mdiDownload, mdiTune } from '@mdi/js';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useMotionStore } from '@/stores/motion';
import { useRetargetStore } from '@/stores/retarget';
import { loadRobot, type RobotModel } from '@/lib/mujoco/runtime';
import { buildRobotScene, type RobotSceneObject } from '@/lib/mujoco/threeScene';
import { SceneManager } from '@/lib/viewport/SceneManager';
import { buildKeypointCloud, type KeypointCloud } from '@/lib/viewport/skeletonView';
import { usePlayback } from '@/composables/usePlayback';
import PlaybackBar from '@/components/PlaybackBar.vue';
import MobileSidePanel from '@/components/MobileSidePanel.vue';
import MetricsPanel from '@/components/MetricsPanel.vue';
import { exportCsv, exportJson, exportNpz, downloadBlob } from '@/lib/export/motion';

const { t } = useI18n();
const { mdAndUp } = useDisplay();
const motion = useMotionStore();
const store = useRetargetStore();
const playback = usePlayback();

const viewportEl = ref<HTMLElement | null>(null);
const sceneManager = shallowRef<SceneManager | null>(null);
const robotScene = shallowRef<RobotSceneObject | null>(null);
const robotModel = shallowRef<RobotModel | null>(null);
const ghost = shallowRef<KeypointCloud | null>(null);
const showGhost = ref(true);
const followCamera = ref(true);
const panelOpen = ref(false);
const currentFrame = computed(() => playback.frameIndex.value);

const progressPct = computed(() =>
  store.runProgress.total > 0 ? (100 * store.runProgress.done) / store.runProgress.total : 0,
);

const stats = computed(() => {
  const r = store.result;
  if (!r) return null;
  return {
    time: (r.elapsedMs / 1000).toFixed(2) + ' s',
    speed: (r.frameCount / (r.elapsedMs / 1000)).toFixed(0) + ' fps',
    frames: r.frameCount,
  };
});

async function run() {
  await store.run();
  if (store.status === 'done') await setupResultScene();
}

async function setupResultScene() {
  const sm = sceneManager.value;
  const result = store.result;
  if (!sm || !result) return;

  const robot = await loadRobot(result.robotId);
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

  playback.setMotion(result.frameCount, result.fps);
  playback.state.playing = true;
  applyFrame(0);
}

function applyFrame(f: number) {
  const result = store.result;
  const robot = robotModel.value;
  const scene = robotScene.value;
  if (!result || !robot || !scene) return;
  const frame = Math.max(0, Math.min(f, result.frameCount - 1));
  const qpos = robot.data.qpos as Float64Array;
  qpos.set(result.qpos.subarray(frame * result.nq, (frame + 1) * result.nq));
  robot.mujoco.mj_kinematics(robot.model, robot.data);
  scene.update(robot.data);
  ghost.value?.update(result.scaledHuman, frame, result.humanBodyNames.length);

  if (followCamera.value && sceneManager.value) {
    const sm = sceneManager.value;
    const tx = qpos[0];
    const ty = qpos[1];
    sm.controls.target.x += (tx - sm.controls.target.x) * 0.08;
    sm.controls.target.y += (ty - sm.controls.target.y) * 0.08;
  }
}

function onExport(kind: 'npz' | 'csv' | 'json') {
  const result = store.result;
  if (!result) return;
  const base = (motion.fileName ?? 'motion').replace(/\.bvh$/i, '');
  const name = `${base}_${result.robotId}`;
  if (kind === 'npz') downloadBlob(exportNpz(result), `${name}.npz`);
  else if (kind === 'csv') downloadBlob(exportCsv(result), `${name}.csv`);
  else downloadBlob(exportJson(result), `${name}.json`);
}

watch(showGhost, (v) => {
  if (ghost.value) ghost.value.root.visible = v;
});
watch(mdAndUp, () => sceneManager.value?.resize());
watch(panelOpen, () => nextTick(() => sceneManager.value?.resize()));

onMounted(() => {
  const sm = new SceneManager(viewportEl.value!, {
    cameraPos: [2.6, -2.6, 1.7],
    target: [0, 0, 0.8],
  });
  sm.onTick((dt) => {
    playback.tick(dt);
    applyFrame(playback.frameIndex.value);
  });
  sm.start();
  sceneManager.value = sm;
  if (store.result) setupResultScene();
});

onActivated(() => {
  sceneManager.value?.start();
  if (store.result && !robotScene.value) setupResultScene();
});
onDeactivated(() => sceneManager.value?.stop());
onUnmounted(() => {
  ghost.value?.dispose();
  robotScene.value?.dispose();
  sceneManager.value?.dispose();
});
</script>

<template>
  <div class="page-root d-flex">
    <MobileSidePanel v-model="panelOpen">
      <div v-if="!motion.hasMotion" class="text-caption text-warning">{{ t('noMotionHint') }}</div>

      <v-btn
        v-if="!store.isBusy"
        color="primary"
        size="large"
        :prepend-icon="mdiPlayCircle"
        :disabled="!motion.hasMotion"
        block
        @click="run"
      >
        {{ t('runRetarget') }}
      </v-btn>
      <v-btn v-else color="error" variant="tonal" :prepend-icon="mdiStopCircle" block @click="store.cancel()">
        {{ t('cancel') }}
      </v-btn>

      <div v-if="store.status === 'loading-robot'" class="text-caption">
        {{ t('loadingRobot') }} {{ store.robotLoadProgress.done }}/{{ store.robotLoadProgress.total }}
      </div>

      <template v-if="store.status === 'running'">
        <v-progress-linear :model-value="progressPct" color="primary" height="18" rounded>
          <span class="text-caption">
            {{ t('retargeting') }} {{ store.runProgress.done }}/{{ store.runProgress.total }}
          </span>
        </v-progress-linear>
      </template>

      <v-alert v-if="store.status === 'error'" type="error" density="compact" variant="tonal">
        {{ store.errorMessage }}
      </v-alert>

      <v-card v-if="stats" variant="tonal" density="compact">
        <v-card-title class="text-subtitle-2">{{ t('statsTitle') }}</v-card-title>
        <v-card-text class="text-body-2">
          <div class="info-line"><span>{{ t('robot') }}</span><b>{{ store.result?.robotId }}</b></div>
          <div class="info-line"><span>{{ t('frames') }}</span><b>{{ stats.frames }}</b></div>
          <div class="info-line"><span>{{ t('solveTime') }}</span><b>{{ stats.time }}</b></div>
          <div class="info-line"><span>{{ t('procSpeed') }}</span><b>{{ stats.speed }}</b></div>
        </v-card-text>
      </v-card>

      <template v-if="store.result">
        <v-switch v-model="showGhost" :label="t('showGhost')" color="primary" density="compact" hide-details />
        <v-switch v-model="followCamera" :label="t('followCamera')" color="primary" density="compact" hide-details />

        <div class="text-subtitle-2 mt-2">{{ t('export') }}</div>
        <v-btn variant="tonal" :prepend-icon="mdiDownload" block @click="onExport('npz')">
          {{ t('exportNpz') }}
        </v-btn>
        <v-btn variant="tonal" :prepend-icon="mdiDownload" block @click="onExport('csv')">
          {{ t('exportCsv') }}
        </v-btn>
        <v-btn variant="tonal" :prepend-icon="mdiDownload" block @click="onExport('json')">
          {{ t('exportJson') }}
        </v-btn>
      </template>
      <div v-else-if="store.status !== 'running'" class="text-caption text-disabled mt-2">
        {{ t('notRun') }}
      </div>
    </MobileSidePanel>

    <div class="main-col d-flex flex-column flex-grow-1">
      <div ref="viewportEl" class="viewport flex-grow-1" />
      <MetricsPanel v-if="store.result" :result="store.result" :frame="currentFrame" />
      <PlaybackBar v-if="store.result" :controller="playback" />
    </div>

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
.viewport {
  min-height: 0;
  position: relative;
}
.info-line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.panel-fab {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 4;
}
</style>
