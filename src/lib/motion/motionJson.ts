/**
 * Retarget Motion JSON — a clean, self-describing skeletal-animation format.
 *
 * It carries the same information as a LAFAN1-style BVH (a joint hierarchy with
 * rest offsets + per-frame root translation and local joint rotations) but as a
 * plain, easy-to-author JSON document. Rotations are stored as quaternions
 * (wxyz), so there is no Euler channel-order ambiguity on load.
 *
 * Loading converts the document into the very same `BvhAnim` the BVH path
 * produces, so the viewer, the LAFAN1 → human-frame conversion and the
 * retargeting engine all consume it unchanged.
 *
 * Conventions (match the BVH/LAFAN1 pipeline):
 *  - Y-up, right-handed, in file units; `unitScale` maps file units → meters
 *    (default 0.01 for centimetres). The Y-up → Z-up conversion happens later in
 *    `bvhToLafan1Frames`, identical to BVH.
 *  - Exactly one root joint (`parent: -1`); its translation comes from
 *    `rootPositions`. Non-root joints use their rest `offset` for position.
 */

import { quatNormalize, type Vec3 } from '../math3d';
import {
  removeQuatDiscontinuities,
  type BvhAnim,
  type BvhJoint,
} from '../bvh/parse';

export const MOTION_JSON_FORMAT = 'retarget_motion_json';
export const MOTION_JSON_VERSION = 1;

export interface MotionJsonJoint {
  name: string;
  /** Index into `skeleton` of the parent joint, or -1 for the root. */
  parent: number;
  /** Local rest offset (file units, Y-up). */
  offset: [number, number, number];
}

export interface MotionJsonEndSite {
  parent: number;
  offset: [number, number, number];
}

export interface MotionJsonDoc {
  format: typeof MOTION_JSON_FORMAT;
  version: number;
  /** Frames per second. */
  fps: number;
  /** File units → meters. Default 0.01 (centimetres), the LAFAN1 convention. */
  unitScale?: number;
  /** Optional human-readable label. */
  name?: string;
  /** Up axis; only "Y" is supported (matches the BVH/LAFAN1 pipeline). */
  upAxis?: 'Y';
  skeleton: MotionJsonJoint[];
  endSites?: MotionJsonEndSite[];
  /** Per-frame root translation: `[frame][3]` (file units). Defaults to origin. */
  rootPositions?: number[][];
  /** Per-frame local rotations: `[frame][joint][4]` as wxyz quaternions. */
  rotations: number[][][];
}

export interface ParsedMotionJson {
  anim: BvhAnim;
  /** File units → meters. */
  unitScale: number;
  name?: string;
}

const ROOT_CHANNELS = [
  'Xposition',
  'Yposition',
  'Zposition',
  'Zrotation',
  'Yrotation',
  'Xrotation',
];
const JOINT_CHANNELS = ['Zrotation', 'Yrotation', 'Xrotation'];

function asVec3(v: unknown, where: string): Vec3 {
  if (!Array.isArray(v) || v.length < 3) {
    throw new Error(`Motion JSON: expected [x, y, z] at ${where}`);
  }
  return [Number(v[0]), Number(v[1]), Number(v[2])];
}

