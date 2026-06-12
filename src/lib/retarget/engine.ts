/**
 * GMR retargeting engine — TypeScript port of GMR's mink-based two-stage
 * differential IK (general_motion_retargeting/motion_retarget.py).
 *
 * Per frame:
 *  1. scale human keypoints about the root (per-body scale table)
 *  2. apply per-body local pos/rot offsets (from ik_match_table1, GMR semantics)
 *  3. two IK stages; each stage solves damped weighted Gauss-Newton steps with
 *     exact MuJoCo body Jacobians until the task error stops improving
 *     (improvement < errTol, at most 1+maxIter solves), with joint-range
 *     clamping after every step.
 */

import { quatConj, quatMul, quatRotate, quatToRotVec, type Quat, type Vec3 } from '../math3d';
import type { HumanFrame, HumanFrameBody } from '../bvh/lafan1';
import type { RobotModel } from '../mujoco/runtime';
import type { GmrIkConfig, SolverOptions } from './types';

interface IkTask {
  robotBody: string;
  bodyId: number;
  humanBody: string;
  posWeight: number;
  rotWeight: number;
}

interface BodyOffsets {
  pos: Vec3; // local-frame position offset (ground already subtracted)
  rot: Quat; // wxyz
}

const MJ_JNT_FREE = 0;
const MJ_JNT_HINGE = 3;
const MJ_JNT_SLIDE = 2;

export class GmrRetargetEngine {
  readonly robot: RobotModel;
  readonly config: GmrIkConfig;
  readonly opts: SolverOptions;

  readonly tasks1: IkTask[] = [];
  readonly tasks2: IkTask[] = [];
  /** effective per-body scale (config table × height ratio) */
  readonly scaleTable: Map<string, number> = new Map();
  /** offsets keyed by human body name (from table1, like GMR) */
  readonly offsets: Map<string, BodyOffsets> = new Map();

  private jacp: any;
  private jacr: any;
  private jacpView!: Float64Array;
  private jacrView!: Float64Array;
  private H: Float64Array;
  private g: Float64Array;
  private L: Float64Array;
  private dq: number[];
  private nv: number;

  /** human keypoints of the last processed frame (scaled + offset), for overlays */
  lastScaledHuman: Map<string, HumanFrameBody> = new Map();

  constructor(robot: RobotModel, config: GmrIkConfig, opts: SolverOptions) {
    this.robot = robot;
    this.config = config;
    this.opts = opts;
    this.nv = robot.nv;

    const ratio = opts.actualHumanHeight / config.human_height_assumption;
    for (const [k, v] of Object.entries(config.human_scale_table)) {
      this.scaleTable.set(k, v * ratio);
    }

    const ground: Vec3 = [0, 0, config.ground_height];
    const addTasks = (
      table: Record<string, [string, number, number, number[], number[]]>,
      out: IkTask[],
      recordOffsets: boolean,
    ) => {
      for (const [robotBody, entry] of Object.entries(table)) {
        const [humanBody, posWeight, rotWeight, posOffset, rotOffset] = entry;
        if (posWeight === 0 && rotWeight === 0) continue;
        const bodyId = robot.bodyIds.get(robotBody);
        if (bodyId === undefined) {
          throw new Error(`Robot body "${robotBody}" not found in model`);
        }
        out.push({ robotBody, bodyId, humanBody, posWeight, rotWeight });
        if (recordOffsets) {
          this.offsets.set(humanBody, {
            pos: [
              posOffset[0] - ground[0],
              posOffset[1] - ground[1],
              posOffset[2] - ground[2],
            ],
            rot: [rotOffset[0], rotOffset[1], rotOffset[2], rotOffset[3]] as Quat,
          });
        }
      }
    };
    // GMR applies the offsets of table1 to the human data used by BOTH stages.
    addTasks(config.ik_match_table1, this.tasks1, true);
    addTasks(config.ik_match_table2, this.tasks2, false);

    const mujoco = robot.mujoco;
    this.jacp = new mujoco.DoubleBuffer(3 * this.nv);
    this.jacr = new mujoco.DoubleBuffer(3 * this.nv);
    this.jacpView = this.jacp.GetView();
    this.jacrView = this.jacr.GetView();
    this.H = new Float64Array(this.nv * this.nv);
    this.g = new Float64Array(this.nv);
    this.L = new Float64Array(this.nv * this.nv);
    this.dq = new Array(this.nv).fill(0);

    this.reset();
  }

