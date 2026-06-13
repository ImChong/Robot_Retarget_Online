<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch, nextTick } from 'vue';
import * as THREE from 'three';
import { mdiDownload, mdiUpload, mdiBackupRestore, mdiTune } from '@mdi/js';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useMotionStore } from '@/stores/motion';
import { useRetargetStore } from '@/stores/retarget';
import { getRobotManifest, loadRobot, type RobotManifestEntry, type RobotModel } from '@/lib/mujoco/runtime';
import { buildRobotScene, type RobotSceneObject } from '@/lib/mujoco/threeScene';
import { SceneManager } from '@/lib/viewport/SceneManager';
import { buildSkeletonView, type SkeletonView } from '@/lib/viewport/skeletonView';
import {
  alignRobotRoot,
  alignSkeletonToRobot,
  jointIndexByName,
  VIEWPORT_ANCHOR,
} from '@/lib/viewport/sceneAlignment';
import MappingTable from '@/components/MappingTable.vue';
import MobileSidePanel from '@/components/MobileSidePanel.vue';
import { downloadBlob } from '@/lib/export/motion';

const { t } = useI18n();
const { mdAndUp } = useDisplay();
const motion = useMotionStore();
const store = useRetargetStore();

const viewportEl = ref<HTMLElement | null>(null);
const sceneManager = shallowRef<SceneManager | null>(null);
const robotScene = shallowRef<RobotSceneObject | null>(null);
const robotModel = shallowRef<RobotModel | null>(null);
const skeleton = shallowRef<SkeletonView | null>(null);
const lines = shallowRef<THREE.LineSegments | null>(null);
const manifest = ref<RobotManifestEntry[]>([]);
const LOADING_STRIP_HIDE_MS = 2500;

type LoadingStripState = 'loading' | 'success' | 'error';
const stripVisible = ref(false);
const stripState = ref<LoadingStripState>('loading');
const loadingText = ref('');
let hideStripTimer: ReturnType<typeof setTimeout> | null = null;

function clearHideStripTimer() {
  if (hideStripTimer !== null) {
    clearTimeout(hideStripTimer);
    hideStripTimer = null;
  }
}

function showLoadingStrip(state: LoadingStripState, text: string) {
  clearHideStripTimer();
  stripVisible.value = true;
  stripState.value = state;
  loadingText.value = text;
}

function scheduleHideStrip() {
  clearHideStripTimer();
  hideStripTimer = setTimeout(() => {
    stripVisible.value = false;
    loadingText.value = '';
    hideStripTimer = null;
  }, LOADING_STRIP_HIDE_MS);
}
const showLines = ref(true);
const showHuman = ref(true);
const highlightBody = ref<string | null>(null);
const importInput = ref<HTMLInputElement | null>(null);
const activeTab = ref('stage1');
const panelOpen = ref(false);

const robotItems = computed(() =>
  manifest.value.map((m) => ({ title: m.label, value: m.id })),
);

const robotBodies = computed(() => robotModel.value?.bodyNames ?? []);

async function ensureRobotScene() {
  const sm = sceneManager.value;
  if (!sm) return;
  robotModel.value = null;
  showLoadingStrip('loading', t('loadingMujoco'));
  let loadTotal = 0;
  try {
    const robot = await loadRobot(store.robotId, (done, total) => {
      loadTotal = total;
      loadingText.value = `${t('loadingRobot')} ${done}/${total}`;
    });
    robotModel.value = robot;
    robotScene.value?.dispose();
    const scene = buildRobotScene(robot);
    (robot.data.qpos as Float64Array).set(robot.model.qpos0 as Float64Array);
    robot.mujoco.mj_kinematics(robot.model, robot.data);
    scene.update(robot.data);
    alignRobotRoot(scene, robot, store.config.robot_root_name, VIEWPORT_ANCHOR);
    scene.root.renderOrder = 1;
    sm.scene.add(scene.root);
    robotScene.value = scene;
    if (skeleton.value && motion.anim) {
      alignSkeletonToRobot(
        skeleton.value,
        motion.anim,
        store.config.human_root_name,
        scene,
        robot,
        store.config.robot_root_name,
        VIEWPORT_ANCHOR,
      );
    }
    refreshLines();
    stripState.value = 'success';
    loadingText.value =
      loadTotal > 0 ? `${t('robotLoadComplete')} (${loadTotal}/${loadTotal})` : t('robotLoadComplete');
    scheduleHideStrip();
  } catch (err) {
    showLoadingStrip('error', err instanceof Error ? err.message : String(err));
  }
}

