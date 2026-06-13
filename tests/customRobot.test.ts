import { describe, expect, it } from 'vitest';
import {
  findUrdfRootLink,
  injectFloatingBase,
  loadCustomRobot,
  parseCustomRobotImport,
  urdfToMjcfWithFloatingBase,
} from '../src/lib/mujoco/customRobot';
import { getMujoco } from '../src/lib/mujoco/runtime';
import { zipSync } from 'fflate';

const HUMANOID_URDF = `<?xml version="1.0"?>
<robot name="humanoid">
  <mujoco><compiler angle="radian" autolimits="true"/></mujoco>
  <link name="pelvis">
    <inertial><origin xyz="0 0 0"/><mass value="5"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/></inertial>
  </link>
  <link name="left_thigh">
    <inertial><mass value="2"/><inertia ixx="0.05" ixy="0" ixz="0" iyy="0.05" iyz="0" izz="0.01"/></inertial>
  </link>
  <link name="right_thigh">
    <inertial><mass value="2"/><inertia ixx="0.05" ixy="0" ixz="0" iyy="0.05" iyz="0" izz="0.01"/></inertial>
  </link>
  <joint name="lhip" type="revolute">
    <parent link="pelvis"/><child link="left_thigh"/>
    <axis xyz="1 0 0"/><limit lower="-1" upper="1" effort="1" velocity="1"/>
  </joint>
  <joint name="rhip" type="revolute">
    <parent link="pelvis"/><child link="right_thigh"/>
    <axis xyz="1 0 0"/><limit lower="-1" upper="1" effort="1" velocity="1"/>
  </joint>
</robot>`;

describe('custom robot import', () => {
  it('finds URDF root link', () => {
    expect(findUrdfRootLink(HUMANOID_URDF)).toBe('pelvis');
  });

  it('wraps compiled URDF with floating pelvis', async () => {
    const mujoco = await getMujoco();
    const mjcf = await urdfToMjcfWithFloatingBase(mujoco, HUMANOID_URDF, 'robot.urdf', 'pelvis');
    expect(mjcf).toContain('name="pelvis"');
    expect(mjcf).toContain('<freejoint');
    mujoco.FS.writeFile('/working/test_custom.xml', mjcf);
    const model = mujoco.MjModel.loadFromXML('/working/test_custom.xml');
    expect(model.nq).toBeGreaterThanOrEqual(7);
    expect(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, 'pelvis')).toBeGreaterThan(0);
  });

  it('loads a single URDF file bundle', async () => {
    const file = new File([HUMANOID_URDF], 'my_bot.urdf', { type: 'application/xml' });
    const bundle = await parseCustomRobotImport(file);
    expect(bundle.baseBody).toBe('pelvis');
    const robot = await loadCustomRobot(bundle);
    expect(robot.bodyIds.has('pelvis')).toBe(true);
    expect(robot.nq).toBeGreaterThanOrEqual(7);
  });

  it('loads a zip archive with URDF', async () => {
    const zip = zipSync({
      'robot.urdf': new TextEncoder().encode(HUMANOID_URDF),
    });
    const file = new File([zip], 'my_bot.zip', { type: 'application/zip' });
    const bundle = await parseCustomRobotImport(file);
    expect(bundle.rootModel).toBe('robot.urdf');
    const robot = await loadCustomRobot(bundle);
    expect(robot.bodyIds.has('pelvis')).toBe(true);
  });

  it('injects freejoint into existing MJCF root body', () => {
    const mjcf = `<mujoco><worldbody><body name="pelvis"><geom type="sphere" size="0.1"/></body></worldbody></mujoco>`;
    const patched = injectFloatingBase(mjcf, 'pelvis');
    expect(patched).toContain('<freejoint name="pelvis"/>');
  });
});
