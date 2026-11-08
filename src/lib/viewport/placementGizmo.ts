/**
 * The floor gizmo under the figure being arranged (shapes adapted from Robot
 * Description Gallery Online's compare stage): a ring that turns the figure,
 * with a pip at its heading, and an arrow along each floor axis that slides it
 * along that axis only. The arrows keep the usual X red / Y green and do not
 * turn with the figure; the ring does.
 *
 * Every handle is grabbed through an invisible pad wider than what is drawn:
 * seen at a glancing angle a mark lying on the floor is a few pixels tall.
 */

import * as THREE from 'three';

export type GizmoHandle = 'turn' | 'x' | 'y';

const RING_COLOR = 0x3b82f6;
const X_COLOR = 0xe5534b;
const Y_COLOR = 0x2ea043;
const RING_OPACITY = 0.85;
const ARROW_OPACITY = 0.9;
/** Floor height the gizmo is drawn at: a hair above the floor (z = 0). */
const LIFT = 0.003;

function axisArrow(inner: number, outer: number): THREE.ShapeGeometry {
  const span = outer - inner;
  const head = span * 0.42;
  const shaft = span * 0.085;
  const barb = span * 0.2;
  const arm = (way: number) => {
    const shape = new THREE.Shape();
    const from = way * inner;
    const to = way * outer;
    const neck = way * (outer - head);
    shape.moveTo(from, -shaft);
    shape.lineTo(neck, -shaft);
    shape.lineTo(neck, -barb);
    shape.lineTo(to, 0);
    shape.lineTo(neck, barb);
    shape.lineTo(neck, shaft);
    shape.lineTo(from, shaft);
    shape.closePath();
    return shape;
  };
  return new THREE.ShapeGeometry([arm(1), arm(-1)]);
}

function axisPad(inner: number, outer: number, halfWidth: number): THREE.ShapeGeometry {
  const bar = (way: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(way * inner, -halfWidth);
    shape.lineTo(way * outer, -halfWidth);
    shape.lineTo(way * outer, halfWidth);
    shape.lineTo(way * inner, halfWidth);
    shape.closePath();
    return shape;
  };
  return new THREE.ShapeGeometry([bar(1), bar(-1)]);
}

export interface PlacementGizmo {
  root: THREE.Group;
  /** Put the gizmo under a figure's mark and turn the ring to its heading. */
  place(x: number, y: number, yaw: number): void;
  /** The handle a ray is over, if any, with where it met it. */
  handleAt(raycaster: THREE.Raycaster): { handle: GizmoHandle; point: THREE.Vector3; distance: number } | null;
  /** Light one handle up (null: none). Returns whether anything changed. */
  hover(handle: GizmoHandle | null): boolean;
  dispose(): void;
}

export function buildPlacementGizmo(radius: number): PlacementGizmo {
  const root = new THREE.Group();
  root.name = 'placement-gizmo';
  const dial = new THREE.Group();
  root.add(dial);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const paint = (color: number, opacity: number) => {
    const m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    materials.push(m);
    return m;
  };
  const padMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  materials.push(padMat);
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    geometries.push(geo);
    return new THREE.Mesh(geo, mat);
  };

  const band = mesh(new THREE.RingGeometry(radius * 0.9, radius, 64), paint(RING_COLOR, RING_OPACITY));
  band.renderOrder = 3;
  dial.add(band);
  // The heading, as a thickening of the band: the mark on a dial.
  const pip = mesh(new THREE.RingGeometry(radius * 0.84, radius * 1.07, 8, 1, -0.13, 0.26), paint(RING_COLOR, 1));
  pip.renderOrder = 3;
  dial.add(pip);

  const handles: Record<GizmoHandle, { mesh: THREE.Mesh; base: number }> = {
    turn: { mesh: band, base: RING_OPACITY },
  } as Record<GizmoHandle, { mesh: THREE.Mesh; base: number }>;
  const pads: THREE.Mesh[] = [];

  const reach = Math.max(radius * 0.22, 0.04);
  const inner = radius + reach * 0.9;
  const outer = inner + Math.max(radius * 0.42, reach * 2);
  for (const [axis, color, turn] of [
    ['x', X_COLOR, 0],
    ['y', Y_COLOR, Math.PI / 2],
  ] as const) {
    const arrow = mesh(axisArrow(inner, outer), paint(color, ARROW_OPACITY));
    arrow.rotation.z = turn;
    arrow.position.z = 0.001; // over the ring where the two cross
    arrow.renderOrder = 4;
    root.add(arrow);
    handles[axis] = { mesh: arrow, base: ARROW_OPACITY };
    const pad = mesh(axisPad(inner, outer, reach * 0.9), padMat);
    pad.rotation.z = turn;
    pad.position.z = 0.002;
    pad.userData.handle = axis;
    root.add(pad);
    pads.push(pad);
  }
  // Last, so the arrows that cross it are the nearer pick where both are hit.
  const turnPad = mesh(new THREE.RingGeometry(Math.max(radius - reach, 0.001), radius + reach, 32), padMat);
  turnPad.userData.handle = 'turn';
  dial.add(turnPad);
  pads.push(turnPad);

  function place(x: number, y: number, yaw: number) {
    root.position.set(x, y, LIFT);
    dial.rotation.z = yaw;
  }

  function handleAt(raycaster: THREE.Raycaster) {
    if (!root.parent) return null;
    root.updateMatrixWorld(true);
    const hit = raycaster.intersectObjects(pads, false)[0];
    return hit ? { handle: hit.object.userData.handle as GizmoHandle, point: hit.point, distance: hit.distance } : null;
  }

  let hovered: GizmoHandle | null = null;
  function hover(handle: GizmoHandle | null): boolean {
    if (handle === hovered) return false;
    for (const which of [hovered, handle]) {
      const h = which && handles[which];
      if (h) (h.mesh.material as THREE.MeshBasicMaterial).opacity = which === handle ? 1 : h.base;
    }
    hovered = handle;
    return true;
  }

  function dispose() {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    root.removeFromParent();
  }

  return { root, place, handleAt, hover, dispose };
}
