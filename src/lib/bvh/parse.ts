/**
 * BVH parser producing local joint transforms per frame.
 *
 * Mirrors GMR's lafan_vendor/extract.py behaviour (euler->quat composition,
 * per-frame quaternion sign continuity) while being tolerant of common BVH
 * dialects (3-channel joints, arbitrary rotation orders, End Sites).
 */

import { eulerToQuat, type Quat, type Vec3 } from '../math3d';

export interface BvhJoint {
  name: string;
  parent: number; // -1 for root
  offset: Vec3; // local offset (file units)
  channels: string[]; // e.g. ["Xposition", ..., "Zrotation", ...]
  rotOrder: string; // e.g. "zyx" (subset of channels)
  hasPos: boolean;
}

export interface BvhEndSite {
  parent: number;
  offset: Vec3;
}

export interface BvhAnim {
  joints: BvhJoint[];
  endSites: BvhEndSite[];
  frameCount: number;
  frameTime: number;
  /** local positions per frame: [frame][joint] -> Vec3 (file units) */
  localPos: Float64Array; // frameCount * J * 3
  /** local quaternions per frame (wxyz): frameCount * J * 4 */
  localQuat: Float64Array;
}

const CHANNEL_AXIS: Record<string, string> = {
  Xrotation: 'x',
  Yrotation: 'y',
  Zrotation: 'z',
};

export function parseBvh(text: string): BvhAnim {
  const lines = text.split(/\r?\n/);
  const joints: BvhJoint[] = [];
  const endSites: BvhEndSite[] = [];

  let active = -1;
  let inEndSite = false;
  let li = 0;

  // ---- HIERARCHY ----
  for (; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line || line === 'HIERARCHY' || line === '{') continue;
    if (line.startsWith('MOTION')) {
      li++;
      break;
    }

    if (line === '}') {
      if (inEndSite) inEndSite = false;
      else if (active >= 0) active = joints[active].parent;
      continue;
    }

    const rootMatch = line.match(/^ROOT\s+(.+)$/);
    const jointMatch = line.match(/^JOINT\s+(.+)$/);
    if (rootMatch || jointMatch) {
      const name = (rootMatch ?? jointMatch)![1].trim();
      joints.push({
        name,
        parent: active,
        offset: [0, 0, 0],
        channels: [],
        rotOrder: 'zyx',
        hasPos: false,
      });
      active = joints.length - 1;
      continue;
    }

    if (/^End Site/i.test(line)) {
      inEndSite = true;
      endSites.push({ parent: active, offset: [0, 0, 0] });
      continue;
    }

    const offsetMatch = line.match(/^OFFSET\s+(\S+)\s+(\S+)\s+(\S+)/);
    if (offsetMatch) {
      const off: Vec3 = [
        parseFloat(offsetMatch[1]),
        parseFloat(offsetMatch[2]),
        parseFloat(offsetMatch[3]),
      ];
      if (inEndSite) endSites[endSites.length - 1].offset = off;
      else joints[active].offset = off;
      continue;
    }

    const chanMatch = line.match(/^CHANNELS\s+(\d+)\s*(.*)$/);
    if (chanMatch) {
      const chans = chanMatch[2].trim().split(/\s+/).filter(Boolean);
      const j = joints[active];
      j.channels = chans;
      j.hasPos = chans.some((c) => c.endsWith('position'));
      const rot = chans.filter((c) => c in CHANNEL_AXIS).map((c) => CHANNEL_AXIS[c]);
      if (rot.length === 3) j.rotOrder = rot.join('');
      continue;
    }
  }

  if (joints.length === 0) throw new Error('Invalid BVH: no joints found');

  // ---- MOTION ----
  let frameCount = 0;
  let frameTime = 1 / 30;
  for (; li < lines.length; li++) {
    const line = lines[li].trim();
    const fMatch = line.match(/^Frames:\s*(\d+)/i);
    if (fMatch) {
      frameCount = parseInt(fMatch[1], 10);
      continue;
    }
    const ftMatch = line.match(/^Frame Time:\s*([\d.eE+-]+)/i);
    if (ftMatch) {
      frameTime = parseFloat(ftMatch[1]);
      li++;
      break;
    }
  }

  const J = joints.length;
  const localPos = new Float64Array(frameCount * J * 3);
  const localQuat = new Float64Array(frameCount * J * 4);

  // Initialize positions with offsets (joints without position channels keep them).
  for (let f = 0; f < frameCount; f++) {
    for (let j = 0; j < J; j++) {
      const base = (f * J + j) * 3;
      localPos[base] = joints[j].offset[0];
      localPos[base + 1] = joints[j].offset[1];
      localPos[base + 2] = joints[j].offset[2];
    }
  }

  const DEG = Math.PI / 180;
  let frame = 0;
  for (; li < lines.length && frame < frameCount; li++) {
    const line = lines[li].trim();
    if (!line) continue;
    const values = line.split(/\s+/);
    let vi = 0;
    for (let j = 0; j < J; j++) {
      const joint = joints[j];
      const pBase = (frame * J + j) * 3;
      const e: Vec3 = [0, 0, 0];
      let ei = 0;
      for (const ch of joint.channels) {
        const v = parseFloat(values[vi++]);
        switch (ch) {
          case 'Xposition':
            localPos[pBase] = v;
            break;
          case 'Yposition':
            localPos[pBase + 1] = v;
            break;
          case 'Zposition':
            localPos[pBase + 2] = v;
            break;
          case 'Xrotation':
          case 'Yrotation':
          case 'Zrotation':
            e[ei++] = v * DEG;
            break;
        }
      }
      const q = eulerToQuat(e, joint.rotOrder);
      const qBase = (frame * J + j) * 4;
      localQuat[qBase] = q[0];
      localQuat[qBase + 1] = q[1];
      localQuat[qBase + 2] = q[2];
      localQuat[qBase + 3] = q[3];
    }
    frame++;
  }

  const anim: BvhAnim = {
    joints,
    endSites,
    frameCount: frame,
    frameTime,
    localPos,
    localQuat,
  };
  removeQuatDiscontinuities(anim);
  return anim;
}

