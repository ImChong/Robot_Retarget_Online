/**
 * Gallery URDF compatibility matrix (issue #98), offline: the inventory and
 * its coverage diff, the URDF edge-case analysis, mesh decimation, and the
 * whole per-robot pipeline (`checkGalleryVersion`) on synthetic gallery
 * entries served by a fake fetch — a humanoid whose names say nothing about
 * left / right, one T-posed and turned to face +y, and a dog.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPAT_STAGES,
  analyzeUrdf,
  checkGalleryVersion,
  loadCompatMotion,
  validateRetarget,
} from '../src/lib/gallery/compat';
import { buildInventory, coverageGaps, parseUpstream } from '../src/lib/gallery/inventory';
import { decimateStl, stlTriangleCount, triangleBudgets } from '../src/lib/gallery/meshDecimate';
import { parseVisibility, type GalleryRegistry, type GalleryRobot } from '../src/lib/gallery/registry';
import { clearCustomRobotCache, loadCustomRobot } from '../src/lib/mujoco/customRobot';
import { analyzeHumanoid, sideFromName } from '../src/lib/retarget/autoConfig';
import { chooseCustomConfig } from '../src/lib/retarget/customConfig';
import { runRetarget } from '../src/lib/retarget/runner';
import { DEFAULT_SOLVER_OPTIONS } from '../src/lib/retarget/types';
import { fetchGalleryRobotBundle } from '../src/lib/gallery/urdfBundle';

const base = 'https://cdn.example/gh/acme/robots@0123456789abcdef/';
const entry = (id: string, category: string, extra: Partial<GalleryRobot> = {}): GalleryRobot => ({
  id,
  name: id.toUpperCase(),
  maker: 'Acme',
  category,
  dof: 12,
  assets: { base, urdf: `${id}/robot.urdf` },
  ...extra,
});

describe('gallery inventory', () => {
  const registry: GalleryRegistry = {
    robots: [
      entry('biped_h', 'humanoid', {
        variants: [
          { id: 'v_urdf', name: 'URDF', dof: 23 },
          { id: 'v_xacro', name: 'xacro', dof: 23, assets: { urdf: 'biped_h/robot.urdf.xacro' } },
          { id: 'v_new', name: 'new', dof: 29, assets: { urdf: 'biped_h/v2.urdf', base: 'https://cdn.example/gh/acme/robots@fedcba/' } },
        ],
      }),
      entry('dog', 'quadruped'),
      entry('hidden_h', 'humanoid'),
      entry('mjcf_h', 'humanoid', { assets: { base, mjcf: 'mjcf_h/scene.xml' } }),
      entry('arm', 'arm'),
      entry('legs', 'biped'),
    ],
  };
  const rows = buildInventory(registry, parseVisibility('- [ ] `hidden_h` Hidden\n- [x] `dog` Dog\n'));
  const byKey = new Map(rows.map((r) => [r.key, r]));

  it('lists every card and every version, classified', () => {
    expect(rows.map((r) => r.key)).toEqual([
      'biped_h@v_urdf',
      'biped_h@v_xacro',
      'biped_h@v_new',
      'dog',
      'hidden_h',
      'mjcf_h',
      'arm',
      'legs',
    ]);
    expect(byKey.get('biped_h@v_urdf')).toMatchObject({ plan: 'test', offered: true, motion: 'humanoid', dof: 23 });
    expect(byKey.get('biped_h@v_new')).toMatchObject({ plan: 'test', upstream: { repo: 'acme/robots', ref: 'fedcba' } });
    expect(byKey.get('biped_h@v_xacro')).toMatchObject({ plan: 'unsupported', format: 'xacro', offered: false });
    expect(byKey.get('dog')).toMatchObject({ plan: 'test', motion: 'quadruped' });
    expect(byKey.get('hidden_h')).toMatchObject({ plan: 'hidden', visible: false, offered: false });
    expect(byKey.get('mjcf_h')).toMatchObject({ plan: 'unsupported', format: 'mjcf' });
    for (const key of ['arm', 'legs']) {
      expect(byKey.get(key)!.plan).toBe('unsupported');
      expect(byKey.get(key)!.reason).toBeTruthy();
      expect(byKey.get(key)!.followUp).toBeTruthy();
    }
    // Nothing the matrix must pass falls outside the picker, and vice versa.
    expect(rows.filter((r) => r.offered).every((r) => r.plan === 'test')).toBe(true);
  });

  it('reports new, changed and removed descriptions against a previous report', () => {
    const previous = rows
      .filter((r) => r.key !== 'dog')
      .map((r) => (r.key === 'biped_h@v_new' ? { ...r, upstream: { ...r.upstream, ref: 'old' } } : r));
    previous.push({ ...rows[0], key: 'gone' });
    const gaps = coverageGaps(rows, previous);
    expect(gaps.added.map((r) => r.key)).toEqual(['dog']);
    expect(gaps.changed.map((r) => r.key)).toEqual(['biped_h@v_new']);
    expect(gaps.removed).toEqual(['gone']);
    expect(coverageGaps(rows, rows)).toEqual({ added: [], changed: [], removed: [] });
  });

  it('reads the upstream repository and commit off the CDN base', () => {
    expect(parseUpstream('https://cdn.jsdelivr.net/gh/unitreerobotics/unitree_ros@daadf41/')).toMatchObject({
      repo: 'unitreerobotics/unitree_ros',
      ref: 'daadf41',
    });
  });
});

describe('URDF edge cases and meshes', () => {
  it('analyses roots, joints, packages and leftovers of a raw URDF', () => {
    const a = analyzeUrdf(`<robot name="r"><!-- <link name="ghost"/> -->
      <link name="world"/><link name="base"><inertial><mass value="1"/>
        <inertia ixx="0.001" ixy="0.001" ixz="0.001" iyy="0.001" iyz="0.001" izz="0.001"/></inertial>
        <visual><geometry><mesh filename="package://p/m.stl"/></geometry></visual></link>
      <link name="a"><collision><geometry><box size="1 1 1"/></geometry></collision></link>
      <link name="stray"/>
      <joint name="f" type="floating"><parent link="world"/><child link="base"/></joint>
      <joint name="j" type="revolute"><parent link="base"/><child link="a"/><mimic joint="f"/></joint>
      <xacro:property name="x" value="1"/></robot>`);
    expect(a.links).toBe(4);
    expect(a.rootLinks).toEqual(['world', 'stray']);
    expect(a.worldLink).toBe(true);
    expect(a.joints).toEqual({ floating: 1, revolute: 1 });
    expect(a.mimicJoints).toBe(1);
    expect(a.packageRefs).toBe(1);
    expect(a.badInertias).toBe(1);
    expect(a.collisionOnlyLinks).toBe(1);
    expect(a.xacroLeftovers).toBe(1);
  });

  it('simplifies an over-budget STL and splits a budget across files', () => {
    // A finely tessellated square plate: 2·n² triangles.
    const n = 60;
    const tris: number[][] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p = (a: number, b: number) => [a / n, b / n, 0];
        tris.push([...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1)], [...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1)]);
      }
    }
    const stl = new Uint8Array(84 + tris.length * 50);
    const dv = new DataView(stl.buffer);
    dv.setUint32(80, tris.length, true);
    tris.forEach((t, k) => t.forEach((v, c) => dv.setFloat32(84 + k * 50 + 12 + c * 4, v, true)));
    const out = decimateStl(stl, 1000);
    expect(stlTriangleCount(out)).toBeLessThanOrEqual(1000);
    expect(stlTriangleCount(out)).toBeGreaterThan(200);
    expect(out.byteLength).toBe(84 + 50 * stlTriangleCount(out));
    expect(decimateStl(stl, 1e6)).toBe(stl);

    const budgets = triangleBudgets(new Map([['a', 100], ['b', 5000], ['c', 20000]]), 6000, 10);
    expect(budgets.get('a')).toBe(100);
    expect(budgets.get('b')! + budgets.get('c')!).toBeLessThanOrEqual(5900);
    expect(budgets.get('b')).toBe(budgets.get('c'));
  });

  it('reads left / right off common naming schemes', () => {
    for (const n of ['left_knee_link', 'L_HIP_P', 'leg_l3_link', 'LLeg2', 'l_ankle_roll', 'LeftShoulderPitch', 'lhip']) {
      expect(sideFromName(n), n).toBe(1);
    }
    for (const n of ['right_knee_link', 'R_ELBOW', 'leg_r4_link', 'RArm3', 'r_wrist']) expect(sideFromName(n), n).toBe(-1);
    for (const n of ['pelvis', 'link_3', 'lumbar_link', 'torso', 'base_link']) expect(sideFromName(n), n).toBe(0);
  });
});

// ---------------- synthetic gallery robots ----------------

const inertial = '<inertial><mass value="1"/><inertia ixx="0.01" ixy="0" ixz="0" iyy="0.01" iyz="0" izz="0.01"/></inertial>';
const box = (x: number, y: number, z: number, at = '0 0 0') =>
  `<visual><origin xyz="${at}"/><geometry><box size="${x} ${y} ${z}"/></geometry></visual>`;

interface HumanoidOptions {
  /** Arms out sideways at the zero pose instead of hanging. */
  tpose?: boolean;
  /** Turn the whole robot to face +y. */
  faceY?: boolean;
  /** Body names that do not say left / right. */
  anonymous?: boolean;
}

