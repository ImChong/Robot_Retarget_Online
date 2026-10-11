import { describe, expect, it } from 'vitest';
import { resolveQuadrupedFromUrl } from '@/lib/features';

describe('resolveQuadrupedFromUrl', () => {
  it('is true without a quadruped URL parameter (surfaced by default)', () => {
    expect(resolveQuadrupedFromUrl('', '')).toBe(true);
    expect(resolveQuadrupedFromUrl('?other=1', '#/bvh')).toBe(true);
  });

  it('is true with ?quadruped=1', () => {
    expect(resolveQuadrupedFromUrl('?quadruped=1', '')).toBe(true);
  });

  it('is false with ?quadruped=0 or ?quadruped=false (per-visit kill switch)', () => {
    expect(resolveQuadrupedFromUrl('?quadruped=0', '')).toBe(false);
    expect(resolveQuadrupedFromUrl('?quadruped=false', '')).toBe(false);
  });

  it('reads quadruped from the hash-router query string', () => {
    expect(resolveQuadrupedFromUrl('', '#/bvh?quadruped=0')).toBe(false);
    expect(resolveQuadrupedFromUrl('', '#/bvh?quadruped=1')).toBe(true);
  });

  it('prefers the top-level query over the hash query', () => {
    expect(resolveQuadrupedFromUrl('?quadruped=0', '#/bvh?quadruped=1')).toBe(false);
  });
});
