<script setup lang="ts">
import { computed, defineAsyncComponent, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, shallowRef, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import * as THREE from 'three';
import { icons } from '@/lib/icons';
import { useDisplay } from 'vuetify';
import { useI18n } from '@/i18n';
import { useMotionStore } from '@/stores/motion';
import { useRetargetStore, CUSTOM_ROBOT_ID } from '@/stores/retarget';
import { getRobotManifest, type RobotManifestEntry, type RobotModel, isRobotModelDisposed } from '@/lib/mujoco/runtime';
import { QUADRUPED_ENABLED } from '@/lib/features';
import { motionMatchesRobot } from '@/lib/motionKind';
import { buildRobotScene, type RobotSceneObject } from '@/lib/mujoco/threeScene';
import { SceneManager } from '@/lib/viewport/SceneManager';
import { buildSkeletonView, type SkeletonView } from '@/lib/viewport/skeletonView';
import {
  defaultPlace,
  FACING_YAW,
  placeRobotRoot,
  placeSkeleton,
  VIEWPORT_ANCHOR,
  type FloorPlace,
} from '@/lib/viewport/sceneAlignment';
import {
  clampPlace,
  dragPlace,
  floorPoint,
  MOVE_SNAP,
  samePlace,
  startGrab,
  yawDegrees,
  type PlacementGrab,
  type StageMember,
} from '@/lib/viewport/stagePlacement';
import { buildPlacementGizmo, type GizmoHandle, type PlacementGizmo } from '@/lib/viewport/placementGizmo';
import MappingTable from '@/components/MappingTable.vue';
import MobileSidePanel from '@/components/MobileSidePanel.vue';
import { BUILTIN_GALLERY_LINKS, galleryRobotUrl } from '@/lib/gallery/registry';
import EngineToggle from '@/components/EngineToggle.vue';
import WorkflowNavBar from '@/components/WorkflowNavBar.vue';
import { downloadBlob } from '@/lib/export/motion';
import { prefetchPreviewStep } from '@/lib/prefetch';
import { onViewportTap, type ViewportTap } from '@/lib/viewport/viewportTap';
import { nearestScreenAnchor, type ScreenAnchor } from '@/lib/viewport/scenePick';
import {
  focusedMatch,
  focusStage,
  isMappingStage,
  MAPPING_STAGES,
  refreshSelection,
  sameSelection,
  selectSource,
  skeletonJointName,
  stageTable,
  stepSelection,
  type MappingMatch,
  type MappingSelection,
  type MappingStage,
  type SelectionSource,
} from '@/lib/retarget/mappingSelection';

const { t } = useI18n();
const { mdAndUp } = useDisplay();
const router = useRouter();
const motion = useMotionStore();
const store = useRetargetStore();

const progressPct = computed(() =>
  store.runProgress.total > 0 ? (100 * store.runProgress.done) / store.runProgress.total : 0,
);

async function run() {
  await store.run();
  if (store.status === 'done') await router.push({ name: 'preview' });
}

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
    hideStripTimer = null;
  }, LOADING_STRIP_HIDE_MS);
}

function onLoadingStripAfterLeave() {
  loadingText.value = '';
}
const showLines = ref(true);
const showHuman = ref(true);
const importInput = ref<HTMLInputElement | null>(null);
// Loads on first open, then stays mounted.
const CustomUrdfImportDialog = defineAsyncComponent(() => import('@/components/CustomUrdfImportDialog.vue'));
const urdfDialogOpen = ref(false);
const urdfDialogUsed = ref(false);
watch(urdfDialogOpen, (open) => open && (urdfDialogUsed.value = true));
const GalleryRobotDialog = defineAsyncComponent(() => import('@/components/GalleryRobotDialog.vue'));
const galleryDialogOpen = ref(false);
const galleryDialogUsed = ref(false);
watch(galleryDialogOpen, (open) => open && (galleryDialogUsed.value = true));
const activeTab = ref('stage1');
const panelOpen = ref(false);
const tableScrollEl = ref<HTMLElement | null>(null);

// ---- Mapping selection (3D pick ⇄ correspondence lines ⇄ table rows) ----

/** Picked robot body / BVH joint / table row, resolved to its mapping rows. */
const selection = shallowRef<MappingSelection | null>(null);
/** Row under the mouse in the open stage table: previewed over the selection. */
const hoverBody = ref<string | null>(null);
const focused = computed(() => focusedMatch(selection.value));

/** The mapping the 3D view highlights: a hovered row, else the focused match. */
const shownMapping = computed((): MappingMatch | null => {
  const stage = activeTab.value;
  if (hoverBody.value && isMappingStage(stage)) {
    const entry = stageTable(store.config, stage)[hoverBody.value];
    if (entry) return { stage, robotBody: hoverBody.value, humanJoint: entry[0] };
  }
  return focused.value;
});

/** Selected row of the open stage table. */
const selectedRow = computed(() =>
  focused.value && focused.value.stage === activeTab.value ? focused.value.robotBody : null,
);

const selectionLabel = computed(() => {
  const sel = selection.value;
  if (!sel) return null;
  const match = focused.value;
  if (match) {
    return {
      mapped: true as const,
      robotBody: match.robotBody,
      humanJoint: match.humanJoint,
      stage: match.stage,
      position: sel.matches.length > 1 ? `${sel.index + 1}/${sel.matches.length}` : '',
    };
  }
  const name = sel.source.kind === 'human' ? sel.source.joint : sel.source.kind === 'robot' ? sel.source.body : '';
  return { mapped: false as const, name };
});

function clearSelection() {
  selection.value = null;
}

