import { defineStore } from 'pinia';
import { markRaw, toRaw } from 'vue';
import { createBlankConfig, getDefaultConfig, validateConfig } from '@/lib/retarget/defaults';
import {
  DEFAULT_SOLVER_OPTIONS,
  type GmrIkConfig,
  type RetargetEngineId,
  type RetargetResult,
  type SolverOptions,
} from '@/lib/retarget/types';
import { loadRobot, type RobotModel } from '@/lib/mujoco/runtime';
import {
  CUSTOM_ROBOT_ID,
  clearCustomRobotCache,
  loadCustomRobot,
  parseCustomRobotImport,
  type CustomRobotBundle,
} from '@/lib/mujoco/customRobot';
import { runRetarget } from '@/lib/retarget/runner';
import { findMissingBodies } from '@/lib/bvh/lafan1';
import {
  defaultRobotIdForKind,
  motionMatchesRobot,
} from '@/lib/motionKind';
import type { RobotManifestEntry } from '@/lib/mujoco/runtime';
import { useMotionStore } from './motion';

export type RetargetStatus = 'idle' | 'loading-robot' | 'running' | 'done' | 'error';

interface RetargetState {
  robotId: string;
  customRobot: CustomRobotBundle | null;
  engine: RetargetEngineId;
  config: GmrIkConfig;
  solver: SolverOptions;
  status: RetargetStatus;
  robotLoadProgress: { done: number; total: number };
  runProgress: { done: number; total: number };
  result: RetargetResult | null;
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
    result: null,
    errorMessage: null,
    abortController: null,
  }),
  getters: {
    isBusy: (s) => s.status === 'loading-robot' || s.status === 'running',
    isCustomRobot: (s) => s.robotId === CUSTOM_ROBOT_ID,
    robotDisplayLabel: (s) =>
      s.robotId === CUSTOM_ROBOT_ID && s.customRobot
        ? `${s.customRobot.label} (custom)`
        : s.robotId,
  },
  actions: {
    setEngine(engine: RetargetEngineId) {
      if (engine === this.engine) return;
      this.engine = engine;
      // Results are engine-specific; clear so the user re-runs with the new one.
      this.result = null;
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
      this.result = null;
      this.status = 'idle';
      this.errorMessage = null;
    },
    /** Pick a built-in robot compatible with the loaded motion (humanoid vs quadruped). */
    syncRobotToMotion(manifest: RobotManifestEntry[]) {
      const motion = useMotionStore();
      const kind = motion.motionKind;
      if (!kind) return false;

      if (this.robotId === CUSTOM_ROBOT_ID) {
        if (kind === 'quadruped') {
          this.setRobot(defaultRobotIdForKind(kind));
          return true;
        }
        return false;
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
      const bundle = await parseCustomRobotImport(file);
      clearCustomRobotCache();
      this.customRobot = bundle;
      this.robotId = CUSTOM_ROBOT_ID;
      this.result = null;
      this.status = 'idle';
      this.errorMessage = null;

      const robot = await this.ensureRobot();
      this.config = createBlankConfig(bundle.baseBody, robot.bodyNames);
    },
    removeCustomRobot(fallbackRobotId = 'unitree_g1') {
      if (!this.customRobot) return false;
      const wasSelected = this.robotId === CUSTOM_ROBOT_ID;
      clearCustomRobotCache();
      this.customRobot = null;
      if (wasSelected) {
        this.robotId = fallbackRobotId;
        this.config = getDefaultConfig(fallbackRobotId);
      }
      this.result = null;
      this.status = 'idle';
      this.errorMessage = null;
      return wasSelected;
    },
    resetConfig() {
      if (this.robotId === CUSTOM_ROBOT_ID && this.customRobot) {
        // Re-load body list if robot already cached.
        this.ensureRobot().then((robot) => {
          this.config = createBlankConfig(this.customRobot!.baseBody, robot.bodyNames);
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
        this.result = markRaw(result);
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
export type { RetargetEngineId };
