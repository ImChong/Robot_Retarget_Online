/**
 * BVHView-style skeleton rendering: capsule bones + joint spheres, built as a
 * three.js hierarchy mirroring the BVH joint tree (three.js does the FK).
 *
 * The BVH file is Y-up in arbitrary units; a wrapper group rotates it into the
 * Z-up world and scales it to meters.
 */

import * as THREE from 'three';
import { estimateSkeletonSize, type BvhAnim } from '../bvh/parse';
import { blendKeypoints, frameBlendIndices } from './poseBlend';

const BONE_COLOR = 0x8d99ae;
const BONE_EMISSIVE = 0x10151c;
const JOINT_COLOR = 0x4fc3f7;
const SELECT_COLOR = 0xffb74d;

export interface SkeletonView {
  root: THREE.Group;
  setFrame(frame: number): void;
  /** Interpolate between adjacent frames for smooth playback. */
  setFrameBlend(frame: number): void;
  setSelected(jointIndex: number | null): void;
  /** Extra yaw (radians) about world Z applied after the Y-up→Z-up rotation. */
  setYaw(radians: number): void;
  /** Keep a joint at a fixed world position (call after setFrame). */
  lockJointToWorld(jointIndex: number, anchor: THREE.Vector3): void;
  /** world position of a joint (after wrapper transform) */
  getJointWorldPos(jointIndex: number, out: THREE.Vector3): THREE.Vector3;
  getJointWorldQuat(jointIndex: number, out: THREE.Quaternion): THREE.Quaternion;
  dispose(): void;
}

export function buildSkeletonView(anim: BvhAnim, unitScale: number): SkeletonView {
  const root = new THREE.Group();
  root.name = 'bvh-skeleton';
  const coord = new THREE.Group();
  coord.name = 'bvh-coord';
  // Y-up (BVH) -> Z-up (world): rotate +90° about X, then scale units -> meters.
  coord.rotation.x = Math.PI / 2;
  coord.scale.setScalar(unitScale);
  root.add(coord);

  const J = anim.joints.length;
  const jointGroups: THREE.Group[] = [];
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const jointSpheres: THREE.Mesh[] = [];
  const lockTmp = new THREE.Vector3();

  // Bone thickness relative to standing height (file units); use FK extent so
  // LAFAN1 root world offsets do not inflate capsule/sphere size.
  const skeletonSize = estimateSkeletonSize(anim);
  const boneRadius = Math.max(skeletonSize * 0.022, 1e-6);

  const boneMat = new THREE.MeshStandardMaterial({
    color: BONE_COLOR,
    emissive: BONE_EMISSIVE,
    roughness: 0.55,
    metalness: 0.15,
  });
  const jointMat = new THREE.MeshStandardMaterial({
    color: JOINT_COLOR,
    roughness: 0.35,
    metalness: 0.1,
  });
  const selectMat = new THREE.MeshStandardMaterial({
    color: SELECT_COLOR,
    emissive: 0x6b3c00,
    roughness: 0.3,
  });
  materials.push(boneMat, jointMat, selectMat);

  const sphereGeo = new THREE.SphereGeometry(boneRadius * 1.45, 16, 12);
  geometries.push(sphereGeo);

  for (let j = 0; j < J; j++) {
    const group = new THREE.Group();
    group.name = anim.joints[j].name;
    jointGroups.push(group);
    const parent = anim.joints[j].parent;
    if (parent < 0) coord.add(group);
    else jointGroups[parent].add(group);

    const sphere = new THREE.Mesh(sphereGeo, jointMat);
    sphere.castShadow = true;
    group.add(sphere);
    jointSpheres.push(sphere);
  }

  // Bones: capsule from each joint to its parent, attached to the parent group.
  const addBone = (parentIdx: number, offset: [number, number, number]) => {
    const len = Math.hypot(offset[0], offset[1], offset[2]);
    if (len < 1e-9) return;
    const capGeo = new THREE.CapsuleGeometry(boneRadius, len, 6, 14);
    geometries.push(capGeo);
    const bone = new THREE.Mesh(capGeo, boneMat);
    bone.castShadow = true;
    // Capsule axis is +Y; orient it along the offset, centered at the midpoint.
    const dir = new THREE.Vector3(offset[0], offset[1], offset[2]).normalize();
    bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    bone.position.set(offset[0] / 2, offset[1] / 2, offset[2] / 2);
    jointGroups[parentIdx].add(bone);
  };

  for (let j = 0; j < J; j++) {
    const parent = anim.joints[j].parent;
    if (parent >= 0) addBone(parent, anim.joints[j].offset);
  }
  for (const es of anim.endSites) {
    if (es.parent >= 0) addBone(es.parent, es.offset);
  }

  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const qBlend = new THREE.Quaternion();

  function setFrame(frame: number) {
    const f = Math.max(0, Math.min(Math.floor(frame), anim.frameCount - 1));
    for (let j = 0; j < J; j++) {
      const pBase = (f * J + j) * 3;
      const qBase = (f * J + j) * 4;
      const group = jointGroups[j];
      group.position.set(
        anim.localPos[pBase],
        anim.localPos[pBase + 1],
        anim.localPos[pBase + 2],
      );
      group.quaternion.set(
        anim.localQuat[qBase + 1],
        anim.localQuat[qBase + 2],
        anim.localQuat[qBase + 3],
        anim.localQuat[qBase],
      );
    }
  }

  function setFrameBlend(frame: number) {
    const { f0, f1, t } = frameBlendIndices(frame, anim.frameCount);
    if (t < 1e-6 || f0 === f1) {
      setFrame(f0);
      return;
    }
    for (let j = 0; j < J; j++) {
      const p0 = (f0 * J + j) * 3;
      const p1 = (f1 * J + j) * 3;
      const q0 = (f0 * J + j) * 4;
      const q1 = (f1 * J + j) * 4;
      const group = jointGroups[j];
      group.position.set(
        anim.localPos[p0] * (1 - t) + anim.localPos[p1] * t,
        anim.localPos[p0 + 1] * (1 - t) + anim.localPos[p1 + 1] * t,
        anim.localPos[p0 + 2] * (1 - t) + anim.localPos[p1 + 2] * t,
      );
      qA.set(anim.localQuat[q0 + 1], anim.localQuat[q0 + 2], anim.localQuat[q0 + 3], anim.localQuat[q0]);
      qB.set(anim.localQuat[q1 + 1], anim.localQuat[q1 + 2], anim.localQuat[q1 + 3], anim.localQuat[q1]);
      qBlend.copy(qA).slerp(qB, t);
      group.quaternion.copy(qBlend);
    }
  }

  let selected: number | null = null;
  function setSelected(jointIndex: number | null) {
    if (selected !== null) jointSpheres[selected].material = jointMat;
    selected = jointIndex;
    if (selected !== null) jointSpheres[selected].material = selectMat;
  }

  function getJointWorldPos(jointIndex: number, out: THREE.Vector3): THREE.Vector3 {
    return jointGroups[jointIndex].getWorldPosition(out);
  }

  function getJointWorldQuat(jointIndex: number, out: THREE.Quaternion): THREE.Quaternion {
    return jointGroups[jointIndex].getWorldQuaternion(out);
  }

  function setYaw(radians: number) {
    root.rotation.z = radians;
  }

  function lockJointToWorld(jointIndex: number, anchor: THREE.Vector3) {
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    getJointWorldPos(jointIndex, lockTmp);
    root.position.set(anchor.x - lockTmp.x, anchor.y - lockTmp.y, anchor.z - lockTmp.z);
  }

  function dispose() {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    root.removeFromParent();
  }

  setFrame(0);
  return {
    root,
    setFrame,
    setFrameBlend,
    setSelected,
    setYaw,
    lockJointToWorld,
    getJointWorldPos,
    getJointWorldQuat,
    dispose,
  };
}

