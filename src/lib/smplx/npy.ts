/**
 * Minimal NPY/NPZ *readers* (the counterpart to the writers in
 * `src/lib/export/npz.ts`). Enough to parse SMPL-X body-model `.npz` files and
 * AMASS motion `.npz` files in the browser — no NumPy, no backend.
 *
 * Supports little-endian numeric dtypes in C-order (the layout NumPy writes by
 * default and what AMASS / the official SMPL-X model files use). Object / string
 * arrays (e.g. an AMASS `gender` field) are skipped rather than erroring.
 */

import { unzipSync } from 'fflate';

export type NpyData =
  | Float32Array
  | Float64Array
  | Int32Array
  | Int16Array
  | Int8Array
  | Uint32Array
  | Uint16Array
  | Uint8Array
  | BigInt64Array
  | BigUint64Array;

export interface NpyArray {
  dtype: string;
  shape: number[];
  data: NpyData;
}

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

/** Map a NumPy dtype descr (e.g. "<f4") to a typed-array constructor. */
function viewFor(descr: string): { ctor: (buf: ArrayBuffer) => NpyData; bytes: number } | null {
  // Byte order: '<' little, '|' not-applicable. Reject big-endian ('>').
  const order = descr[0];
  const kind = descr.slice(1);
  if (order === '>') throw new Error(`big-endian NPY not supported: ${descr}`);
  switch (kind) {
    case 'f4': return { ctor: (b) => new Float32Array(b), bytes: 4 };
    case 'f8': return { ctor: (b) => new Float64Array(b), bytes: 8 };
    case 'i1': return { ctor: (b) => new Int8Array(b), bytes: 1 };
    case 'i2': return { ctor: (b) => new Int16Array(b), bytes: 2 };
    case 'i4': return { ctor: (b) => new Int32Array(b), bytes: 4 };
    case 'i8': return { ctor: (b) => new BigInt64Array(b), bytes: 8 };
    case 'u1': case 'b1': return { ctor: (b) => new Uint8Array(b), bytes: 1 };
    case 'u2': return { ctor: (b) => new Uint16Array(b), bytes: 2 };
    case 'u4': return { ctor: (b) => new Uint32Array(b), bytes: 4 };
    case 'u8': return { ctor: (b) => new BigUint64Array(b), bytes: 8 };
    default: return null; // object/unicode/etc. — caller skips
  }
}

function product(shape: number[]): number {
  return shape.reduce((a, b) => a * b, 1);
}

/** Transpose Fortran-order flat data of the given shape into C-order. */
function fortranToC(flat: NpyData, shape: number[]): NpyData {
  const n = flat.length;
  const out = new (flat.constructor as new (len: number) => NpyData)(n);
  const ndim = shape.length;
  // Fortran strides (column-major): first axis varies fastest.
  const fStride = new Array(ndim).fill(1);
  for (let i = 1; i < ndim; i++) fStride[i] = fStride[i - 1] * shape[i - 1];
  const idx = new Array(ndim).fill(0);
  for (let c = 0; c < n; c++) {
    // c is the C-order linear index; decode to multi-index.
    let rem = c;
    for (let d = ndim - 1; d >= 0; d--) {
      idx[d] = rem % shape[d];
      rem = Math.floor(rem / shape[d]);
    }
    let f = 0;
    for (let d = 0; d < ndim; d++) f += idx[d] * fStride[d];
    (out as unknown as number[])[c] = (flat as unknown as number[])[f];
  }
  return out;
}

/**
 * Parse a single `.npy` buffer. Returns `null` for unsupported (non-numeric)
 * dtypes so callers can skip them.
 */
export function parseNpy(bytes: Uint8Array): NpyArray | null {
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error('not an NPY file (bad magic)');
  }
  const major = bytes[6];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let headerLen: number;
  let dataStart: number;
  if (major === 1) {
    headerLen = view.getUint16(8, true);
    dataStart = 10 + headerLen;
  } else {
    headerLen = view.getUint32(8, true);
    dataStart = 12 + headerLen;
  }
  const headerBytes = bytes.subarray(dataStart - headerLen, dataStart);
  const header = new TextDecoder().decode(headerBytes);

  const descrM = header.match(/'descr':\s*'([^']+)'/);
  const fortranM = header.match(/'fortran_order':\s*(True|False)/);
  const shapeM = header.match(/'shape':\s*\(([^)]*)\)/);
  if (!descrM || !shapeM) throw new Error(`unparseable NPY header: ${header}`);
  const dtype = descrM[1];
  const fortranOrder = fortranM ? fortranM[1] === 'True' : false;
  const shape = shapeM[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));

  const spec = viewFor(dtype);
  if (!spec) return null; // skip object/string arrays gracefully

  const count = product(shape);
  // Copy into a fresh, element-aligned buffer (the zip entry may sit at an
  // arbitrary byte offset, which would break a direct typed-array view).
  const slice = bytes.slice(dataStart, dataStart + count * spec.bytes);
  let data = spec.ctor(slice.buffer);
  if (fortranOrder && shape.length > 1) data = fortranToC(data, shape);
  return { dtype, shape, data };
}

/** Parse a `.npz` (zip of `.npy` entries). Non-numeric entries are skipped. */
export function parseNpz(bytes: Uint8Array): Record<string, NpyArray> {
  const files = unzipSync(bytes);
  const out: Record<string, NpyArray> = {};
  for (const [name, buf] of Object.entries(files)) {
    if (!name.endsWith('.npy')) continue;
    const key = name.slice(0, -'.npy'.length);
    const arr = parseNpy(buf);
    if (arr) out[key] = arr;
  }
  return out;
}

/** Read a numeric NPY array as a plain JS number array (float coercion). */
export function asNumbers(arr: NpyArray): number[] {
  const d = arr.data;
  if (d instanceof BigInt64Array || d instanceof BigUint64Array) {
    return Array.from(d, (v) => Number(v));
  }
  return Array.from(d as ArrayLike<number>);
}
