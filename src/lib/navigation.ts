/** True when the current document was loaded via a browser refresh (F5 / reload). */
export function isPageReload(): boolean {
  if (typeof performance === 'undefined') return false;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === 'reload';
}
