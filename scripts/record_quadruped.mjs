#!/usr/bin/env node
/**
 * Screen-record the full quadruped retargeting flow as a video:
 *   BVH Viewer (load a dog mocap sample) -> Retarget Config (select a quadruped
 *   robot) -> Retarget Preview (run retargeting, auto-play, orbit the camera).
 *
 * Captures Unitree Go2 then Unitree A1. Outputs a .webm (Playwright recordVideo)
 * and, if the bundled ffmpeg supports it, an .mp4.
 *
 * Usage: node scripts/record_quadruped.mjs   (run `npm run build` first)
 */

import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.REC_OUT ?? '/tmp/rec';
const PORT = 4192;
const W = 1280;
const H = 800;
const FFMPEG = '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';

function chrome() {
  for (const c of [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  ]) if (existsSync(c)) return c;
  throw new Error('no chromium');
}

async function waitServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server timeout');
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
  console.log('preview up');
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

  // Slow orbit of the active three.js canvas to show the 3D pose.
  async function orbit(seconds, dxTotal = 320) {
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) { await sleep(seconds * 1000); return; }
    const cy = box.y + box.height / 2;
    const x0 = box.x + box.width * 0.32;
    const steps = Math.max(1, Math.round(seconds * 12));
    await page.mouse.move(x0, cy);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x0 + (dxTotal * i) / steps, cy + Math.sin(i / 4) * 30);
      await sleep((seconds * 1000) / steps);
    }
    await page.mouse.up();
  }

  async function waitRobotLoaded() {
    await page.waitForFunction(() => {
      const s = document.querySelector('.loading-strip');
      return !s || !s.textContent.includes('/') || s.textContent.trim() === '';
    }, { timeout: 120000 });
  }

  async function runFor(robotLabel, tag) {
    // --- Config: pick the robot ---
    await page.goto(`${base}/#/config`);
    await waitRobotLoaded();
    await page.locator('.v-select:has-text("机器人")').first().click();
    await page.getByRole('option', { name: robotLabel }).click();
    await waitRobotLoaded();
    await sleep(1200);
    await orbit(3);
    await page.screenshot({ path: `${OUT}/${tag}_config.png` });

    // --- Preview: run retargeting (auto-plays on completion) ---
    await page.goto(`${base}/#/preview`);
    await page.getByText('开始重定向').click();
    await page.waitForSelector('text=导出 NPZ', { timeout: 300000 });
    await sleep(1500);
    await orbit(8, 300);          // slow orbit while the gait plays + follow-cam tracks
    await page.screenshot({ path: `${OUT}/${tag}_preview.png` });
  }

  // --- BVH Viewer: load a dog mocap sample ---
  await page.goto(`${base}/#/bvh`);
  await page.getByText('加载示例动作 BVH').click();
  await page.getByText('Dog walk', { exact: false }).click();
  await sleep(2500);
  await orbit(4, 280);
  await page.screenshot({ path: `${OUT}/0_bvh_dog.png` });

  await runFor('Unitree Go2 (Quadruped, 12 DoF)', '1_go2');
  await runFor('Unitree A1 (Quadruped, 12 DoF)', '2_a1');

  const videoPath = await page.video().path();
  await context.close(); // finalizes the video
  await browser.close();
  console.log('raw video:', videoPath);

  const webm = join(OUT, 'quadruped_retarget_flow.webm');
  renameSync(videoPath, webm);
  console.log('VIDEO', webm);

  // Best-effort mp4 (h264) for broad compatibility.
  const mp4 = join(OUT, 'quadruped_retarget_flow.mp4');
  const r = spawnSync(FFMPEG, ['-y', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  if (r.status === 0 && existsSync(mp4)) console.log('MP4', mp4);
  else console.log('mp4 conversion unavailable; use the webm');
} finally {
  try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
  for (const f of (existsSync(OUT) ? readdirSync(OUT) : [])) if (f.endsWith('.webm') && f !== 'quadruped_retarget_flow.webm') { /* leftover */ }
  process.exit(process.exitCode ?? 0);
}
