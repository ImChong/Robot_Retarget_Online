/**
 * Shared types for the video → BVH motion-capture pipeline.
 *
 * The pipeline is intentionally decoupled from MediaPipe's concrete types so the
 * conversion / smoothing code can be unit-tested with synthetic input and the
 * heavy `@mediapipe/tasks-vision` dependency stays isolated in
 * `poseLandmarker.ts` (lazy-loaded only when the feature is used).
 */

import type { Vec3 } from '../math3d';

/** Number of BlazePose (MediaPipe Pose) landmarks per frame. */
export const NUM_LANDMARKS = 33;

/**
 * One frame of pose estimation.
 * - `world`: 33 landmarks in metric world space (meters), origin at the hip
 *   center, using MediaPipe's axes (x right, y down, z toward the camera).
 * - `visibility`: per-landmark confidence in [0, 1].
 */
export interface PoseFrame {
  world: Vec3[]; // length NUM_LANDMARKS
  visibility: number[]; // length NUM_LANDMARKS
}

export interface PoseSequence {
  frames: PoseFrame[];
  fps: number;
}

/** BlazePose landmark indices we rely on (subject's left/right). */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;
