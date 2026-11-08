/**
 * Small picking helpers shared by the robot and skeleton views.
 */

import * as THREE from 'three';

/** `object` and every ancestor are visible (three's Raycaster ignores `visible`). */
export function isShown(object: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Nearest visible mesh hit under `root`, or null. */
export function firstVisibleHit(raycaster: THREE.Raycaster, root: THREE.Object3D): THREE.Intersection | null {
  root.updateMatrixWorld(true);
  for (const hit of raycaster.intersectObject(root, true)) {
    if ((hit.object as THREE.Mesh).isMesh && isShown(hit.object)) return hit;
  }
  return null;
}

/** A pickable point: what it stands for and where it is in the world. */
export interface ScreenAnchor<T> {
  id: T;
  world: THREE.Vector3;
}

const projected = new THREE.Vector3();

/**
 * The anchor drawn closest to a canvas pixel, if one lies within `radiusPx`.
 * For bodies without visual geometry and for fingertip taps that land just
 * beside a thin bone. Anchors behind the camera are ignored.
 */
export function nearestScreenAnchor<T>(
  anchors: Iterable<ScreenAnchor<T>>,
  camera: THREE.Camera,
  width: number,
  height: number,
  x: number,
  y: number,
  radiusPx: number,
): T | null {
  let best: T | null = null;
  let bestD = radiusPx;
  for (const anchor of anchors) {
    projected.copy(anchor.world).project(camera);
    if (projected.z < -1 || projected.z > 1) continue;
    const px = ((projected.x + 1) / 2) * width;
    const py = ((1 - projected.y) / 2) * height;
    const d = Math.hypot(px - x, py - y);
    if (d <= bestD) {
      bestD = d;
      best = anchor.id;
    }
  }
  return best;
}
