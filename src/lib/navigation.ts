/** True when the current document was loaded via a browser refresh (F5 / reload). */
export function isPageReload(): boolean {
  if (typeof performance === 'undefined') return false;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === 'reload';
}

export type WorkflowRouteName = 'bvh' | 'config' | 'preview';

/** Strategy B: redirect blocked workflow steps when prerequisites are missing. */
export function workflowRouteRedirect(
  toName: WorkflowRouteName | string | symbol | null | undefined,
  hasMotion: boolean,
  hasRetargetHistory: boolean,
): { name: WorkflowRouteName } | undefined {
  if (toName === 'config' && !hasMotion) {
    return { name: 'bvh' };
  }
  if (toName === 'preview' && !hasRetargetHistory) {
    return hasMotion ? { name: 'config' } : { name: 'bvh' };
  }
  return undefined;
}
