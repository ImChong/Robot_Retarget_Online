#!/usr/bin/env node
/**
 * Visual render harness: for each named sample, load it, run retargeting, and
 * capture a strip of robot frames across one playback loop (to eyeball flips,
 * fall/get-up, etc). Outputs PNGs to $RENDER_OUT (default /tmp/render).
 *
 * Usage: node scripts/render_samples.mjs   (needs `npm run build` first)
 */

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const OUT = process.env.RENDER_OUT ?? '/tmp/render';
const PORT = 4188;

function exe() {
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

// motion file -> { menu substring, number of shots, interval ms }
const JOBS = [
  { file: 'run.bvh', label: '跑步', shots: 4, every: 160 },
  { file: 'fall_getup.bvh', label: '倒地起身', shots: 8, every: 360 },
  { file: 'jumps.bvh', label: '跳跃', shots: 8, every: 160 },
  { file: 'dance.bvh', label: '舞蹈', shots: 6, every: 200 },
];

mkdirSync(OUT, { recursive: true });
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: true },
);

let browser;
const errors = [];
try {
  await waitServer(`http://localhost:${PORT}/`);
  browser = await chromium.launch({
    executablePath: exe(),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  for (const job of JOBS) {
    // load sample on the BVH page
    await page.goto(`http://localhost:${PORT}/#/bvh`);
    await page.getByText('加载示例动作').click();
    await page.getByText(job.label, { exact: false }).click();
    await page.waitForTimeout(800);

    // run retargeting on the preview page
    await page.goto(`http://localhost:${PORT}/#/preview`);
    await page.getByText('开始重定向', { exact: false }).click();
    await page.waitForSelector('text=导出 NPZ', { timeout: 300000 });
    await page.waitForTimeout(600);

    const name = job.file.replace('.bvh', '');
    for (let i = 0; i < job.shots; i++) {
      await page.screenshot({ path: `${OUT}/${name}_${String(i).padStart(2, '0')}.png` });
      await page.waitForTimeout(job.every);
    }
    console.log(`rendered ${name}: ${job.shots} frames`);
  }

  const fatal = errors.filter((e) => !/favicon|GroupMarkerNotSet/.test(e));
  console.log(fatal.length ? `console errors: ${fatal.slice(0, 5).join(' | ')}` : 'no console errors');
  console.log('RENDER DONE');
} catch (err) {
  console.error('RENDER FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
  process.exit(process.exitCode ?? 0);
}
