/**
 * Video → BVH motion capture (in-browser, MediaPipe Pose).
 *
 * Pipeline: decode video → 3D pose landmarks → temporal smoothing →
 * LAFAN1-compatible BVH text. The result loads through the normal
 * `useMotionStore().loadBvhText(...)` path, so the viewer and retargeting
 * pipeline consume it unchanged.
 */

import { extractPosesFromVideo, type ExtractOptions, type ModelQuality } from './poseLandmarker';
import { smoothPoseSequence, type SmoothingOptions } from './smoothing';
import { posesToBvh, type PosesToBvhResult } from './landmarksToBvh';

export type { ModelQuality } from './poseLandmarker';
export { mocapAssets } from './poseLandmarker';
export type { PoseFrame, PoseSequence } from './types';

export interface VideoToBvhOptions extends ExtractOptions {
  smoothing?: SmoothingOptions | false;
}

export interface VideoToBvhResult extends PosesToBvhResult {
  /** Fraction of frames with no detected pose (quality signal for the UI). */
  emptyRatio: number;
}

/** Convert an uploaded video file into a LAFAN1 BVH string. */
export async function videoToBvh(
  file: File,
  opts: VideoToBvhOptions = {},
): Promise<VideoToBvhResult> {
  const seq = await extractPosesFromVideo(file, opts);
  const empty = seq.frames.filter((f) => f.visibility.every((v) => v === 0)).length;

  const frames =
    opts.smoothing === false
      ? seq.frames
      : smoothPoseSequence(seq.frames, seq.fps, opts.smoothing ?? {});

  const result = posesToBvh(frames, seq.fps, {});
  return { ...result, emptyRatio: seq.frames.length ? empty / seq.frames.length : 1 };
}

export { extractPosesFromVideo, smoothPoseSequence, posesToBvh };
export type { ModelQuality as Model };
