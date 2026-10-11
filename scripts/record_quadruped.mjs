#!/usr/bin/env node
/**
 * Record a narrated demo video of the quadruped retargeting flow:
 *
 *   ① BVH Viewer   load the "Dog walk" sample (Labrador mocap, 61 joints)
 *   ② Config       Unitree Go2 is auto-selected, humanoid robots greyed out,
 *                  dog skeleton overlaid on the robot, stage-2 feet mapping
 *   ③ Run          one click from the nav bar → jumps to the preview
 *   ④ Preview      Go2 playback with the dog keypoints + per-frame error chart
 *   ⑤ Export       NPZ / CSV / JSON buttons
 *   ⑥–⑧           "Dog run" clip → switch to Unitree A1 → run → playback
 *   ⑨ History      switch back to the Go2 result (reloads the other robot)
 *
 * Playwright records the whole session as a .webm; only the marked segments
 * (`clip()` below) are kept, so the robot-loading waits are cut out. A caption
 * banner is injected into the page so the steps are narrated in the video
 * itself. ffmpeg (system build with libx264) concatenates the clips into an
 * .mp4; the raw .webm is kept next to it.
 *
 * Usage: npm run build && node scripts/record_quadruped.mjs
 * Output: $REC_OUT (default /tmp/rec)/quadruped_retarget_demo.{mp4,webm}
 * Requires a system `ffmpeg` (the Playwright one is webm-only); override with
 * FFMPEG=/path/to/ffmpeg.
 */

