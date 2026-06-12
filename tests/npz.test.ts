import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { encodeNpy, encodeNpz } from '../src/lib/export/npz';

function decodeNpy(bytes: Uint8Array): { shape: number[]; values: Float64Array } {
  expect(bytes[0]).toBe(0x93);
  expect(new TextDecoder().decode(bytes.subarray(1, 6))).toBe('NUMPY');
  const headerLen = bytes[8] | (bytes[9] << 8);
  const header = new TextDecoder().decode(bytes.subarray(10, 10 + headerLen));
  expect((10 + headerLen) % 64).toBe(0);
  const shapeMatch = header.match(/'shape':\s*\(([^)]*)\)/)!;
  const shape = shapeMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const data = bytes.subarray(10 + headerLen);
  const values = new Float64Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  return { shape, values };
}

describe('npy/npz export', () => {
  it('encodes a float64 array with aligned header', () => {
    const arr = Float64Array.from([1.5, -2.25, 3.125, 4, 5, 6]);
    const npy = encodeNpy(arr, [2, 3]);
    const { shape, values } = decodeNpy(npy);
    expect(shape).toEqual([2, 3]);
    expect([...values]).toEqual([...arr]);
  });

  it('packs multiple arrays into an npz (zip)', () => {
    const npz = encodeNpz({
      fps: { data: Float64Array.of(30), shape: [1] },
      dof_pos: { data: new Float64Array(12).fill(0.5), shape: [3, 4] },
    });
    const files = unzipSync(npz);
    expect(Object.keys(files).sort()).toEqual(['dof_pos.npy', 'fps.npy']);
    const fps = decodeNpy(files['fps.npy']);
    expect(fps.values[0]).toBe(30);
    const dof = decodeNpy(files['dof_pos.npy']);
    expect(dof.shape).toEqual([3, 4]);
  });
});
