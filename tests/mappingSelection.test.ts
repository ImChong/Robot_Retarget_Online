import { describe, expect, it } from 'vitest';
import { getDefaultConfig } from '../src/lib/retarget/defaults';
import {
  findMappings,
  focusedMatch,
  focusStage,
  refreshSelection,
  sameSelection,
  selectSource,
  skeletonJointName,
  stepSelection,
} from '../src/lib/retarget/mappingSelection';
import type { GmrIkConfig, IkMatchEntry } from '../src/lib/retarget/types';

const entry = (joint: string): IkMatchEntry => [joint, 1, 1, [0, 0, 0], [1, 0, 0, 0]];

/** Two stages: `chest` drives two bodies in stage 1; `pelvis` is mapped in both stages. */
function miniConfig(): Pick<GmrIkConfig, 'ik_match_table1' | 'ik_match_table2'> {
  return {
    ik_match_table1: {
      pelvis: entry('Hips'),
      torso: entry('Chest'),
      neck: entry('Chest'),
      left_foot: entry('LeftFootMod'),
    },
    ik_match_table2: {
      pelvis: entry('Hips'),
      head: entry('Chest'),
    },
  };
}

const keys = (ms: { stage: string; robotBody: string }[]) => ms.map((m) => `${m.stage}:${m.robotBody}`);

describe('mapping lookup', () => {
  it('finds a robot body in every stage, preferred stage first', () => {
    const cfg = miniConfig();
    expect(keys(findMappings(cfg, { kind: 'robot', body: 'pelvis' }, 'stage1'))).toEqual([
      'stage1:pelvis',
      'stage2:pelvis',
    ]);
    expect(keys(findMappings(cfg, { kind: 'robot', body: 'pelvis' }, 'stage2'))).toEqual([
      'stage2:pelvis',
      'stage1:pelvis',
    ]);
    // The scale tab is not a stage: fall back to stage 1 first.
    expect(keys(findMappings(cfg, { kind: 'robot', body: 'pelvis' }, 'scale'))[0]).toBe('stage1:pelvis');
  });

  it('lists every body a BVH joint drives, in table order', () => {
    const cfg = miniConfig();
    expect(keys(findMappings(cfg, { kind: 'human', joint: 'Chest' }, 'stage1'))).toEqual([
      'stage1:torso',
      'stage1:neck',
      'stage2:head',
    ]);
    expect(keys(findMappings(cfg, { kind: 'human', joint: 'Chest' }, 'stage2'))).toEqual([
      'stage2:head',
      'stage1:torso',
      'stage1:neck',
    ]);
  });

  it('maps the virtual LAFAN1 foot joints onto the skeleton joint they sit on', () => {
    expect(skeletonJointName('LeftFootMod')).toBe('LeftFoot');
    expect(skeletonJointName('LeftFoot')).toBe('LeftFoot');
    const matches = findMappings(miniConfig(), { kind: 'human', joint: 'LeftFoot' }, 'stage1');
    expect(matches).toEqual([{ stage: 'stage1', robotBody: 'left_foot', humanJoint: 'LeftFootMod' }]);
  });

  it('returns nothing for an unmapped body or joint', () => {
    const cfg = miniConfig();
    expect(findMappings(cfg, { kind: 'robot', body: 'left_knee' }, 'stage1')).toEqual([]);
    expect(findMappings(cfg, { kind: 'human', joint: 'LeftHand' }, 'stage1')).toEqual([]);
    expect(findMappings(cfg, { kind: 'row', stage: 'stage2', robotBody: 'left_knee' }, 'stage2')).toEqual([]);
  });

  it('resolves a table row to its robot body, the row itself first', () => {
    const cfg = miniConfig();
    // The open tab does not reorder a row pick: the clicked row stays focused.
    expect(keys(findMappings(cfg, { kind: 'row', stage: 'stage2', robotBody: 'pelvis' }, 'stage1'))).toEqual([
      'stage2:pelvis',
      'stage1:pelvis',
    ]);
    expect(keys(findMappings(cfg, { kind: 'row', stage: 'stage1', robotBody: 'torso' }, 'stage1'))).toEqual([
      'stage1:torso',
    ]);
  });

  it('resolves every G1 BVH mapping from both sides to the same rows', () => {
    const cfg = getDefaultConfig('unitree_g1');
    for (const [robotBody, [humanJoint]] of Object.entries(cfg.ik_match_table1)) {
      const fromRobot = findMappings(cfg, { kind: 'robot', body: robotBody }, 'stage1');
      expect(fromRobot[0]).toEqual({ stage: 'stage1', robotBody, humanJoint });
      const fromHuman = findMappings(cfg, { kind: 'human', joint: skeletonJointName(humanJoint) }, 'stage1');
      expect(fromHuman[0]).toEqual({ stage: 'stage1', robotBody, humanJoint });
    }
  });
});

