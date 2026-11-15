import { describe, expect, it } from 'vitest';
import {
  formatPostProcessExportBasename,
  formatRetargetExportBasename,
  formatRetargetFilenameStamp,
  formatRetargetHistoryLabel,
  formatRetargetTimestamp,
} from '@/lib/retarget/historyLabel';
import type { RetargetHistoryEntry } from '@/lib/retarget/types';

const createdAt = Date.UTC(2026, 5, 16, 14, 30, 52);

function sampleEntry(overrides: Partial<RetargetHistoryEntry> = {}): RetargetHistoryEntry {
  return {
    id: 'test-id',
    bvhName: 'walk.bvh',
    robotId: 'unitree_g1',
    robotLabel: 'g1.xml',
    engine: 'gmr',
    createdAt,
    result: {
      robotId: 'unitree_g1',
      engine: 'gmr',
      fps: 30,
      frameCount: 10,
      nq: 7,
      qpos: new Float64Array(70),
      dofNames: [],
      taskNames: [],
      taskHumanBodies: [],
      posErrors: new Float32Array(0),
      scaledHuman: new Float32Array(0),
      humanBodyNames: [],
      elapsedMs: 100,
    },
    ...overrides,
  };
}

describe('historyLabel', () => {
  it('formats display timestamps in local time', () => {
    const local = formatRetargetTimestamp(createdAt);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const d = new Date(createdAt);
    expect(local).toBe(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`,
    );
  });

  it('formats filename stamps without spaces or colons', () => {
    const local = formatRetargetFilenameStamp(createdAt);
    expect(local).toMatch(/^\d{8}-\d{6}$/);
    const d = new Date(createdAt);
    expect(local).toBe(
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`,
    );
  });

  it('includes timestamp in history labels', () => {
    const label = formatRetargetHistoryLabel(sampleEntry(), 'GMR');
    expect(label).toContain('walk');
    expect(label).toContain('g1.xml');
    expect(label).toContain('GMR');
    expect(label).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('includes timestamp in export basenames', () => {
    const base = formatRetargetExportBasename(sampleEntry());
    expect(base).toMatch(/^walk_unitree_g1_gmr_\d{8}-\d{6}$/);
  });

  it('distinguishes raw, processed, and report export basenames', () => {
    const entry = sampleEntry();
    expect(formatPostProcessExportBasename(entry, 'raw')).toMatch(/^walk_unitree_g1_gmr_\d{8}-\d{6}_raw$/);
    expect(formatPostProcessExportBasename(entry, 'processed')).toMatch(/^walk_unitree_g1_gmr_\d{8}-\d{6}_processed$/);
    expect(formatPostProcessExportBasename(entry, 'report')).toMatch(/^walk_unitree_g1_gmr_\d{8}-\d{6}_postprocess_report$/);
  });
});
