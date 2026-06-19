/**
 * True on phones/tablets where touch is the primary pointer (iOS Safari, etc.).
 * Also matches iOS WebKit when it reports a fine pointer but hover is unavailable.
 */
export function isCoarsePointerDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(pointer: coarse)').matches) return true;
  // iPad / iPhone can report (pointer: fine) while still being touch-first.
  return window.matchMedia('(hover: none)').matches && navigator.maxTouchPoints > 0;
}
