/**
 * Sub-frame pose blending for smooth playback on high-refresh displays.
 * Motion data is stored at discrete frames; interpolate between neighbors.
 */

import * as THREE from 'three';

const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const qOut = new THREE.Quaternion();

export function frameBlendIndices(
  frame: number,
  frameCount: number,
): { f0: number; f1: number; t: number } {
  if (frameCount <= 1) return { f0: 0, f1: 0, t: 0 };
  const clamped = Math.max(0, Math.min(frame, frameCount - 1));
  const f0 = Math.floor(clamped);
  const f1 = Math.min(f0 + 1, frameCount - 1);
  return { f0, f1, t: clamped - f0 };
}

/** Blend MuJoCo qpos: linear on pos + dofs, slerp on root quaternion (wxyz at [3:7]). */
export function blendQpos(
  out: Float64Array,
  qpos: Float64Array,
  nq: number,
  frameCount: number,
  frame: number,
): void {
  const { f0, f1, t } = frameBlendIndices(frame, frameCount);
  const i0 = f0 * nq;
  const i1 = f1 * nq;
  if (t < 1e-6 || f0 === f1) {
    out.set(qpos.subarray(i0, i0 + nq));
    return;
  }
  for (let i = 0; i < 3; i++) out[i] = qpos[i0 + i] * (1 - t) + qpos[i1 + i] * t;
  qA.set(qpos[i0 + 4], qpos[i0 + 5], qpos[i0 + 6], qpos[i0 + 3]);
  qB.set(qpos[i1 + 4], qpos[i1 + 5], qpos[i1 + 6], qpos[i1 + 3]);
  qOut.copy(qA).slerp(qB, t);
  out[3] = qOut.w;
  out[4] = qOut.x;
  out[5] = qOut.y;
  out[6] = qOut.z;
  for (let i = 7; i < nq; i++) out[i] = qpos[i0 + i] * (1 - t) + qpos[i1 + i] * t;
}

/** Blend flat xyz keypoints: layout [frame][count][3]. */
export function blendKeypoints(
  out: THREE.Vector3,
  positions: Float32Array,
  count: number,
  frameCount: number,
  frame: number,
  keyIndex: number,
): void {
  const { f0, f1, t } = frameBlendIndices(frame, frameCount);
  const b0 = (f0 * count + keyIndex) * 3;
  const b1 = (f1 * count + keyIndex) * 3;
  if (t < 1e-6 || f0 === f1) {
    out.set(positions[b0], positions[b0 + 1], positions[b0 + 2]);
    return;
  }
  out.set(
    positions[b0] * (1 - t) + positions[b1] * t,
    positions[b0 + 1] * (1 - t) + positions[b1 + 1] * t,
    positions[b0 + 2] * (1 - t) + positions[b1 + 2] * t,
  );
}
