#!/usr/bin/env node
/**
 * Mobile verification for the Retarget Preview panel, drawer and metrics data.
 *
 * Complements scripts/webkit_preview_verify.mjs, which guards the tap-target
 * contract (44pt hit areas, touch-action). This one guards the behaviours that
 * only break on a device that dispatches **no compatibility mouse events** for
 * a tap — the iOS 26.6 behaviour documented in src/lib/tapFallback.ts:
 *
 *   1. the metrics ("data") panel scrolls, so no chart is clipped out of reach,
 *      and drag-resizes from its handle,
 *   2. tapping the scrim beside the side panel closes it, and
 *   3. the history dropdown opens on a tap, and closes on a tap outside.
 *
 * Chromium does dispatch those mouse events, so the device is emulated: an init
 * script swallows every *trusted* mouse event at the window capture phase,
 * before anything in the page can see it. Only what src/lib/tapFallback.ts
 * stands in for survives. The suite then runs a second pass with mouse events
 * left alone, which is a healthy browser — both passes must pass.
 *
 * Usage: node scripts/mobile_touch_verify.mjs [--url http://localhost:3000]
 * Requires the dev or preview server to be running.
 */

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:3000';
const OUT_DIR = process.env.MOBILE_VERIFY_OUT ?? '/tmp/mobile-verify';
const VIEWPORT = { width: 390, height: 844 }; // iPhone 13
/** The stand-in waits 400 ms for the browser's own click before sending one. */
const STAND_IN_MS = 900;

mkdirSync(OUT_DIR, { recursive: true });

function findExecutable() {
  const flagIdx = process.argv.indexOf('--executable');
  if (flagIdx >= 0) return process.argv[flagIdx + 1];
  const candidates = [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    '/usr/local/bin/google-chrome',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('No chromium found; pass --executable');
}

const failures = [];

function log(step, detail = '') {
  console.log(`[${step}]${detail ? ` ${detail}` : ''}`);
}

function check(ok, message) {
  if (ok) return true;
  failures.push(message);
  console.log(`  FAIL ${message}`);
  return false;
}

/**
 * The device under test: a tap delivers touch and pointer events, and nothing
 * else. Registered at window capture so it runs before the app's own document
 * listeners; untrusted events (what the fallback sends) pass through.
 */
const SUPPRESS_MOUSE_EVENTS = () => {
  for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) {
    window.addEventListener(
      type,
      (e) => {
        if (!e.isTrusted) return;
        e.stopImmediatePropagation();
        e.preventDefault();
      },
      true,
    );
  }
};

/** Real touchscreen tap at an element's centre, i.e. what a finger would do. */
async function tap(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('control has no box to tap');
  await tapAt(page, box.x + box.width / 2, box.y + box.height / 2);
}

async function tapAt(page, x, y) {
  await page.touchscreen.tap(Math.round(x), Math.round(y));
  await page.waitForTimeout(STAND_IN_MS);
}

/**
 * The scrim spans the whole viewport *under* the drawer, so its centre is a tap
 * on the panel itself. Aim beside the panel, which is what a dismissing tap is.
 */
function tapBesideDrawer(page) {
  return tapAt(page, VIEWPORT.width - 24, VIEWPORT.height / 2);
}

/**
 * A finger dragging upwards, i.e. scrolling down to what is below. Sent as raw
 * touch points so Chromium's own gesture recogniser decides what scrolls, the
 * way it does for a real finger.
 */
async function swipeUp(page, cdp, from, distance) {
  const x = Math.round(from.x);
  const y = Math.round(from.y);
  const steps = 12;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - Math.round((distance * i) / steps), id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
}

