#!/usr/bin/env node
/**
 * Record the README demo GIF (`media/site-demo.gif`): the site's three-page
 * workflow — BVH Viewer (load a LAFAN1 sample, play the mocap, orbit the
 * camera) -> Retarget Config (robot picker + IK keypoint mapping table) ->
 * Retarget Preview (run the retargeting, robot playback with the human
 * keypoints overlaid, per-frame error curve, export buttons).
 *
 * Playwright records the whole session as a .webm; only the marked segments
 * (`clip()` below) are kept, so the long model-loading / solver waits are cut
 * out. ffmpeg then concatenates them and encodes a GIF with a two-pass palette
 * (palettegen/paletteuse), and `gifsicle -O3 --lossy` shrinks it further when
 * available — the README GIF has to stay a couple of MB.
 *
 * Usage: npm run build && node scripts/record_site_demo.mjs
 * Requires a system `ffmpeg` with the gif encoder (the ffmpeg bundled with
 * Playwright is webm-only); `gifsicle` is optional. On Ubuntu:
 *   sudo apt-get install -y ffmpeg gifsicle
 * Override the binary with FFMPEG=/path/to/ffmpeg.
 */

import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const OUT = process.env.REC_OUT ?? '/tmp/site-demo';
const GIF = process.env.GIF_OUT ?? 'media/site-demo.gif';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const GIF_WIDTH = Number(process.env.GIF_WIDTH ?? 760);
const GIF_FPS = Number(process.env.GIF_FPS ?? 10);
const GIF_COLORS = Number(process.env.GIF_COLORS ?? 64);
const GIF_SPEED = Number(process.env.GIF_SPEED ?? 1.4); // >1 shortens the GIF
const GIF_DITHER = process.env.GIF_DITHER ?? 'none'; // flat areas compress far better
const GIF_LOSSY = Number(process.env.GIF_LOSSY ?? 45); // gifsicle --lossy, 0 = off
const PORT = 4194;
const W = 1280;
const H = 800;

function chrome() {
  for (const c of [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  ]) if (existsSync(c)) return c;
  throw new Error('no chromium found');
}

async function waitServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('preview server did not start');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: true },
);

