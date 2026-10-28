import { defineStore } from 'pinia';
import { markRaw, toRaw } from 'vue';
import {
  createBlankConfig,
  createBlankQuadrupedConfig,
  getDefaultConfig,
  matchPresetConfig,
  validateConfig,
} from '@/lib/retarget/defaults';
import {
  DEFAULT_SOLVER_OPTIONS,
  type GmrIkConfig,
  type RetargetEngineId,
  type RetargetHistoryEntry,
  type RetargetResult,
  type SolverOptions,
} from '@/lib/retarget/types';
import { getRobotManifest, loadRobot, type RobotModel } from '@/lib/mujoco/runtime';
import {
  CUSTOM_ROBOT_ID,
  clearCustomRobotCache,
  loadCustomRobot,
  parseCustomRobotImport,
  type CustomRobotBundle,
} from '@/lib/mujoco/customRobot';
import { BUILTIN_GALLERY_LINKS, type GalleryRobot } from '@/lib/gallery/registry';
import { runRetarget } from '@/lib/retarget/runner';
import { findMissingBodies } from '@/lib/bvh/lafan1';
import {
  defaultRobotIdForKind,
  motionMatchesRobot,
  type MotionKind,
} from '@/lib/motionKind';
import type { RobotManifestEntry } from '@/lib/mujoco/runtime';
import { useMotionStore } from './motion';

export type RetargetStatus = 'idle' | 'loading-robot' | 'running' | 'done' | 'error';

/** Motion family an imported robot retargets from (uploads are humanoid). */
function bundleKind(bundle: CustomRobotBundle | null): MotionKind {
  return bundle?.kind ?? 'humanoid';
}

/**
 * Starting ik_config for an imported robot: a bundled GMR preset when every
 * body it names exists on the robot (the gallery's G1 / Go2 / A1 match the
 * built-in ones), else a name-heuristic template for its motion family.
 */
function initialCustomConfig(bundle: CustomRobotBundle, bodyNames: string[]): GmrIkConfig {
  const quadruped = bundleKind(bundle) === 'quadruped';
  const gallery = bundle.gallery;
  const preferred = gallery
    ? Object.entries(BUILTIN_GALLERY_LINKS)
        .filter(([, link]) => link.id === gallery.id && (!link.variant || link.variant === gallery.variant))
        .map(([robotId]) => robotId)
    : [];
  const preset = matchPresetConfig(quadruped ? 'b_Hips' : 'Hips', bodyNames, preferred);
  if (preset) return preset;
  return quadruped
    ? createBlankQuadrupedConfig(bundle.baseBody, bodyNames)
    : createBlankConfig(bundle.baseBody, bodyNames);
}

interface RetargetState {
  robotId: string;
  customRobot: CustomRobotBundle | null;
  engine: RetargetEngineId;
  config: GmrIkConfig;
  solver: SolverOptions;
  status: RetargetStatus;
  robotLoadProgress: { done: number; total: number };
  runProgress: { done: number; total: number };
  resultHistory: RetargetHistoryEntry[];
  activeHistoryId: string | null;
  /** History entry that should autoplay once preview finishes loading it. */
  pendingPreviewAutoplayId: string | null;
  errorMessage: string | null;
  abortController: AbortController | null;
}