/** Open the focused row's stage tab and scroll the row into view. */
function revealFocused() {
  const match = focused.value;
  if (!match) return;
  if (activeTab.value !== match.stage) activeTab.value = match.stage;
  void nextTick(() => scrollRowIntoView(match.robotBody));
}

/** Scroll only the table panel: `scrollIntoView` would also scroll the page around it. */
function scrollRowIntoView(robotBody: string) {
  const box = tableScrollEl.value;
  if (!box) return;
  const row = [...box.querySelectorAll<HTMLElement>('tr[data-robot-body]')].find(
    (el) => el.dataset.robotBody === robotBody,
  );
  if (!row) return;
  const boxRect = box.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  if (rowRect.top >= boxRect.top && rowRect.bottom <= boxRect.bottom) return;
  const top = box.scrollTop + rowRect.top - boxRect.top - (box.clientHeight - rowRect.height) / 2;
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  box.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}

function selectFromView(source: SelectionSource) {
  hoverBody.value = null;
  selection.value = selectSource(store.config, source, activeTab.value, selection.value);
  revealFocused();
}

function stepMatch(delta: number) {
  if (!selection.value) return;
  selection.value = stepSelection(selection.value, delta);
  revealFocused();
}

function onRowSelect(stage: MappingStage, robotBody: string | null) {
  selection.value =
    robotBody === null ? null : selectSource(store.config, { kind: 'row', stage, robotBody }, stage, null);
}

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

/** What lies under a canvas pixel: a robot body, a BVH joint, or nothing. */
function pickAt(x: number, y: number, width: number, height: number, pointerType: string): SelectionSource | null {
  const sm = sceneManager.value;
  const robot = robotModel.value;
  const scene = robotScene.value;
  const sk = skeleton.value;
  const anim = motion.anim;
  if (!sm) return null;
  pointerNdc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, sm.camera);
  const robotHit = robot && scene ? scene.pickBody(raycaster) : null;
  const jointHit = sk && anim ? sk.pickJoint(raycaster) : null;
  if (robot && robotHit && (!jointHit || robotHit.distance <= jointHit.distance)) {
    return { kind: 'robot', body: robot.bodyNames[robotHit.bodyId] };
  }
  if (anim && jointHit) return { kind: 'human', joint: anim.joints[jointHit.joint].name };

  // Nothing under the pointer: take a mapped body origin (some carry no visual
  // geometry) or a joint drawn within a fingertip of it.
  const anchors: ScreenAnchor<SelectionSource>[] = [];
  if (robot && scene) {
    const mapped = new Set(MAPPING_STAGES.flatMap((stage) => Object.keys(stageTable(store.config, stage))));
    for (const body of mapped) {
      const id = robot.bodyIds.get(body);
      const group = id === undefined ? undefined : scene.bodyGroups.get(id);
      if (group) anchors.push({ id: { kind: 'robot', body }, world: group.getWorldPosition(new THREE.Vector3()) });
    }
  }
  if (sk && anim) {
    anim.joints.forEach((joint, j) => {
      if (sk.isJointShown(j)) {
        anchors.push({ id: { kind: 'human', joint: joint.name }, world: sk.getJointWorldPos(j, new THREE.Vector3()) });
      }
    });
  }
  return nearestScreenAnchor(anchors, sm.camera, width, height, x, y, pointerType === 'mouse' ? 12 : 24);
}

function onSceneTap(tap: ViewportTap) {
  const canvas = sceneManager.value?.renderer.domElement;
  if (!canvas) return;
  if (arranging.value) {
    // Arranging: a tap says which figure the gizmo and the fields are about.
    aimRay(tap.clientX, tap.clientY);
    const figure = pickFigure();
    if (figure) arrangeTarget.value = figure.member;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const source = pickAt(tap.clientX - rect.left, tap.clientY - rect.top, rect.width, rect.height, tap.pointerType);
  if (source) selectFromView(source);
  else clearSelection();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || (!selection.value && !arranging.value)) return;
  const el = e.target as HTMLElement | null;
  if (el?.closest('input, textarea, select, [contenteditable="true"], .v-overlay')) return;
  if (arranging.value) arranging.value = false;
  else clearSelection();
}

/** Selection pins: one at the robot body, one at the BVH joint (drawn through meshes). */
const markerGeo = new THREE.SphereGeometry(0.02, 16, 12);
const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 });
const robotMarker = new THREE.Mesh(markerGeo, markerMat);
const humanMarker = new THREE.Mesh(markerGeo, markerMat);
robotMarker.renderOrder = humanMarker.renderOrder = 12;
robotMarker.visible = humanMarker.visible = false;
let unbindTap: (() => void) | null = null;

// ---- Stage arrangement: where the robot and the BVH stand (display only) ----
//
// Each figure can be slid across the floor and turned about the vertical, as
// on Robot Description Gallery Online's compare stage, so the two need not
// overlap where their keypoints are hard to click. Only the three.js objects
// move: the solver reads the motion frames and the MuJoCo model, never the
// viewport, so nothing has to be taken back out before retargeting, and the
// exported config is unchanged. Untouched, both stand where they always have.

const arranging = ref(false);
const arrangeTarget = ref<StageMember>('robot');
const snapping = ref(true);
const places = reactive<Record<StageMember, FloorPlace>>({
  robot: defaultPlace('robot'),
  human: defaultPlace('human'),
});
const placementMoved = computed(
  () => !samePlace(places.robot, defaultPlace('robot')) || !samePlace(places.human, defaultPlace('human')),
);
const targetPlaceFields = computed(() => {
  const p = places[arrangeTarget.value];
  return { x: p.x.toFixed(3), y: p.y.toFixed(3), yaw: String(yawDegrees(p.yaw)) };
});