/** A 1.2 m humanoid: 6-DoF legs, waist, 5-DoF arms, box geometry. */
function humanoidUrdf(o: HumanoidOptions = {}): string {
  // (x, y) in the robot's own frame → URDF frame (turned for faceY).
  const xy = (x: number, y: number) => (o.faceY ? [-y, x] : [x, y]);
  const v = (x: number, y: number, z: number) => `${xy(x, y)[0]} ${xy(x, y)[1]} ${z}`;
  const axis = (a: 'x' | 'y' | 'z') => (a === 'z' ? '0 0 1' : a === 'x' ? v(1, 0, 0) : v(0, 1, 0));
  let n = 0;
  const name = (side: string, part: string) => (o.anonymous ? `link_${++n}` : `${side}_${part}_link`);
  const links: string[] = [`<link name="pelvis">${inertial}${box(0.2, 0.25, 0.12)}</link>`];
  const joints: string[] = [];
  const chain = (parent: string, side: string, parts: [string, 'x' | 'y' | 'z', number[], string][]) => {
    let prev = parent;
    for (const [part, ax, at, geom] of parts) {
      const link = name(side, part);
      links.push(`<link name="${link}">${inertial}${geom}</link>`);
      joints.push(
        `<joint name="${link}_joint" type="revolute"><origin xyz="${v(at[0], at[1], at[2])}"/>` +
          `<parent link="${prev}"/><child link="${link}"/><axis xyz="${axis(ax)}"/>` +
          `<limit lower="-2.5" upper="2.5" effort="1" velocity="1"/></joint>`,
      );
      prev = link;
    }
    return prev;
  };
  for (const [side, s] of [['left', 1], ['right', -1]] as const) {
    chain('pelvis', side, [
      ['hip_pitch', 'y', [0, 0.09 * s, -0.06], ''],
      ['hip_roll', 'x', [0, 0, 0], ''],
      ['hip_yaw', 'z', [0, 0, -0.08], box(0.06, 0.06, 0.18, '0 0 -0.08')],
      ['knee', 'y', [0, 0, -0.18], box(0.05, 0.05, 0.25, '0 0 -0.12')],
      ['ankle_pitch', 'y', [0, 0, -0.26], ''],
      ['ankle_roll', 'x', [0, 0, 0], box(0.18, 0.07, 0.03, `${v(0.03, 0, -0.035)}`)],
    ]);
  }
  const torso = chain('pelvis', 'mid', [['waist_yaw', 'z', [0, 0, 0.08], box(0.18, 0.25, 0.3, '0 0 0.15')]]);
  for (const [side, s] of [['left', 1], ['right', -1]] as const) {
    const down = !o.tpose;
    const seg = (len: number) => (down ? [0, 0, -len] : [0, len * s, 0]);
    const g = (len: number) => box(0.04, 0.04, 0.04, v(...(seg(len / 2) as [number, number, number])));
    chain(torso, side, [
      ['shoulder_pitch', 'y', [0, 0.16 * s, 0.25], ''],
      ['shoulder_roll', 'x', [0, 0, 0], ''],
      ['shoulder_yaw', down ? 'z' : 'y', seg(0.08), g(0.12)],
      ['elbow', down ? 'y' : 'z', seg(0.12), g(0.18)],
      ['wrist', down ? 'z' : 'y', seg(0.18), g(0.08)],
    ]);
  }
  return `<?xml version="1.0"?><robot name="synthetic">${links.join('')}${joints.join('')}</robot>`;
}

