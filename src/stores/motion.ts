import { defineStore } from 'pinia';
import { markRaw } from 'vue';
import { parseBvh, estimateSkeletonSize, type BvhAnim } from '@/lib/bvh/parse';
import { bvhToLafan1Frames, type Lafan1Motion } from '@/lib/bvh/lafan1';

export interface MotionState {
  fileName: string | null;
  anim: BvhAnim | null;
  lafan: Lafan1Motion | null;
  /** file units -> meters */
  unitScale: number;
  skeletonSizeUnits: number;
  loadError: string | null;
}

export const useMotionStore = defineStore('motion', {
  state: (): MotionState => ({
    fileName: null,
    anim: null,
    lafan: null,
    unitScale: 0.01,
    skeletonSizeUnits: 0,
    loadError: null,
  }),
  getters: {
    hasMotion: (s) => s.anim !== null,
    frameCount: (s) => s.anim?.frameCount ?? 0,
    fps: (s) => (s.anim && s.anim.frameTime > 0 ? 1 / s.anim.frameTime : 30),
    duration(): number {
      return this.frameCount / this.fps;
    },
    jointNames: (s) => s.anim?.joints.map((j) => j.name) ?? [],
    /** estimated standing height in meters */
    estHeightMeters: (s) => s.skeletonSizeUnits * s.unitScale,
  },
  actions: {
    loadBvhText(text: string, fileName: string) {
      try {
        const anim = parseBvh(text);
        const size = estimateSkeletonSize(anim);
        // Heuristic: skeletons taller than 10 units are in cm (LAFAN1), else meters.
        const unitScale = size > 10 ? 0.01 : 1.0;
        const lafan = bvhToLafan1Frames(anim, unitScale);
        this.anim = markRaw(anim);
        this.lafan = markRaw(lafan);
        this.unitScale = unitScale;
        this.skeletonSizeUnits = size;
        this.fileName = fileName;
        this.loadError = null;
      } catch (err) {
        this.loadError = err instanceof Error ? err.message : String(err);
        throw err;
      }
    },
    clear() {
      this.anim = null;
      this.lafan = null;
      this.fileName = null;
      this.loadError = null;
    },
  },
});
