/**
 * OmniRetarget engine — an in-browser, per-frame adaptation of OmniRetarget's
 * interaction-mesh idea layered on top of GMR's two-stage differential IK.
 *
 * Where GMR matches every robot body to its human keypoint independently,
 * OmniRetarget additionally preserves the *interaction mesh*: the relative
 * spatial arrangement of the matched keypoints. Each frame we build a small
 * k-nearest-neighbour graph over the (scaled) human keypoints, take each node's
 * Laplacian coordinate
 *
 *     δ_i = p_i − Σ_j w_ij · p_j        (Σ_j w_ij = 1)
 *
 * which is translation-invariant — it encodes local *shape*, not absolute
 * placement — and add a soft Gauss-Newton objective driving the robot's
 * Laplacian coordinates onto the human's. This curbs self-penetration and
 * limb-shape distortion while leaving GMR's absolute position/orientation
 * tracking intact. With `meshWeight = 0` it reduces exactly to GMR.
 *
 * References:
 *  - OmniRetarget — interaction-preserving motion retargeting.
 *  - Ho, Komura & Tai, "Spatial Relationship Preserving Character Motion
 *    Adaptation" (SIGGRAPH 2010) — the interaction mesh / Laplacian formulation.
 */

import type { HumanFrameBody } from '../bvh/lafan1';
import type { Vec3 } from '../math3d';
import { GmrRetargetEngine, type IkTask } from './engine';

interface MeshNode {
  bodyId: number;
  human: Vec3;
}

export class OmniRetargetEngine extends GmrRetargetEngine {
  /** per-node translational Jacobians, row-major [node][3×nv]. */
  private jb = new Float64Array(0);
  /** scratch for one combined Jacobian row A_i (length nv). */
  private arow = new Float64Array(0);

  /**
   * Interaction-mesh Gauss-Newton term. Adds `w²·A_iᵀA_i` into the upper
   * triangle of `H` and `w²·A_iᵀe_i` into `g`, where `A_i = Jp_i − Σ_j w_ij Jp_j`
   * is the Laplacian-coordinate Jacobian and `e_i = δ^human_i − δ^robot_i`.
   */
  protected accumulateExtraTerms(
    tasks: IkTask[],
    human: Map<string, HumanFrameBody>,
    H: Float64Array,
    g: Float64Array,
  ): number {
    const meshWeight = this.opts.meshWeight ?? 0;
    if (meshWeight <= 0) return 0;

    // Mesh nodes = the stage's tasks whose human keypoint is present.
    const nodes: MeshNode[] = [];
    for (const task of tasks) {
      const target = human.get(task.humanBody);
      if (!target) continue;
      nodes.push({ bodyId: task.bodyId, human: target.pos });
    }
    const N = nodes.length;
    if (N < 3) return 0; // a mesh needs at least a small neighbourhood

    const nv = this.nv;
    const { mujoco, model, data } = this.robot;
    const xpos = data.xpos as Float64Array;

    // Neighbour weights from the human keypoints (constant within a frame).
    const k = Math.max(1, Math.min(this.opts.meshNeighbors ?? 4, N - 1));
    const W = knnLaplacianWeights(
      nodes.map((n) => n.human),
      k,
    );

    // Per-node translational Jacobians (row-major 3×nv).
    if (this.jb.length < N * 3 * nv) this.jb = new Float64Array(N * 3 * nv);
    const jb = this.jb;
    for (let a = 0; a < N; a++) {
      mujoco.mj_jacBody(model, data, this.jacp, this.jacr, nodes[a].bodyId);
      jb.set(this.jacpView.subarray(0, 3 * nv), a * 3 * nv);
    }

    if (this.arow.length < nv) this.arow = new Float64Array(nv);
    const arow = this.arow;
    const w2 = meshWeight * meshWeight;
    const lm = this.opts.lmDamping;
    let lmTerm = 0;

    for (let i = 0; i < N; i++) {
      const ri = nodes[i].bodyId * 3;
      // Laplacian coordinates δ_i = p_i − Σ_j w_ij p_j (robot vs. human).
      let dRx = xpos[ri];
      let dRy = xpos[ri + 1];
      let dRz = xpos[ri + 2];
      let dHx = nodes[i].human[0];
      let dHy = nodes[i].human[1];
      let dHz = nodes[i].human[2];
      for (let j = 0; j < N; j++) {
        const wij = W[i * N + j];
        if (wij === 0) continue;
        const rj = nodes[j].bodyId * 3;
        dRx -= wij * xpos[rj];
        dRy -= wij * xpos[rj + 1];
        dRz -= wij * xpos[rj + 2];
        dHx -= wij * nodes[j].human[0];
        dHy -= wij * nodes[j].human[1];
        dHz -= wij * nodes[j].human[2];
      }
      // Error = target (human) − current (robot), mirroring the task sign.
      const ex = dHx - dRx;
      const ey = dHy - dRy;
      const ez = dHz - dRz;
      lmTerm += lm * w2 * (ex * ex + ey * ey + ez * ez);

      const ibase = i * 3 * nv;
      for (let row = 0; row < 3; row++) {
        const e = row === 0 ? ex : row === 1 ? ey : ez;
        // Combined Jacobian row A_i = Jp_i − Σ_j w_ij Jp_j.
        const jiBase = ibase + row * nv;
        for (let c = 0; c < nv; c++) arow[c] = jb[jiBase + c];
        for (let j = 0; j < N; j++) {
          const wij = W[i * N + j];
          if (wij === 0) continue;
          const jjBase = j * 3 * nv + row * nv;
          for (let c = 0; c < nv; c++) arow[c] -= wij * jb[jjBase + c];
        }
        // Accumulate H (upper triangle) and g with weight w².
        for (let c = 0; c < nv; c++) {
          const ac = arow[c] * w2;
          if (ac === 0) continue;
          g[c] += ac * e;
          const hc = c * nv;
          for (let kk = c; kk < nv; kk++) H[hc + kk] += ac * arow[kk];
        }
      }
    }
    return lmTerm;
  }
}

