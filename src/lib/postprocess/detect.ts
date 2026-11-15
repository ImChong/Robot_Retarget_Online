import type { Quat } from '../math3d';
import type { RetargetResult } from '../retarget/types';
import { isQuatFinite, quatDot, quatGeodesicAngle, quatNorm, quatSlerp } from './quaternion';
import {
  DEFAULT_DETECTION_THRESHOLDS,
  type AnomalySeverity,
  type DetectionReport,
  type DetectionThresholds,
  type JointLimitInfo,
  type MotionAnomaly,
  type QualityMetrics,
} from './types';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

function mad(values: number[], med: number): number {
  if (values.length === 0) return 0;
  const dev = values.map((v) => Math.abs(v - med));
  return median(dev);
}

/**
 * Identify outlier frames in a 1D series using a Hampel (local median + MAD) filter
 * guarded by a local-linearity check so smooth fast motions are not flagged.
 */
export function detectOutlierFrames1D(
  values: ArrayLike<number>,
  halfWin: number,
  nSigma: number,
  minSpike: number,
): boolean[] {
  const T = values.length;
  const bad = new Array<boolean>(T).fill(false);
  if (T < 3) return bad;

  for (let t = 0; t < T; t++) {
    const v = values[t];
    if (!Number.isFinite(v)) continue;

    const indices: number[] = [];
    const lo = Math.max(0, t - halfWin);
    const hi = Math.min(T - 1, t + halfWin);
    for (let i = lo; i <= hi; i++) {
      if (Number.isFinite(values[i])) indices.push(i);
    }
    if (indices.length < 3) continue;

    // Estimate robust local linear slope via median of finite first-differences
    // in the window so fast smooth motions do not inflate MAD and mask spikes.
    const diffs: number[] = [];
    for (let i = lo + 1; i <= hi; i++) {
      if (Number.isFinite(values[i - 1]) && Number.isFinite(values[i])) {
        diffs.push(values[i] - values[i - 1]);
      }
    }
    const slope = diffs.length > 0 ? median(diffs) : 0;
    const detrended = indices.map((i) => values[i] - slope * (i - t));

    const med = median(detrended);
    // Estimate local roughness scale via median |2nd difference| over a wider window
    // so curvature or 2-frame bursts don't mask real spikes while continuous chatter is tolerated.
    const rLo = Math.max(1, t - halfWin * 2);
    const rHi = Math.min(T - 2, t + halfWin * 2);
    const absSecondDiffs: number[] = [];
    for (let i = rLo; i <= rHi; i++) {
      if (Number.isFinite(values[i - 1]) && Number.isFinite(values[i]) && Number.isFinite(values[i + 1])) {
        absSecondDiffs.push(Math.abs(values[i] - 0.5 * (values[i - 1] + values[i + 1])));
      }
    }
    const sigma = absSecondDiffs.length > 0
      ? 1.4826 * median(absSecondDiffs)
      : 1.4826 * mad(detrended, med);
    const thresh = Math.max(minSpike, nSigma * sigma);
    const res = Math.abs(v - med);
    if (res <= thresh) continue;

    // Guard against flagging smooth fast motion (monotonic ramps and curved extrema).
    if (
      t >= 2 &&
      t <= T - 3 &&
      Number.isFinite(values[t - 2]) &&
      Number.isFinite(values[t - 1]) &&
      Number.isFinite(values[t + 1]) &&
      Number.isFinite(values[t + 2])
    ) {
      const cubicPred = (4 * (values[t - 1] + values[t + 1]) - (values[t - 2] + values[t + 2])) / 6;
      if (Math.abs(v - cubicPred) < 0.3 * minSpike) continue;
    } else if (t > 0 && t < T - 1 && Number.isFinite(values[t - 1]) && Number.isFinite(values[t + 1])) {
      const linearErr = Math.abs(v - 0.5 * (values[t - 1] + values[t + 1]));
      if (linearErr < 0.6 * minSpike) continue;
    } else if (t === 0 && T >= 3 && Number.isFinite(values[1]) && Number.isFinite(values[2])) {
      const extrap = 2 * values[1] - values[2];
      if (Math.abs(v - extrap) < minSpike) continue;
    } else if (t === T - 1 && T >= 3 && Number.isFinite(values[T - 2]) && Number.isFinite(values[T - 3])) {
      const extrap = 2 * values[T - 2] - values[T - 3];
      if (Math.abs(v - extrap) < minSpike) continue;
    }

    bad[t] = true;
  }
  return bad;
}