async function driveToPreview(page) {
  log('step', 'load the Walk sample and run the retarget');
  await page.goto(`${BASE_URL}/#/bvh`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  await tap(page, page.locator('.panel-fab'));
  await page.waitForFunction(
    () => {
      const d = document.querySelector('.side-drawer');
      return Boolean(d) && d.getBoundingClientRect().left >= 0;
    },
    null,
    { timeout: 15000 },
  );
  await tap(page, page.locator('.side-drawer').getByRole('button', { name: /加载示例动作/ }));
  const walk = page.locator('.sample-menu-panel .v-list-item', { hasText: 'Walk' }).first();
  await walk.waitFor({ timeout: 15000 });
  await tap(page, walk);
  await page.waitForFunction(
    () => document.querySelector('.workflow-nav')?.textContent?.includes('下一步'),
    null,
    { timeout: 60000 },
  );
  await tapBesideDrawer(page);
  const dismissed = await page
    .waitForFunction(() => !document.querySelector('.v-navigation-drawer__scrim'), null, {
      timeout: 5000,
    })
    .then(() => true)
    .catch(() => false);
  if (!check(dismissed, 'tapping beside the drawer did not close it (BVH viewer)')) {
    // Keep going so the preview checks still report; a scripted click is not a tap.
    await page.evaluate(() => document.querySelector('.v-navigation-drawer__scrim')?.click());
    await page.waitForTimeout(600);
  }

  await tap(page, page.locator('.workflow-nav').getByRole('button', { name: /下一步/ }));
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.workflow-nav button')].some(
        (el) => el.textContent?.includes('开始重定向') && !el.disabled,
      ),
    null,
    { timeout: 300000 },
  );
  // The retarget can take a while to start; re-tap rather than hang if the run
  // never gets going, so a stuck attempt reports instead of timing out blind.
  const runBtn = page.locator('.workflow-nav').getByRole('button', { name: /开始重定向/ });
  for (let attempt = 1; ; attempt++) {
    await tap(page, runBtn);
    const started = await page
      .waitForFunction(
        () =>
          Boolean(document.querySelector('.workflow-nav__progress')) ||
          Boolean(document.querySelector('.playback-bar')),
        null,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    if (started) break;
    if (attempt >= 3) throw new Error('the retarget never started after 3 taps');
    log('retry', `retarget did not start on tap ${attempt}`);
  }
  await page.waitForFunction(() => Boolean(document.querySelector('.playback-bar')), null, {
    timeout: 300000,
  });
  await page.waitForTimeout(2500);
}

