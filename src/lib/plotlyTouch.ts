/** True on phones/tablets where touch is the primary pointer (iOS Safari, etc.). */
export function isCoarsePointerDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
