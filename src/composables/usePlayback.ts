import { computed, reactive, ref } from 'vue';

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
  /** True after the user explicitly pauses; cleared when they press play. */
  const userPausedPlayback = ref(false);

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

  function play() {
    state.playing = true;
    userPausedPlayback.value = false;
  }

  function pause() {
    state.playing = false;
    userPausedPlayback.value = true;
  }

  return {
    state,
    userPausedPlayback,
    tick,
    frameIndex: computed(() => Math.min(Math.floor(state.frame), Math.max(state.frameCount - 1, 0))),
    poseFrame,
    play,
    pause,
    toggle: () => (state.playing ? pause() : play()),
    seek: (f: number) => (state.frame = f),
    setMotion: (frameCount: number, fps: number) => {
      state.frameCount = frameCount;
      state.fps = fps;
      state.frame = 0;
    },
  };
}

export type PlaybackController = ReturnType<typeof usePlayback>;
