import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mergeConfigForRobot } from '../src/stores/retarget';
import { getDefaultConfig } from '../src/lib/retarget/defaults';
import { DEFAULT_SOLVER_OPTIONS } from '../src/lib/retarget/types';
import { useRetargetStore } from '../src/stores/retarget';

describe('retarget store robot switching', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('restores cached config when switching back to a robot', () => {
    const store = useRetargetStore();
    store.config.human_height_assumption = 1.65;
    store.solver.damping = 0.9;
    store.solver.actualHumanHeight = 1.6;

    store.setRobot('booster_t1_29dof');
    expect(store.robotId).toBe('booster_t1_29dof');

    store.setRobot('unitree_g1');
    expect(store.config.human_height_assumption).toBe(1.65);
    expect(store.solver.damping).toBe(0.9);
    expect(store.solver.actualHumanHeight).toBe(1.6);
  });

  it('preserves global params on first visit to another robot', () => {
    const store = useRetargetStore();
    store.config.human_height_assumption = 1.65;
    store.solver.damping = 0.9;

    store.setRobot('booster_t1_29dof');

    expect(store.config.human_height_assumption).toBe(1.65);
    expect(store.solver.damping).toBe(0.9);
    expect(store.config.ik_match_table1).toEqual(getDefaultConfig('booster_t1_29dof').ik_match_table1);
  });

  it('resetConfig only affects the current robot', () => {
    const store = useRetargetStore();
    store.config.human_height_assumption = 1.65;
    store.setRobot('booster_t1_29dof');
    store.config.human_height_assumption = 1.55;

    store.resetConfig();
    expect(store.config.human_height_assumption).toBe(1.8);

    store.setRobot('unitree_g1');
    expect(store.config.human_height_assumption).toBe(1.65);
  });
});

describe('mergeConfigForRobot', () => {
  it('keeps user globals but loads robot-specific IK tables', () => {
    const g1 = getDefaultConfig('unitree_g1');
    g1.human_height_assumption = 1.65;
    g1.human_scale_table.Hips = 0.42;

    const merged = mergeConfigForRobot(g1, 'booster_t1_29dof');
    const t1Defaults = getDefaultConfig('booster_t1_29dof');

    expect(merged.human_height_assumption).toBe(1.65);
    expect(merged.human_scale_table.Hips).toBe(0.42);
    expect(merged.ik_match_table1).toEqual(t1Defaults.ik_match_table1);
    expect(merged.robot_root_name).toBe(t1Defaults.robot_root_name);
  });
});
