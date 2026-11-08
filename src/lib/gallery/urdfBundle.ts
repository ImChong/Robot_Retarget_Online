/**
 * Download a gallery URDF + its meshes into a `CustomRobotBundle` that the
 * custom-robot loader compiles with MuJoCo.
 *
 * The URDF is rewritten on the way through:
 *   - every mesh reference (`package://…`, relative, remapped) points at a flat,
 *     uniquely named file under `meshes/`, so MuJoCo needs no package paths and
 *     two upstream files that share a basename cannot collide;
 *   - `<visual>` / `<collision>` elements whose mesh cannot be had (unknown
 *     package, skipped by the gallery, failed download) are dropped, so one
 *     missing file degrades to a partial robot instead of a compile error;
 *   - any upstream `<mujoco>` block (written for upstream's directory layout) is
 *     replaced by one that keeps visuals and fixed-joint links: retargeting
 *     targets such as a quadruped's `FL_foot` are fixed links that MuJoCo's
 *     URDF importer would otherwise fuse into their parent.
 *
 * Before any of that, `normalizeGalleryUrdf` irons out what upstream URDFs do
 * that MuJoCo's importer rejects (see its comments). Collision geometry is
 * dropped there too: the viewport only draws visuals and retargeting is pure
 * kinematics, so collision meshes would only cost downloads.
 */

import { findUrdfRootLink, type CustomRobotBundle } from '@/lib/mujoco/customRobot';
import { convertMeshForMujoco, meshExtension, needsConversion } from './meshConvert';
import { decimateStl, stlTriangleCount, triangleBudgets } from './meshDecimate';
import {
  galleryVariantView,
  urdfVariants,
  type GalleryAssets,
  type GalleryCategory,
  type GalleryRobot,
} from './registry';

export interface GalleryMeshTarget {
  /** `filename` exactly as the URDF writes it. */
  ref: string;
  /** Repository-relative path after `package://` / `mesh_rewrite` resolution. */
  path: string;
  url: string;
}

/**
 * Triangle budget for one robot's STL meshes. MuJoCo's WASM build has a 2 GB
 * heap and needs roughly 1 KB per triangle across its two compile passes, so
 * CAD-resolution robots (X2 Ultra: 1.6 M triangles) are simplified to this
 * total first (`meshDecimate.ts`); every other gallery robot is far below it.
 */
export const GALLERY_TRIANGLE_BUDGET = 600_000;
/** …and per file: Lite3 / X30 "high" ship four 130 k-triangle meshes that still overflow. */
export const GALLERY_TRIANGLES_PER_FILE = 100_000;

export const GALLERY_URDF_COMPILER =
  '<mujoco><compiler angle="radian" autolimits="true" balanceinertia="true" ' +
  'boundmass="0.001" boundinertia="0.000001" discardvisual="false" fusestatic="false" ' +
  'strippath="false"/></mujoco>';