/** 1. The metrics panel must be reachable end to end by scrolling. */
async function checkMetricsScroll(page, cdp, shot) {
  log('check', 'metrics panel scrolls to the whole chart');
  // The joint tabs stack a picker above the chart, which is where the squeeze bit.
  await tap(page, page.locator('.metrics-header .v-tab').nth(1));
  await page.waitForTimeout(800);

  const body = page.locator('.metrics-body');
  const box = await body.boundingBox();
  const before = await body.evaluate((el) => ({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  check(
    before.scrollHeight - before.clientHeight > 8,
    `metrics body has nothing to scroll (${before.scrollHeight} content in ${before.clientHeight}px), so a squeezed chart stays clipped`,
  );
  await shot('metrics-top.png');

  await swipeUp(page, cdp, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 150);
  const after = await body.evaluate((el) => el.scrollTop);
  check(after > 0, `swiping up the metrics body did not scroll it (scrollTop ${after})`);

  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(300);
  const chartFits = await page.evaluate(() => {
    const chart = document.querySelector('.chart-window .chart');
    const body = document.querySelector('.metrics-body');
    if (!chart || !body) return null;
    const c = chart.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    return { hidden: Math.round(c.bottom - b.bottom), height: Math.round(c.height) };
  });
  check(
    chartFits && chartFits.hidden <= 2,
    `chart bottom is still ${chartFits?.hidden}px below the visible panel after scrolling to the end`,
  );
  check(chartFits && chartFits.height >= 180, `chart is only ${chartFits?.height}px tall`);
  await shot('metrics-scrolled.png');
  await body.evaluate((el) => el.scrollTo(0, 0));
}

/** The metrics panel must also be resizable by dragging its handle. */
async function checkResizeHandle(page, cdp, shot) {
  log('check', 'metrics panel resizes by dragging its handle');
  const handle = page.locator('.resize-handle');
  const body = page.locator('.metrics-body');
  const bodyH = () => body.evaluate((el) => Math.round(el.getBoundingClientRect().height));

  const handleBox = await handle.boundingBox();
  check(Boolean(handleBox), 'no resize handle on a touch device');
  if (!handleBox) return;
  check(
    handleBox.height >= 20,
    `resize handle is only ${Math.round(handleBox.height)}px tall — not grabbable with a finger`,
  );
  const overlapsTabs = await page.evaluate(() => {
    const h = document.querySelector('.resize-handle')?.getBoundingClientRect();
    const tab = document.querySelector('.metrics-header .v-tab')?.getBoundingClientRect();
    return h && tab ? h.bottom > tab.top + 1 : null;
  });
  check(overlapsTabs === false, 'the resize handle sits over the tabs and would swallow their taps');

  const before = await bodyH();
  const centre = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
  await swipeUp(page, cdp, centre, 120);
  const grown = await bodyH();
  check(
    grown > before + 60,
    `dragging the handle up grew the panel by only ${grown - before}px (wanted ~120)`,
  );
  await shot('metrics-resized.png');

  const grownBox = await handle.boundingBox();
  await swipeUp(page, cdp, { x: grownBox.x + grownBox.width / 2, y: grownBox.y + grownBox.height / 2 }, -120);
  const shrunk = await bodyH();
  check(
    shrunk < grown - 60,
    `dragging the handle back down shrank the panel by only ${grown - shrunk}px`,
  );
}

/** 2. + 3. Side panel dismissal and the history dropdown. */
async function checkPanel(page, shot) {
  log('check', 'side panel: scrim dismissal and the history dropdown');
  await tap(page, page.locator('.panel-fab'));
  await page.waitForTimeout(500);
  check(
    Boolean(await page.locator('.v-navigation-drawer--active').count()),
    'panel FAB tap did not open the side panel',
  );
  await shot('panel-open.png');

  // Vuetify keeps a menu's content mounted after it closes, so "open" is the
  // active overlay, not the presence of list items.
  const menu = page.locator('.v-overlay--active .v-list-item');

  const field = page.locator('.side-drawer .v-select .v-field').first();
  await tap(page, field);
  await page.waitForTimeout(400);
  check(await menu.count(), 'tapping the history dropdown did not open its menu');
  await shot('history-menu.png');

  // Tapping beside the menu must dismiss it (click-outside needs mousedown + click).
  const outside = await page.evaluate(() => {
    const content = document.querySelector('.v-overlay--active .v-overlay__content');
    const drawer = document.querySelector('.side-drawer');
    if (!content || !drawer) return null;
    const c = content.getBoundingClientRect();
    const d = drawer.getBoundingClientRect();
    return { x: d.left + d.width / 2, y: Math.min(c.bottom + 80, d.bottom - 40) };
  });
  check(Boolean(outside), 'could not find a spot beside the open menu');
  if (outside) {
    await tapAt(page, outside.x, outside.y);
    await page.waitForTimeout(400);
    check(
      (await menu.count()) === 0,
      'tapping beside the open history menu did not close it',
    );
  }

  // Re-open and pick the entry: the selection path must work end to end.
  await tap(page, field);
  await page.waitForTimeout(400);
  if (await menu.count()) {
    await tap(page, menu.first());
    await page.waitForTimeout(400);
    check((await menu.count()) === 0, 'choosing a history entry did not close the menu');
  }

  // One tap is one activation: a stand-in that also fired the browser's own
  // events (or fired twice) would toggle a switch straight back.
  const ghost = page.locator('.side-drawer .v-switch input').first();
  const checked = () => ghost.evaluate((el) => el.checked);
  const wasChecked = await checked();
  await tap(page, ghost);
  await page.waitForTimeout(300);
  check(
    (await checked()) !== wasChecked,
    'tapping the keypoint-overlay switch did not toggle it exactly once',
  );
  await tap(page, ghost);
  await page.waitForTimeout(300);
  check((await checked()) === wasChecked, 'the keypoint-overlay switch did not toggle back');

  check(
    Boolean(await page.locator('.v-navigation-drawer__scrim').count()),
    'temporary drawer has no scrim to tap',
  );
  await tapBesideDrawer(page);
  await page.waitForTimeout(600);
  check(
    (await page.locator('.v-navigation-drawer--active').count()) === 0,
    'tapping the scrim beside the side panel did not close it',
  );
  await shot('panel-dismissed.png');
}

async function runPass(browser, { suppressMouse, label }) {
  log('pass', label);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });
  if (suppressMouse) await context.addInitScript(SUPPRESS_MOUSE_EVENTS);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  const shot = (name) => page.screenshot({ path: join(OUT_DIR, `${label}-${name}`) });

  try {
    await driveToPreview(page).catch(async (err) => {
      await shot('stuck.png');
      throw err;
    });
    await shot('preview.png');
    await checkMetricsScroll(page, cdp, shot);
    await checkResizeHandle(page, cdp, shot);
    await checkPanel(page, shot);
  } finally {
    const fatal = errors.filter((e) => !e.includes('favicon') && !e.includes('GroupMarkerNotSet'));
    if (fatal.length) {
      console.log('  console errors:');
      for (const e of fatal) console.log('   -', e.slice(0, 200));
    }
    await context.close();
  }
}

const browser = await chromium.launch({
  executablePath: findExecutable(),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  await runPass(browser, { suppressMouse: true, label: 'no-mouse-events' });
  await runPass(browser, { suppressMouse: false, label: 'native-mouse-events' });
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log(`\nall checks passed; screenshots in ${OUT_DIR}`);