/** Flip quaternion signs along time so consecutive frames stay in the same hemisphere. */
function removeQuatDiscontinuities(anim: BvhAnim) {
  const { frameCount, joints, localQuat } = anim;
  const J = joints.length;
  for (let f = 1; f < frameCount; f++) {
    for (let j = 0; j < J; j++) {
      const prev = ((f - 1) * J + j) * 4;
      const cur = (f * J + j) * 4;
      let dot = 0;
      for (let k = 0; k < 4; k++) dot += localQuat[prev + k] * localQuat[cur + k];
      if (dot < 0) {
        for (let k = 0; k < 4; k++) localQuat[cur + k] = -localQuat[cur + k];
      }
    }
  }
}

/** Forward kinematics: returns global pos/quat arrays (same layout as local). */
export function bvhFk(anim: BvhAnim): { globalPos: Float64Array; globalQuat: Float64Array } {
  const { frameCount, joints, localPos, localQuat } = anim;
  const J = joints.length;
  const globalPos = new Float64Array(frameCount * J * 3);
  const globalQuat = new Float64Array(frameCount * J * 4);

  for (let f = 0; f < frameCount; f++) {
    for (let j = 0; j < J; j++) {
      const p = joints[j].parent;
      const lp: Vec3 = [
        localPos[(f * J + j) * 3],
        localPos[(f * J + j) * 3 + 1],
        localPos[(f * J + j) * 3 + 2],
      ];
      const lq: Quat = [
        localQuat[(f * J + j) * 4],
        localQuat[(f * J + j) * 4 + 1],
        localQuat[(f * J + j) * 4 + 2],
        localQuat[(f * J + j) * 4 + 3],
      ];
      let gp: Vec3;
      let gq: Quat;
      if (p < 0) {
        gp = lp;
        gq = lq;
      } else {
        const pq: Quat = [
          globalQuat[(f * J + p) * 4],
          globalQuat[(f * J + p) * 4 + 1],
          globalQuat[(f * J + p) * 4 + 2],
          globalQuat[(f * J + p) * 4 + 3],
        ];
        const pp: Vec3 = [
          globalPos[(f * J + p) * 3],
          globalPos[(f * J + p) * 3 + 1],
          globalPos[(f * J + p) * 3 + 2],
        ];
        const rotated = rotateVec(pq, lp);
        gp = [pp[0] + rotated[0], pp[1] + rotated[1], pp[2] + rotated[2]];
        gq = mulQuat(pq, lq);
      }
      globalPos.set(gp, (f * J + j) * 3);
      globalQuat.set(gq, (f * J + j) * 4);
    }
  }
  return { globalPos, globalQuat };
}

// Local helpers (avoid importing array-creating versions in hot loop)
function mulQuat(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function rotateVec(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/**
 * Mocap helper / collision joints that should not be drawn as anatomy
 * (Biped Footsteps, end-site Nubs, dog armor hulls, etc.).
 */
export function isDecorJoint(name: string): boolean {
  return (
    /Footsteps/i.test(name) ||
    /Nub$/i.test(name) ||
    /^Dog_.*Armor/i.test(name) ||
    // Biped internal tail; Dog_LeftTail is the visible mesh chain.
    /^b_Tail\d+$/i.test(name)
  );
}

/** Preferred motion-root joint for camera / viewport anchoring. */
export function resolveMotionRootJoint(anim: BvhAnim): number {
  for (const name of ['Hips', 'b_Hips']) {
    const idx = anim.joints.findIndex((j) => j.name === name);
    if (idx >= 0) return idx;
  }
  return 0;
}

/** Rough skeleton height in file units (max reach from root along Y/Z up-axis guess). */
export function estimateSkeletonSize(anim: BvhAnim): number {
  // Use first frame global positions extent.
  const { globalPos } = bvhFk(sliceFirstFrame(anim));
  let min = Infinity;
  let max = -Infinity;
  const J = anim.joints.length;
  for (let j = 0; j < J; j++) {
    const y = globalPos[j * 3 + 1];
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return max - min;
}

function sliceFirstFrame(anim: BvhAnim): BvhAnim {
  const J = anim.joints.length;
  return {
    ...anim,
    frameCount: 1,
    localPos: anim.localPos.slice(0, J * 3),
    localQuat: anim.localQuat.slice(0, J * 4),
  };
}