import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.REC_OUT ?? '/tmp/rec';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const PORT = 4192;
const W = 1280;
const H = 800;

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

  /** On-page caption banner (recorded with the video; never intercepts clicks). */
  async function caption(text) {
    await page.evaluate((t) => {
      let el = document.getElementById('demo-caption');
      if (!el) {
        el = document.createElement('div');
        el.id = 'demo-caption';
        Object.assign(el.style, {
          position: 'fixed', top: '66px', left: '50%', transform: 'translateX(-50%)',
          maxWidth: '760px', padding: '9px 18px', borderRadius: '12px',
          background: 'rgba(12, 14, 20, 0.82)', color: '#fff', textAlign: 'center',
          font: '600 19px/1.45 system-ui, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
          zIndex: 99999, pointerEvents: 'none', boxShadow: '0 4px 18px rgba(0,0,0,.45)',
        });
        document.body.appendChild(el);
      }
      el.textContent = t;
    }, text);
  }

  const canvasBox = () => page.locator('canvas').first().boundingBox();

  /** Slow wall-clock drag across the three.js canvas — orbits the camera. */
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
      const strip = document.querySelector('.loading-strip');
      const busy = strip && /\d+\s*\/\s*\d+/.test(strip.textContent || '');
      const btn = [...document.querySelectorAll('.workflow-nav__run-slot button')]
        .find((b) => /开始重定向/.test(b.textContent || ''));
      return !busy && btn && !btn.disabled;
    }, { timeout: 120000 });
    await sleep(2000);
  }

  async function loadSample(text, fileName) {
    await page.getByRole('button', { name: /加载示例动作/ }).click();
    await page.locator('.sample-menu-panel .v-list-item').first().waitFor({ timeout: 15000 });
    await sleep(1400); // show the grouped menu
    await page.locator('.sample-menu-panel .v-list-item', { hasText: text }).first().click();
    await page.waitForFunction(
      (f) => [...document.querySelectorAll('.info-line')].some((l) => l.textContent.includes(f)),
      fileName,
      { timeout: 30000 },
    );
  }

  const robotSelect = () => page.locator('aside .v-select').first();

  /** Click the nav-bar run button (Config page) and wait for the Preview result. */
  async function runAndWait(file) {
    await page.locator('.workflow-nav__run-slot').getByRole('button', { name: /开始重定向/ }).click();
    await page.waitForFunction(
      (f) => {
        if (!location.hash.startsWith('#/preview')) return false;
        const lines = [...document.querySelectorAll('.info-line')].map((l) => l.textContent || '');
        const exportBtn = [...document.querySelectorAll('button')].some((b) => /导出 NPZ/.test(b.textContent || ''));
        return lines.some((l) => l.includes(f)) && exportBtn;
      },
      file,
      { timeout: 300000 },
    );
  }

  // ---- ① BVH Viewer: dog mocap sample ----
  await page.goto(`${base}/#/bvh`);
  await sleep(1500);
  await caption('① BVH 预览 · 加载示例动作 → 「四足动物」分组 → Dog walk（Labrador 狗动捕，61 关节）');
  await clip('bvh_dog', async () => {
    await sleep(800);
    await loadSample('Dog walk', 'dog_walk.bvh');
    await sleep(1500);
    await orbit(3, 260);
    await sleep(2000);
  });

  // ---- ② Config: Go2 auto-selected, humanoids greyed out ----
  await page.goto(`${base}/#/config`);
  await waitRobotLoaded();
  await caption('② 重定向设置 · 狗动捕 → 自动选中 Unitree Go2，人形机器人变灰（动作类型与机器人配置必须匹配）');
  await clip('config_go2', async () => {
    await sleep(600);
    await robotSelect().click();
    await page.locator('.v-overlay-container .v-list-item').first().waitFor({ timeout: 15000 });
    await sleep(2200);
    await page.keyboard.press('Escape');
    await sleep(500);
    await orbit(2.5, 220);
    await sleep(600);
    await caption('② 映射表 · 阶段 2：躯干 ← b_Hips，四只脚 FL/FR/RL/RR_foot ← 狗的前爪 / 后爪关键点');
    await page.getByRole('tab', { name: /阶段 2/ }).click().catch(() => {});
    await sleep(2800);
  });

  // ---- ③ Run from the nav bar → ④ Preview ----
  await caption('③ 一键重定向（195 帧，浏览器内约 0.15 s）→ 自动跳转到重定向预览');
  await clip('run_go2', async () => {
    await sleep(900);
    await runAndWait('dog_walk.bvh');
    await sleep(1200);
  });
  await zoom(-300);
  await caption('④ 重定向预览 · Go2 回放，叠加狗的关键点（红点），下方为逐帧关键点误差曲线');
  await clip('preview_go2', async () => {
    await sleep(2500);
    await orbit(5, 300);
    await sleep(3000);
  });
  await caption('⑤ 导出 · NPZ（GMR 格式，dof_pos 12 列）/ CSV / JSON');
  await clip('export', async () => {
    await page.getByRole('button', { name: /导出 NPZ/ }).hover();
    await sleep(2200);
  });

  // ---- ⑥ another clip + ⑦ another robot ----
  await page.goto(`${base}/#/bvh`);
  await sleep(800);
  await caption('⑥ 换一段动捕 · Dog run（210 帧）');
  await clip('bvh_dog_run', async () => {
    await sleep(500);
    await loadSample('Dog run', 'dog_run.bvh');
    await sleep(2500);
  });
  await page.goto(`${base}/#/config`);
  await waitRobotLoaded();
  await caption('⑦ 切换机器人 · Unitree A1（同样 12 自由度，同一套配置约定）');
  await clip('config_a1', async () => {
    await sleep(500);
    await robotSelect().click();
    const a1 = page.locator('.v-overlay-container .v-list-item', { hasText: 'Unitree A1' }).first();
    await a1.waitFor({ timeout: 15000 });
    await sleep(900);
    await a1.click();
    await sleep(1200);
  });
  await waitRobotLoaded();
  await clip('config_a1_loaded', async () => {
    await orbit(2, 200);
    await sleep(500);
  });
  await caption('⑧ A1 重定向 · Dog run 回放');
  await clip('run_a1', async () => {
    await sleep(600);
    await runAndWait('dog_run.bvh');
    await sleep(1200);
  });
  await zoom(-300);
  await clip('preview_a1', async () => {
    await sleep(2000);
    await orbit(5, 300);
    await sleep(2500);
  });

  // ---- ⑨ History: back to the Go2 result ----
  await caption('⑨ 历史重定向 · 切回 Go2 的结果（自动重新加载另一台机器人）');
  await clip('history', async () => {
    await sleep(600);
    await page.locator('aside .v-select').first().click();
    const go2Entry = page.locator('.v-overlay-container .v-list-item', { hasText: 'dog_walk' }).first();
    await go2Entry.waitFor({ timeout: 15000 });
    await sleep(1200);
    await go2Entry.click();
    await page.waitForFunction(
      () => [...document.querySelectorAll('.info-line')].some((l) => /go2/i.test(l.textContent || '')),
      null,
      { timeout: 120000 },
    );
    await sleep(3500);
  });

  const raw = await page.video().path();
  await context.close(); // finalizes the webm
  await browser.close();
  browser = undefined;

  const webm = join(OUT, 'quadruped_retarget_demo.webm');
  renameSync(raw, webm);
  const kept = clips.reduce((s, c) => s + (c.end - c.start), 0);
  console.log(`raw video: ${webm} — keeping ${kept.toFixed(1)}s in ${clips.length} clips`);

  // ---- webm -> mp4: trim to the marked clips and concatenate ----
  const trims = clips
    .map((c, i) => `[0:v]trim=start=${c.start.toFixed(2)}:end=${c.end.toFixed(2)},setpts=PTS-STARTPTS[c${i}];`)
    .join('');
  const concat = `${clips.map((_, i) => `[c${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[out]`;
  const mp4 = join(OUT, 'quadruped_retarget_demo.mp4');
  const r = spawnSync(
    FFMPEG,
    ['-y', '-loglevel', 'error', '-i', webm, '-filter_complex', trims + concat, '-map', '[out]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4],
    { stdio: 'inherit' },
  );
  if (r.error?.code === 'ENOENT') {
    console.log(`${FFMPEG} not found — keeping the raw webm (install ffmpeg or set FFMPEG=)`);
  } else if (r.status === 0 && existsSync(mp4)) {
    console.log(`MP4 ${mp4} — ${(statSync(mp4).size / 1e6).toFixed(2)} MB`);
  } else {
    console.log('mp4 encoding failed; use the raw webm');
    process.exitCode = 1;
  }
} catch (err) {
  console.error('recording failed:', err);
  process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
  process.exit(process.exitCode ?? 0);
}
