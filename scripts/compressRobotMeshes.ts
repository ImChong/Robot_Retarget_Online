/**
 * Vite build plugin: gzip the robot meshes in `dist/robots/` and record which
 * files were packed in `dist/robots/manifest.json` (`gzFiles`).
 *
 * GitHub Pages compresses text and `.bvh` responses on the fly but serves
 * `.STL` (application/vnd.ms-pki.stl) and `.obj` (application/x-tgif) as-is,
 * so the default Unitree G1 alone cost ~19 MB on the wire. Packed here, the
 * same meshes are ~9 MB; src/lib/mujoco/runtime.ts fetches `<file>.gz` and
 * inflates it with the browser's native DecompressionStream.
 *
 * The originals are removed from `dist/` (Pages caps a site at 1 GB) but stay
 * in `public/`, so `npm run dev`, the tests and the GMR parity scripts are
 * unaffected — the dev manifest has no `gzFiles` and the loader fetches raw.
 */
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip as gzipCb, constants } from 'node:zlib';
import type { Plugin } from 'vite';

const gzip = promisify(gzipCb);
const MESH = /\.(stl|obj)$/i;
/** Skip files gzip barely shrinks: they would only add a decode step. */
const MIN_SAVING = 0.1;
const CONCURRENCY = 8;

interface ManifestEntry {
  id: string;
  files: string[];
  gzFiles?: string[];
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

export function compressRobotMeshes(): Plugin {
  let outDir = '';
  return {
    name: 'compress-robot-meshes',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const robotsDir = join(outDir, 'robots');
      const manifestPath = join(robotsDir, 'manifest.json');
      if (!existsSync(manifestPath)) return;
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ManifestEntry[];

      let before = 0;
      let after = 0;
      for (const entry of manifest) {
        const packed: string[] = [];
        await pool(
          entry.files.filter((rel) => MESH.test(rel)),
          CONCURRENCY,
          async (rel) => {
            const file = join(robotsDir, entry.id, rel);
            const raw = await readFile(file);
            const gz = await gzip(raw, { level: constants.Z_BEST_COMPRESSION });
            before += raw.length;
            if (gz.length > raw.length * (1 - MIN_SAVING)) {
              after += raw.length;
              return;
            }
            after += gz.length;
            await writeFile(`${file}.gz`, gz);
            await rm(file);
            packed.push(rel);
          },
        );
        if (packed.length) entry.gzFiles = entry.files.filter((rel) => packed.includes(rel));
      }
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const mb = (n: number) => (n / 1e6).toFixed(1);
      console.log(`[compress-robot-meshes] robot meshes ${mb(before)} MB -> ${mb(after)} MB`);
    },
  };
}
