import { defineStore } from 'pinia';
import { markRaw } from 'vue';
import {
  clonePostProcessConfig,
  createRawPassthroughConfig,
  DEFAULT_POSTPROCESS_CONFIG,
  runPostProcess,
  type JointLimitInfo,
  type PostProcessConfig,
  type PostProcessOutput,
} from '@/lib/postprocess';
import type { RetargetHistoryEntry } from '@/lib/retarget/types';

const MAX_UNDO_HISTORY = 30;

export interface PostProcessSession {
  config: PostProcessConfig;
  undoStack: PostProcessConfig[];
  jointLimits: JointLimitInfo[];
  output: PostProcessOutput;
}

interface PostProcessState {
  sessions: Record<string, PostProcessSession>;
}

export const usePostProcessStore = defineStore('postprocess', {
  state: (): PostProcessState => ({
    sessions: {},
  }),
  actions: {
    getSession(historyId: string | null | undefined): PostProcessSession | null {
      if (!historyId) return null;
      return this.sessions[historyId] ?? null;
    },

    ensureSession(
      entry: RetargetHistoryEntry,
      jointLimits: readonly JointLimitInfo[] = [],
    ): PostProcessSession {
      const existing = this.sessions[entry.id];
      if (!existing) {
        const config = clonePostProcessConfig(DEFAULT_POSTPROCESS_CONFIG);
        const limitsCopy = [...jointLimits];
        const output = markRaw(runPostProcess(entry.result, config, limitsCopy));
        const session: PostProcessSession = {
          config,
          undoStack: [],
          jointLimits: limitsCopy,
          output,
        };
        this.sessions[entry.id] = session;
        return session;
      }

      if (jointLimits.length > 0 && existing.jointLimits.length === 0) {
        existing.jointLimits = [...jointLimits];
        existing.output = markRaw(
          runPostProcess(entry.result, existing.config, existing.jointLimits),
        );
      }
      return existing;
    },

    updateConfig(
      entry: RetargetHistoryEntry,
      updater: (draft: PostProcessConfig) => void,
      jointLimits?: readonly JointLimitInfo[],
    ): PostProcessSession {
      const session = this.ensureSession(entry, jointLimits);
      const prev = clonePostProcessConfig(session.config);
      const next = clonePostProcessConfig(session.config);
      updater(next);
      session.undoStack.push(prev);
      if (session.undoStack.length > MAX_UNDO_HISTORY) {
        session.undoStack.shift();
      }
      session.config = next;
      session.output = markRaw(runPostProcess(entry.result, next, session.jointLimits));
      return session;
    },

    undo(entry: RetargetHistoryEntry): PostProcessSession | null {
      const session = this.sessions[entry.id];
      if (!session || session.undoStack.length === 0) return session ?? null;
      const prev = session.undoStack.pop()!;
      session.config = prev;
      session.output = markRaw(runPostProcess(entry.result, prev, session.jointLimits));
      return session;
    },

    resetDefaults(entry: RetargetHistoryEntry): PostProcessSession {
      const session = this.ensureSession(entry);
      const prev = clonePostProcessConfig(session.config);
      session.undoStack.push(prev);
      if (session.undoStack.length > MAX_UNDO_HISTORY) session.undoStack.shift();
      const next = clonePostProcessConfig(DEFAULT_POSTPROCESS_CONFIG);
      session.config = next;
      session.output = markRaw(runPostProcess(entry.result, next, session.jointLimits));
      return session;
    },

    resetToRaw(entry: RetargetHistoryEntry): PostProcessSession {
      const session = this.ensureSession(entry);
      const prev = clonePostProcessConfig(session.config);
      session.undoStack.push(prev);
      if (session.undoStack.length > MAX_UNDO_HISTORY) session.undoStack.shift();
      const next = createRawPassthroughConfig(session.config);
      session.config = next;
      session.output = markRaw(runPostProcess(entry.result, next, session.jointLimits));
      return session;
    },
  },
});
