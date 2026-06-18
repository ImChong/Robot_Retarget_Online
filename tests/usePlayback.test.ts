import { describe, expect, it } from 'vitest';
import { usePlayback } from '@/composables/usePlayback';

describe('usePlayback scrub', () => {
  it('advances smoothly while scrubbing forward', () => {
    const pb = usePlayback();
    pb.setMotion(100, 30);
    pb.seek(10);

    pb.startScrub(1);
    pb.tick(0.01);

    expect(pb.state.playing).toBe(true);
    expect(pb.scrubDirection.value).toBe(1);
    expect(pb.poseFrame.value).toBeCloseTo(10.3, 5);
  });

  it('advances smoothly while scrubbing backward', () => {
    const pb = usePlayback();
    pb.setMotion(100, 30);
    pb.seek(10);

    pb.startScrub(-1);
    pb.tick(0.01);

    expect(pb.poseFrame.value).toBeCloseTo(9.7, 5);
  });

  it('stops scrubbing at bounds when loop is off', () => {
    const pb = usePlayback();
    pb.setMotion(10, 30);
    pb.state.loop = false;
    pb.seek(0);

    pb.startScrub(-1);
    pb.tick(1);

    expect(pb.poseFrame.value).toBe(0);
    expect(pb.scrubDirection.value).toBe(0);
    expect(pb.state.playing).toBe(false);
  });

  it('wraps while scrubbing when loop is on', () => {
    const pb = usePlayback();
    pb.setMotion(10, 30);
    pb.seek(0);

    pb.startScrub(-1);
    pb.tick(1 / 30);

    expect(pb.poseFrame.value).toBeGreaterThan(8.9);
    expect(pb.poseFrame.value).toBeLessThan(10);
  });
});
