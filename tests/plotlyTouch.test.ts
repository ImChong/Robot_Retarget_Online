import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCoarsePointerDevice } from '@/lib/plotlyTouch';

function installWindow(match: (query: string) => boolean, maxTouchPoints: number) {
  vi.stubGlobal('window', {
    matchMedia: (query: string) =>
      ({
        matches: match(query),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  });
  vi.stubGlobal('navigator', { maxTouchPoints });
}

describe('isCoarsePointerDevice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    expect(isCoarsePointerDevice()).toBe(false);
  });

  it('returns true for coarse pointer media query', () => {
    installWindow((q) => q === '(pointer: coarse)', 0);
    expect(isCoarsePointerDevice()).toBe(true);
  });

  it('returns true for hover-none touch devices (iOS WebKit fallback)', () => {
    installWindow((q) => q === '(hover: none)', 5);
    expect(isCoarsePointerDevice()).toBe(true);
  });

  it('returns false for desktop pointer + hover', () => {
    installWindow(() => false, 0);
    expect(isCoarsePointerDevice()).toBe(false);
  });
});