/** Group contiguous true flags into `[start, end]` intervals. */
export function groupTrueSpans(flags: readonly boolean[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let t = 0;
  while (t < flags.length) {
    if (!flags[t]) {
      t++;
      continue;
    }
    let e = t;
    while (e + 1 < flags.length && flags[e + 1]) e++;
    spans.push([t, e]);
    t = e + 1;
  }
  return spans;
}

const SEVERITY_RANK: Record<AnomalySeverity, number> = {
  info: 1,
  warning: 2,
  error: 3,
};

export function detectMotionAnomalies(
  result: RetargetResult,
  jointLimits: readonly JointLimitInfo[] = [],
  thresholdOverrides?: Partial<DetectionThresholds>,
): DetectionReport {
  const th: DetectionThresholds = { ...DEFAULT_DETECTION_THRESHOLDS, ...thresholdOverrides };
  const anomalies: MotionAnomaly[] = [];
  let seqId = 1;
  const nextId = () => `anom_${seqId++}`;

  const { frameCount: T, nq, qpos, dofNames } = result;
  const validFps = Number.isFinite(result.fps) && result.fps > 0;
  const fps = validFps ? result.fps : 30;
  const dt = 1 / fps;
  const nDof = Math.max(0, nq - 7);
  const frameSeverity: Array<AnomalySeverity | null> = new Array(Math.max(0, T)).fill(null);

  const markSeverity = (start: number, end: number, sev: AnomalySeverity) => {
    for (let f = Math.max(0, start); f <= Math.min(T - 1, end); f++) {
      const cur = frameSeverity[f];
      if (!cur || SEVERITY_RANK[sev] > SEVERITY_RANK[cur]) {
        frameSeverity[f] = sev;
      }
    }
  };

  if (!validFps || T <= 0 || nq < 7 || qpos.length < T * nq) {
    anomalies.push({
      id: nextId(),
      type: 'invalid_sequence',
      severity: 'error',
      repairability: 'unrepairable',
      frameStart: 0,
      frameEnd: Math.max(0, T - 1),
      frame: 0,
      target: 'sequence',
      dofIndex: null,
      value: T,
      threshold: 1,
      unit: 'frames',
      detail: !validFps
        ? `Invalid fps (${result.fps})`
        : `Malformed trajectory buffer (frames=${T}, nq=${nq}, len=${qpos.length})`,
    });
    return {
      anomalies,
      frameSeverity,
      metrics: emptyMetrics(T, fps, anomalies),
    };
  }

  // Track frame validity & non-finite counts
  const frameHasNan = new Array<boolean>(T).fill(false);

  // 1. Root position checks (NaN/Inf + spikes + speed)
  const rootPosBad = new Array<boolean>(T).fill(false);
  const rootNan = new Array<boolean>(T).fill(false);
  const px = new Float64Array(T);
  const py = new Float64Array(T);
  const pz = new Float64Array(T);
  for (let f = 0; f < T; f++) {
    const b = f * nq;
    px[f] = qpos[b];
    py[f] = qpos[b + 1];
    pz[f] = qpos[b + 2];
    if (!Number.isFinite(px[f]) || !Number.isFinite(py[f]) || !Number.isFinite(pz[f])) {
      rootNan[f] = true;
      frameHasNan[f] = true;
    }
  }
  for (const [s, e] of groupTrueSpans(rootNan)) {
    const span = e - s + 1;
    const hasNeighbor = (s > 0 && !rootNan[s - 1]) || (e + 1 < T && !rootNan[e + 1]);
    const rep = span <= th.maxRepairSpan && hasNeighbor ? 'auto' : 'unrepairable';
    anomalies.push({
      id: nextId(),
      type: 'nan_inf',
      severity: 'error',
      repairability: rep,
      frameStart: s,
      frameEnd: e,
      frame: s,
      target: 'root_pos',
      dofIndex: null,
      value: span,
      threshold: th.maxRepairSpan,
      unit: 'frames',
      detail: `Non-finite root position (${span} frame${span > 1 ? 's' : ''})`,
    });
    markSeverity(s, e, 'error');
  }

  const outX = detectOutlierFrames1D(px, th.hampelWindowHalf, th.hampelSigma, th.rootPosSpikeM);
  const outY = detectOutlierFrames1D(py, th.hampelWindowHalf, th.hampelSigma, th.rootPosSpikeM);
  const outZ = detectOutlierFrames1D(pz, th.hampelWindowHalf, th.hampelSigma, th.rootPosSpikeM);
  for (let f = 0; f < T; f++) rootPosBad[f] = outX[f] || outY[f] || outZ[f];

  for (const [s, e] of groupTrueSpans(rootPosBad)) {
    const span = e - s + 1;
    let maxDev = 0;
    for (let f = s; f <= e; f++) {
      const refF = s > 0 ? s - 1 : Math.min(T - 1, e + 1);
      if (!rootNan[f] && !rootNan[refF]) {
        const d = Math.hypot(px[f] - px[refF], py[f] - py[refF], pz[f] - pz[refF]);
        if (d > maxDev) maxDev = d;
      }
    }
    const isLong = span > th.maxRepairSpan;
    anomalies.push({
      id: nextId(),
      type: isLong ? 'discontinuity' : 'root_pos_spike',
      severity: isLong ? 'error' : 'warning',
      repairability: isLong ? 'unrepairable' : 'auto',
      frameStart: s,
      frameEnd: e,
      frame: s,
      target: 'root_pos',
      dofIndex: null,
      value: maxDev,
      threshold: th.rootPosSpikeM,
      unit: 'm',
      detail: `Root position ${isLong ? 'discontinuity' : 'spike'} Δ=${maxDev.toFixed(3)} m`,
    });
    markSeverity(s, e, isLong ? 'error' : 'warning');
  }

  let peakRootSpeedMS = 0;
  for (let f = 1; f < T; f++) {
    if (rootNan[f] || rootNan[f - 1]) continue;
    const speed = Math.hypot(px[f] - px[f - 1], py[f] - py[f - 1], pz[f] - pz[f - 1]) / dt;
    if (speed > peakRootSpeedMS) peakRootSpeedMS = speed;
    if (speed > th.maxRootSpeedMS && !rootPosBad[f] && !rootPosBad[f - 1]) {
      anomalies.push({
        id: nextId(),
        type: 'discontinuity',
        severity: 'warning',
        repairability: 'confirm',
        frameStart: f - 1,
        frameEnd: f,
        frame: f,
        target: 'root_pos',
        dofIndex: null,
        value: speed,
        threshold: th.maxRootSpeedMS,
        unit: 'm/s',
        detail: `Root translation speed ${speed.toFixed(2)} m/s exceeds ${th.maxRootSpeedMS} m/s`,
      });
      markSeverity(f, f, 'warning');
    }
  }

  // 2. Root quaternion checks (NaN/Inf, norm drift, sign flip, geodesic spikes & angular vel)
  const quats: Quat[] = new Array(T);
  const quatNan = new Array<boolean>(T).fill(false);
  const quatNormBad = new Array<boolean>(T).fill(false);
  const quatFlip = new Array<boolean>(T).fill(false);
  const quatSpike = new Array<boolean>(T).fill(false);

  let prevGoodQuat: Quat | null = null;
  for (let f = 0; f < T; f++) {
    const b = f * nq;
    const q: Quat = [qpos[b + 3], qpos[b + 4], qpos[b + 5], qpos[b + 6]];
    quats[f] = q;
    if (!isQuatFinite(q)) {
      quatNan[f] = true;
      frameHasNan[f] = true;
      continue;
    }
    const n = quatNorm(q);
    if (n < 1e-8) {
      quatNan[f] = true;
      frameHasNan[f] = true;
      continue;
    }
    if (Math.abs(n - 1) > th.quatNormTol) {
      quatNormBad[f] = true;
    }
    if (prevGoodQuat && quatDot(prevGoodQuat, q) < 0) {
      quatFlip[f] = true;
    }
    prevGoodQuat = q;
  }

  for (const [s, e] of groupTrueSpans(quatNan)) {
    const span = e - s + 1;
    const hasNeighbor = (s > 0 && !quatNan[s - 1]) || (e + 1 < T && !quatNan[e + 1]);
    anomalies.push({
      id: nextId(),
      type: 'nan_inf',
      severity: 'error',
      repairability: span <= th.maxRepairSpan && hasNeighbor ? 'auto' : 'unrepairable',
      frameStart: s,
      frameEnd: e,
      frame: s,
      target: 'root_rot',
      dofIndex: null,
      value: span,
      threshold: th.maxRepairSpan,
      unit: 'frames',
      detail: `Invalid / non-finite root quaternion (${span} frame${span > 1 ? 's' : ''})`,
    });
    markSeverity(s, e, 'error');
  }

  for (const [s, e] of groupTrueSpans(quatNormBad)) {
    let worstErr = 0;
    for (let f = s; f <= e; f++) {
      const err = Math.abs(quatNorm(quats[f]) - 1);
      if (err > worstErr) worstErr = err;
    }
    anomalies.push({
      id: nextId(),
      type: 'quat_norm',
      severity: 'warning',
      repairability: 'auto',
      frameStart: s,
      frameEnd: e,
      frame: s,
      target: 'root_rot',
      dofIndex: null,
      value: worstErr,
      threshold: th.quatNormTol,
      unit: '',
      detail: `Quaternion norm drift |‖q‖-1|=${worstErr.toFixed(4)}`,
    });
    markSeverity(s, e, 'warning');
  }

  for (const [s, e] of groupTrueSpans(quatFlip)) {
    anomalies.push({
      id: nextId(),
      type: 'quat_sign_flip',
      severity: 'info',
      repairability: 'auto',
      frameStart: s,
      frameEnd: e,
      frame: s,
      target: 'root_rot',
      dofIndex: null,
      value: e - s + 1,
      threshold: 0,
      unit: 'frames',
      detail: `Quaternion antipodal sign flip (q ↔ -q) at frame ${s}${e > s ? `–${e}` : ''}`,
    });
    markSeverity(s, e, 'info');
  }

  let peakRootAngVelRadS = 0;
  for (let f = 1; f < T - 1; f++) {
    if (quatNan[f] || quatNan[f - 1] || quatNan[f + 1]) continue;
    const mid = quatSlerp(quats[f - 1], quats[f + 1], 0.5);
    const geoErr = quatGeodesicAngle(quats[f], mid);
    const neighborSpan = quatGeodesicAngle(quats[f - 1], quats[f + 1]);
    if (geoErr > th.rootRotSpikeRad && geoErr > neighborSpan * 0.75) {
      quatSpike[f] = true;
    }
  }
  for (const [s, e] of groupTrueSpans(quatSpike)) {
    const span = e - s + 1;
    let maxErr = 0;
    for (let f = s; f <= e; f++) {
      if (f > 0 && f < T - 1 && !quatNan[f - 1] && !quatNan[f + 1]) {
        const mid = quatSlerp(quats[f - 1], quats[f + 1], 0.5);
        maxErr = Math.max(maxErr, quatGeodesicAngle(quats[f], mid));
      }
    }
    const isLong = span > th.maxRepairSpan;
    anomalies.push({
      id: nextId(),
      type: isLong ? 'discontinuity' : 'root_rot_spike',
      severity: isLong ? 'error' : 'warning',
      repairability: isLong ? 'unrepairable' : 'auto',
      frameStart: s,
      frameEnd: e,
      frame: s,
      target: 'root_rot',
      dofIndex: null,
      value: maxErr,
      threshold: th.rootRotSpikeRad,
      unit: 'rad',
      detail: `Root orientation spike ${((maxErr * 180) / Math.PI).toFixed(1)}°`,
    });
    markSeverity(s, e, isLong ? 'error' : 'warning');
  }

  for (let f = 1; f < T; f++) {
    if (quatNan[f] || quatNan[f - 1]) continue;
    const w = quatGeodesicAngle(quats[f - 1], quats[f]) / dt;
    if (w > peakRootAngVelRadS) peakRootAngVelRadS = w;
    if (w > th.maxRootAngVelRadS && !quatSpike[f] && !quatSpike[f - 1]) {
      anomalies.push({
        id: nextId(),
        type: 'excessive_velocity',
        severity: 'warning',
        repairability: 'confirm',
        frameStart: f - 1,
        frameEnd: f,
        frame: f,
        target: 'root_rot',
        dofIndex: null,
        value: w,
        threshold: th.maxRootAngVelRadS,
        unit: 'rad/s',
        detail: `Root angular velocity ${w.toFixed(1)} rad/s exceeds ${th.maxRootAngVelRadS} rad/s`,
      });
      markSeverity(f, f, 'warning');
    }
  }

  // 3. Per-DoF checks + kinematics metrics (velocity, acceleration, jerk)
  const limitByDof = new Map<number, JointLimitInfo>();
  for (const lim of jointLimits) limitByDof.set(lim.dofIndex, lim);

  let vSumSq = 0;
  let vCount = 0;
  let aSumSq = 0;
  let aCount = 0;
  let jSumSq = 0;
  let jCount = 0;
  let peakJointVelRadS = 0;
  let peakJointAccRadS2 = 0;

  const col = new Float64Array(T);

  for (let d = 0; d < nDof; d++) {
    const name = dofNames[d] ?? `dof_${d}`;
    const dofNan = new Array<boolean>(T).fill(false);
    for (let f = 0; f < T; f++) {
      const val = qpos[f * nq + 7 + d];
      col[f] = val;
      if (!Number.isFinite(val)) {
        dofNan[f] = true;
        frameHasNan[f] = true;
      }
    }

    // 3a. NaN / Inf spans
    for (const [s, e] of groupTrueSpans(dofNan)) {
      const span = e - s + 1;
      const hasNeighbor = (s > 0 && !dofNan[s - 1]) || (e + 1 < T && !dofNan[e + 1]);
      const rep = span <= th.maxRepairSpan && hasNeighbor ? 'auto' : 'unrepairable';
      anomalies.push({
        id: nextId(),
        type: 'nan_inf',
        severity: 'error',
        repairability: rep,
        frameStart: s,
        frameEnd: e,
        frame: s,
        target: name,
        dofIndex: d,
        value: span,
        threshold: th.maxRepairSpan,
        unit: 'frames',
        detail: `${name}: non-finite values (${span} frame${span > 1 ? 's' : ''})`,
      });
      markSeverity(s, e, 'error');
    }

    // 3b. Joint limits
    const lim = limitByDof.get(d);
    if (lim?.limited) {
      const overFlags = new Array<boolean>(T).fill(false);
      for (let f = 0; f < T; f++) {
        if (!Number.isFinite(col[f])) continue;
        if (col[f] < lim.min - 1e-4 || col[f] > lim.max + 1e-4) {
          overFlags[f] = true;
        }
      }
      for (const [s, e] of groupTrueSpans(overFlags)) {
        let maxOver = 0;
        let worstFrame = s;
        for (let f = s; f <= e; f++) {
          const over = Math.max(lim.min - col[f], col[f] - lim.max, 0);
          if (over > maxOver) {
            maxOver = over;
            worstFrame = f;
          }
        }
        const sev: AnomalySeverity = maxOver > th.softLimitMarginRad ? 'error' : 'warning';
        anomalies.push({
          id: nextId(),
          type: 'joint_limit',
          severity: sev,
          repairability: 'confirm',
          frameStart: s,
          frameEnd: e,
          frame: worstFrame,
          target: name,
          dofIndex: d,
          value: maxOver,
          threshold: th.softLimitMarginRad,
          unit: 'rad',
          detail: `${name}: exceeds [${lim.min.toFixed(2)}, ${lim.max.toFixed(2)}] by ${maxOver.toFixed(3)} rad`,
        });
        markSeverity(s, e, sev);
      }
    }

    // 3c. Spikes / discontinuities
    const spikes = detectOutlierFrames1D(col, th.hampelWindowHalf, th.hampelSigma, th.minJointSpikeRad);
    for (const [s, e] of groupTrueSpans(spikes)) {
      const span = e - s + 1;
      let maxJump = 0;
      let worstF = s;
      for (let f = s; f <= e; f++) {
        const ref = f > 0 && Number.isFinite(col[f - 1])
          ? col[f - 1]
          : f + 1 < T && Number.isFinite(col[f + 1])
            ? col[f + 1]
            : col[f];
        const jump = Math.abs(col[f] - ref);
        if (jump > maxJump) {
          maxJump = jump;
          worstF = f;
        }
      }
      const isLong = span > th.maxRepairSpan;
      anomalies.push({
        id: nextId(),
        type: isLong ? 'discontinuity' : 'joint_spike',
        severity: isLong ? 'error' : 'warning',
        repairability: isLong ? 'unrepairable' : 'auto',
        frameStart: s,
        frameEnd: e,
        frame: worstF,
        target: name,
        dofIndex: d,
        value: maxJump,
        threshold: th.minJointSpikeRad,
        unit: 'rad',
        detail: `${name}: ${isLong ? 'long anomaly span' : 'spike'} Δ=${maxJump.toFixed(3)} rad`,
      });
      markSeverity(s, e, isLong ? 'error' : 'warning');
    }

    // 3d. Velocity, acceleration, jerk & excessive velocity / acceleration
    const highVelFlags = new Array<boolean>(T).fill(false);
    const highAccFlags = new Array<boolean>(T).fill(false);
    for (let f = 1; f < T; f++) {
      if (!Number.isFinite(col[f]) || !Number.isFinite(col[f - 1])) continue;
      const v = (col[f] - col[f - 1]) / dt;
      const av = Math.abs(v);
      vSumSq += v * v;
      vCount++;
      if (av > peakJointVelRadS) peakJointVelRadS = av;
      if (av > th.maxJointVelRadS && !spikes[f] && !spikes[f - 1]) {
        highVelFlags[f] = true;
      }

      if (f >= 2 && Number.isFinite(col[f - 2])) {
        const a = (col[f] - 2 * col[f - 1] + col[f - 2]) / (dt * dt);
        const aa = Math.abs(a);
        aSumSq += a * a;
        aCount++;
        if (aa > peakJointAccRadS2) peakJointAccRadS2 = aa;
        if (aa > th.maxJointAccRadS2 && !spikes[f] && !spikes[f - 1] && !spikes[f - 2]) {
          highAccFlags[f - 1] = true;
        }
      }
      if (f >= 3 && Number.isFinite(col[f - 2]) && Number.isFinite(col[f - 3])) {
        const j = (col[f] - 3 * col[f - 1] + 3 * col[f - 2] - col[f - 3]) / (dt * dt * dt);
        jSumSq += j * j;
        jCount++;
      }
    }

    for (const [s, e] of groupTrueSpans(highVelFlags)) {
      let maxV = 0;
      let wf = s;
      for (let f = s; f <= e; f++) {
        const av = Math.abs(col[f] - col[f - 1]) / dt;
        if (av > maxV) {
          maxV = av;
          wf = f;
        }
      }
      const span = e - s + 1;
      anomalies.push({
        id: nextId(),
        type: 'excessive_velocity',
        severity: 'warning',
        repairability: 'confirm',
        frameStart: s,
        frameEnd: e,
        frame: wf,
        target: name,
        dofIndex: d,
        value: maxV,
        threshold: th.maxJointVelRadS,
        unit: 'rad/s',
        detail: `${name}: velocity ${maxV.toFixed(1)} rad/s > ${th.maxJointVelRadS} rad/s (${span}f)`,
      });
      markSeverity(s, e, 'warning');
    }

    for (const [s, e] of groupTrueSpans(highAccFlags)) {
      let maxA = 0;
      let wf = s;
      for (let f = s; f <= e; f++) {
        if (f > 0 && f + 1 < T && Number.isFinite(col[f - 1]) && Number.isFinite(col[f + 1])) {
          const aa = Math.abs(col[f + 1] - 2 * col[f] + col[f - 1]) / (dt * dt);
          if (aa > maxA) {
            maxA = aa;
            wf = f;
          }
        }
      }
      anomalies.push({
        id: nextId(),
        type: 'excessive_accel',
        severity: 'warning',
        repairability: 'confirm',
        frameStart: s,
        frameEnd: e,
        frame: wf,
        target: name,
        dofIndex: d,
        value: maxA,
        threshold: th.maxJointAccRadS2,
        unit: 'rad/s²',
        detail: `${name}: acceleration ${maxA.toFixed(0)} rad/s² > ${th.maxJointAccRadS2} rad/s²`,
      });
      markSeverity(s, e, 'warning');
    }

    // 3e. High-frequency jitter (repeated sign reversals in consecutive steps)
    if (T >= th.jitterWindowFrames) {
      const jitterFlags = new Array<boolean>(T).fill(false);
      const revMarks = new Array<boolean>(T - 1).fill(false);
      const oscAmp = new Float64Array(T);
      for (let f = 1; f < T - 1; f++) {
        if (!Number.isFinite(col[f - 1]) || !Number.isFinite(col[f]) || !Number.isFinite(col[f + 1])) {
          continue;
        }
        const d1 = col[f] - col[f - 1];
        const d2 = col[f + 1] - col[f];
        if (d1 * d2 < 0 && Math.min(Math.abs(d1), Math.abs(d2)) >= th.jitterAmpRad) {
          revMarks[f] = true;
          oscAmp[f] = Math.abs(col[f] - 0.5 * (col[f - 1] + col[f + 1]));
        }
      }
      const win = th.jitterWindowFrames;
      for (let start = 0; start <= T - win; start++) {
        let revCount = 0;
        for (let k = start + 1; k < start + win - 1; k++) {
          if (revMarks[k]) revCount++;
        }
        if (revCount >= th.jitterMinReversals) {
          for (let k = start; k < start + win; k++) {
            if (revMarks[k] || (k > start && revMarks[k - 1])) jitterFlags[k] = true;
          }
        }
      }
      for (const [s, e] of groupTrueSpans(jitterFlags)) {
        let maxOsc = 0;
        let wf = s;
        for (let f = s; f <= e; f++) {
          if (oscAmp[f] > maxOsc) {
            maxOsc = oscAmp[f];
            wf = f;
          }
        }
        anomalies.push({
          id: nextId(),
          type: 'high_freq_jitter',
          severity: 'warning',
          repairability: 'auto',
          frameStart: s,
          frameEnd: e,
          frame: wf,
          target: name,
          dofIndex: d,
          value: maxOsc,
          threshold: th.jitterAmpRad,
          unit: 'rad',
          detail: `${name}: high-frequency jitter (amp ${maxOsc.toFixed(3)} rad)`,
        });
        markSeverity(s, e, 'warning');
      }
    }
  }

  anomalies.sort((a, b) => a.frame - b.frame || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const validFrames = frameHasNan.filter((x) => !x).length;
  const metrics: QualityMetrics = {
    frameCount: T,
    fps,
    validFrameRatio: T > 0 ? validFrames / T : 0,
    totalIssues: anomalies.length,
    errorCount: anomalies.filter((a) => a.severity === 'error').length,
    warningCount: anomalies.filter((a) => a.severity === 'warning').length,
    infoCount: anomalies.filter((a) => a.severity === 'info').length,
    autoRepairableCount: anomalies.filter((a) => a.repairability === 'auto').length,
    confirmCount: anomalies.filter((a) => a.repairability === 'confirm').length,
    unrepairableCount: anomalies.filter((a) => a.repairability === 'unrepairable').length,
    nanInfCount: anomalies.filter((a) => a.type === 'nan_inf').length,
    spikeCount: anomalies.filter(
      (a) => a.type === 'joint_spike' || a.type === 'root_pos_spike' || a.type === 'root_rot_spike',
    ).length,
    limitViolationCount: anomalies.filter((a) => a.type === 'joint_limit').length,
    jitterIssueCount: anomalies.filter((a) => a.type === 'high_freq_jitter').length,
    quatFlipCount: anomalies.filter((a) => a.type === 'quat_sign_flip').length,
    peakJointVelRadS,
    rmsJointVelRadS: Math.sqrt(vSumSq / Math.max(1, vCount)),
    peakJointAccRadS2,
    rmsJointAccRadS2: Math.sqrt(aSumSq / Math.max(1, aCount)),
    rmsJointJerkRadS3: Math.sqrt(jSumSq / Math.max(1, jCount)),
    peakRootSpeedMS,
    peakRootAngVelRadS,
  };

  return { anomalies, metrics, frameSeverity };
}

function emptyMetrics(frameCount: number, fps: number, anomalies: MotionAnomaly[]): QualityMetrics {
  return {
    frameCount,
    fps,
    validFrameRatio: 0,
    totalIssues: anomalies.length,
    errorCount: anomalies.length,
    warningCount: 0,
    infoCount: 0,
    autoRepairableCount: 0,
    confirmCount: 0,
    unrepairableCount: anomalies.length,
    nanInfCount: 0,
    spikeCount: 0,
    limitViolationCount: 0,
    jitterIssueCount: 0,
    quatFlipCount: 0,
    peakJointVelRadS: 0,
    rmsJointVelRadS: 0,
    peakJointAccRadS2: 0,
    rmsJointAccRadS2: 0,
    rmsJointJerkRadS3: 0,
    peakRootSpeedMS: 0,
    peakRootAngVelRadS: 0,
  };
}