let gizmo: PlacementGizmo | null = null;
let gizmoFor: THREE.Object3D | null = null;
let grab: PlacementGrab | null = null;
let grabPointer = -1;
const overHandle = ref<GizmoHandle | null>(null);
const dragging = ref(false);

function placeRobot() {
  if (robotScene.value && robotModel.value) {
    placeRobotRoot(robotScene.value, robotModel.value, alignBodyName(), places.robot, VIEWPORT_ANCHOR.z);
  }
}

function placeHuman() {
  if (skeleton.value && motion.anim) {
    placeSkeleton(skeleton.value, motion.anim, store.config.human_root_name, places.human, VIEWPORT_ANCHOR.z);
  }
}

function figureRoot(member: StageMember): THREE.Object3D | null {
  return (member === 'robot' ? robotScene.value?.root : skeleton.value?.root) ?? null;
}

/** The gizmo under the figure being arranged, built for its size; none outside arrange mode. */
function refreshGizmo() {
  const sm = sceneManager.value;
  if (!sm) return;
  const target = arranging.value ? figureRoot(arrangeTarget.value) : null;
  if (gizmo && gizmoFor !== target) {
    gizmo.dispose();
    gizmo = null;
    gizmoFor = null;
    overHandle.value = null;
  }
  if (target && !gizmo) {
    const size = new THREE.Box3().setFromObject(target).getSize(new THREE.Vector3());
    gizmo = buildPlacementGizmo(Math.min(Math.max(0.5 * Math.max(size.x, size.y), 0.15), 0.45));
    gizmoFor = target;
    sm.scene.add(gizmo.root);
  }
  const p = places[arrangeTarget.value];
  gizmo?.place(p.x, p.y, FACING_YAW + p.yaw);
  sm.invalidate();
}

function setPlace(member: StageMember, next: FloorPlace) {
  if (samePlace(next, places[member])) return;
  places[member] = next;
  if (member === 'robot') placeRobot();
  else placeHuman();
  refreshGizmo();
  refreshLines();
}

function resetPlacement() {
  setPlace('robot', defaultPlace('robot'));
  setPlace('human', defaultPlace('human'));
}

/** A typed placement, committed on `change` so a half-typed "-" never moves anything. */
function onPlaceField(key: 'x' | 'y' | 'yaw', e: Event) {
  const value = parseFloat((e.target as HTMLInputElement).value);
  const member = arrangeTarget.value;
  if (!Number.isFinite(value)) {
    (e.target as HTMLInputElement).value = targetPlaceFields.value[key];
    return;
  }
  setPlace(member, clampPlace({ ...places[member], [key]: key === 'yaw' ? (value * Math.PI) / 180 : value }));
}

function aimRay(clientX: number, clientY: number): boolean {
  const sm = sceneManager.value;
  if (!sm) return false;
  const rect = sm.renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, sm.camera);
  return true;
}

/** The figure under the current ray, the nearer of the two, with where it was hit. */
function pickFigure(): { member: StageMember; point: THREE.Vector3; distance: number } | null {
  const robotHit = robotScene.value?.pickBody(raycaster) ?? null;
  const jointHit = skeleton.value?.pickJoint(raycaster) ?? null;
  const hit =
    robotHit && (!jointHit || robotHit.distance <= jointHit.distance)
      ? { member: 'robot' as const, distance: robotHit.distance }
      : jointHit
        ? { member: 'human' as const, distance: jointHit.distance }
        : null;
  return hit && { ...hit, point: raycaster.ray.at(hit.distance, new THREE.Vector3()) };
}

/**
 * Capture phase on the viewport, ahead of OrbitControls on the canvas inside
 * it: taking hold of a figure or a handle switches the camera off before it
 * starts following the same pointer. A press on empty floor still orbits.
 */