function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function xmlDecode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const MESH_FILENAME_RE = /<mesh\b[^>]*?\bfilename\s*=\s*(["'])(.*?)\1/g;

export function stripXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

const attr = (tag: string, name: string): string | null =>
  tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`))?.[1] ?? null;

/** Open `<link …>` tag that is not self-closing, through its `</link>`. */
const LINK_BLOCK_RE = /<link\b[^>]*?(?<!\/)>[\s\S]*?<\/link>/g;

/**
 * An inertia tensor MuJoCo accepts: positive definite with some margin. Some
 * upstreams ship singular ones (ANYmal C's hatch: every entry 0.001) or values
 * near 1e-27 (B2's sensor links), which abort the whole compile.
 */
function isUsableInertia(t: number[]): boolean {
  const [xx, xy, xz, yy, yz, zz] = t;
  if (t.some((v) => !Number.isFinite(v))) return false;
  const scale = Math.max(Math.abs(xx), Math.abs(yy), Math.abs(zz));
  if (scale < 1e-9) return false;
  const m2 = xx * yy - xy * xy;
  const det = xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
  return xx > 0 && m2 > 1e-9 * scale * scale && det > 1e-9 * scale * scale * scale;
}

/**
 * Make an upstream URDF acceptable to MuJoCo's importer without changing its
 * kinematics:
 *   - comments go (they can hold stale `<link>` / `<mesh>` markup);
 *   - a `world` root link (simulator exports pin the robot to it through a
 *     floating joint) is removed with its joints, so the robot's own base is
 *     the root the loader puts a free joint on;
 *   - `<collision>` elements are dropped from links that have a visual and
 *     promoted to visuals on links that have none, so nothing turns invisible;
 *   - a visual keeps only its first `<material>` (Collada-derived URDFs such as
 *     Go2's list one per sub-mesh, which MuJoCo rejects);
 *   - unusable inertia tensors are replaced by a small diagonal one; masses and
 *     inertias never enter retargeting, which is pure kinematics.
 */
export function normalizeGalleryUrdf(urdfText: string): string {
  let xml = stripXmlComments(urdfText);

  if (/<link\b[^>]*\bname\s*=\s*["']world["']/.test(xml)) {
    xml = xml
      .replace(/<link\b[^>]*\bname\s*=\s*["']world["'][^>]*?(?:\/>|>[\s\S]*?<\/link>)/g, '')
      .replace(/<joint\b[^>]*>(?:(?!<\/joint>)[\s\S])*?<parent\s+link\s*=\s*["']world["'][\s\S]*?<\/joint>/g, '');
  }

  xml = xml.replace(LINK_BLOCK_RE, (link) => {
    const hasVisual = /<visual\b/.test(link);
    return link.replace(/<collision\b([^>]*?)(?:\/>|>([\s\S]*?)<\/collision>)/g, (_, attrs: string, body?: string) =>
      hasVisual || body === undefined ? '' : `<visual${attrs}>${body}</visual>`,
    );
  });

  xml = xml.replace(/<visual\b[^>]*>[\s\S]*?<\/visual>/g, (visual) => {
    let first = true;
    return visual.replace(/<material\b[^>]*\/>|<material\b[^>]*>[\s\S]*?<\/material>/g, (material) => {
      const keep = first;
      first = false;
      return keep ? material : '';
    });
  });

  xml = xml.replace(/<inertia\b[^>]*>/g, (tag) => {
    const keys = ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'];
    const t = keys.map((k) => parseFloat(attr(tag, k) ?? '0'));
    if (isUsableInertia(t)) return tag;
    const d = (v: number) => (Number.isFinite(v) ? Math.max(Math.abs(v), 1e-6) : 1e-6);
    const close = tag.endsWith('/>') ? '/>' : '>';
    return `<inertia ixx="${d(t[0])}" ixy="0" ixz="0" iyy="${d(t[3])}" iyz="0" izz="${d(t[5])}"${close}`;
  });

  return xml;
}

/**
 * Resolve every mesh reference in a gallery URDF to a fetchable URL (same rules
 * as the gallery's own downloader). References that cannot be resolved — an
 * unknown `package://`, an absolute URL, a path the gallery marks as missing —
 * are returned in `dropped`.
 */
export function resolveGalleryMeshes(
  assets: GalleryAssets,
  urdfText: string,
): { targets: GalleryMeshTarget[]; dropped: string[] } {
  const urdfDir = (assets.urdf ?? '').replace(/[^/]*$/, '');
  const packages = assets.packages ?? {};
  const alt = assets.mesh_alt ?? {};
  const skip = new Set(assets.skip_meshes ?? []);
  const seen = new Map<string, GalleryMeshTarget>();
  const dropped = new Set<string>();

  for (const match of stripXmlComments(urdfText).matchAll(MESH_FILENAME_RE)) {
    const ref = xmlDecode(match[2]);
    if (!ref || seen.has(ref) || dropped.has(ref)) continue;
    let path: string | null = null;
    if (ref.startsWith('package://')) {
      const [pkg, ...rest] = ref.slice('package://'.length).split('/');
      const root = packages[pkg];
      if (root !== undefined) path = normalise(`${root}/${rest.join('/')}`);
    } else if (!/^[a-z]+:/i.test(ref)) {
      path = normalise(urdfDir + ref);
    }
    if (path) {
      for (const { from, to } of assets.mesh_rewrite ?? []) path = path.split(from).join(to);
    }
    if (!path || skip.has(path)) {
      dropped.add(ref);
      continue;
    }
    seen.set(ref, { ref, path, url: alt[path] ?? assets.base + path });
  }
  return { targets: [...seen.values()], dropped: [...dropped] };
}

/** Flat, unique file name a mesh is mounted at (Collada is re-encoded as STL). */
export function localMeshPath(target: GalleryMeshTarget, index: number): string {
  const file = target.path.split('/').pop() ?? 'mesh';
  const stem = file.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_.-]+/g, '_');
  const ext = meshExtension(target.path);
  return `meshes/${index}_${stem}.${needsConversion(target.path) ? 'stl' : ext}`;
}

