/**
 * Turn gallery mesh files into something MuJoCo's compiler reads.
 *
 * MuJoCo loads binary STL, OBJ and MSH only. Gallery URDFs also use Collada
 * (`.dae`: Unitree Go2 / A1 / H1, ANYmal, Atlas …) and the occasional ASCII STL,
 * so those are re-encoded as binary STL in the browser. The Collada scene is
 * placed the way urdf-loader mounts it on the gallery's own viewer (three.js'
 * ColladaLoader output with its root transform reset) and baked into the
 * vertices, so the mesh lands in the link frame the way it does there.
 */

import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

/** Mesh extensions MuJoCo's compiler accepts as-is. */
const NATIVE_EXT = new Set(['stl', 'obj', 'msh']);

export function meshExtension(path: string): string {
  return path.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() ?? '';
}

/** Whether a file at `path` needs `convertMeshForMujoco` before MuJoCo can read it. */
export function needsConversion(path: string, bytes?: Uint8Array): boolean {
  const ext = meshExtension(path);
  if (ext === 'stl') return !!bytes && !isBinaryStl(bytes);
  return !NATIVE_EXT.has(ext);
}

/** Binary STL: 80-byte header, uint32 triangle count, 50 bytes per triangle. */
export function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 84) return false;
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
  return 84 + count * 50 === bytes.byteLength;
}

function exportBinaryStl(object: THREE.Object3D): Uint8Array {
  object.updateMatrixWorld(true);
  const view = new STLExporter().parse(object, { binary: true }) as unknown as DataView;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** Lights and cameras some Collada exports carry along (A1, Aliengo) are not geometry. */
function stripNonGeometry(object: THREE.Object3D) {
  const doomed: THREE.Object3D[] = [];
  object.traverse((child) => {
    if ((child as THREE.Light).isLight || (child as THREE.Camera).isCamera) doomed.push(child);
  });
  for (const child of doomed) child.removeFromParent();
}

/** A 1×1 PNG every texture request resolves to: only the geometry is kept. */
const BLANK_TEXTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function colladaToStl(bytes: Uint8Array): Promise<Uint8Array> {
  // Loaded on demand: only gallery robots with Collada meshes need it.
  const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => BLANK_TEXTURE);
  const collada = new ColladaLoader(manager).parse(new TextDecoder().decode(bytes), '');
  if (!collada?.scene) throw new Error('Collada file has no scene');
  // As urdf-loader does: keep the unit scale, drop the root transform — the
  // Z_UP → Y_UP turn ColladaLoader puts there would tip every link over, since
  // URDF meshes are authored in their link frame whatever `up_axis` says.
  collada.scene.position.set(0, 0, 0);
  collada.scene.quaternion.identity();
  stripNonGeometry(collada.scene);
  return exportBinaryStl(collada.scene);
}

function asciiStlToBinary(bytes: Uint8Array): Uint8Array {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const geometry = new STLLoader().parse(buffer);
  try {
    return exportBinaryStl(new THREE.Mesh(geometry));
  } finally {
    geometry.dispose();
  }
}

/** Re-encode a mesh MuJoCo cannot read as binary STL. */
export async function convertMeshForMujoco(path: string, bytes: Uint8Array): Promise<Uint8Array> {
  const ext = meshExtension(path);
  if (ext === 'dae') return colladaToStl(bytes);
  if (ext === 'stl') return asciiStlToBinary(bytes);
  throw new Error(`Unsupported mesh format .${ext} (${path})`);
}
