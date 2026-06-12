/**
 * Export helpers for retargeted robot motion.
 *
 * NPZ keys mirror GMR's saved pickle (scripts/bvh_to_robot.py):
 *   fps, root_pos (T,3), root_rot (T,4) in **xyzw**, dof_pos (T,ndof)
 * plus dof_names for self-description. scripts/npz_to_pkl.py in this repo
 * converts the NPZ to a GMR-compatible .pkl.
 */

import type { RetargetResult } from '../retarget/types';
import { encodeNpz } from './npz';

export function splitResult(result: RetargetResult) {
  const { qpos, frameCount: T, nq } = result;
  const nDof = nq - 7;
  const rootPos = new Float64Array(T * 3);
  const rootRotXyzw = new Float64Array(T * 4);
  const dofPos = new Float64Array(T * nDof);
  for (let f = 0; f < T; f++) {
    const base = f * nq;
    rootPos[f * 3] = qpos[base];
    rootPos[f * 3 + 1] = qpos[base + 1];
    rootPos[f * 3 + 2] = qpos[base + 2];
    // wxyz -> xyzw (GMR saves scipy-style xyzw)
    rootRotXyzw[f * 4] = qpos[base + 4];
    rootRotXyzw[f * 4 + 1] = qpos[base + 5];
    rootRotXyzw[f * 4 + 2] = qpos[base + 6];
    rootRotXyzw[f * 4 + 3] = qpos[base + 3];
    for (let d = 0; d < nDof; d++) dofPos[f * nDof + d] = qpos[base + 7 + d];
  }
  return { rootPos, rootRotXyzw, dofPos, nDof };
}

export function exportNpz(result: RetargetResult): Blob {
  const { rootPos, rootRotXyzw, dofPos, nDof } = splitResult(result);
  const T = result.frameCount;
  const bytes = encodeNpz({
    fps: { data: Float64Array.of(result.fps), shape: [1] },
    root_pos: { data: rootPos, shape: [T, 3] },
    root_rot: { data: rootRotXyzw, shape: [T, 4] },
    dof_pos: { data: dofPos, shape: [T, nDof] },
  });
  const copy = new Uint8Array(bytes); // detach from any underlying pool
  return new Blob([copy.buffer], { type: 'application/zip' });
}

export function exportCsv(result: RetargetResult): Blob {
  const { rootPos, rootRotXyzw, dofPos, nDof } = splitResult(result);
  const T = result.frameCount;
  const header = [
    'frame',
    'time',
    'root_px',
    'root_py',
    'root_pz',
    'root_qx',
    'root_qy',
    'root_qz',
    'root_qw',
    ...result.dofNames,
  ].join(',');
  const lines = [header];
  for (let f = 0; f < T; f++) {
    const row: string[] = [String(f), (f / result.fps).toFixed(6)];
    for (let i = 0; i < 3; i++) row.push(rootPos[f * 3 + i].toFixed(8));
    for (let i = 0; i < 4; i++) row.push(rootRotXyzw[f * 4 + i].toFixed(8));
    for (let d = 0; d < nDof; d++) row.push(dofPos[f * nDof + d].toFixed(8));
    lines.push(row.join(','));
  }
  return new Blob([lines.join('\n')], { type: 'text/csv' });
}

export function exportJson(result: RetargetResult): Blob {
  const { rootPos, rootRotXyzw, dofPos } = splitResult(result);
  const payload = {
    format: 'gmr_robot_motion',
    robot: result.robotId,
    fps: result.fps,
    frame_count: result.frameCount,
    dof_names: result.dofNames,
    root_pos: Array.from(rootPos),
    root_rot_xyzw: Array.from(rootRotXyzw),
    dof_pos: Array.from(dofPos),
  };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
