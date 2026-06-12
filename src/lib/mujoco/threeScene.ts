/**
 * Build a three.js representation of a MuJoCo robot model (Z-up, no axis swap)
 * and update it from MjData body poses.
 *
 * Only visual geoms are rendered: contype==0 && conaffinity==0 && rgba.a > 0
 * (GMR robot XMLs mark visual geoms that way; collision geoms are skipped).
 */

import * as THREE from 'three';
import type { MjData, MjModel, MujocoModule, RobotModel } from './runtime';

const GEOM_SPHERE = 2;
const GEOM_CAPSULE = 3;
const GEOM_ELLIPSOID = 4;
const GEOM_CYLINDER = 5;
const GEOM_BOX = 6;
const GEOM_MESH = 7;

export interface RobotSceneObject {
  root: THREE.Group;
  bodyGroups: Map<number, THREE.Group>;
  update(data: MjData): void;
  setOpacity(alpha: number): void;
  dispose(): void;
}

export function buildRobotScene(robot: RobotModel): RobotSceneObject {
  const { mujoco, model } = robot;
  void mujoco;
  const root = new THREE.Group();
  root.name = `robot:${robot.id}`;

  const bodyGroups = new Map<number, THREE.Group>();
  for (let b = 1; b < model.nbody; b++) {
    const group = new THREE.Group();
    group.name = robot.bodyNames[b];
    bodyGroups.set(b, group);
    root.add(group); // flat: world transforms come from data.xpos/xquat
  }

  const meshCache = new Map<number, THREE.BufferGeometry>();
  const materials: THREE.MeshStandardMaterial[] = [];

  const geomBodyid = model.geom_bodyid as Int32Array;
  const geomType = model.geom_type as Int32Array;
  const geomContype = model.geom_contype as Int32Array;
  const geomConaffinity = model.geom_conaffinity as Int32Array;
  const geomSize = model.geom_size as Float64Array;
  const geomPos = model.geom_pos as Float64Array;
  const geomQuat = model.geom_quat as Float64Array;
  const geomRgba = model.geom_rgba as Float32Array;
  const geomDataid = model.geom_dataid as Int32Array;

  for (let g = 0; g < model.ngeom; g++) {
    const b = geomBodyid[g];
    if (b === 0) continue; // worldbody geoms (none expected)
    if (geomContype[g] !== 0 || geomConaffinity[g] !== 0) continue; // collision geom
    const alpha = geomRgba[g * 4 + 3];
    if (alpha <= 0.001) continue;

    const type = geomType[g];
    const sx = geomSize[g * 3];
    const sy = geomSize[g * 3 + 1];
    const sz = geomSize[g * 3 + 2];

    let geometry: THREE.BufferGeometry | null = null;
    let scale: [number, number, number] | null = null;
    switch (type) {
      case GEOM_SPHERE:
        geometry = new THREE.SphereGeometry(sx, 24, 16);
        break;
      case GEOM_CAPSULE: {
        const capsule = new THREE.CapsuleGeometry(sx, sz * 2, 8, 20);
        capsule.rotateX(Math.PI / 2); // three capsules are Y-aligned; MuJoCo wants Z
        geometry = capsule;
        break;
      }
      case GEOM_CYLINDER: {
        const cyl = new THREE.CylinderGeometry(sx, sx, sz * 2, 24);
        cyl.rotateX(Math.PI / 2);
        geometry = cyl;
        break;
      }
      case GEOM_ELLIPSOID:
        geometry = new THREE.SphereGeometry(1, 24, 16);
        scale = [sx, sy, sz];
        break;
      case GEOM_BOX:
        geometry = new THREE.BoxGeometry(sx * 2, sy * 2, sz * 2);
        break;
      case GEOM_MESH: {
        const meshId = geomDataid[g];
        geometry = meshCache.get(meshId) ?? null;
        if (!geometry) {
          geometry = buildMeshGeometry(model, meshId);
          meshCache.set(meshId, geometry);
        }
        break;
      }
      default:
        continue;
    }
    if (!geometry) continue;

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(geomRgba[g * 4], geomRgba[g * 4 + 1], geomRgba[g * 4 + 2]),
      transparent: alpha < 1,
      opacity: alpha,
      metalness: 0.25,
      roughness: 0.6,
    });
    materials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(geomPos[g * 3], geomPos[g * 3 + 1], geomPos[g * 3 + 2]);
    mesh.quaternion.set(
      geomQuat[g * 4 + 1],
      geomQuat[g * 4 + 2],
      geomQuat[g * 4 + 3],
      geomQuat[g * 4],
    );
    bodyGroups.get(b)?.add(mesh);
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  }

  function update(data: MjData) {
    const xpos = data.xpos as Float64Array;
    const xquat = data.xquat as Float64Array;
    for (const [b, group] of bodyGroups) {
      group.position.set(xpos[b * 3], xpos[b * 3 + 1], xpos[b * 3 + 2]);
      group.quaternion.set(
        xquat[b * 4 + 1],
        xquat[b * 4 + 2],
        xquat[b * 4 + 3],
        xquat[b * 4],
      );
    }
  }

  function setOpacity(alphaScale: number) {
    for (const m of materials) {
      m.transparent = alphaScale < 1;
      m.opacity = alphaScale;
      m.depthWrite = alphaScale >= 1;
    }
  }

  function dispose() {
    for (const m of materials) m.dispose();
    for (const geo of meshCache.values()) geo.dispose();
    root.removeFromParent();
  }

  return { root, bodyGroups, update, setOpacity, dispose };
}

function buildMeshGeometry(model: MjModel, meshId: number): THREE.BufferGeometry {
  const vertAdr = (model.mesh_vertadr as Int32Array)[meshId];
  const vertNum = (model.mesh_vertnum as Int32Array)[meshId];
  const faceAdr = (model.mesh_faceadr as Int32Array)[meshId];
  const faceNum = (model.mesh_facenum as Int32Array)[meshId];

  const verts = (model.mesh_vert as Float32Array).slice(vertAdr * 3, (vertAdr + vertNum) * 3);
  const normals = (model.mesh_normal as Float32Array).slice(
    vertAdr * 3,
    (vertAdr + vertNum) * 3,
  );
  const faces = (model.mesh_face as Int32Array).slice(faceAdr * 3, (faceAdr + faceNum) * 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(faces, 1));
  return geometry;
}
