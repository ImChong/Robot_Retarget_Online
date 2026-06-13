import { describe, expect, it } from 'vitest';
import { getMujoco } from '../src/lib/mujoco/runtime';
import { urdfToMjcfWithFloatingBase } from '../src/lib/mujoco/customRobot';

const SIMPLE_URDF = `<?xml version="1.0"?>
<robot name="test_bot">
  <mujoco>
    <compiler angle="radian" autolimits="true"/>
  </mujoco>
  <link name="base_link">
    <inertial><origin xyz="0 0 0.5"/><mass value="5"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/></inertial>
    <visual><origin xyz="0 0 0.5"/><geometry><box size="0.3 0.2 0.4"/></geometry></visual>
  </link>
  <link name="leg">
    <inertial><origin xyz="0 0 -0.15"/><mass value="2"/><inertia ixx="0.05" ixy="0" ixz="0" iyy="0.05" iyz="0" izz="0.01"/></inertial>
    <visual><origin xyz="0 0 -0.15"/><geometry><cylinder length="0.3" radius="0.04"/></geometry></visual>
  </link>
  <joint name="hip" type="revolute">
    <parent link="base_link"/><child link="leg"/>
    <origin xyz="0 0 0" rpy="0 0 0"/>
    <axis xyz="1 0 0"/>
    <limit lower="-1.5" upper="1.5" effort="100" velocity="10"/>
  </joint>
</robot>`;

describe('URDF loading', () => {
  it('compiles URDF with floating base wrapper', async () => {
    const mujoco = await getMujoco();
    const mjcf = await urdfToMjcfWithFloatingBase(mujoco, SIMPLE_URDF, 'test.urdf', 'base_link');
    mujoco.FS.writeFile('/working/test.urdf.xml', mjcf);
    const model = mujoco.MjModel.loadFromXML('/working/test.urdf.xml');
    expect(model.nbody).toBeGreaterThan(1);
    expect(model.njnt).toBeGreaterThan(0);
    expect(model.nq).toBeGreaterThanOrEqual(7);
  });
});
