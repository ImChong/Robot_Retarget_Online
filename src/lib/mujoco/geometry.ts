/**
 * Geometry queries on a compiled robot at its current kinematics (call
 * `mj_kinematics` first): the lowest / highest point of all its geometry.
 * Used to put the floor under imported robots (`retarget/autoConfig.ts`) and
 * to measure ground penetration / floating (`gallery/compat.ts`).
 */

import type { RobotModel } from './runtime';

const GEOM_PLANE = 0;
const GEOM_SPHERE = 2;
const GEOM_CAPSULE = 3;
const GEOM_ELLIPSOID = 4;
const GEOM_CYLINDER = 5;
const GEOM_BOX = 6;
const GEOM_MESH = 7;

/**
 * Lowest (sign = 1) or highest (sign = -1, returned negated back) point of all
 * geometry at the current kinematics: exact for meshes (every vertex) and
 * primitives, with a bounding-sphere prefilter so only geoms near the extreme
 * are walked vertex by vertex. `bodies` limits it to the geometry of those bodies.
 */
export function extremeZ(robot: RobotModel, sign: 1 | -1, bodies?: Set<number>): number {
  return extremeAlong(robot, 2, sign, bodies);
}

/** `extremeZ` along any world axis (0 = x, 1 = y, 2 = z). */
export function extremeAlong(robot: RobotModel, axis: 0 | 1 | 2, sign: 1 | -1, bodies?: Set<number>): number {
  const { model, data } = robot;
  const ngeom = model.ngeom as number;
  const type = model.geom_type as Int32Array;
  const body = model.geom_bodyid as Int32Array;
  const size = model.geom_size as Float64Array;
  const rbound = model.geom_rbound as Float64Array;
  const dataid = model.geom_dataid as Int32Array;
  const vert = model.mesh_vert as Float32Array;
  const vertadr = model.mesh_vertadr as Int32Array;
  const vertnum = model.mesh_vertnum as Int32Array;
  const xpos = data.geom_xpos as Float64Array;
  const xmat = data.geom_xmat as Float64Array;
  let best = Infinity; // in "sign" space: lowest of sign·z
  for (let g = 0; g < ngeom; g++) {
    if (body[g] === 0 || type[g] === GEOM_PLANE || (bodies && !bodies.has(body[g]))) continue;
    const pz = sign * xpos[g * 3 + axis];
    if (pz - rbound[g] >= best) continue;
    const r6 = sign * xmat[g * 9 + 3 * axis];
    const r7 = sign * xmat[g * 9 + 3 * axis + 1];
    const r8 = sign * xmat[g * 9 + 3 * axis + 2];
    const sx = size[g * 3];
    const sy = size[g * 3 + 1];
    const sz = size[g * 3 + 2];
    let z: number;
    switch (type[g]) {
      case GEOM_SPHERE:
        z = pz - sx;
        break;
      case GEOM_CAPSULE:
        z = pz - Math.abs(r8) * sy - sx;
        break;
      case GEOM_CYLINDER:
        z = pz - Math.abs(r8) * sy - sx * Math.sqrt(Math.max(0, 1 - r8 * r8));
        break;
      case GEOM_BOX:
        z = pz - (Math.abs(r6) * sx + Math.abs(r7) * sy + Math.abs(r8) * sz);
        break;
      case GEOM_ELLIPSOID:
        z = pz - Math.hypot(r6 * sx, r7 * sy, r8 * sz);
        break;
      case GEOM_MESH: {
        const m = dataid[g];
        if (m < 0) {
          z = pz - rbound[g];
          break;
        }
        z = Infinity;
        const a = vertadr[m] * 3;
        const n = vertnum[m];
        for (let i = 0; i < n; i++) {
          const o = a + i * 3;
          const v = pz + r6 * vert[o] + r7 * vert[o + 1] + r8 * vert[o + 2];
          if (v < z) z = v;
        }
        break;
      }
      default:
        z = pz - rbound[g];
    }
    if (z < best) best = z;
  }
  return Number.isFinite(best) ? sign * best : 0;
}
