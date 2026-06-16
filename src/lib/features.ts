/**
 * Runtime feature flags.
 *
 * Quadruped retargeting (Unitree Go2 / A1 + dog mocap samples) is gated so the
 * production site on `main` stays clean until the feature is verified. The robot
 * MJCF/mesh assets and dog BVH samples still ship in the build — only the UI
 * entry points (robot dropdown + sample list) are hidden.
 *
 * Reveal it on any deployment by visiting a URL with `?quadruped=1`
 * (the choice is remembered in localStorage); `?quadruped=0` hides it again.
 * To surface it for everyone, flip `DEFAULT_QUADRUPED` to `true`.
 */

const DEFAULT_QUADRUPED = false;
const STORAGE_KEY = 'rro-feature-quadruped';

/** Look for `name` in the page query string and in the hash-router query. */
function urlParam(name: string): string | null {
  try {
    const search = new URLSearchParams(window.location.search);
    if (search.has(name)) return search.get(name);
    const hash = window.location.hash;
    const qi = hash.indexOf('?');
    if (qi >= 0) {
      const hp = new URLSearchParams(hash.slice(qi + 1));
      if (hp.has(name)) return hp.get(name);
    }
  } catch {
    /* non-browser / SSR */
  }
  return null;
}

function resolveQuadruped(): boolean {
  const v = urlParam('quadruped');
  if (v !== null) {
    const on = v !== '0' && v !== 'false';
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    return on;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === '1';
  } catch {
    /* ignore */
  }
  return DEFAULT_QUADRUPED;
}

/** Whether quadruped retargeting UI (Go2 / A1 + dog samples) is surfaced. */
export const QUADRUPED_ENABLED = resolveQuadruped();
