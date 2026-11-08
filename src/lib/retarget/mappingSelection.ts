/**
 * Shared selection state for the Retarget Config page: a robot body or a BVH
 * joint picked in the 3D view, or a row picked in a Stage 1 / Stage 2 table,
 * resolved to the mapping rows it belongs to.
 *
 * A mapping is identified by stage + robot body: the robot body is the table
 * key, so it is unique within a stage, while a BVH joint can drive several
 * robot bodies and the same robot body can appear in both stages. Matches are
 * always listed in the same order — preferred stage first, then the other one,
 * each in table order — so a pick never lands on an arbitrary row. Picking the
 * same object again steps to its next match.
 *
 * Pure data: nothing here edits the config.
 */

import type { GmrIkConfig, IkMatchEntry } from './types';

export type MappingStage = 'stage1' | 'stage2';

export const MAPPING_STAGES: readonly MappingStage[] = ['stage1', 'stage2'];

/** One row of a stage table. */
export interface MappingMatch {
  stage: MappingStage;
  robotBody: string;
  humanJoint: string;
}

/** What a selection was made from. */
export type SelectionSource =
  | { kind: 'robot'; body: string }
  | { kind: 'human'; joint: string }
  | { kind: 'row'; stage: MappingStage; robotBody: string };

export interface MappingSelection {
  source: SelectionSource;
  /** Mapping rows of the source, in display order (may be empty: an unmapped body / joint). */
  matches: MappingMatch[];
  /** The focused match; 0 when there are none. */
  index: number;
}

type MatchTables = Pick<GmrIkConfig, 'ik_match_table1' | 'ik_match_table2'>;

/**
 * GMR's virtual LAFAN1 joints take their position from a real one (see
 * `src/lib/bvh/lafan1.ts`), so on the skeleton they sit on that joint.
 */
const VIRTUAL_JOINT_BASE: Record<string, string> = {
  LeftFootMod: 'LeftFoot',
  RightFootMod: 'RightFoot',
};

/** The skeleton joint a table's human-joint name is drawn at. */
export function skeletonJointName(humanJoint: string): string {
  return VIRTUAL_JOINT_BASE[humanJoint] ?? humanJoint;
}

export function isMappingStage(value: unknown): value is MappingStage {
  return value === 'stage1' || value === 'stage2';
}

export function stageTable(config: MatchTables, stage: MappingStage): Record<string, IkMatchEntry> {
  return stage === 'stage1' ? config.ik_match_table1 : config.ik_match_table2;
}

/** Stages in lookup order: the preferred one (the open tab) first. */
export function stageOrder(preferred: string | null | undefined): MappingStage[] {
  return preferred === 'stage2' ? ['stage2', 'stage1'] : ['stage1', 'stage2'];
}

export function mappingKey(match: Pick<MappingMatch, 'stage' | 'robotBody'>): string {
  return `${match.stage}:${match.robotBody}`;
}

export function sameMapping(
  a: Pick<MappingMatch, 'stage' | 'robotBody'> | null | undefined,
  b: Pick<MappingMatch, 'stage' | 'robotBody'> | null | undefined,
): boolean {
  return !!a && !!b && a.stage === b.stage && a.robotBody === b.robotBody;
}

export function sameSource(a: SelectionSource, b: SelectionSource): boolean {
  if (a.kind === 'robot' && b.kind === 'robot') return a.body === b.body;
  if (a.kind === 'human' && b.kind === 'human') return a.joint === b.joint;
  if (a.kind === 'row' && b.kind === 'row') return a.stage === b.stage && a.robotBody === b.robotBody;
  return false;
}

export function sameSelection(a: MappingSelection | null, b: MappingSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b || !sameSource(a.source, b.source) || a.index !== b.index) return false;
  return (
    a.matches.length === b.matches.length &&
    a.matches.every((m, i) => sameMapping(m, b.matches[i]) && m.humanJoint === b.matches[i].humanJoint)
  );
}

/**
 * Every mapping row `source` belongs to, preferred stage first, then table
 * order. A table row stands for its robot body, with its own stage first.
 */
export function findMappings(
  config: MatchTables,
  source: SelectionSource,
  preferredStage?: string | null,
): MappingMatch[] {
  const out: MappingMatch[] = [];
  const order = stageOrder(source.kind === 'row' ? source.stage : preferredStage);
  for (const stage of order) {
    const table = stageTable(config, stage);
    if (source.kind !== 'human') {
      const body = source.kind === 'row' ? source.robotBody : source.body;
      const entry = table[body];
      if (entry) out.push({ stage, robotBody: body, humanJoint: entry[0] });
      continue;
    }
    for (const [robotBody, entry] of Object.entries(table)) {
      if (skeletonJointName(entry[0]) === source.joint) out.push({ stage, robotBody, humanJoint: entry[0] });
    }
  }
  return out;
}

export function focusedMatch(selection: MappingSelection | null | undefined): MappingMatch | null {
  return selection?.matches[selection.index] ?? null;
}

/**
 * Select `source`. Picking the source that is already selected steps to its
 * next match (wrapping), so every row of a many-to-one mapping is reachable.
 */
export function selectSource(
  config: MatchTables,
  source: SelectionSource,
  preferredStage: string | null | undefined,
  previous: MappingSelection | null,
): MappingSelection {
  const matches = findMappings(config, source, preferredStage);
  if (previous && sameSource(previous.source, source) && matches.length > 1) {
    const at = matches.findIndex((m) => sameMapping(m, focusedMatch(previous)));
    return { source, matches, index: (at + 1) % matches.length };
  }
  return { source, matches, index: 0 };
}

/** Step the focus by `delta` matches (wrapping). */
export function stepSelection(selection: MappingSelection, delta: number): MappingSelection {
  const n = selection.matches.length;
  if (n < 2) return selection;
  return { ...selection, index: (((selection.index + delta) % n) + n) % n };
}

/**
 * Re-resolve a selection after the config changed (a row renamed or remapped,
 * a config imported or reset). The focus stays on the same row while it still
 * matches. A table-row selection whose body is gone from both stages is
 * dropped; a picked body or joint stays selected, possibly now unmapped.
 */
export function refreshSelection(
  config: MatchTables,
  selection: MappingSelection | null,
  preferredStage: string | null | undefined,
): MappingSelection | null {
  if (!selection) return null;
  const matches = findMappings(config, selection.source, preferredStage);
  if (selection.source.kind === 'row' && matches.length === 0) return null;
  const at = matches.findIndex((m) => sameMapping(m, focusedMatch(selection)));
  return { source: selection.source, matches, index: Math.max(0, at) };
}

/**
 * The user opened another stage tab: move the focus onto that stage's match if
 * the selection has one there; otherwise leave it where it is.
 */
export function focusStage(selection: MappingSelection | null, stage: string): MappingSelection | null {
  if (!selection || !isMappingStage(stage)) return selection;
  if (focusedMatch(selection)?.stage === stage) return selection;
  const at = selection.matches.findIndex((m) => m.stage === stage);
  return at < 0 ? selection : { ...selection, index: at };
}
