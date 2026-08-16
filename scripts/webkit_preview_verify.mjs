#!/usr/bin/env node
/**
 * WebKit + iPhone verification for the Retarget Preview touch/button behaviour.
 *
 * Drives the whole workflow (load sample -> retarget -> preview) on an emulated
 * iPhone, then checks the two things that actually made controls unusable on
 * iOS Safari:
 *
 *   1. every control resolves to `touch-action: manipulation`, so Safari does
 *      not hold the click back waiting for a double-tap-to-zoom, and
 *   2. every control has at least a 44x44pt *effective* hit area — probed with
 *      elementFromPoint, so padding from pseudo-elements counts and area stolen
 *      by a neighbouring control does not.
 *
 * Finally it taps the controls during active playback and asserts each one
 * actually did something.
 *
 * Usage: node scripts/webkit_preview_verify.mjs [--url http://localhost:3000]
 * Requires the dev or preview server to be running, and Playwright's WebKit
 * build (`npx playwright-core install webkit`).
 */

import { webkit, devices } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:3000';
const OUT_DIR = process.env.WEBKIT_VERIFY_OUT ?? '/tmp/webkit-verify';
const MIN_TAP_TARGET = 44;
const iphone = devices['iPhone 13'];

mkdirSync(OUT_DIR, { recursive: true });

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

const shot = (page, name) => page.screenshot({ path: join(OUT_DIR, name) });

/** Waits for a Vuetify button carrying `text` to exist and be enabled. */
function waitForEnabled(page, scope, text, timeout = 60000) {
  return page.waitForFunction(
    ([sel, label]) =>
      [...document.querySelectorAll(`${sel} button`)].some(
        (el) => el.textContent?.includes(label) && !el.disabled,
      ),
    [scope, text],
    { timeout },
  );
}

async function driveToPreview(page) {
  log('step', 'open BVH viewer and load the Walk sample');
  await page.goto(`${BASE_URL}/#/bvh`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.locator('.panel-fab').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.panel-fab').click();
  // Wait for the drawer to finish sliding in rather than a fixed timeout: the
  // old fixed wait raced the transition and left taps landing on the scrim.
  await page.waitForFunction(
    () => {
      const d = document.querySelector('.side-drawer');
      return Boolean(d) && d.getBoundingClientRect().left >= 0;
    },
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(400);

  await page.locator('.side-drawer').getByRole('button', { name: /加载示例动作/ }).click();
  const walk = page.locator('.sample-menu-panel .v-list-item', { hasText: 'Walk' }).first();
  await walk.waitFor({ timeout: 15000 });
  await walk.click();
  await waitForEnabled(page, '.workflow-nav', '下一步');
  await shot(page, '01-bvh-loaded.png');

  await page.locator('.v-navigation-drawer__scrim').click({ position: { x: 360, y: 400 }, force: true });
  await page.waitForFunction(() => !document.querySelector('.v-navigation-drawer--active'), null, {
    timeout: 15000,
  });
  await page.waitForTimeout(400);

  log('step', 'go to config and run the retarget');
  await page.locator('.workflow-nav').getByRole('button', { name: /下一步/ }).click();
  await waitForEnabled(page, '.workflow-nav', '开始重定向', 300000);
  await shot(page, '02-config.png');
  await page.locator('.workflow-nav').getByRole('button', { name: /开始重定向/ }).click();
  await page.waitForFunction(
    () => document.querySelector('.workflow-nav')?.textContent?.includes('取消'),
    null,
    { timeout: 60000 },
  );
  await page.waitForFunction(
    () => !document.querySelector('.workflow-nav')?.textContent?.includes('取消'),
    null,
    { timeout: 600000 },
  );
  await page.waitForFunction(() => Boolean(document.querySelector('.playback-bar')), null, {
    timeout: 60000,
  });
  await page.waitForTimeout(2500);
  await shot(page, '03-preview.png');
}

/** Audit hit area + resolved touch-action for every control on the page. */
function auditControls(page) {
  return page.evaluate((min) => {
    const groups = [
      ['header', '.site-header button, .site-header a'],
      ['workflow-nav', '.workflow-nav button'],
      ['panel-fab', '.panel-fab'],
      ['metrics', '.metrics-header .v-tab, .metrics-header button'],
      ['playback', '.playback-bar button, .playback-bar .v-btn'],
      ['bottom-nav', '.bottom-nav .v-btn'],
    ];

    // touch-action resolves as the intersection from the element to the root.
    const rank = { auto: 0, manipulation: 1, 'pan-x': 2, 'pan-y': 2, none: 3 };
    const effectiveTouchAction = (el) => {
      let node = el;
      let strictest = 'auto';
      while (node && node.nodeType === 1) {
        const ta = getComputedStyle(node).touchAction;
        if ((rank[ta] ?? 0) > (rank[strictest] ?? 0)) strictest = ta;
        node = node.parentElement;
      }
      return strictest;
    };

    // Grow out from the centre while elementFromPoint still lands inside el, so
    // pseudo-element padding counts and a neighbour's overlay does not.
    const hitExtent = (el) => {
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const owns = (x, y) => {
        const t = document.elementFromPoint(x, y);
        return Boolean(t && (el.contains(t) || t === el));
      };
      const reach = (dx, dy) => {
        let d = 0;
        while (d < 80 && owns(cx + dx * (d + 1), cy + dy * (d + 1))) d++;
        return d;
      };
      return {
        w: reach(-1, 0) + reach(1, 0) + 1,
        h: reach(0, -1) + reach(0, 1) + 1,
        centreOwned: owns(cx, cy),
      };
    };

    const rows = [];
    for (const [group, sel] of groups) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const ext = hitExtent(el);
        rows.push({
          group,
          label: (el.textContent || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 18),
          hitW: ext.w,
          hitH: ext.h,
          touchAction: effectiveTouchAction(el),
          ok: ext.w >= min && ext.h >= min && ext.centreOwned,
        });
      }
    }
    return rows;
  }, MIN_TAP_TARGET);
}

