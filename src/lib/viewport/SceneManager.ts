/**
 * Shared three.js viewport: Z-up world (MuJoCo convention), checkerboard floor,
 * soft shadows, orbit controls, resize handling and a rAF render loop.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { THEME_CHANGE_EVENT, type AppTheme } from '@/composables/useAppTheme';

export interface SceneManagerOptions {
  cameraPos?: [number, number, number];
  target?: [number, number, number];
  floor?: boolean;
}

const VIEWPORT_THEMES = {
  dark: {
    background: 0x16181d,
    fogNear: 14,
    fogFar: 34,
    floor: ['#23262c', '#2b2f37'] as const,
  },
  light: {
    background: 0xe8eaef,
    fogNear: 18,
    fogFar: 42,
    floor: ['#d8dce3', '#c8cdd6'] as const,
  },
} as const;

function readStoredTheme(): AppTheme {
  try {
    return localStorage.getItem('rro-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
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
  private floorMesh: THREE.Mesh | null = null;
  private themeListener: ((event: Event) => void) | null = null;

  constructor(container: HTMLElement, options: SceneManagerOptions = {}) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.applyTheme(readStoredTheme());

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 120);
    this.camera.up.set(0, 0, 1); // Z-up
    const cp = options.cameraPos ?? [2.6, -2.6, 1.7];
    this.camera.position.set(cp[0], cp[1], cp[2]);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    const isMobile = window.matchMedia('(max-width: 959.98px)').matches;
    const dprCap = isMobile ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
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
    dir.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
    dir.shadow.camera.left = -5;
    dir.shadow.camera.right = 5;
    dir.shadow.camera.top = 5;
    dir.shadow.camera.bottom = -5;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 20;
    dir.shadow.bias = -0.0002;
    this.scene.add(dir);

    if (options.floor !== false) {
      this.floorMesh = makeCheckerFloor(readStoredTheme());
      this.scene.add(this.floorMesh);
    }

    this.themeListener = (event: Event) => {
      const theme = (event as CustomEvent<{ theme: AppTheme }>).detail.theme;
      this.applyTheme(theme);
    };
    window.addEventListener(THEME_CHANGE_EVENT, this.themeListener);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.onResize();
  }

  onTick(cb: (dt: number) => void): () => void {
    this.tickCallbacks.add(cb);
    return () => this.tickCallbacks.delete(cb);
  }

  setDampingEnabled(enabled: boolean) {
    this.controls.enableDamping = enabled;
  }

  /** Reposition the camera and orbit target (e.g. to frame a small robot). */
  setView(cameraPos: [number, number, number], target: [number, number, number]) {
    this.camera.position.set(cameraPos[0], cameraPos[1], cameraPos[2]);
    this.controls.target.set(target[0], target[1], target[2]);
    this.controls.update();
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

  /** Re-run layout after container size changes (e.g. drawer open/close). */
  resize() {
    this.onResize();
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
    if (this.themeListener) {
      window.removeEventListener(THEME_CHANGE_EVENT, this.themeListener);
      this.themeListener = null;
    }
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

  applyTheme(theme: AppTheme) {
    const palette = VIEWPORT_THEMES[theme];
    this.scene.background = new THREE.Color(palette.background);
    this.scene.fog = new THREE.Fog(palette.background, palette.fogNear, palette.fogFar);

    if (!this.floorMesh) return;
    const floorMat = this.floorMesh.material as THREE.MeshStandardMaterial;
    const oldMap = floorMat.map;
    floorMat.map = makeCheckerTexture(theme);
    floorMat.needsUpdate = true;
    oldMap?.dispose();
  }
}

function makeCheckerTexture(theme: AppTheme): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const [c0, c1] = VIEWPORT_THEMES[theme].floor;
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
  return texture;
}

function makeCheckerFloor(theme: AppTheme): THREE.Mesh {
  const texture = makeCheckerTexture(theme);
  const repeats = 14;

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
