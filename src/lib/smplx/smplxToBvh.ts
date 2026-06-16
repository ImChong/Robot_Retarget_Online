/**
 * SMPL-X model + AMASS motion → LAFAN1-style BVH text.
 *
 * The whole app already turns a new input into BVH text that flows through
 * `parseBvh` → viewer and `bvhToLafan1Frames` → retargeting (the Video→BVH path
 * does the same). For SMPL-X this conversion is *lossless*: BVH stores per-joint
 * *local* rotations, which the SMPL-X pose parameters already are (axis-angle per
 * joint), and the bone offsets are exactly the shape-dependent rest-joint
 * offsets. So `parseBvh`'s FK reproduces the SMPL-X joints exactly, and
 * `bvhToLafan1Frames` keys the human frames by SMPL-X joint name — matching the
 * bundled `smplx_to_<robot>.json` configs.
 *
 * Emitted in centimeters / Y-up (the LAFAN1 BVH convention) so the size
 * heuristic, viewer camera and downstream cm→m + Y-up→Z-up handling all behave
 * exactly as for a LAFAN1 clip.
 */

import { axisAngleToQuat } from './fk';
import { quatToEulerZYX, type Quat } from '../math3d';
import { restJoints } from './fk';
import {
  SMPLX_BODY_JOINT_NAMES,
  SMPLX_NUM_BODY_JOINTS,
  type SmplxBodyModel,
  type SmplxMotion,
} from './model';

const DEG = 180 / Math.PI;
const M_TO_CM = 100;

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(6) : '0.000000';
}

export interface SmplxToBvhResult {
  bvh: string;
  fps: number;
  frameCount: number;
}

/** Build a LAFAN1-style BVH string (cm, Y-up) from a SMPL-X model + motion. */
export function smplxToBvh(model: SmplxBodyModel, motion: SmplxMotion): SmplxToBvhResult {
  const numBody = Math.min(SMPLX_NUM_BODY_JOINTS, model.numJoints);
  const names = SMPLX_BODY_JOINT_NAMES.slice(0, numBody);
  const parents = model.parents;
  const rest = restJoints(model, motion.betas, numBody); // meters, Y-up

  const childrenOf: number[][] = names.map(() => []);
  for (let j = 1; j < numBody; j++) {
    const p = parents[j] >= 0 && parents[j] < numBody ? parents[j] : 0;
    childrenOf[p].push(j);
  }

  // Local rest offsets (cm). Root offset is 0; its location rides the position
  // channels so the floating base is fully described per frame.
  const offset = (j: number): [number, number, number] => {
    if (j === 0) return [0, 0, 0];
    const p = parents[j] >= 0 && parents[j] < numBody ? parents[j] : 0;
    return [
      (rest[j * 3] - rest[p * 3]) * M_TO_CM,
      (rest[j * 3 + 1] - rest[p * 3 + 1]) * M_TO_CM,
      (rest[j * 3 + 2] - rest[p * 3 + 2]) * M_TO_CM,
    ];
  };

  // ---- HIERARCHY ----
  const lines: string[] = ['HIERARCHY'];
  const writeJoint = (j: number, depth: number) => {
    const pad = '\t'.repeat(depth);
    const kw = j === 0 ? `ROOT ${names[j]}` : `JOINT ${names[j]}`;
    const o = offset(j);
    lines.push(`${pad}${kw}`);
    lines.push(`${pad}{`);
    lines.push(`${pad}\tOFFSET ${fmt(o[0])} ${fmt(o[1])} ${fmt(o[2])}`);
    lines.push(
      j === 0
        ? `${pad}\tCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation`
        : `${pad}\tCHANNELS 3 Zrotation Yrotation Xrotation`,
    );
    if (childrenOf[j].length === 0) {
      // Leaf joint: BVH requires an End Site to close the chain.
      lines.push(`${pad}\tEnd Site`);
      lines.push(`${pad}\t{`);
      lines.push(`${pad}\t\tOFFSET 0.000000 0.000000 0.000000`);
      lines.push(`${pad}\t}`);
    } else {
      for (const c of childrenOf[j]) writeJoint(c, depth + 1);
    }
    lines.push(`${pad}}`);
  };
  writeJoint(0, 0);
  const header = lines.join('\n') + '\n';

  // ---- MOTION ----
  const rows: string[] = [];
  for (const fp of motion.frames) {
    // Root world position (cm): rest root + global translation.
    const rootPos = [
      (rest[0] + fp.trans[0]) * M_TO_CM,
      (rest[1] + fp.trans[1]) * M_TO_CM,
      (rest[2] + fp.trans[2]) * M_TO_CM,
    ];
    const vals: number[] = [rootPos[0], rootPos[1], rootPos[2]];
    for (let j = 0; j < numBody; j++) {
      const q: Quat =
        j === 0
          ? axisAngleToQuat(fp.rootOrient[0], fp.rootOrient[1], fp.rootOrient[2])
          : axisAngleToQuat(
              fp.bodyPose[(j - 1) * 3],
              fp.bodyPose[(j - 1) * 3 + 1],
              fp.bodyPose[(j - 1) * 3 + 2],
            );
      const e = quatToEulerZYX(q); // [z, y, x] radians, inverse of BVH ZYX parse
      vals.push(e[0] * DEG, e[1] * DEG, e[2] * DEG);
    }
    rows.push(vals.map(fmt).join(' '));
  }

  const motionBlock = `MOTION\nFrames: ${motion.frames.length}\nFrame Time: ${(1 / motion.fps).toFixed(6)}\n${rows.join('\n')}\n`;
  return { bvh: header + motionBlock, fps: motion.fps, frameCount: motion.frames.length };
}