  dispose() {
    this.jacp?.delete?.();
    this.jacr?.delete?.();
  }

  /** Reset robot to the model's default pose. */
  reset() {
    const { model, data, mujoco } = this.robot;
    (data.qpos as Float64Array).set(model.qpos0 as Float64Array);
    mujoco.mj_kinematics(model, data);
    mujoco.mj_comPos(model, data);
  }

  /** Human bodies required by the active config. */
  requiredHumanBodies(): string[] {
    const set = new Set<string>();
    for (const t of this.tasks1) set.add(t.humanBody);
    for (const t of this.tasks2) set.add(t.humanBody);
    set.add(this.config.human_root_name);
    return [...set];
  }

  /**
   * Preprocess one human frame exactly like GMR.update_targets:
   * scale about root -> local offsets -> ground offset -> (optional) snap to ground.
   */
  preprocessHuman(frame: HumanFrame, offsetToGround = false): Map<string, HumanFrameBody> {
    const rootName = this.config.human_root_name;
    const root = frame.get(rootName);
    if (!root) throw new Error(`Human root "${rootName}" missing from motion frame`);

    const rootScale = this.scaleTable.get(rootName) ?? 1;
    const scaledRoot: Vec3 = [
      root.pos[0] * rootScale,
      root.pos[1] * rootScale,
      root.pos[2] * rootScale,
    ];

    // Scale in root-local frame (positions only); only bodies in the scale table survive.
    const out = new Map<string, HumanFrameBody>();
    out.set(rootName, { pos: scaledRoot, quat: root.quat });
    for (const [name, body] of frame) {
      if (name === rootName) continue;
      const s = this.scaleTable.get(name);
      if (s === undefined) continue;
      out.set(name, {
        pos: [
          (body.pos[0] - root.pos[0]) * s + scaledRoot[0],
          (body.pos[1] - root.pos[1]) * s + scaledRoot[1],
          (body.pos[2] - root.pos[2]) * s + scaledRoot[2],
        ],
        quat: body.quat,
      });
    }

    // Apply local-frame offsets (rotation first, then rotated position offset).
    for (const [name, body] of out) {
      const off = this.offsets.get(name);
      if (!off) continue;
      const q = quatMul(body.quat, off.rot);
      const dp = quatRotate(q, off.pos);
      out.set(name, {
        pos: [body.pos[0] + dp[0], body.pos[1] + dp[1], body.pos[2] + dp[2]],
        quat: q,
      });
    }

    // Constant ground offset.
    const g = this.opts.groundOffset;
    if (g !== 0) {
      for (const body of out.values()) body.pos[2] -= g;
    }

    // Optional: shift so the lowest "Foot" body sits at z = 0.1 (GMR behaviour).
    if (offsetToGround) {
      let lowest = Infinity;
      for (const [name, body] of out) {
        if (!/foot/i.test(name)) continue;
        if (body.pos[2] < lowest) lowest = body.pos[2];
      }
      if (Number.isFinite(lowest)) {
        const shift = -lowest + 0.1;
        for (const body of out.values()) body.pos[2] += shift;
      }
    }

    return out;
  }

  /** Retarget a single frame; returns a copy of qpos. */
  retargetFrame(frame: HumanFrame): Float64Array {
    const human = this.preprocessHuman(frame, this.opts.offsetToGround);
    this.lastScaledHuman = human;

    if (this.config.use_ik_match_table1) this.solveStage(this.tasks1, human);
    if (this.config.use_ik_match_table2) this.solveStage(this.tasks2, human);

    return new Float64Array(this.robot.data.qpos as Float64Array);
  }

