#!/usr/bin/env node
/**
 * Headless E2E check of the quadruped retargeting flow (dog mocap → Unitree
 * Go2 / A1), driven through the built app in Chromium:
 *
 *   plain URL      → the dog samples + Go2 / A1 are visible (or hidden, see
 *                    --default-visible) in the sample menu / robot dropdown
 *   ?quadruped=0   → both are hidden for that page load (per-visit kill switch)
 *   ?quadruped=1   → both are visible
 *   main flow      → Dog walk → Retarget Config auto-selects Go2 and greys out
 *                    the humanoid robots + custom URDF import → run → stats +
 *                    error metrics → NPZ export (parsed: fps / root_pos /
 *                    root_rot / dof_pos shapes, finite values) → A1 → run →
 *                    NPZ → Dog run / Dog idle on A1 → LAFAN1 Walk switches the
 *                    robot back to a humanoid and greys out Go2 / A1 → run →
 *                    Dog idle again auto-selects Go2.
 *
 * Usage: node scripts/e2e_quadruped.mjs [--out DIR] [--port 4175]
 *                                      [--default-visible 1|0] [--flag "?quadruped=1"]
 * Requires `npm run build` first; serves ./dist via `vite preview`. Screenshots
 * and `summary.json` land in --out (default $E2E_OUT or /tmp/e2e_quadruped).
 * `--flag` is the query string the main flow runs under (default: none).
 */

import { chromium } from 'playwright-core';
import { unzipSync } from 'fflate';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const OUT = resolve(arg('--out', process.env.E2E_OUT ?? '/tmp/e2e_quadruped'));
const PORT = Number(arg('--port', '4175'));
const DEFAULT_VISIBLE = arg('--default-visible', '1') === '1';
const FLAG = arg('--flag', '');

const DOG_FRAMES = { 'dog_walk.bvh': 195, 'dog_run.bvh': 210, 'dog_idle.bvh': 180 };

function chromePath() {
  const flagIdx = args.indexOf('--executable');
  if (flagIdx >= 0) return args[flagIdx + 1];
  for (const c of [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    '/opt/pw-browsers/chromium',
  ]) if (existsSync(c)) return c;
  throw new Error('No chromium found; pass --executable');
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

/** Minimal NPY reader (little-endian numeric dtypes, C order) for export checks. */
function parseNpy(bytes) {
  const magic = String.fromCharCode(...bytes.subarray(1, 6));
  if (bytes[0] !== 0x93 || magic !== 'NUMPY') throw new Error('not an NPY file');
  const major = bytes[6];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = major === 1 ? dv.getUint16(8, true) : dv.getUint32(8, true);
  const headerStart = major === 1 ? 10 : 12;
  const header = String.fromCharCode(...bytes.subarray(headerStart, headerStart + headerLen));
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1] ?? '';
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const data = bytes.subarray(headerStart + headerLen);
  const n = shape.reduce((a, b) => a * b, 1);
  let values;
  if (descr === '<f8') values = new Float64Array(data.buffer.slice(data.byteOffset, data.byteOffset + n * 8));
  else if (descr === '<f4') values = new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + n * 4));
  else if (descr === '<i8') values = new BigInt64Array(data.buffer.slice(data.byteOffset, data.byteOffset + n * 8));
  else if (descr === '<i4') values = new Int32Array(data.buffer.slice(data.byteOffset, data.byteOffset + n * 4));
  else values = null; // e.g. unicode `dof_names` — shape is still reported
  return { descr, shape, values };
}
function parseNpz(path) {
  const entries = unzipSync(new Uint8Array(readFileSync(path)));
  const out = {};
  for (const [name, bytes] of Object.entries(entries)) out[name.replace(/\.npy$/, '')] = parseNpy(bytes);
  return out;
}

const failures = [];
const summary = { visibility: {}, runs: [], exports: {}, consoleErrors: [] };
function check(cond, msg) {
  if (cond) console.log('  ok   ', msg);
  else { console.log('  FAIL ', msg); failures.push(msg); }
}

mkdirSync(OUT, { recursive: true });
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: true },
);

