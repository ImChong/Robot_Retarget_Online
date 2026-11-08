/**
 * The full Robot Description Gallery Online inventory, one row per robot
 * description (each upstream version of a card is its own row), classified for
 * the URDF compatibility matrix (issue #98, `scripts/gallery_matrix.mjs`).
 *
 * Every card of every category is listed: the rows this app offers in its
 * gallery picker are the ones the matrix must retarget end to end; every other
 * row carries the reason it is not offered and what supporting it would take,
 * so nothing drops out of the report silently. Which rows are "offered" is
 * computed with the picker's own filters (`selectRetargetableRobots`,
 * `urdfVariants`), so the matrix and the site cannot disagree.
 */

import {
  GALLERY_CATEGORIES,
  selectRetargetableRobots,
  urdfVariants,
  type GalleryAssets,
  type GalleryRegistry,
  type GalleryRobot,
  type GalleryVariant,
} from './registry';

export type GalleryModelFormat = 'urdf' | 'xacro' | 'mjcf' | 'none';

/**
 * - `test`: offered in the picker — must pass end to end.
 * - `hidden`: a humanoid / quadruped URDF the gallery itself hides
 *   (`data/visibility.md`); not offered, run for information only.
 * - `unsupported`: not offered; `reason` / `followUp` say why and what it would take.
 */
export type InventoryPlan = 'test' | 'hidden' | 'unsupported';

export interface InventoryRow {
  /** `robot` or `robot@variant`, unique across the inventory. */
  key: string;
  robotId: string;
  robotName: string;
  maker: string | null;
  category: string;
  variantId: string | null;
  variantName: string | null;
  deprecated: boolean;
  /** Degrees of freedom the gallery declares for this description. */
  dof: number;
  format: GalleryModelFormat;
  /** Repository-relative path of the URDF / xacro / MJCF. */
  modelPath: string | null;
  /** Upstream repository and pinned commit the files stream from. */
  upstream: { repo: string | null; ref: string | null; base: string };
  /** Listed by the gallery (`data/visibility.md`). */
  visible: boolean;
  /** Offered in this app's "Pick URDF from Gallery" dialog. */
  offered: boolean;
  /** Source motion family it retargets from, when it is one this app has. */
  motion: 'humanoid' | 'quadruped' | null;
  plan: InventoryPlan;
  reason: string | null;
  followUp: string | null;
}

/** Why a category is not offered, and what supporting it would take. */
export const CATEGORY_GAPS: Record<string, { reason: string; followUp: string }> = {
  biped: {
    reason:
      'The picker offers humanoids and quadrupeds only. The structural template does map legs-only robots, ' +
      'but not point-foot or wheel-foot legs (see the evaluated rows: `--explore biped`).',
    followUp:
      'Offer bipeds for humanoid motion once point / wheel feet are mapped (foot tips, as for quadrupeds) and the evaluated failures are fixed.',
  },
  arm: {
    reason:
      'Fixed-base manipulator: no floating base to carry a whole-body motion, and no end-effector motion source.',
    followUp:
      'Fixed-base retarget of one LAFAN1 wrist trajectory (workspace-scaled) onto the end effector, without the free joint.',
  },
  dual_arm: {
    reason: 'Fixed-base bimanual system: same gap as single arms, for two wrists.',
    followUp: 'Map both LAFAN1 wrists (and elbows) onto the two end effectors with a fixed base.',
  },
  hand: {
    reason: 'Dexterous hand / gripper: the motion sources (LAFAN1, dog mocap, SMPL-X body) carry no finger joints.',
    followUp: 'Finger-level source (MANO / SMPL-X hands, MediaPipe Hands) mapped to fingertip keypoints.',
  },
  mobile: {
    reason: 'Mobile manipulator: wheeled base plus arm(s); the IK has no wheel / planar-base model.',
    followUp: 'Planar base trajectory from the human root plus wrist mapping onto the arm(s).',
  },
  mobile_base: {
    reason: 'Wheeled base without limbs: only a planar root trajectory could transfer, which is not motion retargeting.',
    followUp: 'Out of scope (could replay the human root path as a planar base trajectory).',
  },
  biomechanical: {
    reason: 'Musculoskeletal human model: driven by muscles / tendons, not a retargeting target for joint-space IK.',
    followUp: 'Out of scope for now.',
  },
  drone: { reason: 'Aerial vehicle: no articulated limbs to retarget onto.', followUp: 'Out of scope.' },
  vehicle: { reason: 'Vehicle: no articulated limbs to retarget onto.', followUp: 'Out of scope.' },
  sensor: { reason: 'Sensor model: not a robot body.', followUp: 'Out of scope.' },
};

const FORMAT_GAPS: Record<Exclude<GalleryModelFormat, 'urdf'>, { reason: string; followUp: string }> = {
  xacro: {
    reason: 'Upstream ships xacro only: the gallery has no expanded URDF and the app cannot run the xacro preprocessor.',
    followUp: 'Ask the gallery for a pre-expanded URDF, or expand xacro (macros, args, includes) in the browser.',
  },
  mjcf: {
    reason: 'MJCF-only card: the gallery picker loads URDF descriptions (MJCF works through "Import robot" uploads).',
    followUp: 'Resolve the MJCF and its meshdir / assets from the gallery and load it like an uploaded MJCF.',
  },
  none: {
    reason: 'No robot description file in the gallery entry.',
    followUp: 'Nothing to load.',
  },
};