  /** Final per-task position errors (m) against the last preprocessed frame. */
  taskPositionErrors(tasks: IkTask[] = this.tasks2): Float32Array {
    const { data } = this.robot;
    const xpos = data.xpos as Float64Array;
    const out = new Float32Array(tasks.length);
    tasks.forEach((task, i) => {
      const target = this.lastScaledHuman.get(task.humanBody);
      if (!target) return;
      const b = task.bodyId * 3;
      out[i] = Math.hypot(
        target.pos[0] - xpos[b],
        target.pos[1] - xpos[b + 1],
        target.pos[2] - xpos[b + 2],
      );
    });
    return out;
  }

  // ---------------- internal ----------------

  private updateKinematics() {
    const { mujoco, model, data } = this.robot;
    mujoco.mj_kinematics(model, data);
    mujoco.mj_comPos(model, data);
  }

  /** Unweighted stacked task error norm (mink convention for the stop test). */
  private errorNorm(tasks: IkTask[], human: Map<string, HumanFrameBody>): number {
    const { data } = this.robot;
    const xpos = data.xpos as Float64Array;
    const xquat = data.xquat as Float64Array;
    let sum = 0;
    for (const task of tasks) {
      const target = human.get(task.humanBody);
      if (!target) continue;
      const b3 = task.bodyId * 3;
      const b4 = task.bodyId * 4;
      const ep: Vec3 = [
        target.pos[0] - xpos[b3],
        target.pos[1] - xpos[b3 + 1],
        target.pos[2] - xpos[b3 + 2],
      ];
      const bodyQuat: Quat = [xquat[b4], xquat[b4 + 1], xquat[b4 + 2], xquat[b4 + 3]];
      const er = quatToRotVec(quatMul(target.quat, quatConj(bodyQuat)));
      sum += ep[0] * ep[0] + ep[1] * ep[1] + ep[2] * ep[2];
      sum += er[0] * er[0] + er[1] * er[1] + er[2] * er[2];
    }
    return Math.sqrt(sum);
  }

  private solveStage(tasks: IkTask[], human: Map<string, HumanFrameBody>) {
    if (tasks.length === 0) return;
    this.updateKinematics();
    let prevErr = this.errorNorm(tasks, human);
    this.stepOnce(tasks, human);
    this.updateKinematics();
    let nextErr = this.errorNorm(tasks, human);
    let iter = 0;
    while (prevErr - nextErr > this.opts.errTol && iter < this.opts.maxIter) {
      prevErr = nextErr;
      this.stepOnce(tasks, human);
      this.updateKinematics();
      nextErr = this.errorNorm(tasks, human);
      iter++;
    }
  }