function rebuildSkeleton() {
  const sm = sceneManager.value;
  if (!sm) return;
  skeleton.value?.dispose();
  skeleton.value = null;
  if (!motion.anim || !showHuman.value) {
    refreshLines();
    return;
  }
  const sk = buildSkeletonView(motion.anim, motion.unitScale);
  sk.setFrame(0);
  sm.scene.add(sk.root);
  skeleton.value = sk;
  if (robotScene.value && robotModel.value) {
    alignSkeletonToRobot(
      sk,
      motion.anim,
      store.config.human_root_name,
      robotScene.value,
      robotModel.value,
      store.config.robot_root_name,
      VIEWPORT_ANCHOR,
    );
  } else {
    sk.lockJointToWorld(jointIndexByName(motion.anim, store.config.human_root_name), VIEWPORT_ANCHOR);
  }
  refreshLines();
}

function refreshLines() {
  const sm = sceneManager.value;
  if (!sm) return;
  if (lines.value) {
    lines.value.geometry.dispose();
    (lines.value.material as THREE.Material).dispose();
    lines.value.removeFromParent();
    lines.value = null;
  }
  if (!showLines.value || !robotScene.value || !skeleton.value || !robotModel.value || !motion.anim) return;

  const robot = robotModel.value;
  const jointIndex = new Map(motion.anim.joints.map((j, i) => [j.name, i]));
  if (jointIndex.has('LeftFoot')) jointIndex.set('LeftFootMod', jointIndex.get('LeftFoot')!);
  if (jointIndex.has('RightFoot')) jointIndex.set('RightFootMod', jointIndex.get('RightFoot')!);

  const positions: number[] = [];
  const colors: number[] = [];
  const tmp = new THREE.Vector3();
  const stageColor: Record<string, THREE.Color> = {
    stage1: new THREE.Color(0x4fc3f7),
    stage2: new THREE.Color(0xffb74d),
  };
  const tables: [Record<string, [string, number, number, number[], number[]]>, string][] = [
    [store.config.ik_match_table1, 'stage1'],
    [store.config.ik_match_table2, 'stage2'],
  ];
  const active = activeTab.value === 'stage2' ? 1 : 0;
  const [table, stage] = tables[active];
  const color = stageColor[stage];
  const hl = highlightBody.value;
  for (const [robotBody, entry] of Object.entries(table)) {
    const humanJoint = entry[0];
    const bodyId = robot.bodyIds.get(robotBody);
    const jIdx = jointIndex.get(humanJoint);
    if (bodyId === undefined || jIdx === undefined) continue;
    const group = robotScene.value.bodyGroups.get(bodyId);
    if (!group) continue;
    group.getWorldPosition(tmp);
    positions.push(tmp.x, tmp.y, tmp.z);
    skeleton.value.getJointWorldPos(jIdx, tmp);
    positions.push(tmp.x, tmp.y, tmp.z);
    const c = robotBody === hl ? new THREE.Color(0xffffff) : color;
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
  const seg = new THREE.LineSegments(geo, mat);
  seg.renderOrder = 10;
  sm.scene.add(seg);
  lines.value = seg;
}

function onExportConfig() {
  const blob = new Blob([store.exportConfigJson()], { type: 'application/json' });
  downloadBlob(blob, `ik_config_${store.robotId}.json`);
}

function onImportChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  file.text().then((text) => {
    try {
      store.importConfigJson(text);
    } catch (err) {
      showLoadingStrip('error', err instanceof Error ? err.message : String(err));
    }
  });
  (e.target as HTMLInputElement).value = '';
}

