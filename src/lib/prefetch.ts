/**
 * Warm the next workflow step while the user is still on the current one, so
 * the step they are about to open does not start from a cold network: the
 * config page needs the 11 MB MuJoCo module, the preview page needs Plotly.
 *
 * Downloads only, at idle time, once per session, and never on a Save-Data or
 * 2G connection. Nothing is instantiated here (MuJoCo's heap is created by the
 * robot loader as before).
 */
import { getRobotManifest } from '@/lib/mujoco/runtime';
import { loadPlotly } from '@/composables/usePlotlyChart';

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

function onConstrainedNetwork(): boolean {
  const conn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return !!conn && (conn.saveData === true || /2g$/.test(conn.effectiveType ?? ''));
}

function whenIdle(fn: () => void) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 500);
}

const started = new Set<string>();

function prefetchOnce(key: string, load: () => Promise<unknown>) {
  if (started.has(key) || onConstrainedNetwork()) return;
  started.add(key);
  whenIdle(() => {
    load().catch(() => started.delete(key)); // a failed warm-up is retried next time
  });
}

/** BVH page with no motion yet: three.js + the viewport code, so loading one starts drawing at once. */
export function prefetchViewport() {
  prefetchOnce('viewport', () => import('@/lib/viewport/bvhViewport'));
}

/** A motion is loaded on the BVH page: the config page is the next step. */
export function prefetchConfigStep() {
  prefetchOnce('config', () =>
    Promise.all([import('@/views/RetargetConfigView.vue'), import('mujoco-js'), getRobotManifest()]),
  );
}

/** The robot is ready on the config page: the preview page is the next step. */
export function prefetchPreviewStep() {
  prefetchOnce('preview', () =>
    Promise.all([
      import('@/views/RetargetPreviewView.vue'),
      import('@/lib/retarget/runner'),
      loadPlotly(),
    ]),
  );
}
