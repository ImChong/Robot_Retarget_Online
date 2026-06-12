/**
 * GMR ik_config JSON schema (kept byte-compatible with the GMR Python repo so
 * configs can be exchanged in both directions).
 */

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
};

export interface RetargetResult {
  robotId: string;
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
