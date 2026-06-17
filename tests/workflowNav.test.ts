import { describe, expect, it } from 'vitest';
import { workflowRouteRedirect } from '@/lib/navigation';

describe('workflowRouteRedirect', () => {
  it('blocks config without motion', () => {
    expect(workflowRouteRedirect('config', false, false)).toEqual({ name: 'bvh' });
  });

  it('allows config when motion is loaded', () => {
    expect(workflowRouteRedirect('config', true, false)).toBeUndefined();
  });

  it('blocks preview without motion or history', () => {
    expect(workflowRouteRedirect('preview', false, false)).toEqual({ name: 'bvh' });
  });

  it('blocks preview with motion but no retarget history', () => {
    expect(workflowRouteRedirect('preview', true, false)).toEqual({ name: 'config' });
  });

  it('allows preview when retarget history exists', () => {
    expect(workflowRouteRedirect('preview', true, true)).toBeUndefined();
  });

  it('ignores unrelated routes', () => {
    expect(workflowRouteRedirect('bvh', false, false)).toBeUndefined();
  });
});