watch(() => store.robotId, ensureRobotScene);
watch(() => motion.anim, rebuildSkeleton);
watch([showLines, showHuman, activeTab, highlightBody], () => {
  if (showHuman.value && !skeleton.value) rebuildSkeleton();
  else if (!showHuman.value && skeleton.value) rebuildSkeleton();
  else refreshLines();
});
watch(
  () => store.config,
  () => refreshLines(),
  { deep: true },
);
watch(
  () => [store.config.robot_root_name, store.config.human_root_name] as const,
  () => {
    if (!robotScene.value || !robotModel.value || !skeleton.value || !motion.anim) return;
    alignRobotRoot(
      robotScene.value,
      robotModel.value,
      store.config.robot_root_name,
      VIEWPORT_ANCHOR,
    );
    alignSkeletonToRobot(
      skeleton.value,
      motion.anim,
      store.config.human_root_name,
      robotScene.value,
      robotModel.value,
      store.config.robot_root_name,
      VIEWPORT_ANCHOR,
    );
    refreshLines();
  },
);
watch(mdAndUp, () => sceneManager.value?.resize());
watch(panelOpen, () => nextTick(() => sceneManager.value?.resize()));

onMounted(async () => {
  manifest.value = await getRobotManifest().catch(() => []);
  const sm = new SceneManager(viewportEl.value!, {
    cameraPos: [1.6, -2.9, 1.7],
    target: [VIEWPORT_ANCHOR.x, VIEWPORT_ANCHOR.y, VIEWPORT_ANCHOR.z],
  });
  sm.start();
  sceneManager.value = sm;
  rebuildSkeleton();
  await ensureRobotScene();
});

onActivated(() => sceneManager.value?.start());
onDeactivated(() => sceneManager.value?.stop());
onUnmounted(() => {
  clearHideStripTimer();
  skeleton.value?.dispose();
  robotScene.value?.dispose();
  sceneManager.value?.dispose();
});
</script>