  /**
   * One damped weighted Gauss-Newton step:
   * (Σ wᵀJᵀJw + (damping + Σ lm·‖We‖²)·I) Δq = Σ JᵀW²e, then integrate.
   * Kinematics must be up to date when called.
   */
  private stepOnce(tasks: IkTask[], human: Map<string, HumanFrameBody>) {
    const { mujoco, model, data } = this.robot;
    const nv = this.nv;
    const H = this.H;
    const g = this.g;
    H.fill(0);
    g.fill(0);

    const xpos = data.xpos as Float64Array;
    const xquat = data.xquat as Float64Array;

    let lmTerm = 0;

    for (const task of tasks) {
      const target = human.get(task.humanBody);
      if (!target) continue;
      const b3 = task.bodyId * 3;
      const b4 = task.bodyId * 4;

      const ep: Vec3 = [
        target.pos[0] - xpos[b3],
        target.pos[1] - xpos[b3 + 1],
        target.pos[2] - xpos[b3 + 2],
      ];
      const bodyQuat: Quat = [xquat[b4], xquat[b4 + 1], xquat[b4 + 2], xquat[b4 + 3]];
      const er = quatToRotVec(quatMul(target.quat, quatConj(bodyQuat)));

      mujoco.mj_jacBody(model, data, this.jacp, this.jacr, task.bodyId);
      const jp = this.jacpView;
      const jr = this.jacrView;

      const wp = task.posWeight * task.posWeight;
      const wr = task.rotWeight * task.rotWeight;

      // Accumulate H += w * Jᵀ J and g += w * Jᵀ e for both 3-row blocks.
      for (let row = 0; row < 3; row++) {
        if (wp > 0) {
          const jrow = row * nv;
          const e = ep[row];
          for (let i = 0; i < nv; i++) {
            const ji = jp[jrow + i] * wp;
            if (ji === 0) continue;
            g[i] += ji * e;
            const hi = i * nv;
            for (let k = i; k < nv; k++) H[hi + k] += ji * jp[jrow + k];
          }
        }
        if (wr > 0) {
          const jrow = row * nv;
          const e = er[row];
          for (let i = 0; i < nv; i++) {
            const ji = jr[jrow + i] * wr;
            if (ji === 0) continue;
            g[i] += ji * e;
            const hi = i * nv;
            for (let k = i; k < nv; k++) H[hi + k] += ji * jr[jrow + k];
          }
        }
      }

      const epSq = ep[0] * ep[0] + ep[1] * ep[1] + ep[2] * ep[2];
      const erSq = er[0] * er[0] + er[1] * er[1] + er[2] * er[2];
      lmTerm += this.opts.lmDamping * (wp * epSq + wr * erSq);
    }

    // Symmetrize lower triangle + regularize diagonal.
    const reg = this.opts.damping + lmTerm;
    for (let i = 0; i < nv; i++) {
      const hi = i * nv;
      for (let k = i + 1; k < nv; k++) H[k * nv + i] = H[hi + k];
      H[hi + i] += reg;
    }

    if (!this.choleskySolve(H, g, this.dq)) return;

    // Optional mink-style velocity limit: |v| <= vmax  =>  |Δq| <= vmax * dt.
    if (this.opts.useVelocityLimit) {
      const cap = this.opts.velocityLimit * (model.opt?.timestep ?? 0.002);
      for (let i = 0; i < nv; i++) {
        if (this.dq[i] > cap) this.dq[i] = cap;
        else if (this.dq[i] < -cap) this.dq[i] = -cap;
      }
    }

    // qpos <- integrate(qpos, Δq) with proper quaternion handling.
    mujoco.mj_integratePos(model, data.qpos, this.dq, 1.0);
    this.clampJointLimits();
  }

  /** Clamp limited slide/hinge joints to jnt_range (mink ConfigurationLimit analogue). */
  private clampJointLimits() {
    const { model, data } = this.robot;
    const qpos = data.qpos as Float64Array;
    const jntType = model.jnt_type as Int32Array;
    const jntLimited = model.jnt_limited as Uint8Array;
    const jntQposadr = model.jnt_qposadr as Int32Array;
    const jntRange = model.jnt_range as Float64Array;
    for (let j = 0; j < model.njnt; j++) {
      const type = jntType[j];
      if (type !== MJ_JNT_HINGE && type !== MJ_JNT_SLIDE) continue;
      if (!jntLimited[j]) continue;
      const adr = jntQposadr[j];
      const lo = jntRange[j * 2];
      const hi = jntRange[j * 2 + 1];
      if (qpos[adr] < lo) qpos[adr] = lo;
      else if (qpos[adr] > hi) qpos[adr] = hi;
    }
    void MJ_JNT_FREE;
  }

  /** Solve H x = b for SPD H via Cholesky; returns false if not positive definite. */
  private choleskySolve(H: Float64Array, b: Float64Array, x: number[]): boolean {
    const n = this.nv;
    const L = this.L;
    L.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = H[i * n + j];
        for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
        if (i === j) {
          if (sum <= 0) return false;
          L[i * n + j] = Math.sqrt(sum);
        } else {
          L[i * n + j] = sum / L[j * n + j];
        }
      }
    }
    // forward substitution L y = b
    const y = x; // reuse
    for (let i = 0; i < n; i++) {
      let sum = b[i];
      for (let k = 0; k < i; k++) sum -= L[i * n + k] * y[k];
      y[i] = sum / L[i * n + i];
    }
    // back substitution Lᵀ x = y
    for (let i = n - 1; i >= 0; i--) {
      let sum = y[i];
      for (let k = i + 1; k < n; k++) sum -= L[k * n + i] * x[k];
      x[i] = sum / L[i * n + i];
    }
    return true;
  }
}