const DOG_URDF = (() => {
  const legs = ['FL', 'FR', 'RL', 'RR']
    .map((leg) => {
      const x = leg[0] === 'F' ? 0.2 : -0.2;
      const y = leg[1] === 'L' ? 0.1 : -0.1;
      return `<link name="${leg}_hip">${inertial}</link><link name="${leg}_thigh">${inertial}${box(0.03, 0.03, 0.2, '0 0 -0.1')}</link>
      <link name="${leg}_calf">${inertial}${box(0.02, 0.02, 0.2, '0 0 -0.1')}</link>
      <link name="${leg}_foot">${inertial}<collision><geometry><sphere radius="0.02"/></geometry></collision></link>
      <joint name="${leg}_hip_joint" type="revolute"><origin xyz="${x} ${y} 0"/><parent link="base"/><child link="${leg}_hip"/><axis xyz="1 0 0"/><limit lower="-1" upper="1" effort="1" velocity="1"/></joint>
      <joint name="${leg}_thigh_joint" type="revolute"><origin xyz="0 ${y / 2} 0"/><parent link="${leg}_hip"/><child link="${leg}_thigh"/><axis xyz="0 1 0"/><limit lower="-1.5" upper="3" effort="1" velocity="1"/></joint>
      <joint name="${leg}_calf_joint" type="revolute"><origin xyz="0 0 -0.2"/><parent link="${leg}_thigh"/><child link="${leg}_calf"/><axis xyz="0 1 0"/><limit lower="-2.7" upper="-0.8" effort="1" velocity="1"/></joint>
      <joint name="${leg}_foot_joint" type="fixed"><origin xyz="0 0 -0.2"/><parent link="${leg}_calf"/><child link="${leg}_foot"/></joint>`;
    })
    .join('');
  return `<robot name="dog"><link name="base">${inertial}${box(0.4, 0.2, 0.1)}</link>${legs}</robot>`;
})();