<template>
  <div class="page-root d-flex">
    <input ref="importInput" type="file" accept=".json" class="d-none" @change="onImportChosen" />

    <MobileSidePanel v-model="panelOpen">
      <div v-if="!motion.hasMotion" class="text-caption text-warning text-center">{{ t('noMotionHint') }}</div>

      <v-select
        :model-value="store.robotId"
        :items="robotItems"
        :label="t('robot')"
        density="compact"
        hide-details
        @update:model-value="(v: string) => store.setRobot(v)"
      />

      <v-card variant="tonal" density="compact">
        <v-card-title class="text-subtitle-2">{{ t('globalParams') }}</v-card-title>
        <v-card-text class="d-flex flex-column ga-2">
          <v-text-field
            v-model.number="store.solver.actualHumanHeight"
            type="number"
            step="0.01"
            :label="t('actualHumanHeight')"
          />
          <v-text-field
            :model-value="store.config.human_height_assumption"
            type="number"
            step="0.01"
            :label="t('heightAssumption')"
            @update:model-value="(v: string) => (store.config.human_height_assumption = parseFloat(v) || 1.8)"
          />
          <v-text-field
            v-model.number="store.solver.groundOffset"
            type="number"
            step="0.01"
            :label="t('groundHeight')"
          />
        </v-card-text>
      </v-card>

      <v-card variant="tonal" density="compact">
        <v-card-title class="text-subtitle-2">{{ t('solverParams') }}</v-card-title>
        <v-card-text class="d-flex flex-column ga-2">
          <v-text-field v-model.number="store.solver.damping" type="number" step="0.1" :label="t('damping')" />
          <v-text-field v-model.number="store.solver.maxIter" type="number" step="1" :label="t('maxIter')" />
          <v-switch
            v-model="store.solver.useVelocityLimit"
            :label="t('velocityLimit')"
            color="primary"
            density="compact"
            hide-details
          />
        </v-card-text>
      </v-card>

      <div class="d-flex flex-column ga-2">
        <v-btn variant="tonal" :prepend-icon="mdiUpload" @click="importInput?.click()">
          {{ t('importConfig') }}
        </v-btn>
        <v-btn variant="tonal" :prepend-icon="mdiDownload" @click="onExportConfig">
          {{ t('exportConfig') }}
        </v-btn>
        <v-btn variant="text" color="warning" :prepend-icon="mdiBackupRestore" @click="store.resetConfig()">
          {{ t('resetConfig') }}
        </v-btn>
      </div>

      <div class="text-caption text-medium-emphasis">{{ t('configHint') }}</div>

      <v-switch v-model="showHuman" :label="t('showHuman')" color="primary" density="compact" hide-details />
      <v-switch v-model="showLines" :label="t('showLines')" color="primary" density="compact" hide-details />
    </MobileSidePanel>

    <div class="main-col d-flex flex-column flex-grow-1">
      <div ref="viewportEl" class="viewport" />
      <div
        v-if="stripVisible && loadingText"
        class="loading-strip text-caption px-3 py-1"
        :class="{
          'loading-strip--success': stripState === 'success',
          'loading-strip--error': stripState === 'error',
        }"
      >
        <v-progress-circular v-if="stripState === 'loading'" indeterminate size="12" width="2" class="mr-2" />
        {{ loadingText }}
      </div>

      <div class="tables-panel">
        <v-tabs v-model="activeTab" density="compact" color="primary" show-arrows>
          <v-tab value="stage1">{{ t('stage1') }}</v-tab>
          <v-tab value="stage2">{{ t('stage2') }}</v-tab>
          <v-tab value="scale">{{ t('scaleTable') }}</v-tab>
        </v-tabs>
        <div class="table-scroll">
          <MappingTable
            v-if="activeTab === 'stage1'"
            :table="store.config.ik_match_table1"
            :human-joints="motion.jointNames"
            :robot-bodies="robotBodies"
            @highlight="(b) => (highlightBody = b)"
          />
          <MappingTable
            v-else-if="activeTab === 'stage2'"
            :table="store.config.ik_match_table2"
            :human-joints="motion.jointNames"
            :robot-bodies="robotBodies"
            @highlight="(b) => (highlightBody = b)"
          />
          <div v-else class="table-x-scroll">
            <v-table density="compact">
              <thead>
                <tr>
                  <th>{{ t('humanJoint') }}</th>
                  <th style="width: 140px">Scale</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(value, key) in store.config.human_scale_table" :key="key">
                  <td class="mono">{{ key }}</td>
                  <td>
                    <v-text-field
                      :model-value="value"
                      type="number"
                      step="0.05"
                      @update:model-value="(v: string) => (store.config.human_scale_table[key] = parseFloat(v) || 0)"
                    />
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </div>
      </div>
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
  flex: 1 1 55%;
  min-height: 0;
  position: relative;
}
@media (max-width: 959.98px) {
  .viewport {
    flex: 0 0 38vh;
    min-height: 220px;
  }
}
.tables-panel {
  flex: 1 1 45%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.table-scroll {
  overflow: auto;
  flex: 1;
  -webkit-overflow-scrolling: touch;
}
.table-x-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.loading-strip {
  background: rgba(79, 195, 247, 0.08);
  color: rgba(255, 255, 255, 0.87);
  transition: background-color 0.25s ease, color 0.25s ease;
}
.loading-strip--success {
  background: rgba(76, 175, 80, 0.22);
  color: rgb(129, 199, 132);
}
.loading-strip--error {
  background: rgba(244, 67, 54, 0.12);
  color: rgb(239, 154, 154);
}
.mono {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.82rem;
}
.panel-fab {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 4;
}
</style>
