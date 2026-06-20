#!/usr/bin/env node
/**
 * WebKit + iPhone viewport verification for Retarget Preview touch/button fix.
 * Records a video while exercising controls that were broken on iOS WebKit.
 *
 * Usage: node scripts/webkit_preview_verify.mjs [--url http://localhost:3000]
 * Requires the dev or preview server to be running.
 */

import { webkit, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:3000';
const OUT_DIR = process.env.WEBKIT_VERIFY_OUT ?? '/opt/cursor/artifacts/webkit-verify';
const iphone = devices['iPhone 13'];

mkdirSync(OUT_DIR, { recursive: true });

function log(step, detail = '') {
  console.log(`[${step}]${detail ? ` ${detail}` : ''}`);
}

async function openMobilePanel(page) {
  const fab = page.locator('.panel-fab');
  if (await fab.isVisible()) await fab.tap();
  await page.waitForTimeout(600);
}

async function closeMobilePanel(page) {
  const drawer = page.locator('.side-drawer.v-navigation-drawer--active');
  if (await drawer.isVisible()) {
    // Tap the exposed scrim strip on the right (drawer is 320px on a 390px viewport).
    await page.touchscreen.tap(360, 420);
  }
  await page.waitForFunction(() => !document.querySelector('.v-navigation-drawer--active'), { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function waitForRetargetDone(page, timeoutMs = 300000) {
  await page.waitForFunction(
    () => {
      const exportBtn = [...document.querySelectorAll('button, .v-btn')].find((el) =>
        el.textContent?.includes('导出 NPZ'),
      );
      const running = [...document.querySelectorAll('.v-btn, button')].some((el) =>
        el.textContent?.includes('取消'),
      );
      return Boolean(exportBtn) && !running;
    },
    { timeout: timeoutMs },
  );
}

async function readPlaybackFrame(page) {
  return page.evaluate(() => {
    const label = document.querySelector('.frame-label')?.textContent ?? '';
    const match = label.match(/(\d+)\s*\/\s*(\d+)/);
    return match ? Number(match[1]) : -1;
  });
}

async function main() {
  log('launch', 'Playwright WebKit (iPhone 13 emulation)');
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({
    ...iphone,
    recordVideo: {
      dir: OUT_DIR,
      size: { width: iphone.viewport.width, height: iphone.viewport.height },
    },
    locale: 'zh-CN',
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  let videoPath = join(OUT_DIR, 'webkit-preview-verify.webm');

  try {
    // ---- Load sample motion (mobile: open side drawer first) ----
    log('step', 'open BVH viewer and load Walk sample');
    await page.goto(`${BASE_URL}/#/bvh`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await openMobilePanel(page);
    await page.getByRole('button', { name: '加载示例动作 BVH' }).tap();
    await page.getByText('Walk 行走', { exact: false }).tap();
    await page.waitForTimeout(2500);
    await closeMobilePanel(page);
    await page.screenshot({ path: join(OUT_DIR, '01-bvh-loaded.png') });

    // ---- Config + retarget via workflow overlay ----
    log('step', 'go to config and start retarget');
    await page.getByRole('button', { name: '下一步' }).tap();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.workflow-nav button, .workflow-nav .v-btn')].some(
          (el) => el.textContent?.includes('开始重定向') && !el.disabled,
        ),
      { timeout: 120000 },
    );
    await page.waitForTimeout(1000);
    await page.locator('.workflow-nav').getByRole('button', { name: '开始重定向' }).tap();
    await waitForRetargetDone(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT_DIR, '02-preview-loaded.png') });

    // ---- Preview: ensure autoplay is running, then exercise controls while playing ----
    log('step', 'verify controls respond during active playback');
    const frameBeforePlay = await readPlaybackFrame(page);
    await page.waitForTimeout(1200);
    const frameDuringPlay = await readPlaybackFrame(page);
    if (frameDuringPlay <= frameBeforePlay) {
      await page.locator('.playback-bar .v-btn').nth(1).tap();
      await page.waitForTimeout(800);
    }
    const framePlaying = await readPlaybackFrame(page);
    await page.waitForTimeout(800);
    const frameStillPlaying = await readPlaybackFrame(page);
    if (frameStillPlaying <= framePlaying) throw new Error('Preview animation is not playing');

    log('step', 'tap workflow back to config (while playing)');
    await page.locator('.workflow-nav').getByRole('button', { name: '返回重定向设置' }).tap();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT_DIR, '03-nav-config.png') });

    log('step', 'return to preview via bottom nav');
    await page.getByRole('button', { name: /重定向预览|3/ }).tap();
    await page.waitForTimeout(1200);
    await page.waitForTimeout(1000);

    // ---- Panel FAB (while playing) ----
    log('step', 'open side panel FAB during playback');
    await openMobilePanel(page);
    await page.screenshot({ path: join(OUT_DIR, '04-panel-open.png') });
    await closeMobilePanel(page);

    // ---- Metrics collapse/expand (while playing) ----
    log('step', 'collapse and expand metrics panel during playback');
    const metricsToggle = page.locator('.metrics-header .v-btn').last();
    await metricsToggle.tap();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT_DIR, '05-metrics-collapsed.png') });
    await metricsToggle.tap();
    await page.waitForTimeout(800);

    // ---- Playback play/pause ----
    log('step', 'pause then play again');
    const frameBefore = await readPlaybackFrame(page);
    const playBtn = page.locator('.playback-bar .v-btn').nth(1);
    await playBtn.tap();
    await page.waitForTimeout(600);
    const framePaused = await readPlaybackFrame(page);
    await playBtn.tap();
    await page.waitForTimeout(1500);
    const frameResumed = await readPlaybackFrame(page);
    await playBtn.tap();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT_DIR, '06-playback-tested.png') });

    const playAdvanced = frameResumed > framePaused;
    log('result', `frames: before=${frameBefore} paused=${framePaused} resumed=${frameResumed}`);
    if (!playAdvanced) throw new Error('Play button did not advance playback in WebKit');

    // ---- Bottom nav (while playing) ----
    log('step', 'tap bottom nav BVH tab during playback');
    await playBtn.tap();
    await page.waitForTimeout(400);
    await page.locator('.bottom-nav').getByRole('button', { name: 'BVH 预览', exact: true }).tap();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(OUT_DIR, '07-bottom-nav.png') });

    const fatal = errors.filter((e) => !e.includes('favicon'));
    if (fatal.length) {
      console.log('console errors:');
      for (const e of fatal) console.log('  -', e.slice(0, 300));
    }

    log('pass', 'WebKit iPhone controls responded to taps');
  } finally {
    const video = page.video();
    await page.close();
    if (video) {
      await video.saveAs(videoPath);
      log('video', videoPath);
    }
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('WEBKIT VERIFY FAILED:', err.message);
  process.exit(1);
});
