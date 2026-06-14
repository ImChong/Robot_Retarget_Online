import { defineStore } from 'pinia';
import { markRaw } from 'vue';
import { parseBvh, estimateSkeletonSize, type BvhAnim } from '@/lib/bvh/parse';
import { bvhToLafan1Frames, type Lafan1Motion } from '@/lib/bvh/lafan1';
import { looksLikeMotionJson, parseMotionJson } from '@/lib/motion/motionJson';

export type MotionFormat = 'bvh' | 'json';

export interface MotionState {
  fileName: string | null;
  /** Input format the current motion was loaded from. */
  sourceFormat: MotionFormat | null;
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
    sourceFormat: null,
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
    /**
     * Load a motion file, auto-detecting the format from its name/content.
     * Supports BVH (LAFAN1 convention) and Retarget Motion JSON; both resolve to
     * the same `BvhAnim` + human-frame representation downstream.
     */
    loadMotion(text: string, fileName: string) {
      try {
        let anim: BvhAnim;
        let unitScale: number;
        let format: MotionFormat;
        if (looksLikeMotionJson(text, fileName)) {
          const parsed = parseMotionJson(text);
          anim = parsed.anim;
          unitScale = parsed.unitScale;
          format = 'json';
        } else {
          anim = parseBvh(text);
          // Heuristic: skeletons taller than 10 units are in cm (LAFAN1), else meters.
          unitScale = estimateSkeletonSize(anim) > 10 ? 0.01 : 1.0;
          format = 'bvh';
        }
        const lafan = bvhToLafan1Frames(anim, unitScale);
        this.anim = markRaw(anim);
        this.lafan = markRaw(lafan);
        this.unitScale = unitScale;
        this.skeletonSizeUnits = estimateSkeletonSize(anim);
        this.fileName = fileName;
        this.sourceFormat = format;
        this.loadError = null;
      } catch (err) {
        this.loadError = err instanceof Error ? err.message : String(err);
        throw err;
      }
    },
    /** Back-compat alias; prefer `loadMotion` (auto-detects format). */
    loadBvhText(text: string, fileName: string) {
      this.loadMotion(text, fileName);
    },
    clear() {
      this.anim = null;
      this.lafan = null;
      this.fileName = null;
      this.sourceFormat = null;
      this.loadError = null;
    },
  },
});
