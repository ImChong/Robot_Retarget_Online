/**
 * Everything the BVH viewer's 3D view needs, behind one dynamic import so the
 * landing page renders (header, side panel, empty state) without waiting for
 * three.js to download and evaluate.
 */
import { Vector3 } from 'three';

export { SceneManager } from './SceneManager';
export { buildSkeletonView } from './skeletonView';
export { followOrbitCamera } from './sceneAlignment';

export function createVector3(): Vector3 {
  return new Vector3();
}
