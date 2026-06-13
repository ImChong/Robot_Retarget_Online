import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadRobot } from '../src/lib/mujoco/runtime';
import { clearCustomRobotCache, loadCustomRobot, parseCustomRobotImport } from '../src/lib/mujoco/customRobot';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROBOTS_DIR = join(ROOT, 'public', 'robots');

const MINIMAL_URDF = `<?xml version="1.0"?>
<robot name="switch_bot">
  <mujoco><compiler angle="radian" autolimits="true"/></mujoco>
  <link name="pelvis">
    <inertial><origin xyz="0 0 0"/><mass value="5"/><inertia ixx="0.1" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/></inertial>
  </link>
  <link name="leg">
    <inertial><mass value="2"/><inertia ixx="0.05" ixy="0" ixz="0" iyy="0.05" iyz="0" izz="0.01"/></inertial>
  </link>
  <joint name="hip" type="revolute">
    <parent link="pelvis"/><child link="leg"/>
    <axis xyz="1 0 0"/><limit lower="-1" upper="1" effort="1" velocity="1"/>
  </joint>
</robot>`;

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = String(input);
      const rel = raw.replace(/^.*\/robots\//, '');
      if (rel === 'manifest.json') {
        return new Response(readFileSync(join(ROBOTS_DIR, 'manifest.json')));
      }
      return new Response(readFileSync(join(ROBOTS_DIR, rel)));
    }),
  );
});

describe('robot switching memory', () => {
  it('cycles through built-in robots via loadRobot without bad_alloc', async () => {
    const ids = ['unitree_g1', 'engineai_pm01', 'fourier_n1', 'booster_t1_29dof'];
    for (let round = 0; round < 2; round++) {
      for (const id of ids) {
        const robot = await loadRobot(id);
        expect(robot.id).toBe(id);
        expect(robot.model.nbody).toBeGreaterThan(1);
      }
    }
  }, 120_000);

  it('alternates built-in robots and custom URDF imports', async () => {
    const builtIn = await loadRobot('engineai_pm01');
    expect(builtIn.bodyNames.length).toBeGreaterThan(1);

    const file = new File([MINIMAL_URDF], 'switch.urdf', { type: 'application/xml' });
    const bundle = await parseCustomRobotImport(file);
    const custom = await loadCustomRobot(bundle);
    expect(custom.bodyIds.has('pelvis')).toBe(true);

    const again = await loadRobot('unitree_g1');
    expect(again.id).toBe('unitree_g1');

    clearCustomRobotCache();
    const customAgain = await loadCustomRobot(bundle);
    expect(customAgain.bodyIds.has('pelvis')).toBe(true);
  }, 120_000);
});