let browser;
try {
  await waitServer(`http://localhost:${PORT}/`);
  console.log('preview server up');
  browser = await chromium.launch({
    executablePath: chrome(),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  });
  const page = await context.newPage();
  const base = `http://localhost:${PORT}`;

  // Video time starts when the page opens; segments are measured against it.
  const videoT0 = Date.now();
  const now = () => (Date.now() - videoT0) / 1000;
  const clips = [];
  /** Keep what `body` shows on screen; everything unmarked is cut. */
  async function clip(label, body) {
    const start = now();
    await body();
    clips.push({ label, start, end: now() });
    console.log(`clip ${label}: ${start.toFixed(1)}s -> ${now().toFixed(1)}s`);
  }

  const canvasBox = () => page.locator('canvas').first().boundingBox();

  /**
   * Slow drag across the active three.js canvas — orbits the camera. Driven by
   * the wall clock, not a step count: software rendering makes each mouse event
   * take unpredictably long, and the clip length has to stay bounded.
   */
  async function orbit(seconds, dxTotal = 300) {
    const box = await canvasBox();
    if (!box) { await sleep(seconds * 1000); return; }
    const cy = box.y + box.height / 2;
    const x0 = box.x + box.width * 0.34;
    const t0 = Date.now();
    const ms = seconds * 1000;
    await page.mouse.move(x0, cy);
    await page.mouse.down();
    for (;;) {
      const f = Math.min(1, (Date.now() - t0) / ms);
      await page.mouse.move(x0 + dxTotal * f, cy + Math.sin(f * Math.PI * 2) * 24);
      if (f >= 1) break;
      await sleep(70);
    }
    await page.mouse.up();
  }

  /** Wheel-zoom the viewport camera (negative = closer). */
  async function zoom(deltaY, steps = 6) {
    const box = await canvasBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, deltaY / steps);
      await sleep(90);
    }
  }

  async function waitRobotLoaded() {
    await page.waitForFunction(() => {
      const s = document.querySelector('.loading-strip');
      return !s || !s.textContent.includes('/') || s.textContent.trim() === '';
    }, { timeout: 120000 });
  }

  // ---- 1. BVH Viewer: load a LAFAN1 sample and play it ----
  await page.goto(`${base}/#/bvh`);
  await sleep(1500);
  await clip('bvh', async () => {
    await page.getByText('加载示例动作 BVH').click();
    await sleep(700);
    await page.getByText('Walk 行走', { exact: false }).click();
    await sleep(2000);
    await orbit(2, 200);
    await sleep(2500);            // let the walk cycle play, camera parked
  });

  // ---- 2. Retarget Config: robot + IK keypoint mapping ----
  await page.goto(`${base}/#/config`);
  await waitRobotLoaded();
  await sleep(2500);
  await clip('config', async () => {
    await orbit(1.5, 140);
    await sleep(700);
    await page.mouse.move(W * 0.72, H * 0.72);
    await page.mouse.wheel(0, 420);   // scroll the IK keypoint mapping table
    await sleep(2600);
  });

  // ---- 3. Retarget Preview: run it, watch the robot play back ----
  await page.goto(`${base}/#/preview`);
  await sleep(1500);
  const runBtn = page.getByRole('button', { name: '开始重定向' }).first();
  await clip('run', async () => {
    await runBtn.hover();
    await sleep(500);
    await runBtn.click();
    await sleep(1800);            // progress bar
  });
  await page.waitForSelector('text=导出 NPZ', { timeout: 300000 });
  await sleep(2000);
  await zoom(-400);
  await clip('preview', async () => {
    await sleep(3000);            // robot playback, human keypoints overlaid
    await orbit(2.5, 200);
    await sleep(4000);            // playback + per-frame error curve
  });

  const raw = await page.video().path();
  await context.close(); // finalizes the webm
  await browser.close();
  browser = undefined;

  const webm = join(OUT, 'site-demo.webm');
  renameSync(raw, webm);
  const kept = clips.reduce((s, c) => s + (c.end - c.start), 0);
  console.log(`video: ${webm} — keeping ${kept.toFixed(1)}s in ${clips.length} clips`);

  // ---- webm -> gif: trim to the marked clips, concat, two-pass palette ----
  mkdirSync(dirname(GIF), { recursive: true });
  const trims = clips
    .map((c, i) => `[0:v]trim=start=${c.start.toFixed(2)}:end=${c.end.toFixed(2)},setpts=PTS-STARTPTS[c${i}];`)
    .join('');
  const concat = `${clips.map((_, i) => `[c${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[cat];`;
  const speed = GIF_SPEED === 1 ? '' : `setpts=PTS/${GIF_SPEED},`;
  const scaled = `[cat]${speed}fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`;
  const palette = join(OUT, 'palette.png');

  const run = (args) => {
    const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
    if (r.error?.code === 'ENOENT') throw new Error(`${FFMPEG} not found — install ffmpeg (the Playwright one has no gif encoder)`);
    if (r.status !== 0) throw new Error(`${FFMPEG} failed: ${args.join(' ')}`);
  };
  run(['-i', webm, '-filter_complex',
    `${trims}${concat}${scaled},palettegen=max_colors=${GIF_COLORS}:stats_mode=diff[p]`,
    '-map', '[p]', palette]);
  run(['-i', webm, '-i', palette, '-filter_complex',
    `${trims}${concat}${scaled}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[g]`,
    '-map', '[g]', '-loop', '0', GIF]);
  const rawMb = statSync(GIF).size / 1e6;

  // Optional but worth a lot: lossy LZW re-quantisation roughly halves the file.
  if (GIF_LOSSY > 0) {
    const opt = join(OUT, 'optimized.gif');
    const g = spawnSync('gifsicle', ['-O3', `--lossy=${GIF_LOSSY}`, GIF, '-o', opt], { stdio: 'inherit' });
    if (g.status === 0 && existsSync(opt)) renameSync(opt, GIF);
    else console.warn('gifsicle unavailable — keeping the unoptimized GIF');
  }
  console.log(`GIF ${GIF} — ${(statSync(GIF).size / 1e6).toFixed(2)} MB (${rawMb.toFixed(2)} MB before gifsicle)`);
} catch (err) {
  console.error('RECORDING FAILED:', err?.stack ?? err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
  process.exit(process.exitCode ?? 0);
}