let browser;
try {
  await waitServer(`http://localhost:${PORT}/`);
  console.log('preview server up on', PORT);
  browser = await chromium.launch({
    executablePath: chromePath(),
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('requestfailed', (req) => errors.push(`request failed: ${req.url()}`));
  page.on('response', (res) => { if (res.status() >= 400) errors.push(`HTTP ${res.status()}: ${res.url()}`); });

  const base = `http://localhost:${PORT}`;
  const shot = (name) => page.screenshot({ path: join(OUT, name) });
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  // ---------- helpers ----------
  /** Hash-only navigation keeps the in-memory Pinia stores (a reload would clear them). */
  async function gotoHash(route, query = FLAG) {
    const target = `${base}/${query}#/${route}`;
    if (page.url() !== target) await page.goto(target);
    await sleep(400);
  }
  async function openSampleMenu() {
    await page.getByRole('button', { name: /加载示例动作/ }).click();
    await page.locator('.sample-menu-panel .v-list-item').first().waitFor({ timeout: 15000 });
    const items = (await page.locator('.sample-menu-panel .v-list-item').allInnerTexts()).map(norm);
    const headers = (await page.locator('.sample-menu-panel .sample-group-header').allInnerTexts()).map(norm);
    return { items, headers };
  }
  async function closeMenu() {
    await page.keyboard.press('Escape');
    await sleep(400);
  }
  async function loadSample(text, fileName) {
    await openSampleMenu();
    await page.locator('.sample-menu-panel .v-list-item', { hasText: text }).first().click();
    await page.waitForFunction(
      (f) => [...document.querySelectorAll('.info-line')].some((l) => l.textContent.includes(f)),
      fileName,
      { timeout: 30000 },
    );
    await sleep(1500);
    return (await page.locator('.info-line').allInnerTexts()).map(norm);
  }
  async function waitRobotLoaded() {
    await page.waitForFunction(() => {
      const strip = document.querySelector('.loading-strip');
      const stripBusy = strip && /\d+\s*\/\s*\d+/.test(strip.textContent || '');
      const btn = [...document.querySelectorAll('.workflow-nav__run-slot button')]
        .find((b) => /开始重定向/.test(b.textContent || ''));
      return !stripBusy && btn && !btn.disabled;
    }, { timeout: 120000 });
    await sleep(2500); // model compile + first render
  }
  async function selectedRobot() {
    const sel = page.locator('aside .v-select').first();
    const t = await sel.locator('.v-select__selection-text').first().innerText().catch(() => '');
    return norm(t || (await sel.innerText()));
  }
  async function robotOptions() {
    await page.locator('aside .v-select').first().click();
    const opts = page.locator('.v-overlay-container .v-list-item');
    await opts.first().waitFor({ timeout: 15000 });
    const n = await opts.count();
    const out = [];
    for (let i = 0; i < n; i++) {
      const o = opts.nth(i);
      const cls = (await o.getAttribute('class')) || '';
      const aria = await o.getAttribute('aria-disabled');
      out.push({ title: norm(await o.innerText()), disabled: cls.includes('v-list-item--disabled') || aria === 'true' });
    }
    await closeMenu();
    return out;
  }
  async function chooseRobot(label) {
    await page.locator('aside .v-select').first().click();
    const opt = page.locator('.v-overlay-container .v-list-item', { hasText: label }).first();
    await opt.waitFor({ timeout: 15000 });
    await opt.click();
    await sleep(300);
  }
  /**
   * Run from Retarget Config (the preview route is guarded until a result
   * exists); the nav bar jumps to Preview when done. `robotRe` is matched
   * against the stats card's robot line (it shows the MJCF file, e.g.
   * `go2_mocap.xml`), `expectFile` against its file line.
   */
  async function runRetarget(tag, robotRe, expectFile, expectFrames) {
    await gotoHash('config');
    await waitRobotLoaded();
    const t0 = Date.now();
    await page.locator('.workflow-nav__run-slot').getByRole('button', { name: /开始重定向/ }).click();
    await page.waitForFunction(
      ([robotSrc, file]) => {
        if (!location.hash.startsWith('#/preview')) return false;
        const lines = [...document.querySelectorAll('.info-line')].map((l) => (l.textContent || '').replace(/\s+/g, ' ').trim());
        const robotLine = lines.find((l) => l.startsWith('机器人'));
        const fileLine = lines.find((l) => l.startsWith('文件'));
        const exportBtn = [...document.querySelectorAll('button')].some((b) => /导出 NPZ/.test(b.textContent || ''));
        return !!robotLine && new RegExp(robotSrc, 'i').test(robotLine) && !!fileLine && fileLine.includes(file) && exportBtn;
      },
      [robotRe.source, expectFile],
      { timeout: 300000 },
    );
    const wallSeconds = Number(((Date.now() - t0) / 1000).toFixed(1));
    await sleep(2000);
    const info = (await page.locator('.info-line').allInnerTexts()).map(norm);
    const alerts = (await page.locator('.v-alert').allInnerTexts().catch(() => [])).map(norm);
    // The playback bar reads "帧 i / N-1": a stale N means the preview scene was not rebuilt for this result.
    const frameText = norm(await page.getByText(/帧 \d+ \/ \d+/).first().innerText().catch(() => ''));
    const fm = /帧 \d+ \/ (\d+)/.exec(frameText);
    check(!!fm && Number(fm[1]) === expectFrames - 1, `${tag}: playback bar spans the new result (${frameText || 'no frame text'})`);
    const run = { tag, robot: robotRe.source, file: expectFile, wallSeconds, info, alerts, frameText };
    summary.runs.push(run);
    console.log(`  run ${tag}: wall=${wallSeconds}s`);
    for (const l of info) console.log('     ', l);
    check(alerts.length === 0, `${tag}: no error alert`);
    await shot(`${tag}.png`);
    return run;
  }
  async function exportNpz(tag, frames) {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.getByRole('button', { name: /导出 NPZ/ }).click(),
    ]);
    const dest = join(OUT, `${tag}.npz`);
    await dl.saveAs(dest);
    const npz = parseNpz(dest);
    const shapes = Object.fromEntries(Object.entries(npz).map(([k, v]) => [k, v.shape]));
    const rootZ = npz.root_pos ? Array.from({ length: npz.root_pos.shape[0] }, (_, i) => npz.root_pos.values[i * 3 + 2]) : [];
    const meanRootZ = rootZ.reduce((a, b) => a + b, 0) / Math.max(1, rootZ.length);
    const finite = ['root_pos', 'root_rot', 'dof_pos'].every((k) => npz[k] && Array.from(npz[k].values).every(Number.isFinite));
    const rec = { file: dl.suggestedFilename(), shapes, meanRootZ: Number(meanRootZ.toFixed(3)) };
    console.log(`  exported ${rec.file}: ${JSON.stringify(shapes)} mean root z=${rec.meanRootZ} m`);
    check(JSON.stringify(shapes.dof_pos) === JSON.stringify([frames, 12]), `${tag}: dof_pos is (${frames}, 12)`);
    check(JSON.stringify(shapes.root_pos) === JSON.stringify([frames, 3]) && JSON.stringify(shapes.root_rot) === JSON.stringify([frames, 4]), `${tag}: root_pos (N,3) / root_rot (N,4)`);
    check(!!npz.fps, `${tag}: fps present`);
    check(finite, `${tag}: all exported values finite`);
    check(meanRootZ > 0.2 && meanRootZ < 0.4, `${tag}: mean root height ${rec.meanRootZ} m in the quadruped crouch range`);
    return rec;
  }
  async function visibility(query, label) {
    await page.goto(`${base}/${query}#/bvh`);
    await page.waitForLoadState('load');
    await sleep(1500);
    const menu = await openSampleMenu();
    await sleep(600); // let the menu's open transition finish before the screenshot
    await shot(`0_sample_menu_${label}.png`);
    await closeMenu();
    const dogs = menu.items.some((s) => /Dog/i.test(s));
    summary.visibility[label] = { query, sampleItems: menu.items, sampleHeaders: menu.headers, dogSamplesVisible: dogs };
    console.log(`  [${label}] sample items: ${JSON.stringify(menu.items)}`);
    return dogs;
  }

  // ---------- visibility: plain URL / kill switch / explicit on ----------
  console.log('\n[visibility] expected on a plain URL =', DEFAULT_VISIBLE);
  check((await visibility('', 'plain')) === DEFAULT_VISIBLE, `plain URL: dog samples visible = ${DEFAULT_VISIBLE}`);
  await loadSample('Walk 行走', 'walk.bvh');
  await gotoHash('config', '');
  await waitRobotLoaded();
  const optsPlain = await robotOptions();
  summary.visibility.plain.robotOptions = optsPlain;
  console.log('  [plain] robot options:', JSON.stringify(optsPlain.map((o) => o.title)));
  check(optsPlain.some((o) => /Go2|A1/.test(o.title)) === DEFAULT_VISIBLE, `plain URL: Go2/A1 in robot dropdown = ${DEFAULT_VISIBLE}`);
  await shot('0_plain_robot_dropdown.png');
  check((await visibility('?quadruped=0', 'off')) === false, '?quadruped=0 hides the dog samples');
  check((await visibility('?quadruped=1', 'on')) === true, '?quadruped=1 shows the dog samples');

  // ---------- main flow ----------
  console.log(`\n[flow] URL query "${FLAG || '(none)'}"`);
  await page.goto(`${base}/${FLAG}#/bvh`);
  await page.waitForLoadState('load');
  await sleep(1500);
  const menu = await openSampleMenu();
  await closeMenu();
  check(menu.items.some((s) => /Dog walk/i.test(s)), 'Dog walk sample listed');
  check(menu.headers.length === 2, `two sample groups (${menu.headers.join(' / ')})`);

  const infoDog = await loadSample('Dog walk', 'dog_walk.bvh');
  console.log('  motion info:', infoDog.join(' | '));
  check(infoDog.some((l) => /关节数.*61/.test(l)), 'dog_walk: 61 joints');
  check(infoDog.some((l) => /帧数.*195/.test(l)), 'dog_walk: 195 frames');
  await shot('1_bvh_dog_walk.png');

  await gotoHash('config');
  await waitRobotLoaded();
  const sel1 = await selectedRobot();
  console.log('  selected robot after dog load:', sel1);
  check(/Go2/.test(sel1), 'config: Unitree Go2 auto-selected for quadruped motion');
  const opts1 = await robotOptions();
  console.log('  robot options:', JSON.stringify(opts1));
  check(opts1.some((o) => /Go2/.test(o.title) && !o.disabled), 'config: Go2 enabled');
  check(opts1.some((o) => /A1/.test(o.title) && !o.disabled), 'config: A1 enabled');
  const humanoids = opts1.filter((o) => !/Go2|A1/.test(o.title));
  check(humanoids.length > 0 && humanoids.every((o) => o.disabled), 'config: humanoid robots greyed out for dog motion');
  const urdfBtn = page.getByRole('button', { name: /导入自定义 URDF/ });
  check(await urdfBtn.isDisabled(), 'config: custom URDF import disabled for quadruped motion');
  await shot('2_config_go2.png');

  await runRetarget('3_preview_go2_dog_walk', /go2/, 'dog_walk.bvh', DOG_FRAMES['dog_walk.bvh']);
  summary.exports.go2_dog_walk = await exportNpz('go2_dog_walk', DOG_FRAMES['dog_walk.bvh']);

  await gotoHash('config');
  await chooseRobot('Unitree A1');
  await waitRobotLoaded();
  check(/A1/.test(await selectedRobot()), 'config: Unitree A1 selected');
  await shot('4_config_a1.png');
  await runRetarget('5_preview_a1_dog_walk', /a1/, 'dog_walk.bvh', DOG_FRAMES['dog_walk.bvh']);
  summary.exports.a1_dog_walk = await exportNpz('a1_dog_walk', DOG_FRAMES['dog_walk.bvh']);

  await gotoHash('bvh');
  await loadSample('Dog run', 'dog_run.bvh');
  await runRetarget('6_preview_a1_dog_run', /a1/, 'dog_run.bvh', DOG_FRAMES['dog_run.bvh']);
  summary.exports.a1_dog_run = await exportNpz('a1_dog_run', DOG_FRAMES['dog_run.bvh']);

  await gotoHash('bvh');
  await loadSample('Dog idle', 'dog_idle.bvh');
  await runRetarget('7_preview_a1_dog_idle', /a1/, 'dog_idle.bvh', DOG_FRAMES['dog_idle.bvh']);

  // Back to humanoid: the robot must switch away from the quadruped automatically.
  await gotoHash('bvh');
  await loadSample('Walk 行走', 'walk.bvh');
  await gotoHash('config');
  await waitRobotLoaded();
  const selH = await selectedRobot();
  console.log('  selected robot after humanoid load:', selH);
  check(/G1/.test(selH) && !/Go2|A1/.test(selH), 'config: quadruped robot replaced by Unitree G1 (first humanoid) for LAFAN1 motion');
  const optsH = await robotOptions();
  check(optsH.filter((o) => /Go2|A1/.test(o.title)).every((o) => o.disabled), 'config: Go2/A1 greyed out for humanoid motion');
  check(!(await urdfBtn.isDisabled()), 'config: custom URDF import enabled again');
  await shot('8_config_back_to_humanoid.png');
  await runRetarget('9_preview_humanoid_walk', /g1/, 'walk.bvh', 1800);

  // And back to a dog clip: Go2 is auto-picked again from a humanoid robot.
  await gotoHash('bvh');
  await loadSample('Dog idle', 'dog_idle.bvh');
  await gotoHash('config');
  await waitRobotLoaded();
  check(/Go2/.test(await selectedRobot()), 'config: Go2 auto-selected again after switching back to dog motion');

  const fatal = errors.filter((e) => !e.includes('favicon') && !e.includes('GroupMarkerNotSet'));
  summary.consoleErrors = fatal;
  check(fatal.length === 0, `no console / page / network errors (${fatal.length})`);
  for (const e of fatal) console.log('    -', e.slice(0, 300));
} catch (err) {
  failures.push(`exception: ${err.message}`);
  console.error('E2E exception:', err);
  try {
    const pages = browser?.contexts().flatMap((c) => c.pages()) ?? [];
    if (pages[0]) await pages[0].screenshot({ path: join(OUT, 'failure.png') });
  } catch { /* ignore */ }
} finally {
  summary.failures = failures;
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser?.close();
  try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
  console.log(failures.length ? `\nQUADRUPED E2E FAILED (${failures.length}):\n - ${failures.join('\n - ')}` : '\nQUADRUPED E2E PASSED');
  process.exit(failures.length ? 1 : 0);
}