function onArrangePointerDown(e: PointerEvent) {
  const sm = sceneManager.value;
  if (!arranging.value || !sm || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (!aimRay(e.clientX, e.clientY)) return;
  const handle = gizmo?.handleAt(raycaster) ?? null;
  const figure = pickFigure();
  let member: StageMember;
  let kind: PlacementGrab['handle'];
  let height: number;
  if (handle && (!figure || handle.distance <= figure.distance)) {
    member = arrangeTarget.value;
    kind = handle.handle;
    height = handle.point.z;
  } else if (figure) {
    member = figure.member;
    kind = null;
    height = figure.point.z;
  } else {
    return;
  }
  const from = floorPoint(raycaster.ray, height);
  if (!from) return;
  arrangeTarget.value = member;
  grab = startGrab(member, kind, places[member], from, height);
  grabPointer = e.pointerId;
  dragging.value = true;
  sm.controls.enabled = false;
  sm.renderer.domElement.setPointerCapture?.(e.pointerId);
}

function onArrangePointerMove(e: PointerEvent) {
  if (!grab) {
    // Not dragging: light up the handle under a mouse, before anything is pressed.
    if (!arranging.value || !gizmo || e.pointerType !== 'mouse' || e.buttons !== 0) return;
    if (!aimRay(e.clientX, e.clientY)) return;
    const over = gizmo.handleAt(raycaster)?.handle ?? null;
    if (gizmo.hover(over)) sceneManager.value?.invalidate();
    overHandle.value = over;
    return;
  }
  if (e.pointerId !== grabPointer || !aimRay(e.clientX, e.clientY)) return;
  const to = floorPoint(raycaster.ray, grab.height);
  // Above the horizon there is no plane to read: stay where the last move left it.
  if (!to) return;
  setPlace(grab.member, dragPlace(grab, places[grab.member], to, e.shiftKey, snapping.value));
}

function onArrangePointerEnd(e: PointerEvent) {
  if (!grab || e.pointerId !== grabPointer) return;
  grab = null;
  grabPointer = -1;
  dragging.value = false;
  const sm = sceneManager.value;
  if (sm) sm.controls.enabled = true;
}

type RobotSelectItem = {
  title: string;
  value: string;
  props?: { disabled?: boolean };
  isCustom?: boolean;
};

const robotItems = computed((): RobotSelectItem[] => {
  const kind = motion.motionKind;
  const items: RobotSelectItem[] = manifest.value
    .filter((m) => QUADRUPED_ENABLED || m.configKey !== 'bvh_quadruped')
    // SMPL-X robots only surface for SMPL-X motion (keeps the BVH dropdown clean).
    .filter((m) => m.configKey !== 'smplx' || kind === 'smplx')
    .map((m) => ({
      title: m.label,
      value: m.id,
      props: {
        disabled: kind !== null && !motionMatchesRobot(kind, m.configKey),
      },
    }));
  if (store.customRobot) {
    const tag = store.customRobot.gallery ? t('galleryRobotTag') : t('customRobot');
    items.unshift({
      title: `${store.customRobot.label} (${tag})`,
      value: CUSTOM_ROBOT_ID,
      isCustom: true,
      props: { disabled: kind !== null && kind !== store.customRobotKind },
    });
  }
  return items;
});

/** The selected robot's page on Robot Description Gallery Online, when it has one. */
const galleryPageUrl = computed((): string | null => {
  if (store.robotId === CUSTOM_ROBOT_ID) {
    const gallery = store.customRobot?.gallery;
    return gallery ? galleryRobotUrl(gallery.id, gallery.variant) : null;
  }
  const link = BUILTIN_GALLERY_LINKS[store.robotId];
  return link ? galleryRobotUrl(link.id, link.variant) : null;
});

function onRobotSelected(robotId: string) {
  const item = robotItems.value.find((i) => i.value === robotId);
  if (item?.props?.disabled) return;
  store.setRobot(robotId);
}

async function syncRobotToMotion() {
  if (store.syncRobotToMotion(manifest.value)) {
    await ensureRobotScene();
  }
}

const robotBodies = computed(() => robotModel.value?.bodyNames ?? []);

function alignBodyName(robotRootName = store.config.robot_root_name): string {
  const entry = manifest.value.find((m) => m.id === store.robotId);
  return entry?.alignBody ?? robotRootName;
}

async function ensureRobotScene() {
  const sm = sceneManager.value;
  if (!sm) return;
  robotModel.value = null;
  clearSelection();
  showLoadingStrip('loading', t('loadingMujoco'));
  let loadTotal = 0;
  try {
    store.robotLoadProgress = { done: 0, total: 1 };
    const robot = await store.ensureRobot();
    loadTotal = store.robotLoadProgress.total;
    robotModel.value = robot;
    robotScene.value?.dispose();
    const scene = buildRobotScene(robot);
    (robot.data.qpos as Float64Array).set(robot.model.qpos0 as Float64Array);
    robot.mujoco.mj_kinematics(robot.model, robot.data);
    scene.update(robot.data);
    scene.root.renderOrder = 1;
    sm.scene.add(scene.root);
    robotScene.value = scene;
    placeRobot();
    placeHuman();
    refreshGizmo();
    refreshLines();
    frameSmallScene();
    prefetchPreviewStep();
    stripState.value = 'success';
    loadingText.value =
      loadTotal > 0 ? `${t('robotLoadComplete')} (${loadTotal}/${loadTotal})` : t('robotLoadComplete');
    scheduleHideStrip();
  } catch (err) {
    showLoadingStrip('error', err instanceof Error ? err.message : String(err));
  }
}

/** Pull the camera in for small robots (quadrupeds) so robot + source skeleton fill the view. */
function frameSmallScene() {
  const sm = sceneManager.value;
  const robotRoot = robotScene.value?.root;
  if (!sm || !robotRoot) return;
  const box = new THREE.Box3().setFromObject(robotRoot);
  if (skeleton.value?.root) box.expandByObject(skeleton.value.root);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (size.z >= 0.9) return; // humanoids keep their default framing
  const d = Math.max(size.x, size.y, size.z) * 1.8;
  sm.setView(
    [center.x + d * 0.5, center.y - d * 0.95, center.z + d * 0.55],
    [center.x, center.y, center.z],
  );
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
  // Falls back to the motion root if the config root name is briefly out of
  // sync with the loaded motion (e.g. SMPL-X `pelvis` vs a stale `Hips`).
  placeHuman();
  refreshGizmo();
  refreshLines();
}

/**
 * Rebuild the correspondence lines and the selection highlight. Every scene
 * edit on this page ends here, so it also queues the redraw.
 */
function refreshLines() {
  const sm = sceneManager.value;
  if (!sm) return;
  sm.invalidate();
  if (lines.value) {
    lines.value.geometry.dispose();
    (lines.value.material as THREE.Material).dispose();
    lines.value.removeFromParent();
    lines.value = null;
  }
  applySelectionHighlight();
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
  const shown = shownMapping.value;
  const hl = shown && shown.stage === stage ? shown.robotBody : null;
  const white = new THREE.Color(0xffffff);
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
    // With a mapping highlighted, the others fade back.
    const c = robotBody === hl ? white : color;
    const a = robotBody === hl ? 1 : hl ? 0.2 : 0.85;
    colors.push(c.r, c.g, c.b, a, c.r, c.g, c.b, a);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
  const seg = new THREE.LineSegments(geo, mat);
  seg.renderOrder = 10;
  sm.scene.add(seg);
  lines.value = seg;
}

/** Tint the selected robot body, mark the selected BVH joint and pin both ends of the shown mapping. */
function applySelectionHighlight() {
  const robot = robotModel.value;
  const scene = robotScene.value;
  const sk = skeleton.value;
  const anim = motion.anim;
  const shown = shownMapping.value;
  const source = selection.value?.source;
  // An unmapped pick still shows what was picked.
  const robotBody = shown?.robotBody ?? (source?.kind === 'robot' ? source.body : null);
  const humanJoint = shown ? skeletonJointName(shown.humanJoint) : source?.kind === 'human' ? source.joint : null;

  const bodyId = robot && robotBody !== null ? robot.bodyIds.get(robotBody) : undefined;
  const group = bodyId === undefined ? undefined : scene?.bodyGroups.get(bodyId);
  scene?.setHighlightedBody(group ? bodyId! : null);
  const jointIndex = anim && humanJoint !== null ? anim.joints.findIndex((j) => j.name === humanJoint) : -1;
  sk?.setSelected(jointIndex >= 0 ? jointIndex : null);

  robotMarker.visible = !!(shown && group);
  if (robotMarker.visible) group!.getWorldPosition(robotMarker.position);
  humanMarker.visible = !!(shown && sk && jointIndex >= 0);
  if (humanMarker.visible) sk!.getJointWorldPos(jointIndex, humanMarker.position);
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

async function onCustomUrdfImported(successKey = 'urdfImportSuccess') {
  showLoadingStrip('loading', t('loadingRobot'));
  try {
    await ensureRobotScene();
    showLoadingStrip('success', t(successKey));
    scheduleHideStrip();
  } catch (err) {
    showLoadingStrip('error', err instanceof Error ? err.message : String(err));
  }
}

function onRemoveCustomRobot() {
  const switched = store.removeCustomRobot();
  if (switched) {
    showLoadingStrip('success', t('customRobotRemoved'));
    scheduleHideStrip();
  }
}

watch(() => motion.motionKind, () => {
  void syncRobotToMotion();
});
watch(() => store.robotId, ensureRobotScene);
watch(
  () => store.robotLoadProgress,
  ({ done, total }) => {
    if (stripState.value === 'loading' && total > 0) {
      loadingText.value = `${t('loadingRobot')} ${done}/${total}`;
    }
  },
  { deep: true },
);
watch(
  () => motion.anim,
  () => {
    clearSelection();
    rebuildSkeleton();
  },
);
// Opening another stage tab moves the focus onto that stage's match, if any.
watch(activeTab, (tab) => {
  hoverBody.value = null;
  const next = focusStage(selection.value, tab);
  if (next === selection.value) return;
  selection.value = next;
  revealFocused();
});
watch([showLines, showHuman, activeTab, shownMapping, selection], () => {
  if (showHuman.value && !skeleton.value) rebuildSkeleton();
  else if (!showHuman.value && skeleton.value) rebuildSkeleton();
  else refreshLines();
});
watch(
  () => store.config,
  () => {
    // Rows renamed / remapped, a config imported or reset: keep the selection honest.
    const next = refreshSelection(store.config, selection.value, activeTab.value);
    if (!sameSelection(next, selection.value)) selection.value = next;
    refreshLines();
  },
  { deep: true },
);
watch(
  () => [store.config.robot_root_name, store.config.human_root_name] as const,
  () => {
    placeRobot();
    placeHuman();
    refreshGizmo();
    refreshLines();
  },
);
watch([arranging, arrangeTarget], () => {
  if (!arranging.value && grab) {
    grab = null;
    dragging.value = false;
    if (sceneManager.value) sceneManager.value.controls.enabled = true;
  }
  refreshGizmo();
});
watch(mdAndUp, () => sceneManager.value?.resize());
watch(panelOpen, () => nextTick(() => sceneManager.value?.resize()));

onMounted(async () => {
  manifest.value = await getRobotManifest().catch(() => []);
  const sm = new SceneManager(viewportEl.value!, {
    cameraPos: [1.6, -2.9, 1.7],
    target: [VIEWPORT_ANCHOR.x, VIEWPORT_ANCHOR.y, VIEWPORT_ANCHOR.z],
  });
  sm.start();
  sm.scene.add(robotMarker, humanMarker);
  unbindTap = onViewportTap(sm.renderer.domElement, onSceneTap);
  const host = viewportEl.value!;
  host.addEventListener('pointerdown', onArrangePointerDown, true);
  host.addEventListener('pointermove', onArrangePointerMove);
  host.addEventListener('pointerup', onArrangePointerEnd);
  host.addEventListener('pointercancel', onArrangePointerEnd);
  sceneManager.value = sm;
  rebuildSkeleton();
  store.syncRobotToMotion(manifest.value);
  await ensureRobotScene();
});

onActivated(() => {
  window.addEventListener('keydown', onKeydown);
  sceneManager.value?.start();
  // The preview page may have reloaded a different robot for a history entry,
  // freeing the one shown here (only one robot is kept alive): rebuild it.
  if (robotModel.value && isRobotModelDisposed(robotModel.value)) void ensureRobotScene();
});
onDeactivated(() => {
  window.removeEventListener('keydown', onKeydown);
  sceneManager.value?.stop();
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  unbindTap?.();
  gizmo?.dispose();
  clearHideStripTimer();
  skeleton.value?.dispose();
  robotScene.value?.dispose();
  sceneManager.value?.dispose();
});
</script>

<template>
  <div class="page-root d-flex">
    <input ref="importInput" type="file" accept=".json" class="d-none" @change="onImportChosen" />

    <CustomUrdfImportDialog v-if="urdfDialogUsed" v-model="urdfDialogOpen" @imported="onCustomUrdfImported()" />
    <GalleryRobotDialog
      v-if="galleryDialogUsed"
      v-model="galleryDialogOpen"
      @imported="onCustomUrdfImported('galleryImportSuccess')"
    />

    <MobileSidePanel v-model="panelOpen">
      <div class="sidebar-inner d-flex flex-column">
        <div class="sidebar-body d-flex flex-column ga-3">
          <div v-if="!motion.hasMotion" class="text-caption text-warning text-center">{{ t('noMotionHint') }}</div>

          <v-select
        :model-value="store.robotId"
        :items="robotItems"
        item-title="title"
        item-value="value"
        item-props="props"
        :label="t('robot')"
        density="compact"
        hide-details
        @update:model-value="onRobotSelected"
      >
        <template #item="{ item, props: itemProps }">
          <v-list-item v-bind="itemProps" :title="item.title" :disabled="item.props?.disabled">
            <template v-if="item.raw.isCustom" #append>
              <v-btn
                :icon="icons.trash"
                variant="text"
                size="x-small"
                density="compact"
                color="error"
                :title="t('removeCustomRobot')"
                :aria-label="t('removeCustomRobot')"
                @click.stop="onRemoveCustomRobot"
              />
            </template>
          </v-list-item>
        </template>
      </v-select>

      <v-btn
        v-if="galleryPageUrl"
        variant="text"
        density="comfortable"
        :prepend-icon="icons.openExternal"
        :href="galleryPageUrl"
        target="_blank"
        rel="noopener"
      >
        {{ t('viewInGallery') }}
      </v-btn>

      <v-btn
        variant="tonal"
        :prepend-icon="icons.gallery"
        :disabled="motion.motionKind === 'smplx'"
        @click="galleryDialogOpen = true"
      >
        {{ t('pickFromGallery') }}
      </v-btn>

      <v-btn
        variant="tonal"
        :prepend-icon="icons.robot"
        :disabled="motion.motionKind === 'quadruped'"
        @click="urdfDialogOpen = true"
      >
        {{ t('importUrdf') }}
      </v-btn>

          <EngineToggle :disabled="store.isBusy" />

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
          <template v-if="motion.motionKind === 'quadruped'">
            <v-switch
              v-model="store.solver.quadrupedPlanner"
              :label="t('quadrupedPlanner')"
              color="primary"
              density="compact"
              hide-details
            />
            <div class="text-caption text-medium-emphasis">{{ t('quadrupedPlannerHint') }}</div>
          </template>
        </v-card-text>
      </v-card>

      <v-card v-if="store.engine === 'omniretarget'" variant="tonal" density="compact">
        <v-card-title class="text-subtitle-2">{{ t('omniParams') }}</v-card-title>
        <v-card-text class="d-flex flex-column ga-2">
          <v-text-field
            v-model.number="store.solver.meshWeight"
            type="number"
            step="0.5"
            min="0"
            :label="t('meshWeight')"
          />
          <v-text-field
            v-model.number="store.solver.meshNeighbors"
            type="number"
            step="1"
            min="1"
            :label="t('meshNeighbors')"
          />
        </v-card-text>
      </v-card>

      <div class="panel-label">{{ t('configFile') }}</div>
      <div class="config-file-actions">
        <v-btn variant="tonal" :prepend-icon="icons.upload" @click="importInput?.click()">
          {{ t('importConfig') }}
        </v-btn>
        <v-btn variant="tonal" :prepend-icon="icons.download" @click="onExportConfig">
          {{ t('exportConfig') }}
        </v-btn>
        <v-btn variant="text" color="warning" :prepend-icon="icons.reset" class="config-file-actions__reset" @click="store.resetConfig()">
          {{ t('resetConfig') }}
        </v-btn>
      </div>

      <div class="text-caption text-medium-emphasis">{{ t('configHint') }}</div>

          <v-switch v-model="showHuman" :label="t('showHuman')" color="primary" density="compact" hide-details />
          <v-switch v-model="showLines" :label="t('showLines')" color="primary" density="compact" hide-details />
          <div class="text-caption text-medium-emphasis">{{ t('pickHint') }}</div>
        </div>

        <div class="sidebar-footer d-flex flex-column ga-2 pt-3 mt-auto">
          <v-btn
            v-if="store.status !== 'running'"
            color="primary"
            size="large"
            :prepend-icon="icons.play"
            :disabled="!motion.hasMotion || store.isLoadingRobot"
            block
            @click="run"
          >
            {{ t('runRetarget') }}
          </v-btn>
          <v-btn v-else color="error" variant="tonal" :prepend-icon="icons.stop" block @click="store.cancel()">
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
        </div>
      </div>
    </MobileSidePanel>

    <div class="main-col d-flex flex-column flex-grow-1">
      <div class="viewport-wrap">
        <div
          ref="viewportEl"
          class="viewport"
          :class="{
            'viewport--arranging': arranging,
            'viewport--over-handle': arranging && overHandle !== null,
            'viewport--dragging': dragging,
          }"
        />
        <WorkflowNavBar />
        <div class="stage-tools">
          <v-btn
            class="stage-tools__arrange"
            :prepend-icon="icons.arrange"
            :variant="arranging ? 'flat' : 'tonal'"
            :color="arranging ? 'primary' : undefined"
            size="small"
            :aria-pressed="arranging"
            :title="t('arrangeTitle')"
            @click="arranging = !arranging"
          >
            {{ t('arrange') }}
          </v-btn>
        </div>
        <Transition name="selection-chip-fade">
          <div v-if="arranging" class="arrange-panel text-caption" role="group" :aria-label="t('arrangeTitle')">
            <div class="arrange-panel__row">
              <v-btn-toggle
                v-model="arrangeTarget"
                mandatory
                divided
                density="compact"
                variant="outlined"
                color="primary"
                class="arrange-panel__target"
              >
                <v-btn value="robot" size="small">{{ t('arrangeRobot') }}</v-btn>
                <v-btn value="human" size="small">{{ t('arrangeHuman') }}</v-btn>
              </v-btn-toggle>
              <v-btn
                class="arrange-panel__icon-btn"
                :icon="icons.snap"
                size="small"
                :variant="snapping ? 'tonal' : 'text'"
                :color="snapping ? 'primary' : undefined"
                :aria-pressed="snapping"
                :title="t('snapToGrid')"
                :aria-label="t('snapToGrid')"
                @click="snapping = !snapping"
              />
              <v-btn
                v-if="placementMoved"
                class="arrange-panel__reset"
                variant="text"
                size="small"
                :prepend-icon="icons.reset"
                :title="t('resetPlacement')"
                :aria-label="t('resetPlacement')"
                @click="resetPlacement"
              >
                <span class="arrange-panel__reset-label">{{ t('resetPlacement') }}</span>
              </v-btn>
            </div>
            <div class="arrange-panel__row arrange-panel__fields">
              <v-text-field
                :model-value="targetPlaceFields.x"
                label="X"
                suffix="m"
                type="number"
                :step="snapping ? MOVE_SNAP : 0.01"
                inputmode="decimal"
                @change="(e: Event) => onPlaceField('x', e)"
              />
              <v-text-field
                :model-value="targetPlaceFields.y"
                label="Y"
                suffix="m"
                type="number"
                :step="snapping ? MOVE_SNAP : 0.01"
                inputmode="decimal"
                @change="(e: Event) => onPlaceField('y', e)"
              />
              <v-text-field
                :model-value="targetPlaceFields.yaw"
                :label="t('placeYaw')"
                suffix="°"
                type="number"
                :step="snapping ? 15 : 1"
                inputmode="decimal"
                @change="(e: Event) => onPlaceField('yaw', e)"
              />
            </div>
            <div class="arrange-panel__hint">{{ t('arrangeHint') }}</div>
          </div>
        </Transition>
        <Transition name="selection-chip-fade">
          <div
            v-if="selectionLabel && !arranging"
            class="selection-chip text-caption"
            :class="{ 'selection-chip--unmapped': !selectionLabel.mapped }"
            role="status"
            aria-live="polite"
          >
            <template v-if="selectionLabel.mapped">
              <span class="selection-chip__dot" :class="`selection-chip__dot--${selectionLabel.stage}`" />
              <span class="selection-chip__names">
                <span class="selection-chip__name">{{ selectionLabel.robotBody }}</span>
                <span class="selection-chip__arrow" aria-hidden="true">↔</span>
                <span class="selection-chip__name">{{ selectionLabel.humanJoint }}</span>
              </span>
              <span class="selection-chip__meta selection-chip__meta--stage">
                {{ t(selectionLabel.stage === 'stage1' ? 'stage1Short' : 'stage2Short') }}
              </span>
              <template v-if="selectionLabel.position">
                <v-btn
                  class="selection-chip__btn"
                  :icon="icons.caretLeft"
                  variant="text"
                  size="x-small"
                  :title="t('prevMapping')"
                  :aria-label="t('prevMapping')"
                  @click="stepMatch(-1)"
                />
                <span class="selection-chip__meta">{{ selectionLabel.position }}</span>
                <v-btn
                  class="selection-chip__btn"
                  :icon="icons.caretRight"
                  variant="text"
                  size="x-small"
                  :title="t('nextMapping')"
                  :aria-label="t('nextMapping')"
                  @click="stepMatch(1)"
                />
              </template>
            </template>
            <template v-else>
              <span class="selection-chip__names">
                <span class="selection-chip__name">{{ selectionLabel.name }}</span>
              </span>
              <span class="selection-chip__meta">{{ t('notMapped') }}</span>
            </template>
            <v-btn
              class="selection-chip__btn"
              :icon="icons.close"
              variant="text"
              size="x-small"
              :title="t('clearSelection')"
              :aria-label="t('clearSelection')"
              @click="clearSelection"
            />
          </div>
        </Transition>
        <!-- Floats over the viewport instead of pushing it, so the canvas never resizes for it. -->
        <Transition name="loading-strip-slide" @after-leave="onLoadingStripAfterLeave">
          <div
            v-if="stripVisible && loadingText"
            class="loading-strip text-caption"
            :class="{
              'loading-strip--success': stripState === 'success',
              'loading-strip--error': stripState === 'error',
            }"
            role="status"
          >
            <v-progress-circular v-if="stripState === 'loading'" indeterminate size="12" width="2" class="mr-2" />
            {{ loadingText }}
          </div>
        </Transition>
      </div>

      <div class="tables-panel">
        <v-tabs v-model="activeTab" density="compact" color="primary" show-arrows>
          <v-tab value="stage1">{{ t('stage1') }}</v-tab>
          <v-tab value="stage2">{{ t('stage2') }}</v-tab>
          <v-tab value="scale">{{ t('scaleTable') }}</v-tab>
        </v-tabs>
        <div ref="tableScrollEl" class="table-scroll">
          <MappingTable
            v-if="activeTab === 'stage1'"
            :table="store.config.ik_match_table1"
            :human-joints="motion.jointNames"
            :robot-bodies="robotBodies"
            :selected-body="selectedRow"
            @hover="(b) => (hoverBody = b)"
            @select="(b) => onRowSelect('stage1', b)"
          />
          <MappingTable
            v-else-if="activeTab === 'stage2'"
            :table="store.config.ik_match_table2"
            :human-joints="motion.jointNames"
            :robot-bodies="robotBodies"
            :selected-body="selectedRow"
            @hover="(b) => (hoverBody = b)"
            @select="(b) => onRowSelect('stage2', b)"
          />
          <div v-else class="table-x-scroll">
            <v-table density="compact">
              <thead>
                <tr>
                  <th>{{ t('humanJoint') }}</th>
                  <th class="scale-col">{{ t('scale') }}</th>
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
}
.viewport-wrap {
  flex: 1 1 55%;
  min-height: 0;
  position: relative;
}
.viewport {
  position: absolute;
  inset: 0;
}
@media (max-width: 959.98px) {
  .viewport-wrap {
    flex: 0 0 38vh;
    min-height: 220px;
  }
}
.tables-panel {
  flex: 1 1 45%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--rro-border);
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
.loading-strip-slide-enter-active,
.loading-strip-slide-leave-active {
  transition:
    transform var(--rro-dur-move) var(--rro-ease),
    opacity var(--rro-dur-color) var(--rro-ease);
}
.loading-strip-slide-enter-from,
.loading-strip-slide-leave-to {
  transform: translateY(8px);
  opacity: 0;
}
.loading-strip {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  max-width: calc(100% - 24px);
  padding: 8px 12px;
  border-radius: var(--rro-radius);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  box-shadow: var(--rro-shadow-float);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  transition:
    background-color var(--rro-dur-color) var(--rro-ease),
    color var(--rro-dur-color) var(--rro-ease),
    border-color var(--rro-dur-color) var(--rro-ease);
}
.loading-strip--success {
  border-color: rgba(var(--v-theme-success), 0.5);
  color: rgb(var(--v-theme-success));
}
.loading-strip--error {
  border-color: rgba(var(--v-theme-error), 0.5);
  color: rgb(var(--v-theme-error));
}
.viewport--over-handle {
  cursor: grab;
}
.viewport--dragging {
  cursor: grabbing;
}
.stage-tools {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 5;
}
/* Phones: the side-panel button already sits in the corner. */
@media (max-width: 959.98px) {
  .stage-tools {
    left: 64px;
  }
}
.arrange-panel {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(380px, calc(100% - 24px));
  padding: 8px;
  border-radius: var(--rro-radius);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  box-shadow: var(--rro-shadow-float);
}
.arrange-panel__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.arrange-panel__reset {
  margin-left: auto;
}
.arrange-panel__fields > * {
  flex: 1 1 0;
  min-width: 0;
}
.arrange-panel__hint {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  line-height: 1.35;
}
/* Phones: one row (target, snap, reset) so the small viewport stays usable; placing is by drag. */
@media (max-width: 599.98px) {
  .arrange-panel {
    width: auto;
    max-width: calc(100% - 24px);
  }
  .arrange-panel__fields,
  .arrange-panel__hint,
  .arrange-panel__reset-label {
    display: none;
  }
  .arrange-panel__reset :deep(.v-btn__prepend) {
    margin-inline: 0;
  }
}
@media (pointer: coarse), (hover: none) {
  .v-application .stage-tools .v-btn,
  .v-application .arrange-panel .v-btn {
    min-width: var(--rro-tap-target);
    min-height: var(--rro-tap-target);
  }
  .v-application .arrange-panel__target {
    height: var(--rro-tap-target);
  }
}
.selection-chip {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 24px);
  padding: 2px 4px 2px 12px;
  border-radius: var(--rro-radius);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  box-shadow: var(--rro-shadow-float);
  font-variant-numeric: tabular-nums;
}
.selection-chip--unmapped .selection-chip__meta {
  color: rgb(var(--v-theme-warning));
}
.selection-chip__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
/* The stage colours of the correspondence lines (refreshLines). */
.selection-chip__dot--stage1 {
  background: #4fc3f7;
}
.selection-chip__dot--stage2 {
  background: #ffb74d;
}
.selection-chip__names {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-family: var(--rro-font-mono);
}
.selection-chip__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selection-chip__arrow {
  flex: none;
  opacity: 0.6;
}
.selection-chip__meta {
  flex: none;
  white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
.selection-chip__btn {
  flex: none;
}
/* Phones: the two names stack, and the stage shows in the dot colour and the open tab. */
@media (max-width: 599.98px) {
  .selection-chip__names {
    flex: 1 1 auto;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    line-height: 1.3;
  }
  .selection-chip__name {
    max-width: 100%;
  }
  .selection-chip__arrow,
  .selection-chip__meta--stage {
    display: none;
  }
}
@media (pointer: coarse), (hover: none) {
  .v-application .selection-chip__btn.v-btn {
    min-width: var(--rro-tap-target);
    min-height: var(--rro-tap-target);
  }
}
.selection-chip-fade-enter-active,
.selection-chip-fade-leave-active {
  transition: opacity var(--rro-dur-color) var(--rro-ease);
}
.selection-chip-fade-enter-from,
.selection-chip-fade-leave-to {
  opacity: 0;
}
.mono {
  font-size: 0.75rem;
}
.scale-col {
  width: 140px;
}
.config-file-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.config-file-actions__reset {
  grid-column: 1 / -1;
  justify-self: start;
}
.panel-fab {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 4;
}
.sidebar-inner {
  min-height: 100%;
}
.sidebar-footer {
  border-top: 1px solid var(--rro-border);
  padding-top: 12px;
}
</style>