/** Simple keypoint cloud + topology lines for the scaled human overlay. */
export interface KeypointCloud {
  root: THREE.Group;
  update(positions: Float32Array, frame: number, count: number): void;
  updateBlend(positions: Float32Array, frame: number, count: number, frameCount: number): void;
  dispose(): void;
}

export function buildKeypointCloud(names: string[], color = 0xef6c80): KeypointCloud {
  const root = new THREE.Group();
  root.name = 'human-keypoints';
  const K = names.length;
  const geo = new THREE.SphereGeometry(0.028, 12, 8);
  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    roughness: 0.4,
  });
  const spheres: THREE.Mesh[] = [];
  for (let k = 0; k < K; k++) {
    const s = new THREE.Mesh(geo, mat);
    root.add(s);
    spheres.push(s);
  }

  const blendPos = new THREE.Vector3();

  function update(positions: Float32Array, frame: number, count: number) {
    for (let k = 0; k < Math.min(K, count); k++) {
      const base = (frame * count + k) * 3;
      spheres[k].position.set(positions[base], positions[base + 1], positions[base + 2]);
    }
  }

  function updateBlend(positions: Float32Array, frame: number, count: number, frameCount: number) {
    for (let k = 0; k < Math.min(K, count); k++) {
      blendKeypoints(blendPos, positions, count, frameCount, frame, k);
      spheres[k].position.copy(blendPos);
    }
  }

  function dispose() {
    geo.dispose();
    mat.dispose();
    root.removeFromParent();
  }

  return { root, update, updateBlend, dispose };
}
