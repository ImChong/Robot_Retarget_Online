#!/usr/bin/env node
/**
 * Copy the MediaPipe Tasks-Vision WASM runtime out of node_modules into
 * `public/mediapipe/wasm/` so the video → BVH feature loads it from the app's
 * own origin (no third-party CDN at runtime). Runs automatically via the
 * `predev` / `prebuild` npm hooks. The copied files are gitignored; the npm
 * package is the source of truth, so they never enter git history.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dst = resolve(root, 'public/mediapipe/wasm');

if (!existsSync(src)) {
  console.warn('[mediapipe] wasm not found in node_modules — run `npm install` first. Skipping copy.');
  process.exit(0);
}

mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('[mediapipe] copied WASM runtime → public/mediapipe/wasm');
