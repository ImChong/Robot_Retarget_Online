/**
 * Arranging the Retarget Config stage: the robot and the BVH skeleton can each
 * be slid across the floor and turned about the vertical, so they can stand
 * apart (or side by side) instead of overlapping where their keypoints are
 * hard to click. Adapted from the compare stage of Robot Description Gallery
 * Online (web/js/compare-stage.js): a drag is read against a level plane at
 * the height it took hold, moves snap to a grid and turns to 15°, and there is
 * no height — both figures stay at the viewport anchor's height.
 *
 * Display only: see `FloorPlace` in ./sceneAlignment.
 */

import * as THREE from 'three';
import type { FloorPlace } from './sceneAlignment';

export type StageMember = 'robot' | 'human';

/** Where a move lands when snapping: 5 cm, a fifth of a floor checker cell. */
export const MOVE_SNAP = 0.05;
/** Where a turn lands when snapping: twelve positions around the circle. */
export const YAW_SNAP = Math.PI / 12;
/**
 * How far from the origin a figure may be placed. A drag on a level plane seen
 * nearly edge-on maps the last pixels before the horizon onto kilometres; this
 * keeps a slip somewhere the figure can still be seen and dragged back.
 */
export const PLACE_REACH = 6;

/** Round to the nearest multiple of `step`, or leave alone when not snapping. */
export function snapped(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/** Degrees, wrapped to (-180, 180] and rounded to 0.1 — how a heading reads. */
export function yawDegrees(yaw: number): number {
  const wrapped = ((((yaw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const deg = Math.round(wrapped * (180 / Math.PI) * 10) / 10;
  return deg === -180 ? 180 : deg;
}

/** Keep a placement on the floor that can be seen. */
export function clampPlace(place: FloorPlace): FloorPlace {
  const hold = (v: number) => Math.min(Math.max(v, -PLACE_REACH), PLACE_REACH);
  return { x: hold(place.x), y: hold(place.y), yaw: place.yaw };
}

export function samePlace(a: FloorPlace, b: FloorPlace): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.yaw - b.yaw) < 1e-9;
}

const levelPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const planeHit = new THREE.Vector3();

/**
 * Where a ray meets the level (Z-up) plane at `height`, or null above the
 * horizon. A drag is read at the height it took hold, not on the floor: a ray
 * that met the figure there certainly meets a plane through the same point,
 * where one aimed at a humanoid's chest from a low camera may never reach the
 * floor at all.
 */
export function floorPoint(ray: THREE.Ray, height: number): { x: number; y: number } | null {
  levelPlane.constant = -height;
  const at = ray.intersectPlane(levelPlane, planeHit);
  return at ? { x: at.x, y: at.y } : null;
}

/** What a drag took hold of, and where, so the figure does not jump under the pointer. */
export interface PlacementGrab {
  member: StageMember;
  /** null: the figure itself (slides freely; Shift turns). Otherwise a gizmo handle. */
  handle: 'turn' | 'x' | 'y' | null;
  height: number;
  /** place − grab point, on the floor. */
  offset: { x: number; y: number };
  /** Bearing of the grab point around the figure's mark, for turning. */
  bearing: number;
  start: FloorPlace;
}

export function startGrab(
  member: StageMember,
  handle: PlacementGrab['handle'],
  place: FloorPlace,
  from: { x: number; y: number },
  height: number,
): PlacementGrab {
  return {
    member,
    handle,
    height,
    offset: { x: place.x - from.x, y: place.y - from.y },
    bearing: Math.atan2(from.y - place.y, from.x - place.x),
    start: { ...place },
  };
}

/**
 * The placement a drag has reached with the pointer over `to` (on the grab's
 * plane). An arrow moves along its one axis only; the ring — or the figure with
 * `turn` held — turns it about its mark, which does not move.
 */
export function dragPlace(
  grab: PlacementGrab,
  current: FloorPlace,
  to: { x: number; y: number },
  turn: boolean,
  snapping: boolean,
): FloorPlace {
  if (grab.handle === 'turn' || (grab.handle === null && turn)) {
    const now = Math.atan2(to.y - current.y, to.x - current.x);
    return { ...current, yaw: snapped(grab.start.yaw + now - grab.bearing, snapping ? YAW_SNAP : 0) };
  }
  const step = snapping ? MOVE_SNAP : 0;
  const x = snapped(to.x + grab.offset.x, step);
  const y = snapped(to.y + grab.offset.y, step);
  if (grab.handle === 'x') return clampPlace({ ...current, x });
  if (grab.handle === 'y') return clampPlace({ ...current, y });
  return clampPlace({ ...current, x, y });
}
