<script setup lang="ts">
import * as THREE from 'three';
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useDisplay } from 'vuetify';
import { icons } from '@/lib/icons';
import { useI18n } from '@/i18n';
import { useRetargetStore } from '@/stores/retarget';
import { usePostProcessStore } from '@/stores/postprocess';
import {
  formatPostProcessExportBasename,
  formatRetargetHistoryLabel,
} from '@/lib/retarget/historyLabel';
import { isRobotModelDisposed, type RobotModel } from '@/lib/mujoco/runtime';
import { buildRobotScene, type RobotSceneObject } from '@/lib/mujoco/threeScene';
import { SceneManager } from '@/lib/viewport/SceneManager';
import { usePlayback } from '@/composables/usePlayback';
import { blendQpos } from '@/lib/viewport/poseBlend';
import { isCoarsePointerDevice } from '@/lib/plotlyTouch';
import { downloadBlob, exportCsv, exportJson, exportNpz } from '@/lib/export/motion';
import {
  exportPostProcessReportJson,
  extractJointLimits,
  type PostProcessConfig,
  type SmoothingMethod,
} from '@/lib/postprocess';
import PlaybackBar from '@/components/PlaybackBar.vue';
import MobileSidePanel from '@/components/MobileSidePanel.vue';
import WorkflowNavBar from '@/components/WorkflowNavBar.vue';
import PostProcessAnalysisPanel from '@/components/PostProcessAnalysisPanel.vue';

const { t } = useI18n();
const { mdAndUp } = useDisplay();
const store = useRetargetStore();
const ppStore = usePostProcessStore();
const playback = usePlayback();
const touchUi = isCoarsePointerDevice();

const viewportEl = ref<HTMLElement | null>(null);
const sceneManager = shallowRef<SceneManager | null>(null);
const robotModel = shallowRef<RobotModel | null>(null);
const processedScene = shallowRef<RobotSceneObject | null>(null);
const rawScene = shallowRef<RobotSceneObject | null>(null);

type ViewMode = 'overlay' | 'processed' | 'raw';
const viewMode = ref<ViewMode>('overlay');
const followCamera = ref(true);
const panelOpen = ref(false);
const rawFrameNonFinite = ref(false);
const isViewActive = ref(false);
const currentFrame = computed(() => Math.floor(playback.frameIndex.value));
const passTouchToOverlays = computed(() => touchUi && playback.state.playing);

let setupSeq = 0;
let displayedHistoryId: string | null = null;

const activeEntry = computed(() => store.activeHistoryEntry);

// Ensure a session always exists for the active entry so controls & charts render immediately.
const activeSession = computed(() => {
  const entry = activeEntry.value;
  if (!entry) return null;
  return ppStore.ensureSession(entry);
});

const historyItems = computed(() =>
  store.resultHistory.map((entry) => ({
    title: formatRetargetHistoryLabel(
      entry,
      entry.engine === 'omniretarget' ? t('engineOmni') : t('engineGmr'),
    ),
    value: entry.id,
  })),
);

function onHistorySelect(id: unknown) {
  if (typeof id === 'string') store.selectHistory(id);
}

const smoothingMethodItems = computed(() => [
  { title: t('ppMethodSavgol'), value: 'savgol' as SmoothingMethod },
  { title: t('ppMethodGaussian'), value: 'gaussian' as SmoothingMethod },
  { title: t('ppMethodMovingAvg'), value: 'moving_average' as SmoothingMethod },
  { title: t('ppMethodOneEuro'), value: 'one_euro' as SmoothingMethod },
]);

const activePreviewBadge = computed(() => {
  if (viewMode.value === 'overlay') return t('ppBadgeOverlay');
  if (viewMode.value === 'processed') return t('ppBadgeProcessed');
  return t('ppBadgeRaw');
});

