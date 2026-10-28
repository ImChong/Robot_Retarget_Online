import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { createPinia, setActivePinia } from 'pinia';
import {
  galleryRobotUrl,
  galleryVariantView,
  parseVisibility,
  selectRetargetableRobots,
  type GalleryRegistry,
  type GalleryRobot,
} from '../src/lib/gallery/registry';
import {
  fetchGalleryRobotBundle,
  normalizeGalleryUrdf,
  prepareGalleryUrdf,
  resolveGalleryMeshes,
} from '../src/lib/gallery/urdfBundle';
import { convertMeshForMujoco, isBinaryStl, needsConversion } from '../src/lib/gallery/meshConvert';
import { clearCustomRobotCache, loadCustomRobot, parseCustomRobotImport } from '../src/lib/mujoco/customRobot';
import {
  createBlankQuadrupedConfig,
  getDefaultConfig,
  matchPresetConfig,
} from '../src/lib/retarget/defaults';
import { CUSTOM_ROBOT_ID, useRetargetStore } from '../src/stores/retarget';
import { useMotionStore } from '../src/stores/motion';
import type { RetargetHistoryEntry } from '../src/lib/retarget/types';

/** Closed tetrahedron (edge `s` metres) as binary STL. */
function tetraStl(s = 0.05): Uint8Array {
  const v = [[0, 0, 0], [s, 0, 0], [0, s, 0], [0, 0, s]];
  const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  const buf = new ArrayBuffer(84 + 50 * faces.length);
  const dv = new DataView(buf);
  dv.setUint32(80, faces.length, true);
  faces.forEach((f, i) => {
    let o = 84 + i * 50 + 12;
    for (const idx of f) for (const c of v[idx]) { dv.setFloat32(o, c, true); o += 4; }
  });
  return new Uint8Array(buf);
}

const ASCII_STL = `solid t
facet normal 0 0 -1
 outer loop
  vertex 0 0 0
  vertex 0 0.05 0
  vertex 0.05 0 0
 endloop
endfacet
facet normal 0 -1 0
 outer loop
  vertex 0 0 0
  vertex 0.05 0 0
  vertex 0 0 0.05
 endloop
endfacet
facet normal -1 0 0
 outer loop
  vertex 0 0 0
  vertex 0 0 0.05
  vertex 0 0.05 0
 endloop
endfacet
facet normal 1 1 1
 outer loop
  vertex 0.05 0 0
  vertex 0 0.05 0
  vertex 0 0 0.05
 endloop
endfacet
endsolid t
`;

const inertial = (m = 1) =>
  `<inertial><mass value="${m}"/><inertia ixx="0.01" ixy="0" ixz="0" iyy="0.01" iyz="0" izz="0.01"/></inertial>`;

function leg(prefix: string, x: number, y: number): string {
  return `
  <link name="${prefix}_thigh">${inertial()}
    <visual><geometry><mesh filename="package://dog_description/meshes/thigh.dae"/></geometry></visual>
    <collision><geometry><mesh filename="package://dog_description/meshes/thigh_collision.stl"/></geometry></collision>
  </link>
  <joint name="${prefix}_thigh_joint" type="revolute">
    <origin xyz="${x} ${y} 0"/><parent link="base"/><child link="${prefix}_thigh"/>
    <axis xyz="0 1 0"/><limit lower="-1" upper="1" effort="1" velocity="1"/>
  </joint>
  <link name="${prefix}_calf">${inertial()}
    <visual><geometry><mesh filename="../meshes/calf.stl"/></geometry></visual>
  </link>
  <joint name="${prefix}_calf_joint" type="revolute">
    <origin xyz="0 0 -0.2"/><parent link="${prefix}_thigh"/><child link="${prefix}_calf"/>
    <axis xyz="0 1 0"/><limit lower="-2" upper="0" effort="1" velocity="1"/>
  </joint>
  <link name="${prefix}_foot">${inertial(0.01)}
    <collision><geometry><sphere radius="0.02"/></geometry></collision>
  </link>
  <joint name="${prefix}_foot_joint" type="fixed">
    <origin xyz="0 0 -0.2"/><parent link="${prefix}_calf"/><child link="${prefix}_foot"/>
  </joint>`;
}