/**
 * Rewrite a gallery URDF for MuJoCo: point mesh references at `localRefs`,
 * drop geometry whose mesh is not in it, and install `GALLERY_URDF_COMPILER`.
 */
export function prepareGalleryUrdf(urdfText: string, localRefs: Map<string, string>): string {
  let xml = stripXmlComments(urdfText);
  xml = xml.replace(/[ \t]*<(visual|collision)\b[^>]*>[\s\S]*?<\/\1>[ \t]*\n?/g, (element) => {
    for (const m of element.matchAll(MESH_FILENAME_RE)) {
      if (!localRefs.has(xmlDecode(m[2]))) return '';
    }
    return element;
  });
  xml = xml.replace(MESH_FILENAME_RE, (whole, quote: string, ref: string) => {
    const local = localRefs.get(xmlDecode(ref));
    return local ? whole.replace(`${quote}${ref}${quote}`, `${quote}${local}${quote}`) : whole;
  });
  xml = xml.replace(/<mujoco\b[^>]*\/>|<mujoco\b[^>]*>[\s\S]*?<\/mujoco>/g, '');
  const robotOpen = xml.match(/<robot\b[^>]*>/);
  if (!robotOpen) throw new Error('Gallery URDF has no <robot> element.');
  return xml.replace(robotOpen[0], `${robotOpen[0]}\n  ${GALLERY_URDF_COMPILER}`);
}

/** What a gallery download found, for the compatibility matrix (`compat.ts`). */
export interface GalleryFetchStats {
  urdfUrl: string;
  /** Upstream URDF as downloaded, before any normalisation. */
  rawUrdf: string;
  /** Mesh files the URDF references that resolve to a URL. */
  meshTargets: number;
  meshFetched: number;
  /** `url: reason` for every mesh that could not be downloaded or converted. */
  meshFailed: string[];
  /** References with no source (unknown `package://`, absolute URL, `skip_meshes`). */
  meshDropped: string[];
  /** Files re-encoded for MuJoCo (Collada, ASCII STL). */
  meshConverted: number;
  meshBytes: number;
  /** STL triangles before / after simplification, and how many files were simplified. */
  trianglesIn: number;
  trianglesOut: number;
  meshDecimated: number;
}

// ---------------- leg tips ----------------

type Mat3 = [number, number, number, number, number, number, number, number, number];

/** URDF `rpy` (fixed-axis roll, pitch, yaw) → row-major rotation. */
function rpyMatrix(r: number, p: number, y: number): Mat3 {
  const [cr, sr, cp, sp, cy, sy] = [Math.cos(r), Math.sin(r), Math.cos(p), Math.sin(p), Math.cos(y), Math.sin(y)];
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr,
    -sp, cp * sr, cp * cr,
  ];
}

const nums = (text: string | null | undefined, n: number, def = 0): number[] => {
  const v = (text ?? '').trim().split(/\s+/).map(Number);
  return Array.from({ length: n }, (_, i) => (Number.isFinite(v[i]) ? v[i] : def));
};

/** Vertices of a binary STL or an OBJ, in file units. */
function meshPoints(path: string, bytes: Uint8Array): number[][] {
  const out: number[][] = [];
  if (/\.stl$/i.test(path) && bytes.byteLength >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = view.getUint32(80, true);
    const step = Math.max(1, Math.floor(n / 20000)); // the extremes survive a sparse sample
    for (let t = 0; t < n; t += step) {
      for (let k = 0; k < 3; k++) {
        const o = 84 + t * 50 + 12 + k * 12;
        out.push([view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)]);
      }
    }
  } else if (/\.obj$/i.test(path)) {
    for (const m of new TextDecoder().decode(bytes).matchAll(/^v\s+(\S+)\s+(\S+)\s+(\S+)/gm)) {
      out.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    }
  }
  return out;
}