/**
 * k-nearest-neighbour, inverse-distance, row-normalised interaction-mesh
 * weights. `W[i*N + j]` is node i's weight on neighbour j; each row sums to 1
 * and the diagonal is 0. Pure (no engine state) so tests can reproduce the
 * exact graph the engine uses.
 */
export function knnLaplacianWeights(points: Vec3[], k: number): Float64Array {
  const N = points.length;
  const W = new Float64Array(N * N);
  if (N < 2) return W;
  const kk = Math.max(1, Math.min(k, N - 1));
  const dist = new Float64Array(N);
  const idx = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const pi = points[i];
    let m = 0;
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const pj = points[j];
      dist[m] = Math.hypot(pi[0] - pj[0], pi[1] - pj[1], pi[2] - pj[2]);
      idx[m] = j;
      m++;
    }
    // Partial selection sort for the k smallest distances.
    const sel = Math.min(kk, m);
    for (let a = 0; a < sel; a++) {
      let best = a;
      for (let b = a + 1; b < m; b++) if (dist[b] < dist[best]) best = b;
      if (best !== a) {
        const td = dist[a];
        dist[a] = dist[best];
        dist[best] = td;
        const ti = idx[a];
        idx[a] = idx[best];
        idx[best] = ti;
      }
    }
    let sum = 0;
    for (let a = 0; a < sel; a++) {
      const w = 1 / (dist[a] + 1e-6);
      W[i * N + idx[a]] = w;
      sum += w;
    }
    if (sum > 0) for (let a = 0; a < sel; a++) W[i * N + idx[a]] /= sum;
  }
  return W;
}

/** Laplacian coordinates δ_i = p_i − Σ_j W[i,j] p_j for every node. */
export function laplacianCoords(points: Vec3[], W: Float64Array): Vec3[] {
  const N = points.length;
  const out: Vec3[] = [];
  for (let i = 0; i < N; i++) {
    let dx = points[i][0];
    let dy = points[i][1];
    let dz = points[i][2];
    for (let j = 0; j < N; j++) {
      const wij = W[i * N + j];
      if (wij === 0) continue;
      dx -= wij * points[j][0];
      dy -= wij * points[j][1];
      dz -= wij * points[j][2];
    }
    out.push([dx, dy, dz]);
  }
  return out;
}

/**
 * Mean L2 interaction-mesh distortion between a robot pose and the human target
 * under a shared neighbour graph `W`: mean over nodes of ‖δ^robot_i − δ^human_i‖.
 */
export function meanLaplacianResidual(
  robotPts: Vec3[],
  humanPts: Vec3[],
  W: Float64Array,
): number {
  const dR = laplacianCoords(robotPts, W);
  const dH = laplacianCoords(humanPts, W);
  let sum = 0;
  for (let i = 0; i < dR.length; i++) {
    sum += Math.hypot(dR[i][0] - dH[i][0], dR[i][1] - dH[i][1], dR[i][2] - dH[i][2]);
  }
  return dR.length ? sum / dR.length : 0;
}
