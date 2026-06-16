/**
 * GMR ik_config JSON schema (kept byte-compatible with the GMR Python repo so
 * configs can be exchanged in both directions).
 */

import type { HumanFrame, HumanFrameBody } from '../bvh/lafan1';

/** Retargeting engines selectable behind the same UI / ik_config. */
export type RetargetEngineId = 'gmr' | 'omniretarget';

/** [human_body, pos_weight, rot_weight, pos_offset(3), rot_offset_wxyz(4)] */
export type IkMatchEntry = [string, number, number, number[], number[]];

export interface GmrIkConfig {
  robot_root_name: string;
  human_root_name: string;
  ground_height: number;
  human_height_assumption: number;
  use_ik_match_table1: boolean;
  use_ik_match_table2: boolean;
  human_scale_table: Record<string, number>;
  ik_match_table1: Record<string, IkMatchEntry>;
  ik_match_table2: Record<string, IkMatchEntry>;
}

export interface SolverOptions {
  /** Tikhonov damping on the step (GMR default 0.5). */
  damping: number;
  /** Levenberg-Marquardt scaling per task (mink FrameTask lm_damping=1). */
  lmDamping: number;
  /** Max extra iterations per stage per frame (GMR max_iter=10). */
  maxIter: number;
  /** Convergence: stop when error improvement < errTol (GMR 0.001). */
  errTol: number;
  /** Subject height in meters (GMR BVH pipeline uses 1.75). */
  actualHumanHeight: number;
  /** Optional joint velocity limit (rad/s), mink-style per-step clamp. */
  useVelocityLimit: boolean;
  velocityLimit: number;
  /** Shift human data so the lowest foot touches z≈0.1 (GMR offset_to_ground). */
  offsetToGround: boolean;
  /** Constant z offset subtracted from human data (GMR ground_offset). */
  groundOffset: number;

  // ---- OmniRetarget-only (ignored by the GMR engine) ----
  /**
   * Weight of the interaction-mesh (Laplacian) preservation term. The
   * OmniRetarget engine adds a soft objective that keeps the *relative* spatial
   * arrangement of the matched keypoints — robot vs. (scaled) human — close,
   * reducing self-penetration and limb-shape distortion. 0 ⇒ behaves like GMR.
   */
  meshWeight: number;
  /** Neighbors used to build the per-frame interaction mesh (k-nearest). */
  meshNeighbors: number;
}

export const DEFAULT_SOLVER_OPTIONS: SolverOptions = {
  damping: 0.5,
  lmDamping: 1.0,
  maxIter: 10,
  errTol: 0.001,
  actualHumanHeight: 1.75,
  useVelocityLimit: false,
  velocityLimit: 3 * Math.PI,
  offsetToGround: false,
  groundOffset: 0,
  meshWeight: 16,
  meshNeighbors: 4,
};

export interface RetargetResult {
  robotId: string;
  /** Engine that produced this result. */
  engine: RetargetEngineId;
  fps: number;
  frameCount: number;
  nq: number;
  /** All frames' qpos, layout [frame][nq]. qpos = [pos(3), quat wxyz(4), dofs]. */
  qpos: Float64Array;
  /** Joint names for qpos[7:] in order. */
  dofNames: string[];
  /** Stage-2 task names (robot bodies) for the error series. */
  taskNames: string[];
  /** Human source body for each task. */
  taskHumanBodies: string[];
  /** Per frame per task position error (m), layout [frame][task]. */
  posErrors: Float32Array;
  /** Scaled human keypoints per frame, layout [frame][K][3] (Z-up meters). */
  scaledHuman: Float32Array;
  /** Keypoint names for scaledHuman. */
  humanBodyNames: string[];
  /** Wall-clock processing time in ms. */
  elapsedMs: number;
}

/** One completed retarget run kept in the in-memory session history (lost on refresh). */
export interface RetargetHistoryEntry {
  id: string;
  /** Source BVH file name at run time. */
  bvhName: string;
  robotId: string;
  /** URDF / model file label shown in the history dropdown. */
  robotLabel: string;
  engine: RetargetEngineId;
  /** Wall-clock time when the retarget run finished (ms since epoch). */
  createdAt: number;
  result: RetargetResult;
}

/**
 * Common contract every retargeting engine implements so GMR and OmniRetarget
 * are interchangeable behind the runner / store / UI (the `RetargetEngine`
 * interface called for in ROADMAP.md). Both engines consume the same
 * `GmrIkConfig` + `SolverOptions` and emit per-frame robot `qpos`.
 */
export interface RetargetEngine {
  /** Stage-2 tasks (robot body ↔ human body), used for the error series. */
  readonly tasks2: ReadonlyArray<{ robotBody: string; humanBody: string }>;
  /** Human keypoints of the last processed frame (scaled + offset), for overlays. */
  lastScaledHuman: Map<string, HumanFrameBody>;
  /** Human bodies required by the active config. */
  requiredHumanBodies(): string[];
  /** Retarget a single frame; returns a copy of qpos. */
  retargetFrame(frame: HumanFrame): Float64Array;
  /** Final per-task position errors (m) against the last preprocessed frame. */
  taskPositionErrors(): Float32Array;
  /** Release native (WASM) allocations. */
  dispose(): void;
}
