#!/usr/bin/env node
/**
 * Headless E2E check of picking robots from Robot Description Gallery Online
 * (https://imchong.github.io/Robot_Description_Gallery_Online/web/), driven
 * through a live app in Chromium:
 *
 *   Walk sample → Retarget Config: the built-in G1 shows a "View in Gallery"
 *   link → Gallery dialog lists humanoids (quadrupeds greyed out) → load the
 *   gallery's G1 URDF (STL meshes) → the G1 preset is matched → run → preview.
 *   Dog walk → Gallery dialog switches to quadrupeds → load Go2 (Collada
 *   meshes, converted to STL in the browser) → run → preview.
 *
 * Needs network access to imchong.github.io and cdn.jsdelivr.net (the robots
 * stream from their upstream repositories). Honours HTTPS_PROXY.
 *
 * Usage: node scripts/e2e_gallery.mjs [--url http://localhost:3000]
 *                                     [--humanoid G1] [--quadruped Go2]
 * (`--humanoid` / `--quadruped` take a gallery card name.)
 * Requires the dev or preview server to be running. Screenshots + summary.json
 * land in $E2E_OUT (default /tmp/e2e_gallery).
 */

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const BASE = arg('--url', 'http://localhost:3000').replace(/\/$/, '');
const OUT = resolve(process.env.E2E_OUT ?? '/tmp/e2e_gallery');
const HUMANOID = arg('--humanoid', 'G1');
const QUADRUPED = arg('--quadruped', 'Go2');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function chromePath() {
  for (const c of [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    '/opt/pw-browsers/chromium',
  ]) if (existsSync(c)) return c;
  return undefined; // let playwright-core find its own build
}

const failures = [];
const summary = { runs: [], consoleErrors: [] };
function check(cond, msg) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures.push(msg);
}

mkdirSync(OUT, { recursive: true });
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const browser = await chromium.launch({
  executablePath: chromePath(),
  proxy,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /context lost/i.test(msg.text())) summary.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => summary.consoleErrors.push(String(err)));
  const shot = (name) => page.screenshot({ path: join(OUT, name) });

  async function loadSample(text, fileName) {
    await page.getByRole('button', { name: /加载示例动作/ }).click();
    await page.locator('.sample-menu-panel .v-list-item', { hasText: text }).first().click();
    await page.waitForFunction(
      (f) => [...document.querySelectorAll('.info-line')].some((l) => l.textContent.includes(f)),
      fileName,
      { timeout: 30000 },
    );
    await sleep(1000);
  }
  async function waitRobotLoaded() {
    await page.waitForFunction(() => {
      const strip = document.querySelector('.loading-strip');
      const busy = strip && /\d+\s*\/\s*\d+/.test(strip.textContent || '') && !/完成|loaded/.test(strip.textContent || '');
      const btn = [...document.querySelectorAll('.workflow-nav__run-slot button')]
        .find((b) => /开始重定向/.test(b.textContent || ''));
      return !busy && btn && !btn.disabled;
    }, null, { timeout: 180000 });
    await sleep(2500);
  }
  async function selectedRobot() {
    return norm(await page.locator('aside .v-select').first().innerText());
  }
  const galleryHref = () => page.locator('aside a', { hasText: '在 Gallery 中查看' }).first().getAttribute('href');

  async function pickFromGallery(name, tag) {
    await page.locator('aside').getByRole('button', { name: /从 Gallery 选择 URDF/ }).click();
    const dialog = page.locator('.v-overlay--active .v-card').last();
    await dialog.locator('.gallery-item').first().waitFor({ timeout: 60000 });
    const item = dialog.locator('.gallery-item').filter({
      has: page.locator('.v-list-item-title', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
    }).first();
    await item.scrollIntoViewIfNeeded();
    await item.click();
    await sleep(800);
    await shot(`${tag}_dialog.png`);
    const toggles = await dialog.locator('.v-btn-toggle .v-btn').evaluateAll((els) =>
      els.map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })),
    );
    const href = await dialog.getByRole('link', { name: /在 Gallery 中查看/ }).getAttribute('href');
    await dialog.getByRole('button', { name: /加载此机器人/ }).click();
    await page.waitForFunction(() => !document.querySelector('.v-overlay--active .gallery-item'), null, { timeout: 300000 });
    await waitRobotLoaded();
    return { toggles, href };
  }

  async function run(tag) {
    const t0 = Date.now();
    await page.locator('.workflow-nav__run-slot').getByRole('button', { name: /开始重定向/ }).click();
    await page.waitForFunction(
      () => location.hash.startsWith('#/preview') && [...document.querySelectorAll('button')].some((b) => /导出 NPZ/.test(b.textContent || '')),
      null,
      { timeout: 300000 },
    );
    await sleep(2500);
    const info = (await page.locator('.info-line').allInnerTexts()).map(norm);
    const alerts = (await page.locator('.v-alert').allInnerTexts().catch(() => [])).map(norm);
    await shot(`${tag}_preview.png`);
    summary.runs.push({ tag, wallSeconds: (Date.now() - t0) / 1000, info, alerts });
    check(alerts.length === 0, `${tag}: retarget ran without an error alert`);
  }

  console.log(`[humanoid] Walk sample → built-in G1 → gallery ${HUMANOID}`);
  await page.goto(`${BASE}/#/bvh`);
  await loadSample('Walk 行走', 'walk.bvh');
  await page.goto(`${BASE}/#/config`);
  await waitRobotLoaded();
  const builtinHref = await galleryHref();
  check(/#robot=g1&v=g1_29dof_rev_1_0$/.test(builtinHref ?? ''), `built-in G1 links to the gallery (${builtinHref})`);
  await shot('1_config_builtin_g1.png');

  const h = await pickFromGallery(HUMANOID, `2_${slug(HUMANOID)}`);
  check(h.toggles.some((b) => /四足/.test(b.text) && b.disabled), 'quadruped category disabled for a humanoid motion');
  check(/#robot=\w+/.test(h.href ?? ''), `dialog links to the gallery page (${h.href})`);
  check((await selectedRobot()).includes(`${HUMANOID}`) && /Gallery/.test(await selectedRobot()), `gallery ${HUMANOID} selected (${await selectedRobot()})`);
  check((await galleryHref()) === h.href, 'sidebar links the loaded gallery robot');
  if (HUMANOID === 'G1') {
    const tableRows = await page.locator('.tables-panel tbody tr').count();
    check(tableRows >= 10, `G1 preset matched (${tableRows} stage-1 mappings)`);
  }
  await shot(`2_${slug(HUMANOID)}_config.png`);
  await run(`2_${slug(HUMANOID)}`);

  console.log(`[quadruped] Dog walk → gallery ${QUADRUPED}`);
  await page.goto(`${BASE}/#/bvh`);
  await loadSample('Dog walk', 'dog_walk.bvh');
  await page.goto(`${BASE}/#/config`);
  await waitRobotLoaded();
  const q = await pickFromGallery(QUADRUPED, `3_${slug(QUADRUPED)}`);
  check(q.toggles.some((b) => /人形/.test(b.text) && b.disabled), 'humanoid category disabled for a dog motion');
  check((await selectedRobot()).includes(QUADRUPED) && /Gallery/.test(await selectedRobot()), `gallery ${QUADRUPED} selected (${await selectedRobot()})`);
  await shot(`3_${slug(QUADRUPED)}_config.png`);
  await run(`3_${slug(QUADRUPED)}`);
} finally {
  await browser.close();
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ failures, ...summary }, null, 2));
  console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall checks passed', `— output in ${OUT}`);
  process.exitCode = failures.length ? 1 : 0;
}
