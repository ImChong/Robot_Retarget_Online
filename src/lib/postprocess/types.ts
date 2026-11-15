export type AnomalySeverity = 'error' | 'warning' | 'info';

export type AnomalyRepairability = 'auto' | 'confirm' | 'unrepairable';

export type AnomalyType =
  | 'nan_inf'
  | 'joint_limit'
  | 'joint_spike'
  | 'excessive_velocity'
  | 'excessive_accel'
  | 'high_freq_jitter'
  | 'root_pos_spike'
  | 'root_rot_spike'
  | 'quat_norm'
  | 'quat_sign_flip'
  | 'discontinuity'
  | 'invalid_sequence';

export interface JointLimitInfo {
  dofIndex: number;
  name: string;
  type: 'hinge' | 'slide';
  limited: boolean;
  min: number;
  max: number;
}

export interface MotionAnomaly {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  repairability: AnomalyRepairability;
  frameStart: number;
  frameEnd: number;
  /** Representative frame to seek to when inspecting this anomaly. */
  frame: number;
  /** Channel name: joint name, 'root_pos', 'root_rot', or 'sequence'. */
  target: string;
  /** Index into result.dofNames when target is a DoF, otherwise null. */
  dofIndex: number | null;
  /** Observed magnitude (unit matches `unit`). */
  value: number;
  /** Threshold that triggered detection (unit matches `unit`). */
  threshold: number;
  unit: string;
  /** Short technical summary for reports & tooltips. */
  detail: string;
}

export interface DetectionThresholds {
  /** Tolerance for |‖q‖ - 1| before flagging quaternion norm drift. */
  quatNormTol: number;
  /** Half-window (frames) for Hampel / local-median outlier detection. */
  hampelWindowHalf: number;
  /** Robust z-score (MAD multiplier) threshold for outlier detection. */
  hampelSigma: number;
  /** Minimum joint residual (rad) required to flag a joint spike (prevents noise false positives). */
  minJointSpikeRad: number;
  /** Physical joint velocity ceiling (rad/s). */
  maxJointVelRadS: number;
  /** Physical joint acceleration ceiling (rad/s²). */
  maxJointAccRadS2: number;
  /** Sliding window length (frames) for high-frequency jitter detection. */
  jitterWindowFrames: number;
  /** Minimum velocity sign reversals inside jitterWindowFrames to flag jitter. */
  jitterMinReversals: number;
  /** Minimum oscillation amplitude (rad) to count as jitter rather than quantization noise. */
  jitterAmpRad: number;
  /** Minimum root position residual (m) required to flag a root position spike. */
  rootPosSpikeM: number;
  /** Root translation speed ceiling (m/s). */
  maxRootSpeedMS: number;
  /** Minimum root geodesic rotation residual (rad) required to flag a root orientation spike. */
  rootRotSpikeRad: number;
  /** Root angular velocity ceiling (rad/s). */
  maxRootAngVelRadS: number;
  /** Joint limit overshoot above this (rad) is marked 'error' / 'confirm' instead of minor warning. */
  softLimitMarginRad: number;
  /** Maximum contiguous anomalous frame span considered safe for local interpolation. */
  maxRepairSpan: number;
}

export const DEFAULT_DETECTION_THRESHOLDS: DetectionThresholds = {
  quatNormTol: 1e-2,
  hampelWindowHalf: 3,
  hampelSigma: 4.0,
  minJointSpikeRad: 0.15,
  maxJointVelRadS: 25.0,
  maxJointAccRadS2: 400.0,
  jitterWindowFrames: 7,
  jitterMinReversals: 4,
  jitterAmpRad: 0.025,
  rootPosSpikeM: 0.12,
  maxRootSpeedMS: 12.0,
  rootRotSpikeRad: 0.35,
  maxRootAngVelRadS: 20.0,
  softLimitMarginRad: 0.05,
  maxRepairSpan: 4,
};

export type SmoothingMethod = 'savgol' | 'gaussian' | 'moving_average' | 'one_euro';

export interface PostProcessConfig {
  thresholds: DetectionThresholds;
  quatCanonicalize: boolean;
  outlierRepair: {
    enabled: boolean;
    maxRepairSpan: number;
    repairJoints: boolean;
    repairRootPos: boolean;
    repairRootRot: boolean;
  };
  smoothing: {
    enabled: boolean;
    method: SmoothingMethod;
    /** Odd window size (5..15) used by savgol / gaussian / moving_average. */
    windowSize: number;
    /** Polynomial order (2 or 3) used by savgol. */
    polyOrder: number;
    /** Gaussian standard deviation in frames (used when method === 'gaussian'). */
    gaussianSigma: number;
    /** One-Euro filter min cutoff frequency in Hz. */
    oneEuroMinCutoff: number;
    /** One-Euro filter speed coefficient. */
    oneEuroBeta: number;
    smoothJoints: boolean;
    smoothRootPos: boolean;
    smoothRootRot: boolean;
  };
  constraints: {
    enforceJointLimits: boolean;
    enforceVelocityLimit: boolean;
    maxJointVelocityRadS: number;
  };
}

export interface QualityMetrics {
  frameCount: number;
  fps: number;
  validFrameRatio: number;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  autoRepairableCount: number;
  confirmCount: number;
  unrepairableCount: number;
  nanInfCount: number;
  spikeCount: number;
  limitViolationCount: number;
  jitterIssueCount: number;
  quatFlipCount: number;
  peakJointVelRadS: number;
  rmsJointVelRadS: number;
  peakJointAccRadS2: number;
  rmsJointAccRadS2: number;
  rmsJointJerkRadS3: number;
  peakRootSpeedMS: number;
  peakRootAngVelRadS: number;
}

export interface DetectionReport {
  anomalies: MotionAnomaly[];
  metrics: QualityMetrics;
  /** Per-frame highest severity for timeline markers. */
  frameSeverity: Array<AnomalySeverity | null>;
}

export interface TrajectoryDelta {
  dofRmsDiffRad: number;
  dofMaxDiffRad: number;
  rootPosRmsDiffM: number;
  rootPosMaxDiffM: number;
  rootRotRmsDiffDeg: number;
  rootRotMaxDiffDeg: number;
}

export interface PostProcessOperationsSummary {
  quatNormalizedFrames: number;
  quatSignFlippedFrames: number;
  repairedJointCells: number;
  repairedRootPosFrames: number;
  repairedRootRotFrames: number;
  skippedUnrepairableSpans: number;
  smoothingApplied: boolean;
  smoothingMethod: SmoothingMethod | 'none';
  clampedLimitCells: number;
  largeLimitWarnings: number;
  velocityClampedCells: number;
}

export interface PostProcessOutput {
  rawDetection: DetectionReport;
  processedDetection: DetectionReport;
  processedResult: import('../retarget/types').RetargetResult;
  metricsBefore: QualityMetrics;
  metricsAfter: QualityMetrics;
  delta: TrajectoryDelta;
  operations: PostProcessOperationsSummary;
  jointLimits: JointLimitInfo[];
}