/** Points of one `<visual>` in its link's frame. */
function visualPoints(visual: string, files: Map<string, Uint8Array>): number[][] {
  const origin = /<origin\b[^>]*>/.exec(visual)?.[0] ?? '';
  const xyz = nums(attr(origin, 'xyz'), 3);
  const R = rpyMatrix(...(nums(attr(origin, 'rpy'), 3) as [number, number, number]));
  let local: number[][] = [];
  const mesh = /<mesh\b[^>]*>/.exec(visual)?.[0];
  const box = /<box\b[^>]*>/.exec(visual)?.[0];
  const cyl = /<cylinder\b[^>]*>/.exec(visual)?.[0];
  const sphere = /<sphere\b[^>]*>/.exec(visual)?.[0];
  if (mesh) {
    const file = attr(mesh, 'filename');
    const bytes = file ? files.get(file) : undefined;
    const scale = nums(attr(mesh, 'scale'), 3, 1);
    if (file && bytes) local = meshPoints(file, bytes).map((v) => [v[0] * scale[0], v[1] * scale[1], v[2] * scale[2]]);
  } else if (box) {
    const [x, y, z] = nums(attr(box, 'size'), 3).map((v) => v / 2);
    for (const sx of [-x, x]) for (const sy of [-y, y]) for (const sz of [-z, z]) local.push([sx, sy, sz]);
  } else if (cyl) {
    const r = Number(attr(cyl, 'radius') ?? 0);
    const h = Number(attr(cyl, 'length') ?? 0) / 2;
    for (let a = 0; a < 8; a++) for (const z of [-h, h]) local.push([r * Math.cos((a * Math.PI) / 4), r * Math.sin((a * Math.PI) / 4), z]);
  } else if (sphere) {
    const r = Number(attr(sphere, 'radius') ?? 0);
    for (const v of [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]]) local.push(v);
  }
  return local.map((v) => [
    xyz[0] + R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    xyz[1] + R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    xyz[2] + R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ]);
}

/**
 * Give every moving leaf link a fixed `<link>_tip` child at the point of its
 * geometry farthest from its joint — the paw of a leg that ends in its calf
 * (Laikago, Mini Cheetah), which the quadruped template then tracks as the foot.
 */
export function addLegTips(urdf: string, files: Map<string, Uint8Array>): string {
  const joints = [...urdf.matchAll(/<joint\b[^>]*>[\s\S]*?<\/joint>/g)].map((m) => ({
    type: attr(m[0].match(/<joint\b[^>]*>/)![0], 'type') ?? 'fixed',
    parent: /<parent\s+link\s*=\s*["']([^"']+)["']/.exec(m[0])?.[1],
    child: /<child\s+link\s*=\s*["']([^"']+)["']/.exec(m[0])?.[1],
  }));
  const parents = new Set(joints.map((j) => j.parent));
  const leaves = joints.filter((j) => j.type !== 'fixed' && j.child && !parents.has(j.child)).map((j) => j.child!);
  const extra: string[] = [];
  for (const leaf of leaves) {
    const block = new RegExp(`<link\\b[^>]*\\bname\\s*=\\s*["']${leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([\\s\\S]*?)<\\/link>`).exec(urdf);
    if (!block) continue;
    let tip: number[] | null = null;
    let far = 0;
    for (const v of block[1].match(/<visual\b[\s\S]*?<\/visual>/g) ?? []) {
      for (const p of visualPoints(v, files)) {
        const d = Math.hypot(p[0], p[1], p[2]);
        if (d > far) [far, tip] = [d, p];
      }
    }
    if (!tip || far < 0.02) continue;
    const name = `${leaf}_tip`;
    extra.push(
      `<link name="${name}"/><joint name="${name}_joint" type="fixed"><parent link="${leaf}"/><child link="${name}"/>` +
        `<origin xyz="${tip.map((v) => +v.toFixed(5)).join(' ')}"/></joint>`,
    );
  }
  return extra.length ? urdf.replace(/<\/robot>\s*$/, `${extra.join('\n')}\n</robot>`) : urdf;
}

export interface GalleryFetchOptions {
  onProgress?: (done: number, total: number) => void;
  /** Filled in as the download goes (left as is when the URDF itself fails). */
  stats?: Partial<GalleryFetchStats>;
  fetchImpl?: typeof fetch;
  /** Mesh re-encoder for files MuJoCo cannot read (injectable for tests). */
  convert?: (path: string, bytes: Uint8Array) => Promise<Uint8Array>;
  /** Parallel downloads (the gallery's own downloader uses 6). */
  concurrency?: number;
  /** Total STL triangles to simplify the meshes down to (`GALLERY_TRIANGLE_BUDGET`). */
  triangleBudget?: number;
}

