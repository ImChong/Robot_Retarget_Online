/**
 * Runtime feature flags.
 *
 * Quadruped retargeting (Unitree Go2 / A1 + dog mocap samples) shipped hidden
 * behind this flag until it was verified (`tests/quadruped.test.ts` covers
 * walk / run / idle on both robots; `scripts/e2e_quadruped.mjs` drives the full
 * browser flow). It is now surfaced by default; the flag stays as a per-visit
 * kill switch: open any deployment with `?quadruped=0` to hide the UI entry
 * points (robot dropdown + sample list) for that page load.
 *
 * The flag is evaluated once per page load from the URL only (no localStorage
 * persistence — otherwise a one-time visit would pin the choice forever).
 * To hide it for everyone again, flip `DEFAULT_QUADRUPED` to `false`.
 */

const DEFAULT_QUADRUPED = true;

/** Parse `name` from a query string and from an optional hash-router suffix. */
export function readUrlParam(search: string, hash: string, name: string): string | null {
  const top = new URLSearchParams(search);
  if (top.has(name)) return top.get(name);
  const qi = hash.indexOf('?');
  if (qi >= 0) {
    const hp = new URLSearchParams(hash.slice(qi + 1));
    if (hp.has(name)) return hp.get(name);
  }
  return null;
}

export function resolveQuadrupedFromUrl(search: string, hash: string): boolean {
  const v = readUrlParam(search, hash, 'quadruped');
  if (v === null) return DEFAULT_QUADRUPED;
  return v !== '0' && v !== 'false';
}

/** Look for `name` in the page query string and in the hash-router query. */
function urlParam(name: string): string | null {
  try {
    return readUrlParam(window.location.search, window.location.hash, name);
  } catch {
    /* non-browser / SSR */
    return null;
  }
}

function resolveQuadruped(): boolean {
  try {
    return resolveQuadrupedFromUrl(window.location.search, window.location.hash);
  } catch {
    return DEFAULT_QUADRUPED;
  }
}

/** Whether quadruped retargeting UI (Go2 / A1 + dog samples) is surfaced. */
export const QUADRUPED_ENABLED = resolveQuadruped();
