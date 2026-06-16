import { describe, expect, it } from 'vitest';
import { isPageReload } from '@/lib/navigation';

describe('isPageReload', () => {
  it('returns false when performance navigation is unavailable', () => {
    expect(isPageReload()).toBe(false);
  });
});
