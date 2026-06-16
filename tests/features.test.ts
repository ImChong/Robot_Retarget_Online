import { describe, expect, it } from 'vitest';
import { resolveQuadrupedFromUrl } from '@/lib/features';

describe('resolveQuadrupedFromUrl', () => {
  it('is false without a quadruped URL parameter', () => {
    expect(resolveQuadrupedFromUrl('', '')).toBe(false);
  });

  it('is true with ?quadruped=1', () => {
    expect(resolveQuadrupedFromUrl('?quadruped=1', '')).toBe(true);
  });

  it('is false with ?quadruped=0', () => {
    expect(resolveQuadrupedFromUrl('?quadruped=0', '')).toBe(false);
  });

  it('reads quadruped from the hash-router query string', () => {
    expect(resolveQuadrupedFromUrl('', '#/bvh?quadruped=1')).toBe(true);
  });
});
