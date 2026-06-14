import { computed, reactive } from 'vue';

/**
 * Frame-based playback clock. Call `tick(dt)` from the render loop; read
 * `frameIndex` to drive the scene.
 */
export function usePlayback() {
  const state = reactive({
    playing: false,
    frame: 0, // fractional frame position
    speed: 1.0,
    loop: true,
    frameCount: 0,
    fps: 30,
  });

  function tick(dt: number) {
    if (!state.playing || state.frameCount === 0) return;
    state.frame += dt * state.fps * state.speed;
    if (state.frame >= state.frameCount) {
      if (state.loop) state.frame %= state.frameCount;
      else {
        state.frame = state.frameCount - 1;
        state.playing = false;
      }
    }
  }

  /** Fractional frame for sub-frame pose interpolation during playback. */
  const poseFrame = computed(() => {
    if (state.frameCount <= 0) return 0;
    if (state.loop) {
      let f = state.frame % state.frameCount;
      if (f < 0) f += state.frameCount;
      return f;
    }
    return Math.min(state.frame, state.frameCount - 1);
  });

  return {
    state,
    tick,
    frameIndex: computed(() => Math.min(Math.floor(state.frame), Math.max(state.frameCount - 1, 0))),
    poseFrame,
    toggle: () => (state.playing = !state.playing),
    seek: (f: number) => (state.frame = f),
    setMotion: (frameCount: number, fps: number) => {
      state.frameCount = frameCount;
      state.fps = fps;
      state.frame = 0;
    },
  };
}

export type PlaybackController = ReturnType<typeof usePlayback>;
