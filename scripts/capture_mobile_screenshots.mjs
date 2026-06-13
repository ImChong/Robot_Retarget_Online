#!/usr/bin/env node
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT_DIR = '/opt/cursor/artifacts/screenshots';
const PORT = 4174;
const BASE = `http://localhost:${PORT}/`;

mkdirSync(OUT_DIR, { recursive: true });

async function waitForServer(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('preview server did not start');
}

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: true },
);

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: '/usr/local/bin/google-chrome',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader'],
  });

  async function shot(page, name, viewport) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT_DIR}/${name}`, fullPage: false });
    console.log('saved', name);
  }

  // Mobile BVH viewer
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`${BASE}#/bvh`);
  await mobile.waitForTimeout(1200);
  await shot(mobile, 'mobile-bvh-empty.png', { width: 390, height: 844 });

  await mobile.locator('input[type="file"]').setInputFiles('public/sample_motions/walk.bvh');
  await mobile.waitForTimeout(2500);
  await shot(mobile, 'mobile-bvh-loaded.png', { width: 390, height: 844 });

  // Mobile drawer open
  await mobile.locator('.panel-fab').click();
  await mobile.waitForTimeout(600);
  await shot(mobile, 'mobile-bvh-drawer.png', { width: 390, height: 844 });

  // Mobile config (motion persists via keep-alive)
  await mobile.goto(`${BASE}#/config`);
  await mobile.waitForTimeout(5000);
  await shot(mobile, 'mobile-config.png', { width: 390, height: 844 });

  // Mobile preview
  await mobile.goto(`${BASE}#/preview`);
  await mobile.waitForTimeout(1500);
  await shot(mobile, 'mobile-preview.png', { width: 390, height: 844 });
  await mobile.close();

  // Desktop comparison
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto(`${BASE}#/bvh`);
  await desktop.locator('input[type="file"]').setInputFiles('public/sample_motions/walk.bvh');
  await desktop.waitForTimeout(2500);
  await shot(desktop, 'desktop-bvh-loaded.png', { width: 1440, height: 900 });
  await desktop.close();
} finally {
  if (browser) await browser.close();
  process.kill(-server.pid, 'SIGTERM');
}
