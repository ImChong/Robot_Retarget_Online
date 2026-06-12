/**
 * Shared three.js viewport: Z-up world (MuJoCo convention), checkerboard floor,
 * soft shadows, orbit controls, resize handling and a rAF render loop.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface SceneManagerOptions {
  cameraPos?: [number, number, number];
  target?: [number, number, number];
  floor?: boolean;
}

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  private rafId = 0;
  private running = false;
  private clock = new THREE.Clock();
  private tickCallbacks = new Set<(dt: number) => void>();

  constructor(container: HTMLElement, options: SceneManagerOptions = {}) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x16181d);
    this.scene.fog = new THREE.Fog(0x16181d, 14, 34);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 120);
    this.camera.up.set(0, 0, 1); // Z-up
    const cp = options.cameraPos ?? [2.6, -2.6, 1.7];
    this.camera.position.set(cp[0], cp[1], cp[2]);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    const t = options.target ?? [0, 0, 0.8];
    this.controls.target.set(t[0], t[1], t[2]);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 30;

    // Lights
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x30363f, 1.0);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(3, -2.5, 5);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -5;
    dir.shadow.camera.right = 5;
    dir.shadow.camera.top = 5;
    dir.shadow.camera.bottom = -5;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 20;
    dir.shadow.bias = -0.0002;
    this.scene.add(dir);

    if (options.floor !== false) this.scene.add(makeCheckerFloor());

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.onResize();
  }

  onTick(cb: (dt: number) => void): () => void {
    this.tickCallbacks.add(cb);
    return () => this.tickCallbacks.delete(cb);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      for (const cb of this.tickCallbacks) cb(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private onResize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose() {
    this.stop();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }
}

function makeCheckerFloor(): THREE.Mesh {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c0 = '#23262c';
  const c1 = '#2b2f37';
  const n = 8;
  const cell = size / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? c0 : c1;
      ctx.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const repeats = 14;
  texture.repeat.set(repeats, repeats);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const geo = new THREE.PlaneGeometry(repeats * 2, repeats * 2);
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.92,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'floor';
  return mesh; // PlaneGeometry lies in XY; with Z-up world it is already the ground
}
