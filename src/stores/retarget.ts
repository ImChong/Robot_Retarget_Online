import { defineStore } from 'pinia';
import { markRaw, toRaw } from 'vue';
import { getDefaultConfig, validateConfig } from '@/lib/retarget/defaults';
import { DEFAULT_SOLVER_OPTIONS, type GmrIkConfig, type RetargetResult, type SolverOptions } from '@/lib/retarget/types';
import { loadRobot, type RobotModel } from '@/lib/mujoco/runtime';
import { runRetarget } from '@/lib/retarget/runner';
import { findMissingBodies } from '@/lib/bvh/lafan1';
import { useMotionStore } from './motion';

export type RetargetStatus = 'idle' | 'loading-robot' | 'running' | 'done' | 'error';

interface RetargetState {
  robotId: string;
  config: GmrIkConfig;
  solver: SolverOptions;
  /** Per-robot saved IK config so switching robots does not discard user edits. */
  configByRobot: Record<string, GmrIkConfig>;
  /** Per-robot saved solver options. */
  solverByRobot: Record<string, SolverOptions>;
  status: RetargetStatus;
  robotLoadProgress: { done: number; total: number };
  runProgress: { done: number; total: number };
  result: RetargetResult | null;
  errorMessage: string | null;
  abortController: AbortController | null;
}

/** Keep user-tuned global fields; load robot-specific IK tables from defaults. */
export function mergeConfigForRobot(current: GmrIkConfig, robotId: string): GmrIkConfig {
  const defaults = getDefaultConfig(robotId);
  return {
    ...defaults,
    human_root_name: current.human_root_name,
    human_height_assumption: current.human_height_assumption,
    ground_height: current.ground_height,
    human_scale_table: { ...current.human_scale_table },
    use_ik_match_table1: current.use_ik_match_table1,
    use_ik_match_table2: current.use_ik_match_table2,
  };
}

export const useRetargetStore = defineStore('retarget', {
  state: (): RetargetState => ({
    robotId: 'unitree_g1',
    config: getDefaultConfig('unitree_g1'),
    solver: { ...DEFAULT_SOLVER_OPTIONS },
    configByRobot: {},
    solverByRobot: {},
    status: 'idle',
    robotLoadProgress: { done: 0, total: 1 },
    runProgress: { done: 0, total: 1 },
    result: null,
    errorMessage: null,
    abortController: null,
  }),
  getters: {
    isBusy: (s) => s.status === 'loading-robot' || s.status === 'running',
  },
  actions: {
    persistCurrentRobotSettings() {
      const id = this.robotId;
      this.configByRobot[id] = structuredClone(toRaw(this.config)) as GmrIkConfig;
      this.solverByRobot[id] = { ...toRaw(this.solver) };
    },
    setRobot(robotId: string) {
      if (robotId === this.robotId) return;
      const previousConfig = structuredClone(toRaw(this.config)) as GmrIkConfig;
      const previousSolver = { ...toRaw(this.solver) };
      this.persistCurrentRobotSettings();

      this.robotId = robotId;
      const cachedConfig = this.configByRobot[robotId];
      const cachedSolver = this.solverByRobot[robotId];
      this.config = cachedConfig
        ? structuredClone(toRaw(cachedConfig))
        : mergeConfigForRobot(previousConfig, robotId);
      this.solver = cachedSolver ? { ...toRaw(cachedSolver) } : previousSolver;
      this.result = null;
      this.status = 'idle';
      this.errorMessage = null;
    },
    resetConfig() {
      this.config = getDefaultConfig(this.robotId);
      this.persistCurrentRobotSettings();
    },
    importConfigJson(text: string) {
      this.config = validateConfig(JSON.parse(text));
      this.persistCurrentRobotSettings();
    },
    exportConfigJson(): string {
      return JSON.stringify(toRaw(this.config), null, 4);
    },
    async ensureRobot(): Promise<RobotModel> {
      this.status = 'loading-robot';
      try {
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