/** Fetch a gallery robot (one of its URDF versions) as a custom-robot bundle. */
export async function fetchGalleryRobotBundle(
  robot: GalleryRobot,
  variantId?: string | null,
  options: GalleryFetchOptions = {},
): Promise<CustomRobotBundle> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const convert = options.convert ?? convertMeshForMujoco;
  const { variant, assets } = galleryVariantView(robot, variantId);
  if (!assets.urdf) throw new Error(`${robot.name} has no URDF in the gallery.`);

  const urdfUrl = assets.base + assets.urdf;
  const stats = options.stats;
  if (stats) stats.urdfUrl = urdfUrl;
  const res = await fetchImpl(urdfUrl);
  if (!res.ok) throw new Error(`URDF ${urdfUrl} → HTTP ${res.status}`);
  const rawUrdf = await res.text();
  const urdfText = normalizeGalleryUrdf(rawUrdf);

  const { targets, dropped } = resolveGalleryMeshes(assets, urdfText);
  const failures: string[] = [];
  let converted = 0;
  let meshBytes = 0;
  if (stats) {
    Object.assign(stats, { rawUrdf, meshTargets: targets.length, meshDropped: dropped, meshFailed: failures });
  }
  const total = targets.length + 1;
  let done = 1;
  options.onProgress?.(done, total);

  const files = new Map<string, Uint8Array>();
  const localRefs = new Map<string, string>();
  const queue = targets.map((target, index) => ({ target, local: localMeshPath(target, index) }));
  const workers = Array.from({ length: Math.min(options.concurrency ?? 6, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { target, local } = job;
      try {
        const meshRes = await fetchImpl(target.url);
        if (!meshRes.ok) throw new Error(`HTTP ${meshRes.status}`);
        let bytes: Uint8Array = new Uint8Array(await meshRes.arrayBuffer());
        if (needsConversion(target.path, bytes)) {
          bytes = await convert(target.path, bytes);
          converted++;
        }
        meshBytes += bytes.byteLength;
        files.set(local, bytes);
        localRefs.set(target.ref, local);
      } catch (err) {
        failures.push(`${target.url}: ${err instanceof Error ? err.message : String(err)}`);
      }
      done++;
      options.onProgress?.(done, total);
    }
  });
  await Promise.all(workers);

  const counts = new Map<string, number>();
  for (const [path, bytes] of files) if (path.endsWith('.stl')) counts.set(path, stlTriangleCount(bytes));
  const budgets = triangleBudgets(counts, options.triangleBudget ?? GALLERY_TRIANGLE_BUDGET, 4000, GALLERY_TRIANGLES_PER_FILE);
  let trianglesOut = 0;
  let decimated = 0;
  for (const [path, n] of counts) {
    const budget = budgets.get(path) ?? n;
    if (budget < n) {
      const simplified = decimateStl(files.get(path)!, budget);
      files.set(path, simplified);
      meshBytes += simplified.byteLength - 84 - 50 * n;
      decimated++;
      trianglesOut += stlTriangleCount(simplified);
    } else {
      trianglesOut += n;
    }
  }
  const trianglesIn = [...counts.values()].reduce((a, b) => a + b, 0);
  if (stats) {
    Object.assign(stats, { meshFetched: localRefs.size, meshConverted: converted, meshBytes, trianglesIn, trianglesOut, meshDecimated: decimated });
  }
  if (targets.length > 0 && localRefs.size === 0) {
    throw new Error(`Could not download any mesh for ${robot.name}: ${failures[0]}`);
  }
  if (failures.length) console.warn(`[gallery] ${robot.id}: skipped ${failures.length} mesh(es)`, failures);

  let urdf = prepareGalleryUrdf(urdfText, localRefs);
  // Quadruped legs that end in a calf link have no body at the paw.
  if (robot.category === 'quadruped') urdf = addLegTips(urdf, files);
  const fileId = variant?.id ?? robot.id;
  const rootModel = `${fileId.replace(/[^A-Za-z0-9_.-]+/g, '_')}.urdf`;
  files.set(rootModel, new TextEncoder().encode(urdf));

  const showVariant = variant && urdfVariants(robot).length > 1;
  return {
    label: showVariant ? `${robot.name} · ${variant.name}` : robot.name,
    rootModel,
    files,
    baseBody: findUrdfRootLink(urdf),
    kind: robot.category as GalleryCategory,
    gallery: { id: robot.id, variant: variant?.id ?? null },
  };
}