/** A Go2-shaped URDF exercising what upstream descriptions do to MuJoCo's importer. */
const DOG_URDF = `<?xml version="1.0"?>
<robot name="dog">
  <mujoco><compiler meshdir="../meshes" discardvisual="true"/></mujoco>
  <!-- <link name="commented_out"/> -->
  <link name="world"/>
  <joint name="floating_base" type="floating"><parent link="world"/><child link="base"/></joint>
  <link name="base">
    <inertial><mass value="5"/><inertia ixx="0.001" ixy="0.001" ixz="0.001" iyy="0.001" iyz="0.001" izz="0.001"/></inertial>
    <visual>
      <geometry><mesh filename="package://dog_description/meshes/base.dae"/></geometry>
      <material name="a"><color rgba="1 0 0 1"/></material><material name="b"><color rgba="0 1 0 1"/></material>
    </visual>
    <visual><geometry><mesh filename="package://unknown_pkg/meshes/sensor.stl"/></geometry></visual>
    <collision><geometry><box size="0.4 0.1 0.1"/></geometry></collision>
  </link>
  ${leg('FL', 0.2, 0.05)}${leg('FR', 0.2, -0.05)}${leg('RL', -0.2, 0.05)}${leg('RR', -0.2, -0.05)}
</robot>`;

const DOG: GalleryRobot = {
  id: 'dog',
  name: 'Dog',
  maker: 'Test',
  category: 'quadruped',
  dof: 8,
  assets: {
    base: 'https://cdn.example/gh/acme/dog@abc/',
    urdf: 'robots/dog_description/urdf/dog.urdf',
    packages: { dog_description: 'robots/dog_description' },
    mesh_alt: { 'robots/dog_description/meshes/calf.stl': 'https://media.example/calf.stl' },
  },
};