function servedRobot(id: string, category: string, urdf: string): { robot: GalleryRobot; fetchImpl: typeof fetch } {
  const robot = entry(id, category);
  const fetchImpl = (async (input: RequestInfo | URL) =>
    String(input).endsWith(`${id}/robot.urdf`) ? new Response(urdf) : new Response('missing', { status: 404 })) as typeof fetch;
  return { robot, fetchImpl };
}

const walk = loadCompatMotion(readFileSync('public/sample_motions/walk.bvh', 'utf8'), 'walk', 'humanoid', 240);
const dogWalk = loadCompatMotion(readFileSync('public/sample_motions/dog_walk.bvh', 'utf8'), 'dog walk', 'quadruped');

describe('gallery compatibility pipeline (offline)', () => {
  it.each([
    ['plain', {}],
    ['anonymous names, T-posed, facing +y', { tpose: true, faceY: true, anonymous: true }],
  ] as [string, HumanoidOptions][])('retargets a synthetic humanoid end to end (%s)', async (_label, options) => {
    const { robot, fetchImpl } = servedRobot('synth', 'humanoid', humanoidUrdf(options));
    const report = await checkGalleryVersion(robot, null, walk, { fetchImpl });
    expect(report.failure).toBeNull();
    expect(report.status).toBe('passed');
    for (const stage of COMPAT_STAGES) expect(report.stages[stage]?.ok, stage).toBe(true);
    expect(report.config?.source).toBe('structural');
    expect(Object.keys(report.config!.mapped).sort()).toEqual(
      ['Hips', 'LeftArm', 'LeftFootMod', 'LeftForeArm', 'LeftHand', 'LeftLeg', 'LeftUpLeg', 'RightArm', 'RightFootMod',
        'RightForeArm', 'RightHand', 'RightLeg', 'RightUpLeg', 'Spine2'].sort(),
    );
    expect(report.metrics!.headingAgreement).toBeGreaterThan(0.8);
    expect(report.exports!.npzBytes).toBeGreaterThan(0);
    expect(report.model!.hinge).toBe(23);
  });

  it('maps the legs by geometry when names say nothing, facing +y', async () => {
    const { robot, fetchImpl } = servedRobot('synth', 'humanoid', humanoidUrdf({ anonymous: true, faceY: true }));
    const bundle = await fetchGalleryRobotBundle(robot, null, { fetchImpl });
    clearCustomRobotCache();
    const model = await loadCustomRobot(bundle);
    const sk = analyzeHumanoid(model, bundle.baseBody)!;
    // Facing +y, the left leg is the one at −x; the yaw turns it to face +x.
    expect(sk.yaw).toBeCloseTo(-Math.PI / 2, 3);
    expect(sk.rest.pos[sk.left.hip][0]).toBeLessThan(0);
  });

  it('retargets a gallery dog (Go2 names → Go2 preset, rescaled to its legs) and checks it', async () => {
    const { robot, fetchImpl } = servedRobot('dog', 'quadruped', DOG_URDF);
    const report = await checkGalleryVersion(robot, null, dogWalk, { fetchImpl });
    expect(report.failure).toBeNull();
    expect(report.config?.source).toBe('preset:unitree_go2 (rescaled)'); // 0.40 m legs vs Go2's 0.426
    expect(report.metrics!.frames).toBe(dogWalk.frames.length);
  });

  it('fails the motion checks of a robot that tips over, and of broken output', async () => {
    const { robot, fetchImpl } = servedRobot('synth', 'humanoid', humanoidUrdf());
    const bundle = await fetchGalleryRobotBundle(robot, null, { fetchImpl });
    clearCustomRobotCache();
    const model = await loadCustomRobot(bundle);
    const { config } = chooseCustomConfig(model, bundle);
    const frames = walk.frames.slice(0, 60);
    const result = await runRetarget({ robot: model, config, solver: { ...DEFAULT_SOLVER_OPTIONS }, frames, fps: walk.fps });
    const ok = validateRetarget(model, config, result, 'humanoid', frames.length);
    expect(ok.checks.filter((c) => !c.ok && c.severity === 'fail')).toEqual([]);

    // Lay the robot on its back and corrupt one value.
    const broken = { ...result, qpos: new Float64Array(result.qpos) };
    for (let f = 0; f < frames.length; f++) broken.qpos.set([Math.SQRT1_2, 0, Math.SQRT1_2, 0], f * result.nq + 3);
    broken.qpos[5 * result.nq + 9] = Number.NaN;
    const bad = validateRetarget(model, config, broken, 'humanoid', frames.length);
    const failed = new Set(bad.checks.filter((c) => !c.ok).map((c) => c.id));
    expect(failed.has('finite')).toBe(true);
    expect(failed.has('upright')).toBe(true);
    expect(validateRetarget(model, config, result, 'humanoid', 61).checks.find((c) => c.id === 'shape')!.ok).toBe(false);
  });

  it('reports a missing URDF as a download failure and skips the rest', async () => {
    const robot = entry('nowhere', 'humanoid');
    const fetchImpl = (async () => new Response('missing', { status: 404 })) as unknown as typeof fetch;
    const report = await checkGalleryVersion(robot, null, walk, { fetchImpl });
    expect(report.status).toBe('failed');
    expect(report.failure).toMatchObject({ stage: 'fetch', category: 'urdf-download' });
    expect(report.stages.solve).toMatchObject({ ok: false, skipped: true });
  });
});
