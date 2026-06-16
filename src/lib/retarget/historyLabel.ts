import type { RetargetHistoryEntry } from './types';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Human-readable stamp for history dropdown labels and stats (local time). */
export function formatRetargetTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Filesystem-safe stamp for exported motion filenames (local time). */
export function formatRetargetFilenameStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

export function formatRetargetHistoryLabel(entry: RetargetHistoryEntry, engineLabel: string): string {
  const bvh = entry.bvhName.replace(/\.bvh$/i, '');
  const stamp = formatRetargetTimestamp(entry.createdAt);
  return `${bvh} · ${entry.robotLabel} · ${engineLabel} · ${stamp}`;
}

export function formatRetargetExportBasename(entry: RetargetHistoryEntry): string {
  const base = entry.bvhName.replace(/\.bvh$/i, '');
  const stamp = formatRetargetFilenameStamp(entry.createdAt);
  return `${base}_${entry.result.robotId}_${entry.result.engine}_${stamp}`;
}
