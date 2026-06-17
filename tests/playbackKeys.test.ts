import { describe, expect, it } from 'vitest';
import { isPlaybackKeyCode } from '@/lib/playbackKeys';

describe('playbackKeys', () => {
  it('recognizes playback key codes', () => {
    expect(isPlaybackKeyCode('ArrowLeft')).toBe(true);
    expect(isPlaybackKeyCode('ArrowRight')).toBe(true);
    expect(isPlaybackKeyCode('Space')).toBe(true);
    expect(isPlaybackKeyCode('KeyA')).toBe(false);
  });
});
