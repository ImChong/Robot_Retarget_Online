#!/usr/bin/env node
/**
 * Screenshot the Motion JSON input flow on the built app (UI verification).
 * Usage: npm run build && node scripts/shot_motion_json.mjs
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const OUT_DIR = process.env.SHOT_OUT ?? '/tmp/motionjson_shots';
const PORT = 4173;

function findExecutable() {
  const candidates = [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('No chromium found');
}

async function waitForServer(url, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('preview server did not start');
}

mkdirSync(OUT_DIR, { recursive: true });
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: true },
);

let browser;
try {
  await waitForServer(`http://localhost:${PORT}/`);
  browser = await chromium.launch({
    executablePath: findExecutable(),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`http://localhost:${PORT}/#/bvh`);
  await page.waitForTimeout(800);

  // Load each JSON sample and screenshot the viewer.
  const clips = [
    ['Wave 挥手', 'wave'],
    ['Squat 深蹲', 'squat'],
    ['T-pose calibration', 'tpose'],
    ['Walk 行走 (JSON', 'walk_json'],
  ];
  let first = true;
  for (const [label, tag] of clips) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.getByText('加载示例动作').click();
    await page.waitForTimeout(500);
    if (first) {
      await page.screenshot({ path: `${OUT_DIR}/0_sample_menu.png` });
      first = false;
    }
    await page.getByText(label, { exact: false }).click();
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `${OUT_DIR}/bvh_${tag}.png` });
  }

  // Retarget a JSON sample end-to-end on the preview page.
  await page.goto(`http://localhost:${PORT}/#/config`);
  await page.waitForFunction(
    () => {
      const strip = document.querySelector('.loading-strip');
      return !strip || !strip.textContent.includes('/') || strip.textContent.trim() === '';
    },
    { timeout: 120000 },
  );
  await page.waitForTimeout(2500);
  await page.goto(`http://localhost:${PORT}/#/preview`);
  await page.getByText('开始重定向').click();
  await page.waitForSelector('text=导出 NPZ', { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT_DIR}/preview_retarget.png` });

  console.log('SHOTS WRITTEN to', OUT_DIR);
} catch (err) {
  console.error('SHOT FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {
    server.kill('SIGKILL');
  }
  process.exit(process.exitCode ?? 0);
}
