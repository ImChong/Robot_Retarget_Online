/**
 * Integration test: GMR engine against a small MuJoCo model (runs the real
 * mujoco-js WASM in Node). Pose-recovery: take a known robot pose, expose its
 * body poses as "human" targets, and check the IK reconstructs it.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { loadRobotFromXmlString, type RobotModel } from '../src/lib/mujoco/runtime';
import { GmrRetargetEngine } from '../src/lib/retarget/engine';
import { DEFAULT_SOLVER_OPTIONS, type GmrIkConfig } from '../src/lib/retarget/types';
import type { HumanFrame } from '../src/lib/bvh/lafan1';
import type { Quat, Vec3 } from '../src/lib/math3d';

const TEST_XML = `
<mujoco model="mini-humanoid">
  <compiler angle="radian"/>
  <worldbody>
    <body name="torso" pos="0 0 1">
      <freejoint name="root"/>
      <geom type="capsule" fromto="0 0 -0.2 0 0 0.2" size="0.08" mass="6"/>
      <body name="upper_arm" pos="0 0.15 0.15">
        <joint name="shoulder_x" type="hinge" axis="1 0 0" range="-2.8 2.8"/>
        <joint name="shoulder_y" type="hinge" axis="0 1 0" range="-2.8 2.8"/>
        <geom type="capsule" fromto="0 0 0 0 0.25 0" size="0.04" mass="1"/>
        <body name="lower_arm" pos="0 0.25 0">
          <joint name="elbow" type="hinge" axis="1 0 0" range="-2.5 0.1"/>
          <geom type="capsule" fromto="0 0 0 0 0.22 0" size="0.035" mass="0.8"/>
        </body>
      </body>
      <body name="thigh" pos="0 -0.05 -0.25">
        <joint name="hip_x" type="hinge" axis="1 0 0" range="-2.0 2.0"/>
        <geom type="capsule" fromto="0 0 0 0 0 -0.3" size="0.05" mass="3"/>
        <body name="shin" pos="0 0 -0.3">
          <joint name="knee" type="hinge" axis="1 0 0" range="0 2.4"/>
          <geom type="capsule" fromto="0 0 0 0 0 -0.3" size="0.04" mass="2"/>
        </body>
      </body>
    </body>
  </worldbody>
</mujoco>`;

const CONFIG: GmrIkConfig = {
  robot_root_name: 'torso',
  human_root_name: 'HTorso',
  ground_height: 0,
  human_height_assumption: 1.75,
  use_ik_match_table1: true,
  use_ik_match_table2: true,
  human_scale_table: {
    HTorso: 1,
    HLowerArm: 1,
    HShin: 1,
  },
  ik_match_table1: {
    torso: ['HTorso', 0, 10, [0, 0, 0], [1, 0, 0, 0]],
    lower_arm: ['HLowerArm', 0, 10, [0, 0, 0], [1, 0, 0, 0]],
    shin: ['HShin', 0, 10, [0, 0, 0], [1, 0, 0, 0]],
  },
  ik_match_table2: {
    torso: ['HTorso', 100, 5, [0, 0, 0], [1, 0, 0, 0]],
    lower_arm: ['HLowerArm', 50, 5, [0, 0, 0], [1, 0, 0, 0]],
    shin: ['HShin', 50, 5, [0, 0, 0], [1, 0, 0, 0]],
  },
};

let robot: RobotModel;

beforeAll(async () => {
  robot = await loadRobotFromXmlString('mini', TEST_XML);
});

function captureTargets(qpos: number[]): HumanFrame {
  const { mujoco, model, data } = robot;
  (data.qpos as Float64Array).set(qpos);
  mujoco.mj_kinematics(model, data);
  const frame: HumanFrame = new Map();
  const grab = (bodyName: string, humanName: string) => {
    const b = robot.bodyIds.get(bodyName)!;
    const xpos = data.xpos as Float64Array;
    const xquat = data.xquat as Float64Array;
    frame.set(humanName, {
      pos: [xpos[b * 3], xpos[b * 3 + 1], xpos[b * 3 + 2]] as Vec3,
      quat: [xquat[b * 4], xquat[b * 4 + 1], xquat[b * 4 + 2], xquat[b * 4 + 3]] as Quat,
    });
  };
  grab('torso', 'HTorso');
  grab('lower_arm', 'HLowerArm');
  grab('shin', 'HShin');
  return frame;
}

describe('GmrRetargetEngine', () => {
  it('recovers a known pose from body-pose targets', () => {
    const target = [0.15, -0.1, 1.05, 1, 0, 0, 0, /*shoulder_x*/ 0.7, /*shoulder_y*/ -0.4, /*elbow*/ -1.1, /*hip_x*/ -0.5, /*knee*/ 1.0];
    const frame = captureTargets(target);

    const engine = new GmrRetargetEngine(robot, CONFIG, { ...DEFAULT_SOLVER_OPTIONS });
    // stream the same frame several times: must converge to the source pose
    let qpos: Float64Array | null = null;
    for (let i = 0; i < 8; i++) qpos = engine.retargetFrame(frame);

    const errs = engine.taskPositionErrors();
    for (const e of errs) expect(e).toBeLessThan(0.01); // < 1 cm

    // joint angles close to the source pose
    expect(qpos).not.toBeNull();
    for (let d = 7; d < 12; d++) {
      expect(Math.abs(qpos![d] - target[d])).toBeLessThan(0.08);
    }
    engine.dispose();
  });

  it('respects joint limits', () => {
    const frame = captureTargets([0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    // ask the elbow to bend beyond its range via an absurd target
    const tweaked: HumanFrame = new Map(frame);
    const la = tweaked.get('HLowerArm')!;
    tweaked.set('HLowerArm', { pos: [la.pos[0], la.pos[1] - 1.0, la.pos[2] + 1.0], quat: la.quat });

    const engine = new GmrRetargetEngine(robot, CONFIG, { ...DEFAULT_SOLVER_OPTIONS });
    const qpos = engine.retargetFrame(tweaked);
    const model = robot.model;
    const jntRange = model.jnt_range as Float64Array;
    // hinge joints are jnt ids 1..5, qpos addresses 7..11
    for (let j = 1; j < 6; j++) {
      const lo = jntRange[j * 2];
      const hi = jntRange[j * 2 + 1];
      const v = qpos[7 + (j - 1)];
      expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(v).toBeLessThanOrEqual(hi + 1e-9);
    }
    engine.dispose();
  });

  it('scales human data about the root', () => {
    const engine = new GmrRetargetEngine(
      robot,
      { ...CONFIG, human_scale_table: { HTorso: 0.5, HLowerArm: 0.5, HShin: 0.5 } },
      { ...DEFAULT_SOLVER_OPTIONS },
    );
    const frame = captureTargets([0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    const processed = engine.preprocessHuman(frame);
    const root = processed.get('HTorso')!;
    expect(root.pos[2]).toBeCloseTo(0.5, 9); // 1.0 * 0.5
    const shinOrig = frame.get('HShin')!;
    const rootOrig = frame.get('HTorso')!;
    const shin = processed.get('HShin')!;
    // local offset halved
    expect(shin.pos[2] - root.pos[2]).toBeCloseTo((shinOrig.pos[2] - rootOrig.pos[2]) * 0.5, 9);
    engine.dispose();
  });
});