function mutateConfig(updater: (draft: PostProcessConfig) => void) {
  const entry = activeEntry.value;
  if (!entry) return;
  ppStore.updateConfig(entry, updater);
  posedFrame = Number.NaN;
  applyFrame(playback.poseFrame.value);
  sceneManager.value?.invalidate();
}

function onUndo() {
  if (!activeEntry.value) return;
  ppStore.undo(activeEntry.value);
  posedFrame = Number.NaN;
  applyFrame(playback.poseFrame.value);
  sceneManager.value?.invalidate();
}

function onResetDefaults() {
  if (!activeEntry.value) return;
  ppStore.resetDefaults(activeEntry.value);
  posedFrame = Number.NaN;
  applyFrame(playback.poseFrame.value);
  sceneManager.value?.invalidate();
}

function onResetToRaw() {
  if (!activeEntry.value) return;
  ppStore.resetToRaw(activeEntry.value);
  posedFrame = Number.NaN;
  applyFrame(playback.poseFrame.value);
  sceneManager.value?.invalidate();
}

function isArrayFinite(arr: Float64Array): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

async function setupPostProcessScene() {
  const seq = ++setupSeq;
  const sm = sceneManager.value;
  const entry = activeEntry.value;
  if (!sm || !entry) return;

  const isNewDisplay = entry.id !== displayedHistoryId;
  const pausedAtStart = playback.userPausedPlayback.value;

  const robot = await store.loadRobotForHistory(entry);
  if (seq !== setupSeq) return;

  robotModel.value = robot;
  const limits = extractJointLimits(robot);
  ppStore.ensureSession(entry, limits);

  rawScene.value?.dispose();
  processedScene.value?.dispose();

  const rawObj = buildRobotScene(robot);
  const procObj = buildRobotScene(robot);
  sm.scene.add(rawObj.root);
  sm.scene.add(procObj.root);
  rawScene.value = rawObj;
  processedScene.value = procObj;

  if (isNewDisplay) {
    playback.setMotion(entry.result.frameCount, entry.result.fps);
    displayedHistoryId = entry.id;
    const pausedDuringSetup = playback.userPausedPlayback.value && !pausedAtStart;
    if (!pausedDuringSetup) {
      playback.play();
    }
  }

  posedFrame = Number.NaN;
  applyFrame(playback.poseFrame.value);
  frameSmallRobot(procObj.root);
  sm.invalidate();
}

function frameSmallRobot(root: THREE.Object3D) {
  const sm = sceneManager.value;
  if (!sm) return;
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (size.z >= 0.9) return;
  const d = Math.max(size.x, size.y, size.z) * 2.2;
  sm.setView(
    [center.x + d * 0.55, center.y - d * 0.85, center.z + d * 0.5],
    [center.x, center.y, center.z],
  );
}

let blendedQpos = new Float64Array(0);
let posedFrame = Number.NaN;
let posedMode: ViewMode | null = null;
let posedOutputRef: unknown = null;