export function modelFormat(path: string | null | undefined, mjcf?: string | null): GalleryModelFormat {
  if (path && /\.urdf$/i.test(path)) return 'urdf';
  if (path && /\.xacro$/i.test(path)) return 'xacro';
  if (path && /\.(xml|mjcf)$/i.test(path)) return 'mjcf';
  if (mjcf) return 'mjcf';
  return 'none';
}

/** `https://cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/` → repository + ref. */
export function parseUpstream(base: string): { repo: string | null; ref: string | null; base: string } {
  const gh = /\/gh\/([^/@]+\/[^/@]+)@([^/]+)\//.exec(base);
  if (gh) return { repo: gh[1], ref: gh[2], base };
  const raw = /raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)\//.exec(base);
  if (raw) return { repo: raw[1], ref: raw[2], base };
  return { repo: null, ref: null, base };
}

export function inventoryKey(robotId: string, variantId: string | null): string {
  return variantId ? `${robotId}@${variantId}` : robotId;
}

/** All rows of the gallery, in registry order (versions in their card's order). */
export function buildInventory(registry: GalleryRegistry, visibility: Map<string, boolean>): InventoryRow[] {
  const offeredRobots = new Set(selectRetargetableRobots(registry, visibility).map((r) => r.id));
  const rows: InventoryRow[] = [];

  for (const robot of registry.robots) {
    const visible = visibility.get(robot.id) !== false;
    const family = (GALLERY_CATEGORIES as string[]).includes(robot.category)
      ? (robot.category as 'humanoid' | 'quadruped')
      : null;
    const offeredVariants = new Set(offeredRobots.has(robot.id) ? urdfVariants(robot).map((v) => v.id) : []);
    const versions: (GalleryVariant | null)[] = robot.variants?.length ? robot.variants : [null];

    for (const variant of versions) {
      const assets: GalleryAssets = { ...robot.assets, ...(variant?.assets ?? {}) };
      const path = assets.urdf ?? assets.mjcf ?? null;
      const format = modelFormat(assets.urdf, assets.mjcf);
      const offered = offeredRobots.has(robot.id) && (variant ? offeredVariants.has(variant.id) : true);

      let plan: InventoryPlan;
      let gap: { reason: string; followUp: string } | null = null;
      if (offered) {
        plan = 'test';
      } else if (!family) {
        plan = 'unsupported';
        gap = CATEGORY_GAPS[robot.category] ?? {
          reason: `Category "${robot.category}" has no motion family in this app.`,
          followUp: 'Evaluate a source motion and mapping for this category.',
        };
        if (format !== 'urdf') {
          const f = FORMAT_GAPS[format as Exclude<GalleryModelFormat, 'urdf'>];
          gap = { reason: `${gap.reason} ${f.reason}`, followUp: gap.followUp };
        }
      } else if (format !== 'urdf') {
        plan = 'unsupported';
        gap = FORMAT_GAPS[format as Exclude<GalleryModelFormat, 'urdf'>];
      } else if (!visible) {
        plan = 'hidden';
        gap = {
          reason: 'Hidden by the gallery itself (data/visibility.md), so neither site offers it.',
          followUp: 'Offered automatically once the gallery shows it; the matrix already runs it for information.',
        };
      } else {
        // A visible humanoid / quadruped URDF the picker drops would be a bug in the filters.
        plan = 'unsupported';
        gap = { reason: 'Not offered by the picker filters (unexpected).', followUp: 'Investigate registry.ts filters.' };
      }

      rows.push({
        key: inventoryKey(robot.id, variant?.id ?? null),
        robotId: robot.id,
        robotName: robot.name,
        maker: robot.maker,
        category: robot.category,
        variantId: variant?.id ?? null,
        variantName: variant?.name ?? null,
        deprecated: !!variant?.deprecated,
        dof: variant?.dof ?? robot.dof,
        format,
        modelPath: path,
        upstream: parseUpstream(assets.base),
        visible,
        offered,
        motion: family,
        plan,
        reason: gap?.reason ?? null,
        followUp: gap?.followUp ?? null,
      });
    }
  }
  return rows;
}

/** The robot card a row belongs to (for loading it). */
export function robotForRow(registry: GalleryRegistry, row: InventoryRow): GalleryRobot | undefined {
  return registry.robots.find((r) => r.id === row.robotId);
}

/**
 * Inventory rows a previous report does not cover: new cards / versions, or
 * ones whose upstream file or commit changed since that report was made.
 */
export function coverageGaps(
  rows: InventoryRow[],
  covered: { key: string; modelPath: string | null; upstream: { ref: string | null } }[],
): { added: InventoryRow[]; changed: InventoryRow[]; removed: string[] } {
  const byKey = new Map(covered.map((c) => [c.key, c]));
  const added: InventoryRow[] = [];
  const changed: InventoryRow[] = [];
  for (const row of rows) {
    const prev = byKey.get(row.key);
    if (!prev) added.push(row);
    else if (prev.modelPath !== row.modelPath || prev.upstream.ref !== row.upstream.ref) changed.push(row);
  }
  const live = new Set(rows.map((r) => r.key));
  const removed = covered.map((c) => c.key).filter((k) => !live.has(k));
  return { added, changed, removed };
}