describe('gallery registry', () => {
  const registry: GalleryRegistry = {
    robots: [
      { ...DOG, id: 'go', category: 'quadruped' },
      { ...DOG, id: 'humanoid_urdf', category: 'humanoid' },
      { ...DOG, id: 'hidden_one', category: 'humanoid' },
      { ...DOG, id: 'an_arm', category: 'arm' },
      { ...DOG, id: 'mjcf_only', category: 'humanoid', assets: { base: 'x/', mjcf: 'scene.xml' } },
      { ...DOG, id: 'xacro_only', category: 'humanoid', assets: { base: 'x/', urdf: 'robot.urdf.xacro' } },
    ],
  };

  it('keeps visible humanoid / quadruped URDF entries only', () => {
    const visibility = parseVisibility('- [x] `go` **Go**\n- [ ] `hidden_one` **Hidden**\n');
    const ids = selectRetargetableRobots(registry, visibility).map((r) => r.id);
    expect(ids).toEqual(['go', 'humanoid_urdf']);
  });

  it('builds the gallery deep link, with the version when one is picked', () => {
    expect(galleryRobotUrl('g1')).toBe('https://imchong.github.io/Robot_Description_Gallery_Online/web/#robot=g1');
    expect(galleryRobotUrl('g1', 'g1_23dof')).toMatch(/#robot=g1&v=g1_23dof$/);
  });

  it("overlays a version's own assets on the card's", () => {
    const robot: GalleryRobot = {
      ...DOG,
      variants: [
        { id: 'v1', name: 'v1', dof: 8, assets: { urdf: 'robots/dog_description/urdf/v1.urdf' } },
        { id: 'v2', name: 'v2', dof: 9, assets: { urdf: 'robots/dog_description/urdf/v2.urdf', base: 'https://other/' } },
      ],
    };
    expect(galleryVariantView(robot).variant?.id).toBe('v1');
    const v2 = galleryVariantView(robot, 'v2');
    expect(v2.assets.urdf).toMatch(/v2\.urdf$/);
    expect(v2.assets.base).toBe('https://other/');
    expect(v2.assets.packages).toEqual(DOG.assets.packages);
    expect(v2.dof).toBe(9);
  });
});

describe('gallery URDF preparation', () => {
  it('resolves package://, relative, remapped and alt-hosted meshes', () => {
    const assets = {
      ...DOG.assets,
      mesh_rewrite: [{ from: 'base.dae', to: 'base.obj' }],
      skip_meshes: ['robots/dog_description/meshes/thigh_collision.stl'],
    };
    const { targets, dropped } = resolveGalleryMeshes(assets, DOG_URDF);
    const byRef = Object.fromEntries(targets.map((t) => [t.ref, t]));
    expect(byRef['package://dog_description/meshes/base.dae'].url).toBe(
      'https://cdn.example/gh/acme/dog@abc/robots/dog_description/meshes/base.obj',
    );
    expect(byRef['../meshes/calf.stl'].url).toBe('https://media.example/calf.stl');
    expect(dropped).toEqual(
      expect.arrayContaining([
        'package://unknown_pkg/meshes/sensor.stl',
        'package://dog_description/meshes/thigh_collision.stl',
      ]),
    );
  });

  it('normalises what MuJoCo rejects without touching the kinematics', () => {
    const xml = normalizeGalleryUrdf(DOG_URDF);
    expect(xml).not.toMatch(/name="world"|commented_out|floating/);
    // Collisions go where a visual exists, and become the visual where none does.
    expect(xml).not.toContain('thigh_collision.stl');
    expect(xml).toMatch(/<link name="FL_foot">[\s\S]*?<visual><geometry><sphere/);
    expect(xml.match(/<material/g)).toHaveLength(1);
    // The singular base inertia is replaced; the valid ones are left alone.
    expect(xml).toContain('<inertia ixx="0.001" ixy="0" ixz="0" iyy="0.001" iyz="0" izz="0.001"/>');
    expect(xml).toContain('<inertia ixx="0.01" ixy="0" ixz="0" iyy="0.01" iyz="0" izz="0.01"/>');
    // Joints and links are all still there.
    expect(xml.match(/<joint /g)).toHaveLength(12);
  });

  it('points meshes at local files and installs its own compiler block', () => {
    const xml = normalizeGalleryUrdf(DOG_URDF);
    const local = new Map([['../meshes/calf.stl', 'meshes/1_calf.stl']]);
    const out = prepareGalleryUrdf(xml, local);
    expect(out.match(/<mujoco>/g)).toHaveLength(1);
    expect(out).toContain('fusestatic="false"');
    expect(out).toContain('discardvisual="false"');
    expect(out).not.toContain('meshdir');
    expect(out).toContain('filename="meshes/1_calf.stl"');
    // Geometry whose mesh is not local is dropped rather than left dangling.
    expect(out).not.toMatch(/\.dae|sensor\.stl/);
  });

  it('recognises binary STL and re-encodes ASCII STL', async () => {
    expect(isBinaryStl(tetraStl())).toBe(true);
    const ascii = new TextEncoder().encode(ASCII_STL);
    expect(needsConversion('a.stl', ascii)).toBe(true);
    expect(needsConversion('a.STL', tetraStl())).toBe(false);
    expect(needsConversion('a.obj')).toBe(false);
    expect(needsConversion('a.dae')).toBe(true);
    const binary = await convertMeshForMujoco('a.stl', ascii);
    expect(isBinaryStl(binary)).toBe(true);
    expect(new DataView(binary.buffer, binary.byteOffset).getUint32(80, true)).toBe(4);
  });
});

const fetched: string[] = [];
const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  fetched.push(url);
  if (url.endsWith('/dog.urdf')) return new Response(DOG_URDF);
  if (url === 'https://media.example/calf.stl') return new Response(new TextEncoder().encode(ASCII_STL));
  if (url.endsWith('.dae')) return new Response('<COLLADA/>');
  return new Response('not found', { status: 404 });
}) as typeof fetch;
const fetchDog = (onProgress?: (done: number) => void) =>
  fetchGalleryRobotBundle(DOG, null, {
    fetchImpl: fakeFetch,
    // Collada needs a DOM; stand in a tetrahedron for the converted mesh.
    convert: async (path, bytes) => (path.endsWith('.dae') ? tetraStl() : convertMeshForMujoco(path, bytes)),
    onProgress,
  });

describe('gallery robot bundle → MuJoCo', () => {
  it('downloads, compiles and keeps fixed-joint feet as bodies', async () => {
    const progress: number[] = [];
    const bundle = await fetchDog((done) => progress.push(done));
    expect(bundle.kind).toBe('quadruped');
    expect(bundle.gallery).toEqual({ id: 'dog', variant: null });
    expect(bundle.baseBody).toBe('base');
    expect(fetched.some((u) => u.includes('collision'))).toBe(false);
    expect([...bundle.files.keys()].filter((k) => k.startsWith('meshes/'))).toHaveLength(3);
    expect(progress.at(-1)).toBe(4);

    clearCustomRobotCache();
    const robot = await loadCustomRobot(bundle);
    for (const body of ['base', 'FL_foot', 'FR_foot', 'RL_foot', 'RR_foot']) {
      expect(robot.bodyIds.has(body)).toBe(true);
    }
    expect(robot.nq).toBe(7 + 8);
    const contype = robot.model.geom_contype as Int32Array;
    expect(Array.from(contype).every((c) => c === 0)).toBe(true); // all drawn as visuals

    const preset = matchPresetConfig('b_Hips', robot.bodyNames, ['unitree_go2']);
    expect(preset?.robot_root_name).toBe('base');
    expect(Object.keys(preset!.ik_match_table2).sort()).toEqual(
      Object.keys(getDefaultConfig('unitree_go2').ik_match_table2).sort(),
    );
    expect(matchPresetConfig('Hips', robot.bodyNames)).toBeNull();
  });
});

