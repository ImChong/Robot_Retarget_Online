import { describe, expect, it, vi } from 'vitest';
import {
  isPlaybackKeyCode,
  shouldSuppressPlaybackKeyUp,
  suppressPlaybackKeyEvent,
} from '@/lib/playbackKeys';

describe('playbackKeys', () => {
  it('recognizes playback key codes', () => {
    expect(isPlaybackKeyCode('ArrowLeft')).toBe(true);
    expect(isPlaybackKeyCode('ArrowRight')).toBe(true);
    expect(isPlaybackKeyCode('Space')).toBe(true);
    expect(isPlaybackKeyCode('KeyA')).toBe(false);
  });

  it('suppresses keyup for playback keys', () => {
    expect(shouldSuppressPlaybackKeyUp('Space')).toBe(true);
    expect(shouldSuppressPlaybackKeyUp('ArrowLeft')).toBe(true);
    expect(shouldSuppressPlaybackKeyUp('ArrowRight')).toBe(true);
    expect(shouldSuppressPlaybackKeyUp('KeyA')).toBe(false);
  });

  it('suppresses default and propagation', () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    suppressPlaybackKeyEvent({ preventDefault, stopPropagation });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });
});
