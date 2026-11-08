/**
 * Vertex-clustering decimation of binary STL meshes.
 *
 * Some gallery robots ship CAD-resolution meshes (Agibot X2 Ultra: 1.6 M
 * triangles in 40 STL files) that make MuJoCo's WASM compiler run out of its
 * 2 GB heap. Retargeting is pure kinematics and the viewport only needs the
 * silhouette, so meshes over budget are simplified before compiling: vertices
 * are snapped to a uniform grid (one representative per occupied cell, the
 * mean of its vertices) and triangles that collapse are dropped. The grid is
 * the coarsest that still keeps at least the requested share of triangles'
 * worth of detail — found by bisection on the cell size.
 */

/** Triangle count of a binary STL (header field). */
export function stlTriangleCount(bytes: Uint8Array): number {
  if (bytes.byteLength < 84) return 0;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
}

function readTriangles(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = stlTriangleCount(bytes);
  const verts = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 9; k++) verts[t * 9 + k] = view.getFloat32(o + k * 4, true);
  }
  return verts;
}

/** Cluster at cell size `h`; returns the kept triangles as cell triples plus cell means. */
function cluster(verts: Float32Array, min: number[], h: number) {
  const cells = new Map<number, number>();
  const sums: number[] = [];
  const ids = new Int32Array(verts.length / 3);
  const nx = 2 ** 16; // cell indices stay below 2^13 per axis: keys are exact integers
  for (let v = 0; v < ids.length; v++) {
    const ix = Math.floor((verts[v * 3] - min[0]) / h);
    const iy = Math.floor((verts[v * 3 + 1] - min[1]) / h);
    const iz = Math.floor((verts[v * 3 + 2] - min[2]) / h);
    const key = (ix * nx + iy) * nx + iz;
    let id = cells.get(key);
    if (id === undefined) {
      id = cells.size;
      cells.set(key, id);
      sums.push(0, 0, 0, 0);
    }
    sums[id * 4] += verts[v * 3];
    sums[id * 4 + 1] += verts[v * 3 + 1];
    sums[id * 4 + 2] += verts[v * 3 + 2];
    sums[id * 4 + 3]++;
    ids[v] = id;
  }
  const seen = new Set<string>();
  const tris: number[] = [];
  for (let t = 0; t < ids.length / 3; t++) {
    const a = ids[t * 3];
    const b = ids[t * 3 + 1];
    const c = ids[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    tris.push(a, b, c);
  }
  return { tris, sums };
}

/**
 * Simplify a binary STL to at most `maxTriangles` (returned unchanged when it
 * is already within budget).
 */
export function decimateStl(bytes: Uint8Array, maxTriangles: number): Uint8Array {
  const n = stlTriangleCount(bytes);
  if (n <= maxTriangles) return bytes;
  const verts = readTriangles(bytes);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < verts.length; v += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], verts[v + k]);
      max[k] = Math.max(max[k], verts[v + k]);
    }
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  // Bisect the cell size: smallest cell (most detail) whose result fits the budget.
  let lo = extent / 4096;
  let hi = extent / 4;
  let best = cluster(verts, min, hi);
  for (let i = 0; i < 14; i++) {
    const mid = Math.sqrt(lo * hi);
    const res = cluster(verts, min, mid);
    if (res.tris.length / 3 <= maxTriangles) {
      best = res;
      hi = mid;
    } else {
      lo = mid;
    }
  }

  const count = best.tris.length / 3;
  const out = new Uint8Array(84 + count * 50);
  const view = new DataView(out.buffer);
  view.setUint32(80, count, true);
  const p = (id: number, k: number) => best.sums[id * 4 + k] / best.sums[id * 4 + 3];
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [best.tris[t * 3], best.tris[t * 3 + 1], best.tris[t * 3 + 2]];
    const A = [p(a, 0), p(a, 1), p(a, 2)];
    const B = [p(b, 0), p(b, 1), p(b, 2)];
    const C = [p(c, 0), p(c, 1), p(c, 2)];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
    let o = 84 + t * 50;
    for (const x of [nrm[0] / len, nrm[1] / len, nrm[2] / len, ...A, ...B, ...C]) {
      view.setFloat32(o, x, true);
      o += 4;
    }
  }
  return out;
}

/**
 * Per-file triangle budgets so the robot's meshes total at most `total`
 * triangles: files over their proportional share are cut to it, small files
 * are left alone (never below `floor`).
 */
export function triangleBudgets(
  counts: Map<string, number>,
  total: number,
  floor = 4000,
  /** Cap for any single file (MuJoCo's per-mesh work grows faster than linearly). */
  perFile = Infinity,
): Map<string, number> {
  const sum = [...counts.values()].reduce((a, b) => a + Math.min(b, perFile), 0);
  const budgets = new Map<string, number>();
  if (sum <= total) {
    for (const [k, v] of counts) budgets.set(k, Math.min(v, perFile));
    return budgets;
  }
  // Water-filling: a common cap c with Σ min(n_i, c) = total.
  const sorted = [...counts.values()].sort((a, b) => a - b);
  let remaining = total;
  let cap = 0;
  for (let i = 0; i < sorted.length; i++) {
    const share = remaining / (sorted.length - i);
    if (sorted[i] <= share) {
      remaining -= sorted[i];
    } else {
      cap = share;
      break;
    }
  }
  for (const [k, v] of counts) budgets.set(k, Math.max(floor, Math.min(v, perFile, Math.floor(cap))));
  return budgets;
}