describe('imported-robot ik_config templates', () => {
  it('maps a quadruped root and four feet by name', () => {
    const anymal = createBlankQuadrupedConfig('base', [
      'world', 'base', 'LF_HIP', 'LF_SHANK', 'LF_FOOT', 'RF_HIP', 'RF_FOOT', 'LH_HIP', 'LH_FOOT', 'RH_HIP', 'RH_FOOT',
    ]);
    expect(anymal.human_root_name).toBe('b_Hips');
    expect(anymal.robot_root_name).toBe('base');
    expect(Object.fromEntries(Object.entries(anymal.ik_match_table2).map(([k, e]) => [k, e[0]]))).toEqual({
      base: 'b_Hips',
      LF_FOOT: 'b_LeftHand',
      RF_FOOT: 'b_RightHand',
      LH_FOOT: 'b_LeftToe',
      RH_FOOT: 'b_RightToe',
    });
    // Suffix naming (Mini Cheetah) and no explicit foot: the leg's last body.
    const cheetah = createBlankQuadrupedConfig('body', ['body', 'abduct_fl', 'thigh_fl', 'shank_fl', 'abduct_hr', 'shank_hr']);
    expect(cheetah.ik_match_table2.shank_fl[0]).toBe('b_LeftHand');
    expect(cheetah.ik_match_table2.shank_hr[0]).toBe('b_RightToe');
    // Each foot owns its offsets: the mapping table edits them in place.
    expect(anymal.ik_match_table2.LF_FOOT[3]).not.toBe(anymal.ik_match_table2.RF_FOOT[3]);
  });
});

describe('retarget store with a gallery quadruped', () => {
  it('starts from a matching preset and follows the motion family', async () => {
    setActivePinia(createPinia());
    const store = useRetargetStore();
    const motion = useMotionStore();
    motion.motionKind = 'quadruped';

    const dog = await fetchDog();
    await store.adoptCustomRobot(dog);
    expect(store.robotId).toBe(CUSTOM_ROBOT_ID);
    expect(store.customRobotKind).toBe('quadruped');
    expect(store.config.human_root_name).toBe('b_Hips');
    expect(Object.keys(store.config.ik_match_table2)).toContain('FL_foot');
    expect(store.syncRobotToMotion([])).toBe(false); // dog motion keeps the dog

    // A history entry keeps replaying on the robot it was made with.
    const entry = { id: 'h', robotId: CUSTOM_ROBOT_ID, customRobot: dog } as RetargetHistoryEntry;
    const other = await parseCustomRobotImport(
      new File(
        [
          `<robot name="r"><link name="pelvis">${inertial()}</link><link name="thigh">${inertial()}</link>
          <joint name="hip" type="revolute"><parent link="pelvis"/><child link="thigh"/>
          <axis xyz="1 0 0"/><limit lower="-1" upper="1" effort="1" velocity="1"/></joint></robot>`,
        ],
        'r.urdf',
      ),
    );
    await store.adoptCustomRobot(other);
    expect(store.config.human_root_name).toBe('Hips');
    const replay = await store.loadRobotForHistory(entry);
    expect(replay.bodyIds.has('FL_foot')).toBe(true);

    await store.adoptCustomRobot(dog);
    motion.motionKind = 'humanoid';
    expect(store.syncRobotToMotion([])).toBe(true); // humanoid motion leaves the dog
    expect(store.robotId).toBe('unitree_g1');
  });
});

describe('custom URDF uploads with meshes', () => {
  it('compiles a zipped URDF next to its meshes', async () => {
    const urdf = `<robot name="boxbot">
      <mujoco><compiler meshdir="meshes" discardvisual="false"/></mujoco>
      <link name="pelvis">${inertial()}
        <visual><geometry><mesh filename="meshes/body.stl"/></geometry></visual>
      </link>
    </robot>`;
    const zip = zipSync({ 'robot.urdf': new TextEncoder().encode(urdf), 'meshes/body.stl': tetraStl() });
    const bundle = await parseCustomRobotImport(new File([zip], 'boxbot.zip'));
    clearCustomRobotCache();
    const robot = await loadCustomRobot(bundle);
    expect(robot.model.nmesh).toBe(1);
    expect(robot.bodyIds.has('pelvis')).toBe(true);
  });
});