/** Parse a Retarget Motion JSON document (object or string) into a `BvhAnim`. */
export function parseMotionJson(input: string | unknown): ParsedMotionJson {
  const doc = (typeof input === 'string' ? JSON.parse(input) : input) as Partial<MotionJsonDoc>;
  if (typeof doc !== 'object' || doc === null) {
    throw new Error('Motion JSON: document must be an object');
  }
  if (doc.format && doc.format !== MOTION_JSON_FORMAT) {
    throw new Error(`Motion JSON: unsupported format "${doc.format}"`);
  }
  if (doc.upAxis && doc.upAxis !== 'Y') {
    throw new Error(`Motion JSON: only upAxis "Y" is supported (got "${doc.upAxis}")`);
  }
  const skeleton = doc.skeleton;
  if (!Array.isArray(skeleton) || skeleton.length === 0) {
    throw new Error('Motion JSON: "skeleton" must be a non-empty array');
  }
  const rotations = doc.rotations;
  if (!Array.isArray(rotations)) {
    throw new Error('Motion JSON: "rotations" must be an array of frames');
  }

  const J = skeleton.length;
  const joints: BvhJoint[] = skeleton.map((s, j) => {
    if (typeof s?.name !== 'string') throw new Error(`Motion JSON: skeleton[${j}] missing "name"`);
    const parent = Number(s.parent ?? -1);
    if (parent >= j) {
      throw new Error(`Motion JSON: skeleton[${j}] "${s.name}" parent must precede it (got ${parent})`);
    }
    return {
      name: s.name,
      parent,
      offset: asVec3(s.offset, `skeleton[${j}].offset`),
      channels: parent < 0 ? [...ROOT_CHANNELS] : [...JOINT_CHANNELS],
      rotOrder: 'zyx',
      hasPos: parent < 0,
    };
  });

  const rootIndices = joints.flatMap((j, i) => (j.parent < 0 ? [i] : []));
  if (rootIndices.length !== 1) {
    throw new Error(`Motion JSON: exactly one root joint required (found ${rootIndices.length})`);
  }
  const rootIdx = rootIndices[0];

  const endSites = (doc.endSites ?? []).map((e, i) => ({
    parent: Number(e?.parent ?? -1),
    offset: asVec3(e?.offset, `endSites[${i}].offset`),
  }));

  const frameCount = rotations.length;
  const rootPositions = doc.rootPositions;
  const localPos = new Float64Array(frameCount * J * 3);
  const localQuat = new Float64Array(frameCount * J * 4);

  for (let f = 0; f < frameCount; f++) {
    const frameRot = rotations[f];
    if (!Array.isArray(frameRot) || frameRot.length !== J) {
      throw new Error(
        `Motion JSON: rotations[${f}] must have ${J} quaternions (got ${
          Array.isArray(frameRot) ? frameRot.length : typeof frameRot
        })`,
      );
    }
    for (let j = 0; j < J; j++) {
      const base = (f * J + j) * 3;
      localPos[base] = joints[j].offset[0];
      localPos[base + 1] = joints[j].offset[1];
      localPos[base + 2] = joints[j].offset[2];

      const raw = frameRot[j];
      if (!Array.isArray(raw) || raw.length < 4) {
        throw new Error(`Motion JSON: rotations[${f}][${j}] must be [w, x, y, z]`);
      }
      const q = quatNormalize([Number(raw[0]), Number(raw[1]), Number(raw[2]), Number(raw[3])]);
      const qBase = (f * J + j) * 4;
      localQuat[qBase] = q[0];
      localQuat[qBase + 1] = q[1];
      localQuat[qBase + 2] = q[2];
      localQuat[qBase + 3] = q[3];
    }
    if (rootPositions && rootPositions[f]) {
      const rp = asVec3(rootPositions[f], `rootPositions[${f}]`);
      const base = (f * J + rootIdx) * 3;
      localPos[base] = rp[0];
      localPos[base + 1] = rp[1];
      localPos[base + 2] = rp[2];
    }
  }

  const fps = Number(doc.fps) > 0 ? Number(doc.fps) : 30;
  const anim: BvhAnim = {
    joints,
    endSites,
    frameCount,
    frameTime: 1 / fps,
    localPos,
    localQuat,
  };
  removeQuatDiscontinuities(anim);

  return {
    anim,
    unitScale: Number(doc.unitScale) > 0 ? Number(doc.unitScale) : 0.01,
    name: typeof doc.name === 'string' ? doc.name : undefined,
  };
}

/** True if `text`/`fileName` looks like a Retarget Motion JSON document. */
export function looksLikeMotionJson(text: string, fileName?: string): boolean {
  if (fileName && /\.json$/i.test(fileName)) return true;
  const head = text.trimStart();
  return head.startsWith('{') && head.includes(MOTION_JSON_FORMAT);
}

export interface SerializeMotionJsonOptions {
  /** File units → meters recorded in the document (default 0.01). */
  unitScale?: number;
  name?: string;
  /** Decimal places for offsets/positions/quaternions (default 6). */
  precision?: number;
}

/** Serialize a `BvhAnim` into a Retarget Motion JSON document. */
export function bvhAnimToMotionJson(
  anim: BvhAnim,
  opts: SerializeMotionJsonOptions = {},
): MotionJsonDoc {
  const precision = opts.precision ?? 6;
  const r = (x: number) => Number(x.toFixed(precision));
  const { joints, endSites, frameCount, frameTime, localPos, localQuat } = anim;
  const J = joints.length;
  const rootIdx = joints.findIndex((j) => j.parent < 0);

  const skeleton: MotionJsonJoint[] = joints.map((j) => ({
    name: j.name,
    parent: j.parent,
    offset: [r(j.offset[0]), r(j.offset[1]), r(j.offset[2])],
  }));

  const rootPositions: number[][] = [];
  const rotations: number[][][] = [];
  for (let f = 0; f < frameCount; f++) {
    const rBase = (f * J + rootIdx) * 3;
    rootPositions.push([r(localPos[rBase]), r(localPos[rBase + 1]), r(localPos[rBase + 2])]);
    const frame: number[][] = [];
    for (let j = 0; j < J; j++) {
      const qBase = (f * J + j) * 4;
      frame.push([
        r(localQuat[qBase]),
        r(localQuat[qBase + 1]),
        r(localQuat[qBase + 2]),
        r(localQuat[qBase + 3]),
      ]);
    }
    rotations.push(frame);
  }

  const doc: MotionJsonDoc = {
    format: MOTION_JSON_FORMAT,
    version: MOTION_JSON_VERSION,
    fps: r(frameTime > 0 ? 1 / frameTime : 30),
    unitScale: opts.unitScale ?? 0.01,
    upAxis: 'Y',
    skeleton,
    rootPositions,
    rotations,
  };
  if (opts.name) doc.name = opts.name;
  if (endSites.length > 0) {
    doc.endSites = endSites.map((e) => ({
      parent: e.parent,
      offset: [r(e.offset[0]), r(e.offset[1]), r(e.offset[2])],
    }));
  }
  return doc;
}

/** Convenience: serialize a `BvhAnim` to a JSON string. */
export function serializeMotionJson(anim: BvhAnim, opts: SerializeMotionJsonOptions = {}): string {
  return JSON.stringify(bvhAnimToMotionJson(anim, opts));
}
