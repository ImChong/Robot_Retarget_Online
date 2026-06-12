/**
 * Minimal NPY/NPZ writers for exporting motions in a NumPy-compatible format.
 */

import { zipSync } from 'fflate';

type NumericArray = Float64Array | Float32Array | Int32Array | BigInt64Array;

function descrFor(arr: NumericArray): string {
  if (arr instanceof Float64Array) return '<f8';
  if (arr instanceof Float32Array) return '<f4';
  if (arr instanceof Int32Array) return '<i4';
  if (arr instanceof BigInt64Array) return '<i8';
  throw new Error('Unsupported dtype');
}

export function encodeNpy(arr: NumericArray, shape: number[]): Uint8Array {
  const shapeStr =
    shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(', ')})`;
  let header = `{'descr': '${descrFor(arr)}', 'fortran_order': False, 'shape': ${shapeStr}, }`;
  // Pad with spaces so that magic(6)+ver(2)+len(2)+header is a multiple of 64, ending in \n.
  const baseLen = 10 + header.length + 1;
  const pad = (64 - (baseLen % 64)) % 64;
  header = header + ' '.repeat(pad) + '\n';

  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(10 + headerBytes.length + arr.byteLength);
  out[0] = 0x93;
  out.set([0x4e, 0x55, 0x4d, 0x50, 0x59], 1); // NUMPY
  out[6] = 1; // major
  out[7] = 0; // minor
  out[8] = headerBytes.length & 0xff;
  out[9] = (headerBytes.length >> 8) & 0xff;
  out.set(headerBytes, 10);
  out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), 10 + headerBytes.length);
  return out;
}

export function encodeNpz(arrays: Record<string, { data: NumericArray; shape: number[] }>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [name, { data, shape }] of Object.entries(arrays)) {
    files[`${name}.npy`] = encodeNpy(data, shape);
  }
  // store uncompressed: keeps export instant; meshes of doubles barely compress anyway
  return zipSync(files, { level: 0 });
}
