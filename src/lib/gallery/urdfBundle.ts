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

export interface GalleryFetchOptions {
  onProgress?: (done: number, total: number) => void;
  fetchImpl?: typeof fetch;
  /** Mesh re-encoder for files MuJoCo cannot read (injectable for tests). */
  convert?: (path: string, bytes: Uint8Array) => Promise<Uint8Array>;
  /** Parallel downloads (the gallery's own downloader uses 6). */
  concurrency?: number;
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
  const res = await fetchImpl(urdfUrl);
  if (!res.ok) throw new Error(`URDF ${urdfUrl} → HTTP ${res.status}`);
  const urdfText = normalizeGalleryUrdf(await res.text());

  const { targets } = resolveGalleryMeshes(assets, urdfText);
  const total = targets.length + 1;
  let done = 1;
  options.onProgress?.(done, total);

  const files = new Map<string, Uint8Array>();
  const localRefs = new Map<string, string>();
  const failures: string[] = [];
  const queue = targets.map((target, index) => ({ target, local: localMeshPath(target, index) }));
  const workers = Array.from({ length: Math.min(options.concurrency ?? 6, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { target, local } = job;
      try {
        const meshRes = await fetchImpl(target.url);
        if (!meshRes.ok) throw new Error(`HTTP ${meshRes.status}`);
        let bytes: Uint8Array = new Uint8Array(await meshRes.arrayBuffer());
        if (needsConversion(target.path, bytes)) bytes = await convert(target.path, bytes);
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
  if (targets.length > 0 && localRefs.size === 0) {
    throw new Error(`Could not download any mesh for ${robot.name}: ${failures[0]}`);
  }
  if (failures.length) console.warn(`[gallery] ${robot.id}: skipped ${failures.length} mesh(es)`, failures);

  const urdf = prepareGalleryUrdf(urdfText, localRefs);
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