function applyFrame(f: number): boolean {
  const entry = activeEntry.value;
  const session = activeSession.value;
  const robot = robotModel.value;
  const rawObj = rawScene.value;
  const procObj = processedScene.value;
  if (!entry || !session || !robot || !rawObj || !procObj || isRobotModelDisposed(robot)) {
    return false;
  }

  const rawRes = entry.result;
  const procRes = session.output.processedResult;
  const playing = playback.state.playing;
  const frame = playing ? f : Math.max(0, Math.min(Math.floor(f), rawRes.frameCount - 1));
  const changed =
    playing ||
    frame !== posedFrame ||
    viewMode.value !== posedMode ||
    session.output !== posedOutputRef;

  if (changed) {
    if (blendedQpos.length !== rawRes.nq) blendedQpos = new Float64Array(rawRes.nq);
    const qpos = robot.data.qpos as Float64Array;
    let followTarget: [number, number] | null = null;

    const showRaw = viewMode.value === 'raw' || viewMode.value === 'overlay';
    const showProc = viewMode.value === 'processed' || viewMode.value === 'overlay';

    if (showRaw) {
      if (playing) blendQpos(blendedQpos, rawRes.qpos, rawRes.nq, rawRes.frameCount, frame);
      else blendedQpos.set(rawRes.qpos.subarray(frame * rawRes.nq, (frame + 1) * rawRes.nq));
      if (isArrayFinite(blendedQpos)) {
        rawFrameNonFinite.value = false;
        qpos.set(blendedQpos);
        robot.mujoco.mj_kinematics(robot.model, robot.data);
        rawObj.update(robot.data);
        rawObj.setOpacity(viewMode.value === 'overlay' ? 0.32 : 1.0);
        rawObj.root.visible = true;
        followTarget = [qpos[0], qpos[1]];
      } else {
        rawFrameNonFinite.value = true;
        rawObj.root.visible = false;
      }
    } else {
      rawFrameNonFinite.value = false;
      rawObj.root.visible = false;
    }

    if (showProc) {
      if (playing) blendQpos(blendedQpos, procRes.qpos, procRes.nq, procRes.frameCount, frame);
      else blendedQpos.set(procRes.qpos.subarray(frame * procRes.nq, (frame + 1) * procRes.nq));
      if (isArrayFinite(blendedQpos)) {
        qpos.set(blendedQpos);
        robot.mujoco.mj_kinematics(robot.model, robot.data);
        procObj.update(robot.data);
        procObj.setOpacity(1.0);
        procObj.root.visible = true;
        followTarget = [qpos[0], qpos[1]];
      } else {
        procObj.root.visible = false;
      }
    } else {
      procObj.root.visible = false;
    }

    posedFrame = playing ? Number.NaN : frame;
    posedMode = viewMode.value;
    posedOutputRef = session.output;

    if (followCamera.value && followTarget && sceneManager.value) {
      const sm = sceneManager.value;
      const ex = followTarget[0] - sm.controls.target.x;
      const ey = followTarget[1] - sm.controls.target.y;
      const smooth = playing || ex * ex + ey * ey < 1e-8 ? 1 : 0.08;
      const dx = ex * smooth;
      const dy = ey * smooth;
      sm.controls.target.x += dx;
      sm.controls.target.y += dy;
      sm.camera.position.x += dx;
      sm.camera.position.y += dy;
      sm.setDampingEnabled(!playing);
    }
  }

  return changed;
}

function onSeekFrame(f: number) {
  playback.pause();
  playback.seek(f);
  posedFrame = Number.NaN;
  applyFrame(f);
  sceneManager.value?.invalidate();
}

function onExport(variant: 'processed' | 'raw', format: 'npz' | 'csv' | 'json') {
  const entry = activeEntry.value;
  const session = activeSession.value;
  if (!entry || !session) return;
  const targetResult = variant === 'processed' ? session.output.processedResult : entry.result;
  const base = formatPostProcessExportBasename(entry, variant);
  if (format === 'npz') downloadBlob(exportNpz(targetResult), `${base}.npz`);
  else if (format === 'csv') downloadBlob(exportCsv(targetResult), `${base}.csv`);
  else downloadBlob(exportJson(targetResult), `${base}.json`);
}

function onExportReport() {
  const entry = activeEntry.value;
  const session = activeSession.value;
  if (!entry || !session) return;
  const base = formatPostProcessExportBasename(entry, 'report');
  downloadBlob(exportPostProcessReportJson(entry, session.config, session.output), `${base}.json`);
}

function syncCanvasTouchTarget() {
  const canvas = sceneManager.value?.renderer.domElement;
  if (!canvas || !touchUi) return;
  canvas.style.pointerEvents = playback.state.playing ? 'none' : 'auto';
}

watch(viewMode, () => {
  posedFrame = Number.NaN;
  applyFrame(playback.poseFrame.value);
  sceneManager.value?.invalidate();
});

