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
  /** -1 / +1 while the user holds an arrow key for smooth scrubbing. */
  const scrubDirection = ref<-1 | 0 | 1>(0);

  function wrapLoopFrame(frame: number): number {
    let f = frame % state.frameCount;
    if (f < 0) f += state.frameCount;
    return f;
  }

  function advanceFrame(delta: number) {
    state.frame += delta;
    if (state.loop) {
      if (state.frame >= state.frameCount || state.frame < 0) {
        state.frame = wrapLoopFrame(state.frame);
      }
      return;
    }
    if (state.frame >= state.frameCount) {
      state.frame = state.frameCount - 1;
      if (scrubDirection.value) stopScrub();
      else state.playing = false;
    } else if (state.frame < 0) {
      state.frame = 0;
      if (scrubDirection.value) stopScrub();
    }
  }

  function tick(dt: number) {
    if (state.frameCount === 0) return;
    if (scrubDirection.value !== 0) {
      advanceFrame(scrubDirection.value * dt * state.fps * state.speed);
      return;
    }
    if (!state.playing) return;
    advanceFrame(dt * state.fps * state.speed);
  }

  /** Fractional frame for sub-frame pose interpolation during playback. */
  const poseFrame = computed(() => {
    if (state.frameCount <= 0) return 0;
    if (state.loop) {
      let f = state.frame % state.frameCount;
      if (f < 0) f += state.frameCount;
      return f;
    }
    return Math.max(0, Math.min(state.frame, state.frameCount - 1));
  });

  function play() {
    state.playing = true;
    userPausedPlayback.value = false;
  }

  function pause() {
    state.playing = false;
    userPausedPlayback.value = true;
  }

  function startScrub(dir: -1 | 1) {
    scrubDirection.value = dir;
    state.playing = true;
    userPausedPlayback.value = false;
  }

  function stopScrub() {
    scrubDirection.value = 0;
    pause();
  }

  return {
    state,
    userPausedPlayback,
    scrubDirection,
    tick,
    frameIndex: computed(() => Math.min(Math.floor(state.frame), Math.max(state.frameCount - 1, 0))),
    poseFrame,
    play,
    pause,
    startScrub,
    stopScrub,
    toggle: () => (state.playing ? pause() : play()),
    seek: (f: number) => (state.frame = f),
    setMotion: (frameCount: number, fps: number) => {
      state.frameCount = frameCount;
      state.fps = fps;
      state.frame = 0;
      scrubDirection.value = 0;
    },
  };
}

export type PlaybackController = ReturnType<typeof usePlayback>;
