/**
 * BVHView-style skeleton rendering: capsule bones + joint spheres, built as a
 * three.js hierarchy mirroring the BVH joint tree (three.js does the FK).
 *
 * The BVH file is Y-up in arbitrary units; a wrapper group rotates it into the
 * Z-up world and scales it to meters.
 */

import * as THREE from 'three';
import type { BvhAnim } from '../bvh/parse';

const BONE_COLOR = 0x8d99ae;
const BONE_EMISSIVE = 0x10151c;
const JOINT_COLOR = 0x4fc3f7;
const SELECT_COLOR = 0xffb74d;

export interface SkeletonView {
  root: THREE.Group;
  setFrame(frame: number): void;
  setSelected(jointIndex: number | null): void;
  /** world position of a joint (after wrapper transform) */
  getJointWorldPos(jointIndex: number, out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export function buildSkeletonView(anim: BvhAnim, unitScale: number): SkeletonView {
  const root = new THREE.Group();
  root.name = 'bvh-skeleton';
  // Y-up (BVH) -> Z-up (world): rotate +90° about X, then scale units -> meters.
  root.rotation.x = Math.PI / 2;
  root.scale.setScalar(unitScale);

  const J = anim.joints.length;
  const jointGroups: THREE.Group[] = [];
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const jointSpheres: THREE.Mesh[] = [];

  // Bone thickness relative to skeleton size (file units).
  const skeletonSize = estimateSize(anim);
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
    if (parent < 0) root.add(group);
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

  function setFrame(frame: number) {
    const f = Math.max(0, Math.min(frame, anim.frameCount - 1));
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

  let selected: number | null = null;
  function setSelected(jointIndex: number | null) {
    if (selected !== null) jointSpheres[selected].material = jointMat;
    selected = jointIndex;
    if (selected !== null) jointSpheres[selected].material = selectMat;
  }

  function getJointWorldPos(jointIndex: number, out: THREE.Vector3): THREE.Vector3 {
    return jointGroups[jointIndex].getWorldPosition(out);
  }

  function dispose() {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    root.removeFromParent();
  }

  setFrame(0);
  return { root, setFrame, setSelected, getJointWorldPos, dispose };
}

function estimateSize(anim: BvhAnim): number {
  // Sum of |offset| along the longest chain is overkill; use max joint offset reach.
  let maxReach = 0;
  const reach: number[] = [];
  for (let j = 0; j < anim.joints.length; j++) {
    const off = anim.joints[j].offset;
    const parent = anim.joints[j].parent;
    const r = (parent >= 0 ? reach[parent] : 0) + Math.hypot(off[0], off[1], off[2]);
    reach.push(r);
    if (r > maxReach) maxReach = r;
  }
  return maxReach || 1;
}

/** Simple keypoint cloud + topology lines for the scaled human overlay. */
export interface KeypointCloud {
  root: THREE.Group;
  update(positions: Float32Array, frame: number, count: number): void;
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
    roughness: 0.4,
  });
  const spheres: THREE.Mesh[] = [];
  for (let k = 0; k < K; k++) {
    const s = new THREE.Mesh(geo, mat);
    root.add(s);
    spheres.push(s);
  }

  function update(positions: Float32Array, frame: number, count: number) {
    for (let k = 0; k < Math.min(K, count); k++) {
      const base = (frame * count + k) * 3;
      spheres[k].position.set(positions[base], positions[base + 1], positions[base + 2]);
    }
  }

  function dispose() {
    geo.dispose();
    mat.dispose();
    root.removeFromParent();
  }

  return { root, update, dispose };
}