describe('selection', () => {
  it('steps through the matches when the same object is picked again', () => {
    const cfg = miniConfig();
    const chest = { kind: 'human', joint: 'Chest' } as const;
    let sel = selectSource(cfg, chest, 'stage1', null);
    expect(focusedMatch(sel)?.robotBody).toBe('torso');
    sel = selectSource(cfg, chest, 'stage1', sel);
    expect(focusedMatch(sel)?.robotBody).toBe('neck');
    sel = selectSource(cfg, chest, 'stage1', sel);
    expect(focusedMatch(sel)).toMatchObject({ stage: 'stage2', robotBody: 'head' });
    // Picking again from the stage-2 tab keeps the order stable and wraps.
    sel = selectSource(cfg, chest, 'stage2', sel);
    expect(focusedMatch(sel)).toMatchObject({ stage: 'stage1', robotBody: 'torso' });
  });

  it('starts over on a different object, and keeps a single match in place', () => {
    const cfg = miniConfig();
    let sel = selectSource(cfg, { kind: 'human', joint: 'Chest' }, 'stage1', null);
    sel = selectSource(cfg, { kind: 'human', joint: 'Chest' }, 'stage1', sel);
    sel = selectSource(cfg, { kind: 'robot', body: 'torso' }, 'stage1', sel);
    expect(sel.index).toBe(0);
    expect(selectSource(cfg, { kind: 'robot', body: 'torso' }, 'stage1', sel).index).toBe(0);
  });

  it('keeps an unmapped pick selected with no match', () => {
    const sel = selectSource(miniConfig(), { kind: 'robot', body: 'left_knee' }, 'stage1', null);
    expect(sel.matches).toEqual([]);
    expect(focusedMatch(sel)).toBeNull();
  });

  it('steps both ways with wrap-around', () => {
    const sel = selectSource(miniConfig(), { kind: 'human', joint: 'Chest' }, 'stage1', null);
    expect(stepSelection(sel, -1).index).toBe(2);
    expect(stepSelection(sel, 4).index).toBe(1);
    const single = selectSource(miniConfig(), { kind: 'robot', body: 'torso' }, 'stage1', null);
    expect(stepSelection(single, 1)).toBe(single);
  });

  it('moves the focus onto the stage tab the user opens', () => {
    const cfg = miniConfig();
    const row = selectSource(cfg, { kind: 'row', stage: 'stage2', robotBody: 'pelvis' }, 'stage2', null);
    expect(focusedMatch(focusStage(row, 'stage1'))).toMatchObject({ stage: 'stage1', robotBody: 'pelvis' });
    const sel = selectSource(cfg, { kind: 'robot', body: 'pelvis' }, 'stage1', null);
    expect(focusedMatch(focusStage(sel, 'stage2'))?.stage).toBe('stage2');
    expect(focusStage(sel, 'stage1')).toBe(sel);
    expect(focusStage(sel, 'scale')).toBe(sel);
    const torso = selectSource(cfg, { kind: 'robot', body: 'torso' }, 'stage1', null);
    expect(focusStage(torso, 'stage2')).toBe(torso); // no stage-2 row: stays put
  });
});

describe('selection after config edits', () => {
  it('follows the focused row while it still matches', () => {
    const cfg = miniConfig();
    let sel = selectSource(cfg, { kind: 'human', joint: 'Chest' }, 'stage1', null);
    sel = selectSource(cfg, { kind: 'human', joint: 'Chest' }, 'stage1', sel); // neck
    delete cfg.ik_match_table1.torso;
    const next = refreshSelection(cfg, sel, 'stage1')!;
    expect(focusedMatch(next)?.robotBody).toBe('neck');
    expect(next.matches).toHaveLength(2);
  });

  it('drops a table-row selection whose body is gone, keeps a 3D pick as unmapped', () => {
    const cfg = miniConfig();
    const row = selectSource(cfg, { kind: 'row', stage: 'stage1', robotBody: 'torso' }, 'stage1', null);
    const pick = selectSource(cfg, { kind: 'robot', body: 'torso' }, 'stage1', null);
    cfg.ik_match_table1.chest = cfg.ik_match_table1.torso;
    delete cfg.ik_match_table1.torso;
    expect(refreshSelection(cfg, row, 'stage1')).toBeNull();
    const after = refreshSelection(cfg, pick, 'stage1')!;
    expect(after.matches).toEqual([]);
    expect(focusedMatch(after)).toBeNull();
  });

  it('reports no change when nothing relevant changed', () => {
    const cfg = miniConfig();
    const sel = selectSource(cfg, { kind: 'robot', body: 'pelvis' }, 'stage1', null);
    cfg.ik_match_table1.pelvis[1] = 42; // a weight edit
    expect(sameSelection(refreshSelection(cfg, sel, 'stage1'), sel)).toBe(true);
    cfg.ik_match_table1.pelvis[0] = 'Spine';
    expect(sameSelection(refreshSelection(cfg, sel, 'stage1'), sel)).toBe(false);
    expect(refreshSelection(cfg, null, 'stage1')).toBeNull();
  });
});
