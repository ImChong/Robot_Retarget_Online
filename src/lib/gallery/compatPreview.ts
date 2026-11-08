/**
 * Preview stage of the gallery compatibility matrix (`compat.ts`): draw the
 * retargeted robot at a few frames with the viewport's own robot builder
 * (`buildRobotScene`) into one contact sheet, so a reviewer can spot a twisted,
 * sunk or floating robot at a glance. Browser only (WebGL).
 */

import * as THREE from 'three';
import { buildRobotScene } from '../mujoco/threeScene';
import type { RobotModel } from '../mujoco/runtime';
import type { RetargetResult } from '../retarget/types';

export interface PreviewOptions {
  /** Size of one panel, CSS pixels. */
  width?: number;
  height?: number;
  title?: string;
}

/** One PNG data URL: the robot at each of `frames`, side by side, with a ground grid. */
export async function renderCompatPreview(
  robot: RobotModel,
  result: RetargetResult,
  frames: number[],
  options: PreviewOptions = {},
): Promise<string[]> {
  const w = options.width ?? 300;
  const h = options.height ?? 360;
  const { mujoco, model, data } = robot;

  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0xf3f4f6, 1);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(2, -3, 5);
  scene.add(sun);
  const grid = new THREE.GridHelper(20, 80, 0x9ca3af, 0xd1d5db);
  grid.rotation.x = Math.PI / 2; // Z-up
  scene.add(grid);
  const robotScene = buildRobotScene(robot);
  scene.add(robotScene.root);

  const camera = new THREE.PerspectiveCamera(35, w / h, 0.01, 100);
  camera.up.set(0, 0, 1);

  const sheet = document.createElement('canvas');
  sheet.width = w * frames.length;
  sheet.height = h + 22;
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  const qpos = data.qpos as Float64Array;
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  try {
    frames.forEach((frame, i) => {
      qpos.set(result.qpos.subarray(frame * result.nq, (frame + 1) * result.nq));
      mujoco.mj_kinematics(model, data);
      robotScene.update(data);
      robotScene.root.updateMatrixWorld(true);
      box.setFromObject(robotScene.root);
      box.getSize(size);
      box.getCenter(center);
      // Look from the robot's front-left (its root heading), framing the whole body.
      const q = result.qpos;
      const o = frame * result.nq + 3;
      const yaw = Math.atan2(2 * (q[o] * q[o + 3] + q[o + 1] * q[o + 2]), 1 - 2 * (q[o + 2] ** 2 + q[o + 3] ** 2));
      const radius = Math.max(size.x, size.y, size.z, 0.2);
      const dist = (radius / Math.tan((camera.fov * Math.PI) / 360)) * 0.85;
      const az = yaw + Math.PI / 5;
      camera.position.set(center.x + Math.cos(az) * dist, center.y + Math.sin(az) * dist, center.z + dist * 0.35);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      grid.position.set(Math.round(center.x * 4) / 4, Math.round(center.y * 4) / 4, 0);
      renderer.render(scene, camera);
      ctx.drawImage(canvas, i * w, 22, w, h);
      ctx.fillStyle = '#111827';
      ctx.font = '12px sans-serif';
      ctx.fillText(`frame ${frame}`, i * w + 6, 15);
    });
    if (options.title) {
      ctx.fillStyle = '#374151';
      ctx.textAlign = 'right';
      ctx.fillText(options.title, sheet.width - 6, 15);
    }
    return [sheet.toDataURL('image/png')];
  } finally {
    robotScene.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