const readFrame = (page) =>
  page.evaluate(() => {
    const label = document.querySelector('.frame-label')?.textContent ?? '';
    const match = label.match(/(\d+)\s*\/\s*(\d+)/);
    return match ? Number(match[1]) : -1;
  });

/** Real touchscreen tap at the control's centre, i.e. what a finger would do. */
async function tapCentre(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('control has no box to tap');
  await page.touchscreen.tap(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
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

  try {
    await driveToPreview(page);

    log('step', 'audit tap targets and touch-action');
    const rows = await auditControls(page);
    console.log('  group          label                HIT AREA   touch-action');
    for (const r of rows) {
      console.log(
        `  ${r.group.padEnd(14)} ${r.label.padEnd(20)} ${`${r.hitW}x${r.hitH}`.padEnd(10)} ${r.touchAction}`,
      );
    }
    for (const r of rows) {
      check(
        r.ok,
        `${r.group} "${r.label}" hit area ${r.hitW}x${r.hitH} is under ${MIN_TAP_TARGET}x${MIN_TAP_TARGET}pt`,
      );
      check(
        r.touchAction !== 'auto',
        `${r.group} "${r.label}" still has double-tap-zoom armed (touch-action: auto)`,
      );
    }

    log('step', 'tap fallback stays dormant where click works');
    await page.evaluate(() => {
      window.__clickLog = [];
      document.addEventListener(
        'click',
        (e) => window.__clickLog.push(e.isTrusted),
        { capture: true },
      );
    });
    // The already-selected metrics tab: re-selecting it changes no state, so
    // this counts clicks without disturbing the playback checks below.
    await tapCentre(page, page.locator('.metrics-header .v-tab').first());
    await page.waitForTimeout(700);
    const clickLog = await page.evaluate(() => window.__clickLog);
    check(
      clickLog.length === 1 && clickLog[0] === true,
      `one tap produced ${clickLog.length} click(s) (${clickLog.join(',')}); the tap fallback must not double-fire where the browser dispatches click itself`,
    );

    log('step', 'tap controls during active playback');
    const before = await readFrame(page);
    await page.waitForTimeout(1000);
    check((await readFrame(page)) > before, 'preview did not autoplay');

    const playBtn = page.locator('.playback-bar .v-btn').nth(1);
    await tapCentre(page, playBtn);
    await page.waitForTimeout(700);
    const paused = await readFrame(page);
    await page.waitForTimeout(700);
    check((await readFrame(page)) === paused, 'pause tap did not stop playback');

    await tapCentre(page, playBtn);
    await page.waitForTimeout(1200);
    check((await readFrame(page)) > paused, 'play tap did not resume playback');
    await shot(page, '04-playback.png');

    const metricsToggle = page.locator('.metrics-header .v-btn').last();
    const bodyVisible = () => page.locator('.metrics-body').isVisible();
    await tapCentre(page, metricsToggle);
    await page.waitForTimeout(700);
    check(!(await bodyVisible()), 'metrics collapse tap did nothing');
    await shot(page, '05-metrics-collapsed.png');
    await tapCentre(page, metricsToggle);
    await page.waitForTimeout(700);
    check(await bodyVisible(), 'metrics expand tap did nothing');

    await tapCentre(page, page.locator('.panel-fab'));
    await page.waitForTimeout(800);
    check(
      await page.locator('.v-navigation-drawer--active').count(),
      'panel FAB tap did not open the side panel',
    );
    await shot(page, '06-panel-open.png');
    await page.locator('.v-navigation-drawer__scrim').click({ position: { x: 360, y: 400 }, force: true });
    // The scrim outlives the drawer by a fade; tapping through it lands on the
    // scrim instead of the control underneath.
    await page.waitForFunction(() => !document.querySelector('.v-navigation-drawer__scrim'), null, {
      timeout: 15000,
    });
    await page.waitForTimeout(400);

    await tapCentre(page, page.locator('.workflow-nav').getByRole('button', { name: /返回重定向设置/ }));
    await page.waitForTimeout(1200);
    check(page.url().includes('/config'), 'workflow nav tap did not navigate to config');
    await shot(page, '07-nav-config.png');

    await tapCentre(page, page.locator('.bottom-nav').getByRole('button', { name: /重定向预览/ }));
    await page.waitForTimeout(1200);
    check(page.url().includes('/preview'), 'bottom nav tap did not navigate back to preview');

    await tapCentre(page, page.locator('.site-header .lang-toggle'));
    await page.waitForTimeout(600);
    check(
      Boolean(await page.locator('.bottom-nav', { hasText: 'Preview' }).count()),
      'header language toggle tap did nothing',
    );
    await shot(page, '08-header-toggle.png');

    const fatal = errors.filter((e) => !e.includes('favicon'));
    if (fatal.length) {
      console.log('console errors:');
      for (const e of fatal) console.log('  -', e.slice(0, 300));
    }

    if (failures.length) {
      console.log(`\n${failures.length} check(s) failed.`);
      process.exitCode = 1;
    } else {
      log('pass', `all ${rows.length} controls meet ${MIN_TAP_TARGET}pt and respond to taps`);
    }
  } finally {
    const video = page.video();
    await page.close();
    if (video) {
      const videoPath = join(OUT_DIR, 'webkit-preview-verify.webm');
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