export const useRetargetStore = defineStore('retarget', {
  state: (): RetargetState => ({
    robotId: 'unitree_g1',
    customRobot: null,
    engine: 'gmr',
    config: getDefaultConfig('unitree_g1'),
    solver: { ...DEFAULT_SOLVER_OPTIONS },
    status: 'idle',
    robotLoadProgress: { done: 0, total: 1 },
    runProgress: { done: 0, total: 1 },
    resultHistory: [],
    activeHistoryId: null,
    pendingPreviewAutoplayId: null,
    errorMessage: null,
    abortController: null,
  }),
  getters: {
    isBusy: (s) => s.status === 'loading-robot' || s.status === 'running',
    isLoadingRobot: (s) => s.status === 'loading-robot',
    isRetargetRunning: (s) => s.status === 'running',
    isCustomRobot: (s) => s.robotId === CUSTOM_ROBOT_ID,
    customRobotKind: (s): MotionKind => bundleKind(s.customRobot),
    robotDisplayLabel: (s) =>
      s.robotId === CUSTOM_ROBOT_ID && s.customRobot
        ? `${s.customRobot.label} (custom)`
        : s.robotId,
    result: (s): RetargetResult | null => {
      if (!s.activeHistoryId) return null;
      return s.resultHistory.find((e) => e.id === s.activeHistoryId)?.result ?? null;
    },
    activeHistoryEntry: (s): RetargetHistoryEntry | null => {
      if (!s.activeHistoryId) return null;
      return s.resultHistory.find((e) => e.id === s.activeHistoryId) ?? null;
    },
    hasHistory: (s) => s.resultHistory.length > 0,
  },
  actions: {
    setEngine(engine: RetargetEngineId) {
      if (engine === this.engine) return;
      this.engine = engine;
      if (this.status === 'done' || this.status === 'error') this.status = 'idle';
      this.errorMessage = null;
    },
    setRobot(robotId: string) {
      if (robotId === this.robotId) return;
      if (robotId === CUSTOM_ROBOT_ID && !this.customRobot) return;
      this.robotId = robotId;
      if (robotId === CUSTOM_ROBOT_ID) {
        // Keep the custom ik_config when switching back from a built-in robot.
      } else {
        this.config = getDefaultConfig(robotId);
      }
      this.status = 'idle';
      this.errorMessage = null;
    },
    /** Pick a built-in robot compatible with the loaded motion (humanoid vs quadruped). */
    syncRobotToMotion(manifest: RobotManifestEntry[]) {
      const motion = useMotionStore();
      const kind = motion.motionKind;
      if (!kind) return false;

      if (this.robotId === CUSTOM_ROBOT_ID) {
        if (kind === bundleKind(this.customRobot)) return false;
        this.setRobot(defaultRobotIdForKind(kind));
        return true;
      }

      const entry = manifest.find((m) => m.id === this.robotId);
      if (entry && motionMatchesRobot(kind, entry.configKey)) return false;

      const fallback =
        manifest.find((m) => motionMatchesRobot(kind, m.configKey)) ??
        manifest.find((m) => m.id === defaultRobotIdForKind(kind));
      if (!fallback || fallback.id === this.robotId) return false;
      this.setRobot(fallback.id);
      return true;
    },
    async importCustomRobot(file: File) {
      await this.adoptCustomRobot(await parseCustomRobotImport(file));
    },
    /** Download a robot from Robot Description Gallery Online and select it. */
    async importGalleryRobot(
      robot: GalleryRobot,
      variantId: string | null,
      onProgress?: (done: number, total: number) => void,
    ) {
      // Loaded on demand: pulls in the mesh converters (three.js STL / Collada).
      const { fetchGalleryRobotBundle } = await import('@/lib/gallery/urdfBundle');
      await this.adoptCustomRobot(await fetchGalleryRobotBundle(robot, variantId, { onProgress }));
    },
    async adoptCustomRobot(bundle: CustomRobotBundle) {
      clearCustomRobotCache();
      // Mesh bytes can run to tens of MB: keep them out of Vue's reactivity.
      this.customRobot = markRaw(bundle);
      this.robotId = CUSTOM_ROBOT_ID;
      this.status = 'idle';
      this.errorMessage = null;

      const robot = await this.ensureRobot();
      this.config = initialCustomConfig(bundle, robot.bodyNames);
    },
    removeCustomRobot(
      fallbackRobotId = defaultRobotIdForKind(useMotionStore().motionKind ?? 'humanoid'),
    ) {
      if (!this.customRobot) return false;
      const wasSelected = this.robotId === CUSTOM_ROBOT_ID;
      clearCustomRobotCache();
      this.customRobot = null;
      if (wasSelected) {
        this.robotId = fallbackRobotId;
        this.config = getDefaultConfig(fallbackRobotId);
      }
      this.status = 'idle';
      this.errorMessage = null;
      return wasSelected;
    },
    resetConfig() {
      if (this.robotId === CUSTOM_ROBOT_ID && this.customRobot) {
        // Re-load body list if robot already cached.
        this.ensureRobot().then((robot) => {
          this.config = initialCustomConfig(this.customRobot!, robot.bodyNames);
        });
        return;
      }
      this.config = getDefaultConfig(this.robotId);
    },
    importConfigJson(text: string) {
      this.config = validateConfig(JSON.parse(text));
    },
    exportConfigJson(): string {
      return JSON.stringify(toRaw(this.config), null, 4);
    },
    async ensureRobot(): Promise<RobotModel> {
      this.status = 'loading-robot';
      try {
        if (this.robotId === CUSTOM_ROBOT_ID) {
          if (!this.customRobot) throw new Error('No custom robot imported.');
          const robot = await loadCustomRobot(this.customRobot, (done, total) => {
            this.robotLoadProgress = { done, total };
          });
          return robot;
        }
        const robot = await loadRobot(this.robotId, (done, total) => {
          this.robotLoadProgress = { done, total };
        });
        return robot;
      } finally {
        if (this.status === 'loading-robot') this.status = 'idle';
      }
    },
    cancel() {
      this.abortController?.abort();
    },
    selectHistory(id: string) {
      if (this.resultHistory.some((e) => e.id === id)) this.activeHistoryId = id;
    },
    consumePendingAutoplay(entryId: string): boolean {
      if (this.pendingPreviewAutoplayId !== entryId) return false;
      this.pendingPreviewAutoplayId = null;
      return true;
    },
    async resolveRobotLabel(robotId?: string): Promise<string> {
      const id = robotId ?? this.robotId;
      if (id === CUSTOM_ROBOT_ID) {
        return this.customRobot?.label ?? CUSTOM_ROBOT_ID;
      }
      const manifest = await getRobotManifest().catch(() => []);
      const entry = manifest.find((m) => m.id === id);
      return entry?.xml ?? id;
    },
    async loadRobotForHistory(entry: RetargetHistoryEntry): Promise<RobotModel> {
      if (entry.robotId === CUSTOM_ROBOT_ID) {
        const bundle = entry.customRobot ?? this.customRobot;
        if (!bundle) throw new Error('Custom robot no longer available');
        return loadCustomRobot(bundle);
      }
      return loadRobot(entry.robotId);
    },
    async run() {
      const motion = useMotionStore();
      if (!motion.lafan) {
        this.errorMessage = 'no motion';
        this.status = 'error';
        return;
      }
      try {
        const robot = await this.ensureRobot();
        const config = structuredClone(toRaw(this.config)) as GmrIkConfig;

        // Validate required human bodies exist in the motion.
        const required = new Set<string>();
        for (const t of Object.values(config.ik_match_table1)) required.add(t[0]);
        for (const t of Object.values(config.ik_match_table2)) required.add(t[0]);
        required.add(config.human_root_name);
        const missing = findMissingBodies(motion.lafan.frames, [...required]);
        if (missing.length > 0) {
          throw new Error(`Missing joints in BVH: ${missing.join(', ')}`);
        }

        this.status = 'running';
        this.runProgress = { done: 0, total: motion.lafan.frames.length };
        this.abortController = new AbortController();

        const result = await runRetarget({
          robot,
          config,
          solver: { ...toRaw(this.solver) },
          frames: motion.lafan.frames,
          fps: motion.fps,
          engine: this.engine,
          signal: this.abortController.signal,
          onProgress: (done, total) => {
            this.runProgress = { done, total };
          },
        });
        const robotLabel = await this.resolveRobotLabel();
        const entry: RetargetHistoryEntry = {
          id: crypto.randomUUID(),
          bvhName: motion.fileName ?? 'motion.bvh',
          robotId: this.robotId,
          robotLabel,
          engine: this.engine,
          createdAt: Date.now(),
          result: markRaw(result),
          customRobot: this.robotId === CUSTOM_ROBOT_ID ? (this.customRobot ?? undefined) : undefined,
        };
        this.resultHistory.unshift(entry);
        this.activeHistoryId = entry.id;
        this.pendingPreviewAutoplayId = entry.id;
        this.status = 'done';
        this.errorMessage = null;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') {
          this.status = 'idle';
        } else {
          this.status = 'error';
          this.errorMessage = err instanceof Error ? err.message : String(err);
        }
      } finally {
        this.abortController = null;
      }
    },
  },
});

export { CUSTOM_ROBOT_ID };
export type { RetargetEngineId, RetargetHistoryEntry };
