/**
 * Robot Description Gallery Online (https://github.com/ImChong/Robot_Description_Gallery_Online)
 * as a robot source.
 *
 * The gallery hosts no model files: `data/robots.json` pins each description to
 * an upstream repository + commit and streams it from jsDelivr. This module
 * reads that registry (and the gallery's own `data/visibility.md`, so robots the
 * gallery hides stay hidden here too), keeps the humanoid and quadruped URDF
 * entries this app can retarget to, and builds the deep links back to the
 * gallery's viewer page. The path rules (`package://`, `mesh_rewrite`,
 * `mesh_alt`, `skip_meshes`, per-variant `assets`) mirror the gallery's own
 * `web/js/registry.js` and `web/js/download.js`.
 */

export const GALLERY_SITE_URL = 'https://imchong.github.io/Robot_Description_Gallery_Online/';
export const GALLERY_REPO_URL = 'https://github.com/ImChong/Robot_Description_Gallery_Online';
const GALLERY_DATA_URL = `${GALLERY_SITE_URL}data/`;

/** Gallery categories this app can retarget to (matches `MotionKind` values). */
export type GalleryCategory = 'humanoid' | 'quadruped';
export const GALLERY_CATEGORIES: GalleryCategory[] = ['humanoid', 'quadruped'];

export interface GalleryAssets {
  /** CDN prefix every repository-relative path is appended to. */
  base: string;
  urdf?: string;
  mjcf?: string;
  packages?: Record<string, string>;
  /** Repository-relative mesh path → URL to fetch instead (files over jsDelivr's limit). */
  mesh_alt?: Record<string, string>;
  mesh_rewrite?: { from: string; to: string }[];
  /** Repository-relative mesh paths the host does not have. */
  skip_meshes?: string[];
  mesh_files?: number;
  mesh_bytes?: number;
  mesh_formats?: string[];
}

export interface GalleryVariant {
  id: string;
  name: string;
  deprecated?: boolean;
  dof: number;
  assets?: Partial<GalleryAssets>;
}

export interface GalleryRobot {
  id: string;
  name: string;
  maker: string | null;
  category: string;
  dof: number;
  license?: string | null;
  assets: GalleryAssets;
  variants?: GalleryVariant[];
}

export interface GalleryRegistry {
  robots: GalleryRobot[];
}

/** The gallery's viewer page for one robot (and one of its upstream versions). */
export function galleryRobotUrl(robotId: string, variantId?: string | null): string {
  const params = new URLSearchParams({ robot: robotId });
  if (variantId) params.set('v', variantId);
  return `${GALLERY_SITE_URL}web/#${params.toString()}`;
}

export function galleryThumbUrl(robotId: string): string {
  return `${GALLERY_SITE_URL}web/thumbs/${robotId}.webp`;
}

const VISIBILITY_LINE = /^\s*[-*]\s*\[([ xX])\]\s*`([a-z0-9_]+)`/;

/** `data/visibility.md` task list → robot id → shown in the gallery. */
export function parseVisibility(text: string): Map<string, boolean> {
  const wanted = new Map<string, boolean>();
  for (const line of text.split('\n')) {
    const match = VISIBILITY_LINE.exec(line);
    if (match) wanted.set(match[2], match[1] !== ' ');
  }
  return wanted;
}

const isUsableUrdf = (path?: string) => !!path && /\.urdf$/i.test(path);

/** Versions of a robot that are plain URDF (xacro / MJCF-only versions are left out). */
export function urdfVariants(robot: GalleryRobot): GalleryVariant[] {
  return (robot.variants ?? []).filter((v) => isUsableUrdf(v.assets?.urdf ?? robot.assets.urdf));
}

/**
 * Humanoid / quadruped entries described by a plain URDF, minus the ones the
 * gallery hides. MJCF-only cards and xacro-only upstreams are skipped: the
 * former have no URDF to pick, the latter need a xacro expander.
 */
export function selectRetargetableRobots(
  registry: GalleryRegistry,
  visibility: Map<string, boolean> = new Map(),
): GalleryRobot[] {
  return registry.robots.filter(
    (r) =>
      (GALLERY_CATEGORIES as string[]).includes(r.category) &&
      visibility.get(r.id) !== false &&
      isUsableUrdf(r.assets?.urdf) &&
      (!r.variants?.length || urdfVariants(r).length > 0),
  );
}

/**
 * One version of a robot shaped like a single-file entry: the version's own
 * `assets` (URDF path, sometimes a different commit or mesh remaps) win over
 * the card's. Falls back to the robot's first URDF version.
 */
export function galleryVariantView(
  robot: GalleryRobot,
  variantId?: string | null,
): { variant: GalleryVariant | null; assets: GalleryAssets; dof: number } {
  const variants = urdfVariants(robot);
  if (!variants.length) return { variant: null, assets: robot.assets, dof: robot.dof };
  const variant = variants.find((v) => v.id === variantId) ?? variants[0];
  return { variant, assets: { ...robot.assets, ...variant.assets }, dof: variant.dof };
}

let registryPromise: Promise<GalleryRobot[]> | null = null;

/** Fetch the gallery registry once per page load (both files are served with CORS `*`). */
export function loadGalleryRobots(fetchImpl: typeof fetch = fetch): Promise<GalleryRobot[]> {
  if (!registryPromise) {
    registryPromise = (async () => {
      const res = await fetchImpl(`${GALLERY_DATA_URL}robots.json`);
      if (!res.ok) throw new Error(`Gallery registry: HTTP ${res.status}`);
      const registry = (await res.json()) as GalleryRegistry;
      // A missing or unreadable visibility list shows everything, as on the gallery.
      let visibility = new Map<string, boolean>();
      try {
        const vis = await fetchImpl(`${GALLERY_DATA_URL}visibility.md`);
        if (vis.ok) visibility = parseVisibility(await vis.text());
      } catch {
        /* offline / blocked — keep every robot */
      }
      return selectRetargetableRobots(registry, visibility);
    })();
    registryPromise.catch(() => {
      registryPromise = null; // allow a retry after a network failure
    });
  }
  return registryPromise;
}

/**
 * Built-in robots that are also gallery cards, so "view in gallery" works for
 * them too. Kept here rather than in `public/robots/manifest.json`, which
 * `scripts/prepare_gmr_robots.py` regenerates.
 */
export const BUILTIN_GALLERY_LINKS: Record<string, { id: string; variant?: string }> = {
  unitree_g1: { id: 'g1', variant: 'g1_29dof_rev_1_0' },
  unitree_g1_with_hands: { id: 'g1', variant: 'g1_29dof_with_hand_rev_1_0' },
  booster_t1_29dof: { id: 'booster_t1_29dof' },
  stanford_toddy: { id: 'toddlerbot' },
  fourier_n1: { id: 'n1' },
  engineai_pm01: { id: 'pm01' },
  unitree_go2: { id: 'go2' },
  unitree_a1: { id: 'a1' },
  unitree_h1: { id: 'h1' },
  unitree_h1_2: { id: 'h1_2' },
  booster_t1: { id: 'booster_t1' },
  booster_k1: { id: 'booster_k1' },
  pnd_adam_lite: { id: 'pndbotics_adam_lite' },
  tienkung: { id: 'tiankung' },
  fourier_gr3: { id: 'gr3', variant: 'gr3v2_1_1_dummy_hand' },
};
