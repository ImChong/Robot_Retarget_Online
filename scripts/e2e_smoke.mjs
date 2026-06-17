#!/usr/bin/env node
/**
 * Headless smoke test: drives the built app through the full pipeline
 * (load sample BVH -> robot/config page -> run retargeting -> export UI).
 *
 * Usage: node scripts/e2e_smoke.mjs [--executable /path/to/chrome]
 * Requires `npm run build` first; serves ./dist via `vite preview`.
 */

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const OUT_DIR = process.env.E2E_OUT ?? '/tmp/e2e';
const PORT = 4173;

function findExecutable() {
  const flagIdx = process.argv.indexOf('--executable');
  if (flagIdx >= 0) return process.argv[flagIdx + 1];
  const candidates = [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('No chromium found; pass --executable');
}

async function waitForServer(url, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
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

const errors = [];
let browser;
try {
  await waitForServer(`http://localhost:${PORT}/`);
  console.log('preview server up');

  browser = await chromium.launch({
    executablePath: findExecutable(),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('requestfailed', (req) => errors.push(`request failed: ${req.url()}`));
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`HTTP ${res.status()}: ${res.url()}`);
  });

  // ---- Page 1: BVH viewer + sample motion ----
  await page.goto(`http://localhost:${PORT}/#/bvh`);
  await page.getByText('加载示例动作 BVH').click();
  await page.getByText('Walk 行走', { exact: false }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT_DIR}/1_bvh_viewer.png` });
  const frameLabel = await page.getByText(/帧 \d+ \/ 1799/).count();
  console.log('bvh viewer: playback bar present =', frameLabel > 0);

  // ---- Page 2: config (loads MuJoCo + robot) ----
  await page.goto(`http://localhost:${PORT}/#/config`);
  await page.waitForFunction(
    () => {
      const strip = document.querySelector('.loading-strip');
      return !strip || !strip.textContent.includes('/') || strip.textContent.trim() === '';
    },
    { timeout: 120000 },
  );
  await page.waitForTimeout(3000); // model compile + first render
  await page.screenshot({ path: `${OUT_DIR}/2_config.png` });
  console.log('config page loaded');

  // ---- Page 3: run retargeting ----
  await page.goto(`http://localhost:${PORT}/#/preview`);
  await page.getByText('开始重定向').click();
  await page.waitForSelector('text=导出 NPZ', { timeout: 300000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT_DIR}/3_preview.png` });

  const meanErr = await page.getByText(/平均误差/).textContent().catch(() => null);
  const maxErr = await page.getByText(/最大误差/).textContent().catch(() => null);
  const stats = await page.locator('.info-line').allTextContents().catch(() => []);
  console.log('retarget done.', meanErr, '|', maxErr);
  console.log('stats:', stats.join(' | '));

  const fatal = errors.filter(
    (e) => !e.includes('favicon') && !e.includes('GroupMarkerNotSet'),
  );
  if (fatal.length) {
    console.log('console errors:');
    for (const e of fatal) console.log('  -', e.slice(0, 300));
  } else {
    console.log('no console errors');
  }
  console.log('E2E SMOKE PASSED');
} catch (err) {
  console.error('E2E SMOKE FAILED:', err.message);
  if (errors.length) console.error('console errors:', errors.slice(0, 10));
  try {
    if (browser) {
      const pages = browser.contexts().flatMap((c) => c.pages());
      if (pages[0]) await pages[0].screenshot({ path: `${OUT_DIR}/failure.png` });
    }
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGKILL'); // kill the whole preview process group
  } catch {
    server.kill('SIGKILL');
  }
  process.exit(process.exitCode ?? 0);
}
