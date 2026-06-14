/**
 * MediaPipe Pose Landmarker wrapper: decode an uploaded video frame-by-frame
 * and return per-frame 3D world landmarks. The heavy `@mediapipe/tasks-vision`
 * dependency is dynamically imported so it (and its WASM) never enter the
 * first-paint bundle — consistent with the lazy-loaded MuJoCo WASM.
 *
 * Privacy: the video is decoded entirely in the browser; only the model and
 * runtime WASM are fetched (from a CDN by default). Nothing is uploaded.
 */

import type { Vec3 } from '../math3d';
import { NUM_LANDMARKS, type PoseFrame, type PoseSequence } from './types';

export type ModelQuality = 'lite' | 'full';

/**
 * Asset locations — served from the app's own origin so the feature works
 * behind restrictive networks / CSP and offline, with no third-party CDN
 * dependency. The WASM runtime is copied from node_modules at build time
 * (`scripts/setup-mediapipe-wasm.mjs`); the lite pose model ships in `public/`.
 */
const BASE = import.meta.env.BASE_URL;
export const mocapAssets = {
  wasmBase: `${BASE}mediapipe/wasm`,
  models: {
    lite: `${BASE}mediapipe/models/pose_landmarker_lite.task`,
    full: `${BASE}mediapipe/models/pose_landmarker_lite.task`,
  } satisfies Record<ModelQuality, string>,
};

export interface ExtractOptions {
  model?: ModelQuality;
  /** Target sampling rate (frames/second) to extract from the video. */
  targetFps?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

async function createLandmarker(model: ModelQuality, delegate: 'GPU' | 'CPU') {
  const vision = await import('@mediapipe/tasks-vision');
  const fileset = await vision.FilesetResolver.forVisionTasks(mocapAssets.wasmBase);
  return vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: mocapAssets.models[model], delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}

/**
 * Try the GPU (WebGL) delegate first for speed, but fall back to CPU if it
 * throws *or* stalls — some browsers expose a WebGL context that never finishes
 * initializing the delegate. CPU (XNNPACK) is slower but always available.
 */
async function createLandmarkerWithFallback(model: ModelQuality) {
  try {
    return await withTimeout(createLandmarker(model, 'GPU'), 7000, 'GPU pose landmarker init');
  } catch (err) {
    console.warn('[mocap] GPU pose delegate unavailable, falling back to CPU:', err);
    return createLandmarker(model, 'CPU');
  }
}

function waitEvent(el: HTMLMediaElement, type: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener(type, finish);
      resolve();
    };
    el.addEventListener(type, finish, { once: true });
    setTimeout(finish, timeoutMs);
  });
}

const EMPTY_FRAME = (): PoseFrame => ({
  world: Array.from({ length: NUM_LANDMARKS }, () => [0, 0, 0] as Vec3),
  visibility: new Array(NUM_LANDMARKS).fill(0),
});

interface RawLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

function toFrame(world: RawLandmark[], normalized: RawLandmark[] | undefined): PoseFrame {
  const src = normalized ?? world;
  return {
    world: world.map((l) => [l.x, l.y, l.z] as Vec3),
    visibility: src.map((l) => (typeof l.visibility === 'number' ? l.visibility : 1)),
  };
}

/**
 * Run pose estimation across an uploaded video file.
 * Throws `AbortError` if `signal` is aborted.
 */
export async function extractPosesFromVideo(
  file: File,
  opts: ExtractOptions = {},
): Promise<PoseSequence> {
  const model = opts.model ?? 'lite';
  const fps = opts.targetFps ?? 30;

  const landmarker = await createLandmarkerWithFallback(model);

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(file);
  video.src = url;

  const cleanup = () => {
    URL.revokeObjectURL(url);
    try {
      landmarker.close();
    } catch {
      /* ignore */
    }
  };

  try {
    await waitEvent(video, 'loadedmetadata');
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!duration) throw new Error('Could not read video duration');
    const total = Math.max(1, Math.floor(duration * fps));

    // Prefer playback + requestVideoFrameCallback (realtime, reliable decoding);
    // fall back to frame seeking where rVFC is unavailable.
    const frames =
      typeof video.requestVideoFrameCallback === 'function'
        ? await extractByPlayback(video, landmarker, fps, total, opts)
        : await extractBySeeking(video, landmarker, fps, duration, total, opts);

    return { frames, fps };
  } finally {
    cleanup();
  }
}

type Landmarker = Awaited<ReturnType<typeof createLandmarkerWithFallback>>;

function detectFrame(landmarker: Landmarker, video: HTMLVideoElement, ts: number): PoseFrame {
  const res = landmarker.detectForVideo(video, ts);
  const world = res?.worldLandmarks?.[0];
  return world && world.length === NUM_LANDMARKS ? toFrame(world, res.landmarks?.[0]) : EMPTY_FRAME();
}

/** Play the clip and sample frames as they are decoded (target rate throttled). */
async function extractByPlayback(
  video: HTMLVideoElement,
  landmarker: Landmarker,
  fps: number,
  total: number,
  opts: ExtractOptions,
): Promise<PoseFrame[]> {
  const frames: PoseFrame[] = [];
  const dtSample = 1 / fps;
  await new Promise<void>((resolve, reject) => {
    let lastSampled = -Infinity;
    let lastTs = -1;
    let stopped = false;
    const stop = (err?: unknown) => {
      if (stopped) return;
      stopped = true;
      video.pause();
      if (err) reject(err);
      else resolve();
    };
    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (stopped) return;
      if (opts.signal?.aborted) return stop(new DOMException('Aborted', 'AbortError'));
      const t = meta.mediaTime;
      if (t - lastSampled >= dtSample - 1e-3) {
        lastSampled = t;
        let ts = Math.round(t * 1000);
        if (ts <= lastTs) ts = lastTs + 1; // detectForVideo needs increasing stamps
        lastTs = ts;
        frames.push(detectFrame(landmarker, video, ts));
        opts.onProgress?.(Math.min(frames.length, total), total);
      }
      if (video.ended) stop();
      else video.requestVideoFrameCallback(onFrame);
    };
    video.addEventListener('ended', () => stop(), { once: true });
    video.addEventListener('error', () => stop(new Error('Video decode failed')), { once: true });
    video.requestVideoFrameCallback(onFrame);
    video.play().catch(stop);
  });
  return frames;
}

/** Fallback frame iteration by seeking (rVFC unavailable). */
async function extractBySeeking(
  video: HTMLVideoElement,
  landmarker: Landmarker,
  fps: number,
  duration: number,
  total: number,
  opts: ExtractOptions,
): Promise<PoseFrame[]> {
  const frames: PoseFrame[] = [];
  const dt = 1 / fps;
  let lastTs = -1;
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const t = Math.min(i * dt, Math.max(0, duration - 1e-3));
    video.currentTime = t;
    await waitEvent(video, 'seeked', 2500);
    let ts = Math.round(t * 1000);
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    frames.push(detectFrame(landmarker, video, ts));
    opts.onProgress?.(i + 1, total);
  }
  return frames;
}