watch(
  () => store.activeHistoryId,
  (id) => {
    if (id && isViewActive.value) void setupPostProcessScene();
  },
);
watch(() => playback.state.playing, syncCanvasTouchTarget);
watch(mdAndUp, () => sceneManager.value?.resize());
watch(panelOpen, () => nextTick(() => sceneManager.value?.resize()));

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
    if (!processedScene.value) return false;
    playback.tick(dt);
    return applyFrame(playback.poseFrame.value);
  });
  sm.start();
  sceneManager.value = sm;
  syncCanvasTouchTarget();
  if (store.activeHistoryId) void setupPostProcessScene();
});

onActivated(() => {
  isViewActive.value = true;
  if (robotModel.value && isRobotModelDisposed(robotModel.value)) {
    robotModel.value = null;
    rawScene.value?.dispose();
    rawScene.value = null;
    processedScene.value?.dispose();
    processedScene.value = null;
  }
  sceneManager.value?.start();
  if (store.activeHistoryId && (store.activeHistoryId !== displayedHistoryId || !processedScene.value)) {
    void setupPostProcessScene();
  }
});

onDeactivated(() => {
  isViewActive.value = false;
  setupSeq++;
  sceneManager.value?.stop();
});

onUnmounted(() => {
  rawScene.value?.dispose();
  processedScene.value?.dispose();
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

      <p v-if="!activeEntry || !activeSession" class="text-body-2 text-medium-emphasis">
        {{ t('ppNoResultHint') }}
      </p>

      <template v-else>
        <v-card variant="tonal" density="compact">
          <v-card-title class="text-subtitle-2">{{ t('ppQualitySummary') }}</v-card-title>
          <v-card-text class="text-caption">
            <dl class="info-list">
              <div class="info-line">
                <dt>{{ t('ppMetricIssues') }}</dt>
                <dd>{{ activeSession.output.metricsBefore.totalIssues }} → {{ activeSession.output.metricsAfter.totalIssues }}</dd>
              </div>
              <div class="info-line">
                <dt>{{ t('ppMetricSpikes') }}</dt>
                <dd>{{ activeSession.output.metricsBefore.spikeCount }} → {{ activeSession.output.metricsAfter.spikeCount }}</dd>
              </div>
              <div class="info-line">
                <dt>{{ t('ppMetricLimits') }}</dt>
                <dd>{{ activeSession.output.metricsBefore.limitViolationCount }} → {{ activeSession.output.metricsAfter.limitViolationCount }}</dd>
              </div>
              <div class="info-line">
                <dt>{{ t('ppMetricJitter') }}</dt>
                <dd>{{ activeSession.output.metricsBefore.jitterIssueCount }} → {{ activeSession.output.metricsAfter.jitterIssueCount }}</dd>
              </div>
              <div class="info-line">
                <dt>{{ t('ppMetricPeakVel') }}</dt>
                <dd>{{ activeSession.output.metricsBefore.peakJointVelRadS.toFixed(1) }} → {{ activeSession.output.metricsAfter.peakJointVelRadS.toFixed(1) }} rad/s</dd>
              </div>
              <div class="info-line">
                <dt>{{ t('ppMetricPeakAcc') }}</dt>
                <dd>{{ activeSession.output.metricsBefore.peakJointAccRadS2.toFixed(0) }} → {{ activeSession.output.metricsAfter.peakJointAccRadS2.toFixed(0) }} rad/s²</dd>
              </div>
              <div class="info-line">
                <dt>{{ t('ppMetricJerk') }}</dt>
                <dd>{{ activeSession.output.metricsBefore.rmsJointJerkRadS3.toFixed(0) }} → {{ activeSession.output.metricsAfter.rmsJointJerkRadS3.toFixed(0) }} rad/s³</dd>
              </div>
              <div class="info-line">
                <dt>{{ t('ppMetricDofDiff') }}</dt>
                <dd>{{ ((activeSession.output.delta.dofRmsDiffRad * 180) / Math.PI).toFixed(2) }}°</dd>
              </div>
              <div class="info-line">
                <dt>{{ t('ppMetricRootDiff') }}</dt>
                <dd>{{ (activeSession.output.delta.rootPosRmsDiffM * 1000).toFixed(1) }} mm</dd>
              </div>
            </dl>
          </v-card-text>
        </v-card>

        <v-alert
          v-if="activeSession.output.operations.skippedUnrepairableSpans > 0"
          type="warning"
          variant="tonal"
          density="compact"
          class="text-caption"
        >
          {{ t('ppSkippedWarning') }}
        </v-alert>

        <div class="pp-action-bar">
          <v-btn
            size="small"
            variant="tonal"
            :prepend-icon="icons.reset"
            :disabled="activeSession.undoStack.length === 0"
            @click="onUndo"
          >
            {{ t('ppUndo') }}
          </v-btn>
          <v-btn size="small" variant="text" @click="onResetDefaults">
            {{ t('ppResetDefaults') }}
          </v-btn>
          <v-btn size="small" variant="text" @click="onResetToRaw">
            {{ t('ppResetRaw') }}
          </v-btn>
        </div>

        <div class="panel-label">{{ t('ppPipelineConfig') }}</div>

        <v-switch
          :model-value="activeSession.config.quatCanonicalize"
          :label="t('ppQuatCanon')"
          color="primary"
          density="compact"
          hide-details
          @update:model-value="(v) => mutateConfig((c) => { c.quatCanonicalize = Boolean(v); })"
        />

        <v-card variant="outlined" density="compact" class="pp-section-card">
          <v-card-text class="d-flex flex-column ga-2 pa-3">
            <v-switch
              :model-value="activeSession.config.outlierRepair.enabled"
              :label="t('ppEnableOutlier')"
              color="primary"
              density="compact"
              hide-details
              @update:model-value="(v) => mutateConfig((c) => { c.outlierRepair.enabled = Boolean(v); })"
            />
            <template v-if="activeSession.config.outlierRepair.enabled">
              <div class="d-flex flex-wrap ga-2">
                <v-checkbox
                  :model-value="activeSession.config.outlierRepair.repairJoints"
                  :label="t('ppRepairJoints')"
                  density="compact"
                  hide-details
                  @update:model-value="(v) => mutateConfig((c) => { c.outlierRepair.repairJoints = Boolean(v); })"
                />
                <v-checkbox
                  :model-value="activeSession.config.outlierRepair.repairRootPos"
                  :label="t('ppRepairRootPos')"
                  density="compact"
                  hide-details
                  @update:model-value="(v) => mutateConfig((c) => { c.outlierRepair.repairRootPos = Boolean(v); })"
                />
                <v-checkbox
                  :model-value="activeSession.config.outlierRepair.repairRootRot"
                  :label="t('ppRepairRootRot')"
                  density="compact"
                  hide-details
                  @update:model-value="(v) => mutateConfig((c) => { c.outlierRepair.repairRootRot = Boolean(v); })"
                />
              </div>
              <div class="slider-row">
                <div class="slider-head">
                  <span>{{ t('ppSpikeThreshRad') }}</span>
                  <span class="mono">{{ activeSession.config.thresholds.minJointSpikeRad.toFixed(2) }}</span>
                </div>
                <v-slider
                  :model-value="activeSession.config.thresholds.minJointSpikeRad"
                  :min="0.05"
                  :max="0.6"
                  :step="0.01"
                  density="compact"
                  hide-details
                  color="primary"
                  @update:model-value="(v) => mutateConfig((c) => { c.thresholds.minJointSpikeRad = Number(v); })"
                />
              </div>
              <div class="slider-row">
                <div class="slider-head">
                  <span>{{ t('ppHampelSigma') }}</span>
                  <span class="mono">{{ activeSession.config.thresholds.hampelSigma.toFixed(1) }}</span>
                </div>
                <v-slider
                  :model-value="activeSession.config.thresholds.hampelSigma"
                  :min="2.5"
                  :max="8.0"
                  :step="0.5"
                  density="compact"
                  hide-details
                  color="primary"
                  @update:model-value="(v) => mutateConfig((c) => { c.thresholds.hampelSigma = Number(v); })"
                />
              </div>
              <div class="slider-row">
                <div class="slider-head">
                  <span>{{ t('ppMaxRepairSpan') }}</span>
                  <span class="mono">{{ activeSession.config.outlierRepair.maxRepairSpan }}</span>
                </div>
                <v-slider
                  :model-value="activeSession.config.outlierRepair.maxRepairSpan"
                  :min="1"
                  :max="8"
                  :step="1"
                  density="compact"
                  hide-details
                  color="primary"
                  @update:model-value="(v) => mutateConfig((c) => { c.outlierRepair.maxRepairSpan = Number(v); c.thresholds.maxRepairSpan = Number(v); })"
                />
              </div>
            </template>
          </v-card-text>
        </v-card>

        <v-card variant="outlined" density="compact" class="pp-section-card">
          <v-card-text class="d-flex flex-column ga-2 pa-3">
            <v-switch
              :model-value="activeSession.config.smoothing.enabled"
              :label="t('ppEnableSmoothing')"
              color="primary"
              density="compact"
              hide-details
              @update:model-value="(v) => mutateConfig((c) => { c.smoothing.enabled = Boolean(v); })"
            />
            <template v-if="activeSession.config.smoothing.enabled">
              <v-select
                :model-value="activeSession.config.smoothing.method"
                :items="smoothingMethodItems"
                :label="t('ppSmoothMethod')"
                density="compact"
                variant="outlined"
                hide-details
                @update:model-value="(v) => mutateConfig((c) => { c.smoothing.method = v as SmoothingMethod; })"
              />
              <template v-if="activeSession.config.smoothing.method !== 'one_euro'">
                <div class="slider-row">
                  <div class="slider-head">
                    <span>{{ t('ppWindowSize') }}</span>
                    <span class="mono">{{ activeSession.config.smoothing.windowSize }}</span>
                  </div>
                  <v-slider
                    :model-value="activeSession.config.smoothing.windowSize"
                    :min="5"
                    :max="15"
                    :step="2"
                    density="compact"
                    hide-details
                    color="primary"
                    @update:model-value="(v) => mutateConfig((c) => { c.smoothing.windowSize = Number(v); })"
                  />
                </div>
              </template>
              <template v-if="activeSession.config.smoothing.method === 'savgol'">
                <div class="slider-row">
                  <div class="slider-head">
                    <span>{{ t('ppPolyOrder') }}</span>
                    <span class="mono">{{ activeSession.config.smoothing.polyOrder }}</span>
                  </div>
                  <v-slider
                    :model-value="activeSession.config.smoothing.polyOrder"
                    :min="2"
                    :max="3"
                    :step="1"
                    density="compact"
                    hide-details
                    color="primary"
                    @update:model-value="(v) => mutateConfig((c) => { c.smoothing.polyOrder = Number(v); })"
                  />
                </div>
              </template>
              <template v-else-if="activeSession.config.smoothing.method === 'gaussian'">
                <div class="slider-row">
                  <div class="slider-head">
                    <span>{{ t('ppGaussianSigma') }}</span>
                    <span class="mono">{{ activeSession.config.smoothing.gaussianSigma.toFixed(1) }}</span>
                  </div>
                  <v-slider
                    :model-value="activeSession.config.smoothing.gaussianSigma"
                    :min="0.5"
                    :max="4.0"
                    :step="0.25"
                    density="compact"
                    hide-details
                    color="primary"
                    @update:model-value="(v) => mutateConfig((c) => { c.smoothing.gaussianSigma = Number(v); })"
                  />
                </div>
              </template>
              <template v-else-if="activeSession.config.smoothing.method === 'one_euro'">
                <div class="slider-row">
                  <div class="slider-head">
                    <span>{{ t('ppOneEuroCutoff') }}</span>
                    <span class="mono">{{ activeSession.config.smoothing.oneEuroMinCutoff.toFixed(1) }}</span>
                  </div>
                  <v-slider
                    :model-value="activeSession.config.smoothing.oneEuroMinCutoff"
                    :min="0.3"
                    :max="5.0"
                    :step="0.1"
                    density="compact"
                    hide-details
                    color="primary"
                    @update:model-value="(v) => mutateConfig((c) => { c.smoothing.oneEuroMinCutoff = Number(v); })"
                  />
                </div>
                <div class="slider-row">
                  <div class="slider-head">
                    <span>{{ t('ppOneEuroBeta') }}</span>
                    <span class="mono">{{ activeSession.config.smoothing.oneEuroBeta.toFixed(2) }}</span>
                  </div>
                  <v-slider
                    :model-value="activeSession.config.smoothing.oneEuroBeta"
                    :min="0"
                    :max="0.5"
                    :step="0.01"
                    density="compact"
                    hide-details
                    color="primary"
                    @update:model-value="(v) => mutateConfig((c) => { c.smoothing.oneEuroBeta = Number(v); })"
                  />
                </div>
              </template>
              <div class="d-flex flex-wrap ga-2">
                <v-checkbox
                  :model-value="activeSession.config.smoothing.smoothJoints"
                  :label="t('ppSmoothJoints')"
                  density="compact"
                  hide-details
                  @update:model-value="(v) => mutateConfig((c) => { c.smoothing.smoothJoints = Boolean(v); })"
                />
                <v-checkbox
                  :model-value="activeSession.config.smoothing.smoothRootPos"
                  :label="t('ppSmoothRootPos')"
                  density="compact"
                  hide-details
                  @update:model-value="(v) => mutateConfig((c) => { c.smoothing.smoothRootPos = Boolean(v); })"
                />
                <v-checkbox
                  :model-value="activeSession.config.smoothing.smoothRootRot"
                  :label="t('ppSmoothRootRot')"
                  density="compact"
                  hide-details
                  @update:model-value="(v) => mutateConfig((c) => { c.smoothing.smoothRootRot = Boolean(v); })"
                />
              </div>
            </template>
          </v-card-text>
        </v-card>

        <v-card variant="outlined" density="compact" class="pp-section-card">
          <v-card-text class="d-flex flex-column ga-2 pa-3">
            <div class="text-caption font-weight-bold">{{ t('ppConstraintsSection') }}</div>
            <v-switch
              :model-value="activeSession.config.constraints.enforceJointLimits"
              :label="t('ppEnforceLimits')"
              color="primary"
              density="compact"
              hide-details
              @update:model-value="(v) => mutateConfig((c) => { c.constraints.enforceJointLimits = Boolean(v); })"
            />
            <div v-if="activeSession.jointLimits.length === 0" class="text-caption text-medium-emphasis">
              {{ t('ppLimitsUnavailable') }}
            </div>
            <v-switch
              :model-value="activeSession.config.constraints.enforceVelocityLimit"
              :label="t('ppEnforceVelLimit')"
              color="primary"
              density="compact"
              hide-details
              @update:model-value="(v) => mutateConfig((c) => { c.constraints.enforceVelocityLimit = Boolean(v); })"
            />
            <div v-if="activeSession.config.constraints.enforceVelocityLimit" class="slider-row">
              <div class="slider-head">
                <span>{{ t('ppMaxVelRadS') }}</span>
                <span class="mono">{{ activeSession.config.constraints.maxJointVelocityRadS.toFixed(1) }}</span>
              </div>
              <v-slider
                :model-value="activeSession.config.constraints.maxJointVelocityRadS"
                :min="5"
                :max="40"
                :step="1"
                density="compact"
                hide-details
                color="primary"
                @update:model-value="(v) => mutateConfig((c) => { c.constraints.maxJointVelocityRadS = Number(v); })"
              />
            </div>
          </v-card-text>
        </v-card>

        <v-switch v-model="followCamera" :label="t('followCamera')" color="primary" density="compact" hide-details />

        <div class="panel-label">{{ t('ppExportProcessedTitle') }}</div>
        <v-btn color="primary" variant="tonal" :prepend-icon="icons.download" block @click="onExport('processed', 'npz')">
          {{ t('ppExportNpzProcessed') }}
        </v-btn>
        <div class="export-secondary">
          <v-btn variant="text" size="small" :prepend-icon="icons.download" @click="onExport('processed', 'csv')">
            {{ t('exportCsv') }}
          </v-btn>
          <v-btn variant="text" size="small" :prepend-icon="icons.download" @click="onExport('processed', 'json')">
            {{ t('exportJson') }}
          </v-btn>
        </div>

        <div class="panel-label">{{ t('ppExportRawTitle') }}</div>
        <div class="export-raw-row">
          <v-btn variant="outlined" size="small" @click="onExport('raw', 'npz')">{{ t('ppExportNpzRaw') }}</v-btn>
          <v-btn variant="outlined" size="small" @click="onExport('raw', 'csv')">CSV</v-btn>
          <v-btn variant="outlined" size="small" @click="onExport('raw', 'json')">JSON</v-btn>
        </div>

        <v-btn variant="tonal" size="small" :prepend-icon="icons.download" block @click="onExportReport">
          {{ t('ppExportReport') }}
        </v-btn>
      </template>
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
          <div v-if="activeSession" class="compare-hud">
            <v-btn-toggle
              v-model="viewMode"
              density="compact"
              variant="outlined"
              divided
              mandatory
              color="primary"
              class="compare-toggle"
            >
              <v-btn value="overlay" size="small">{{ t('ppModeOverlay') }}</v-btn>
              <v-btn value="processed" size="small">{{ t('ppModeProcessed') }}</v-btn>
              <v-btn value="raw" size="small">{{ t('ppModeRaw') }}</v-btn>
            </v-btn-toggle>
            <div class="compare-badge">{{ activePreviewBadge }}</div>
            <v-chip v-if="rawFrameNonFinite" color="error" size="x-small" variant="flat">
              {{ t('ppRawNanWarning') }}
            </v-chip>
          </div>
        </div>
      </div>
      <PostProcessAnalysisPanel
        v-if="activeEntry && activeSession"
        :raw="activeEntry.result"
        :output="activeSession.output"
        :frame="currentFrame"
        @resize="onMetricsResize"
        @seek-frame="onSeekFrame"
      />
      <PlaybackBar v-if="activeEntry" :controller="playback" />
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
.compare-hud {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  max-width: calc(100% - 24px);
  padding: 4px 8px;
  border-radius: var(--rro-radius-lg);
  pointer-events: auto;
  background: rgba(var(--v-theme-surface), 0.9);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: var(--rro-shadow-float);
}
.compare-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--rro-text);
}
.pp-action-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pp-section-card {
  border-color: var(--rro-border);
}
.pp-section-card :deep(.v-selection-control) {
  align-items: flex-start;
  min-height: 28px;
}
.pp-section-card :deep(.v-label) {
  white-space: normal;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.slider-row {
  display: flex;
  flex-direction: column;
}
.slider-head {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--rro-text-muted);
}
.export-secondary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.export-raw-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  gap: 6px;
}
.panel-fab {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 6;
}
@media (pointer: coarse), (hover: none) {
  .compare-toggle :deep(.v-btn) {
    min-width: var(--rro-tap-target);
    min-height: var(--rro-tap-target);
  }
}
</style>
