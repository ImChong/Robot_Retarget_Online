#!/usr/bin/env node
/**
 * Full compatibility matrix of Robot Description Gallery Online URDFs (issue #98).
 *
 * Reads the live gallery registry (`data/robots.json` + `data/visibility.md`),
 * lists every card and every upstream version (`src/lib/gallery/inventory.ts`),
 * and runs each one the picker offers — plus the humanoid / quadruped URDFs
 * the gallery hides — through `checkGalleryVersion` (`src/lib/gallery/compat.ts`):
 * download → MuJoCo compile → joints / bodies → ik_config → retarget a sample
 * clip (LAFAN1 walk for humanoids, dog walk for quadrupeds) → motion checks →
 * preview render → NPZ / CSV / JSON export. Everything else is listed as
 * unsupported with its reason; nothing is skipped silently.
 *
 * Each model runs in a fresh tab (its own MuJoCo heap) under a timeout, so one
 * hang or crash cannot take the rest down. Output in --out (default
 * $E2E_OUT or /tmp/gallery_matrix): report.json, report.md, previews/*.png,
 * logs/*.log. With --report-dir the JSON / Markdown report (no images) is also
 * written there — docs/gallery-compat/ holds the committed one.
 *
 * Needs the dev server (`npm run dev`; the harness imports the app's modules
 * from /src) and network access to imchong.github.io + cdn.jsdelivr.net
 * (honours HTTPS_PROXY).
 *
 * Usage:
 *   node scripts/gallery_matrix.mjs [--url http://localhost:3000]
 *        [--only g1,go2,g1@g1_23dof]     robot ids or row keys
 *        [--plans test,hidden]           which rows to run (default both)
 *        [--frames 600]                  humanoid clip length (dog walk runs whole)
 *        [--timeout 300]                 seconds per model
 *        [--concurrency 1]               parallel tabs (each MuJoCo heap can reach 2 GB)
 *        [--explore biped]               also evaluate visible URDFs of these unsupported
 *                                        categories with the humanoid clip (reported, not offered)
 *        [--report-dir docs/gallery-compat]
 *        [--merge docs/gallery-compat/report.json]   keep rows not re-run from a previous report
 *        [--coverage docs/gallery-compat/report.json] only diff the live inventory against a report;
 *                                                     exits 1 when rows are new / changed / missing
 */

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const BASE = arg('--url', 'http://localhost:3000').replace(/\/$/, '');
const OUT = resolve(arg('--out', process.env.E2E_OUT ?? '/tmp/gallery_matrix'));
const ONLY = arg('--only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PLANS = arg('--plans', 'test,hidden').split(',');
const FRAMES = Number(arg('--frames', '600'));
const TIMEOUT_S = Number(arg('--timeout', '300'));
const CONCURRENCY = Math.max(1, Number(arg('--concurrency', '1')));
const REPORT_DIR = arg('--report-dir', null);
const MERGE = arg('--merge', null);
const COVERAGE = arg('--coverage', null);
// Categories the picker does not offer, evaluated anyway with the humanoid clip
// (bipeds: legs only) so the report says whether offering them would work.
const EXPLORE = arg('--explore', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const SAMPLES = {
  humanoid: { file: 'walk.bvh', clip: 'LAFAN1 walk (sample_motions/walk.bvh)' },
  quadruped: { file: 'dog_walk.bvh', clip: 'Dog walk (sample_motions/dog_walk.bvh)' },
};
const STAGES = ['fetch', 'compile', 'parse', 'config', 'solve', 'validate', 'preview', 'export'];
const fileKey = (key) => key.replace(/[^A-Za-z0-9_.-]+/g, '_');

function chromePath() {
  for (const c of [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    '/opt/pw-browsers/chromium',
  ]) if (existsSync(c)) return c;
  return undefined; // playwright-core's own build
}

mkdirSync(join(OUT, 'previews'), { recursive: true });
mkdirSync(join(OUT, 'logs'), { recursive: true });

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
let browser = null;
let context = null;
/** (Re)launch Chromium; a model that takes the whole browser down must not end the run. */
async function ensureBrowser() {
  if (browser?.isConnected()) return;
  await browser?.close().catch(() => undefined);
  browser = await chromium.launch({
    executablePath: chromePath(),
    proxy,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  context = await browser.newContext({ viewport: { width: 800, height: 600 } });
}
let relaunching = null;
async function browserReady() {
  if (browser?.isConnected()) return;
  relaunching ??= ensureBrowser().finally(() => {
    relaunching = null;
  });
  await relaunching;
}
await ensureBrowser();
// A plain same-origin document to import the app modules into (no Vue app boot).
const HOST_PAGE = `${BASE}/robots/manifest.json`;

async function newHarnessPage() {
  await browserReady();
  const page = await context.newPage();
  await page.goto(HOST_PAGE);
  return page;
}

/** Registry, visibility, inventory and gallery provenance, read in the page. */
async function loadInventory() {
  const page = await newHarnessPage();
  try {
    return await page.evaluate(async () => {
      const site = 'https://imchong.github.io/Robot_Description_Gallery_Online/data/';
      const res = await fetch(`${site}robots.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`robots.json: HTTP ${res.status}`);
      const text = await res.text();
      const registry = JSON.parse(text);
      const visText = await (await fetch(`${site}visibility.md`, { cache: 'no-store' })).text();
      const { parseVisibility } = await import('/src/lib/gallery/registry.ts');
      const { buildInventory } = await import('/src/lib/gallery/inventory.ts');
      const rows = buildInventory(registry, parseVisibility(visText));
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      let galleryCommit = null;
      try {
        const head = await fetch('https://api.github.com/repos/ImChong/Robot_Description_Gallery_Online/commits/main', {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (head.ok) galleryCommit = (await head.json()).sha;
      } catch {
        /* provenance is best effort */
      }
      return {
        rows,
        gallery: {
          registryUrl: `${site}robots.json`,
          generated: registry.generated ?? null,
          generator: registry.generator ?? null,
          robots: registry.robots.length,
          sha256,
          commit: galleryCommit,
        },
      };
    });
  } finally {
    await page.close();
  }
}

/** Import every module the harness uses once, so Vite's dep optimizer settles before the run. */
async function warmUp() {
  const page = await newHarnessPage();
  try {
    await page.evaluate(async () => {
      await import('/src/lib/gallery/compat.ts');
      await import('/src/lib/gallery/compatPreview.ts');
      const { convertMeshForMujoco } = await import('/src/lib/gallery/meshConvert.ts');
      const dae =
        '<?xml version="1.0"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">' +
        '<asset><unit meter="1"/><up_axis>Z_UP</up_axis></asset><scene/></COLLADA>';
      await convertMeshForMujoco('warm.dae', new TextEncoder().encode(dae)).catch(() => undefined);
      const { getMujoco } = await import('/src/lib/mujoco/runtime.ts');
      await getMujoco();
    });
  } finally {
    await page.close();
  }
  await new Promise((r) => setTimeout(r, 3000));
}

const explored = (row) => row.plan === 'unsupported' && row.format === 'urdf' && row.visible && EXPLORE.includes(row.category);

async function runRow(input) {
  const row = { ...input, motion: input.motion ?? 'humanoid' };
  const logLines = [];
  const log = (s) => logLines.push(`[${new Date().toISOString()}] ${s}`);
  const page = await newHarnessPage();
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) log(`console.${msg.type()}: ${msg.text().slice(0, 2000)}`);
  });
  page.on('pageerror', (err) => log(`pageerror: ${String(err).slice(0, 2000)}`));
  page.on('crash', () => log('page crashed'));
  const t0 = Date.now();
  let report;
  try {
    const sample = SAMPLES[row.motion];
    const evaluation = page.evaluate(
      async ({ robotId, variantId, sample, kind, frames }) => {
        const site = 'https://imchong.github.io/Robot_Description_Gallery_Online/data/';
        const registry = await (await fetch(`${site}robots.json`)).json();
        const robot = registry.robots.find((r) => r.id === robotId);
        const { checkGalleryVersion, loadCompatMotion } = await import('/src/lib/gallery/compat.ts');
        const { renderCompatPreview } = await import('/src/lib/gallery/compatPreview.ts');
        const bvh = await (await fetch(`/sample_motions/${sample.file}`)).text();
        const motion = loadCompatMotion(bvh, sample.clip, kind, kind === 'humanoid' ? frames : Infinity);
        const logs = [];
        const report = await checkGalleryVersion(robot, variantId, motion, {
          renderPreview: (model, result, at) =>
            renderCompatPreview(model, result, at, { title: `${robotId}${variantId ? ' @ ' + variantId : ''}` }),
          log: (m) => logs.push(m),
        });
        return { report, logs };
      },
      { robotId: row.robotId, variantId: row.variantId, sample, kind: row.motion, frames: FRAMES },
    );
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_S} s`)), TIMEOUT_S * 1000),
    );
    const { report: r, logs } = await Promise.race([evaluation, timeout]);
    for (const l of logs) log(l);
    report = r;
  } catch (err) {
    const message = String(err?.message ?? err ?? 'unknown error').split('\n')[0] || 'unknown error';
    log(`harness error: ${message}`);
    report = {
      key: row.key,
      robotId: row.robotId,
      variantId: row.variantId,
      kind: row.motion,
      clip: SAMPLES[row.motion].clip,
      status: 'failed',
      failure: {
        stage: 'harness',
        category: /timed out/.test(message) ? 'timeout' : /closed|crash/i.test(message) ? 'browser-crash' : 'harness',
        message,
      },
      stages: {},
      checks: [],
      warnings: [],
    };
  } finally {
    await page.close().catch(() => undefined);
  }
  report.wallSeconds = Math.round((Date.now() - t0) / 100) / 10;
  const images = report.preview?.images ?? [];
  if (images.length) {
    const file = `previews/${fileKey(row.key)}.png`;
    writeFileSync(join(OUT, file), Buffer.from(images[0].split(',')[1], 'base64'));
    report.preview = { frames: report.preview.frames, file };
  }
  writeFileSync(join(OUT, 'logs', `${fileKey(row.key)}.log`), logLines.join('\n') + '\n');
  return report;
}

// ---------------- report ----------------

const mark = (s) => (!s ? '·' : s.skipped ? '–' : s.ok ? '✓' : '✗');
const short = (ref) => (ref ? ref.slice(0, 10) : '—');
const fmt = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function finalStatus(row, result) {
  if (row.plan === 'unsupported') return 'unsupported';
  if (!result) return 'not-run';
  return result.status;
}

function buildMarkdown(meta, rows, results) {
  const byKey = new Map(results.map((r) => [r.key, r]));
  const lines = [];
  const offered = rows.filter((r) => r.plan === 'test');
  const hidden = rows.filter((r) => r.plan === 'hidden');
  const unsupported = rows.filter((r) => r.plan === 'unsupported');
  const count = (list, status) => list.filter((r) => finalStatus(r, byKey.get(r.key)) === status).length;

  lines.push('# Gallery URDF compatibility matrix · Gallery URDF 兼容性矩阵', '');
  lines.push('Generated by `node scripts/gallery_matrix.mjs` (issue #98). Do not edit by hand.', '');
  lines.push('| | |', '|---|---|');
  lines.push(`| Run at | ${meta.runAt} |`);
  lines.push(`| Gallery registry | ${meta.gallery.registryUrl} (generated ${meta.gallery.generated}, ${meta.gallery.generator ?? ''}) |`);
  lines.push(`| Registry SHA-256 | \`${meta.gallery.sha256}\` |`);
  lines.push(`| Gallery repo commit | ${meta.gallery.commit ? `\`${meta.gallery.commit}\`` : 'unknown'} |`);
  lines.push(`| Retarget commit | ${meta.appCommit ? `\`${meta.appCommit}\`` : 'unknown'} |`);
  lines.push(`| Motion clips | humanoid: ${SAMPLES.humanoid.clip}, first ${meta.frames} frames; quadruped: ${SAMPLES.quadruped.clip}, all frames |`);
  lines.push('');
  lines.push('## Summary · 汇总', '');
  lines.push(`${meta.gallery.robots} gallery cards → ${rows.length} descriptions (every upstream version is a row).`, '');
  lines.push('| Rows | Count | passed | failed | unsupported | not run |', '|---|---|---|---|---|---|');
  lines.push(`| Offered in the picker | ${offered.length} | ${count(offered, 'passed')} | ${count(offered, 'failed')} | ${count(offered, 'unsupported')} | ${count(offered, 'not-run')} |`);
  lines.push(`| Hidden by the gallery (informational) | ${hidden.length} | ${count(hidden, 'passed')} | ${count(hidden, 'failed')} | ${count(hidden, 'unsupported')} | ${count(hidden, 'not-run')} |`);
  lines.push(`| Not offered (registered below) | ${unsupported.length} | — | — | ${unsupported.length} | — |`);
  lines.push('');

  const cats = [...new Set(rows.map((r) => r.category))];
  lines.push('| Category | Rows | Offered | passed | Hidden | Unsupported |', '|---|---|---|---|---|---|');
  for (const c of cats) {
    const rs = rows.filter((r) => r.category === c);
    const off = rs.filter((r) => r.plan === 'test');
    lines.push(`| ${c} | ${rs.length} | ${off.length} | ${count(off, 'passed')} | ${rs.filter((r) => r.plan === 'hidden').length} | ${rs.filter((r) => r.plan === 'unsupported').length} |`);
  }
  lines.push('');
  lines.push('Stages: fetch → compile → parse → config → solve → validate → preview → export ' +
    '(✓ ok, ✗ failed, – skipped). Metrics: tracking = p95 stage-2 position error; pen = p95 depth below the floor; ' +
    'float = p95 height of the lowest point; tilt = max root tilt. Checks and limits: `COMPAT_LIMITS` in `src/lib/gallery/compat.ts`.', '');

  const table = (list) => {
    lines.push('| Robot | Version | Cat. | Upstream | DoF | Config | ' + STAGES.join(' | ') + ' | Track cm | Pen cm | Float cm | Tilt° | Status | Notes |');
    lines.push('|' + '---|'.repeat(6 + STAGES.length + 6));
    for (const row of list) {
      const r = byKey.get(row.key);
      const s = r?.stages ?? {};
      const m = r?.metrics;
      const notes = r?.limitation
        ? `**${r.limitation.id}**: ${esc(r.limitation.reason)}`
        : r?.failure
        ? `**${r.failure.category}**: ${esc(r.failure.message).slice(0, 220)}`
        : (r?.warnings ?? []).length
          ? `${r.warnings.length} warning(s): ${esc(r.warnings[0]).slice(0, 140)}`
          : '';
      lines.push(
        `| ${esc(row.robotName)} (\`${row.robotId}\`) | ${row.variantId ? `\`${row.variantId}\`${row.deprecated ? ' (deprecated)' : ''}` : '—'} | ${row.category} | ${row.upstream.repo ?? '?'}@${short(row.upstream.ref)} | ${r?.model ? `${r.model.hinge + r.model.slide}/${row.dof}` : row.dof} | ${r?.config?.source ?? '—'} | ` +
          STAGES.map((st) => mark(s[st])).join(' | ') +
          ` | ${fmt(m?.trackingP95Cm)} | ${fmt(m?.penetrationP95Cm)} | ${fmt(m?.floatP95Cm)} | ${fmt(m?.tiltMaxDeg, 0)} | **${row.plan === 'unsupported' && r ? `unsupported (evaluated: ${r.status})` : finalStatus(row, r)}** | ${notes} |`,
      );
    }
    lines.push('');
  };

  lines.push('## Offered in the picker · Retarget 站点可选', '');
  table(offered);
  const gaps = offered.filter((r) => byKey.get(r.key)?.status === 'unsupported');
  if (gaps.length) {
    lines.push('### Offered but unsupported · 可选但不支持（能力缺口）', '');
    lines.push('The picker lists these, but the robot lacks what the motion family needs; they are registered, not passed.', '');
    lines.push('| Description | Gap | Reason | Follow-up |', '|---|---|---|---|');
    for (const row of gaps) {
      const l = byKey.get(row.key).limitation;
      lines.push(`| \`${row.key}\` | ${l.id} | ${esc(l.reason)} | ${esc(l.followUp)} |`);
    }
    lines.push('');
  }
  lines.push('## Hidden by the gallery · Gallery 隐藏（仅供参考）', '');
  lines.push('`data/visibility.md` hides these, so neither site offers them; they are run for information only.', '');
  table(hidden);

  lines.push('## Unsupported · 不支持（已登记）', '');
  const evaluated = unsupported.filter((r) => byKey.has(r.key));
  if (evaluated.length) {
    lines.push(
      `### Evaluated, not offered · 已评估（未开放）`,
      '',
      `${evaluated.length} unsupported descriptions were run anyway with the humanoid clip (\`--explore\`) to see whether ` +
        `the current mapping / solver could serve them: ${evaluated.filter((r) => byKey.get(r.key).status === 'passed').length} would pass. ` +
        'They stay **unsupported** until the picker offers them.',
      '',
    );
    table(evaluated);
  }
  lines.push('| Robot | Version | Category | Format | Visible | Upstream | Reason | Follow-up |', '|---|---|---|---|---|---|---|---|');
  for (const row of unsupported) {
    lines.push(
      `| ${esc(row.robotName)} (\`${row.robotId}\`) | ${row.variantId ? `\`${row.variantId}\`` : '—'} | ${row.category} | ${row.format} | ${row.visible ? 'yes' : 'no'} | ${row.upstream.repo ?? '?'}@${short(row.upstream.ref)} | ${esc(row.reason)} | ${esc(row.followUp)} |`,
    );
  }
  lines.push('');

  // Edge cases the URDFs exercise (issue #98's checklist), over every row that ran.
  const ran = [...offered, ...hidden].map((r) => byKey.get(r.key)).filter(Boolean);
  const withU = ran.filter((r) => r.urdf);
  const keys = (list) => (list.length ? list.map((r) => `\`${r.key}\``).slice(0, 8).join(', ') + (list.length > 8 ? `, … (${list.length})` : '') : '—');
  const edge = [
    ['`world` root link + floating joint (removed, robot base becomes the root)', withU.filter((r) => r.urdf.worldLink)],
    ['More than one root link besides `world`', withU.filter((r) => r.urdf.rootLinks.filter((l) => l !== 'world').length > 1)],
    ['Fixed joints (kept as bodies, `fusestatic="false"`)', withU.filter((r) => (r.urdf.joints.fixed ?? 0) > 0)],
    ['Continuous joints (wheels, or legs declared continuous)', withU.filter((r) => (r.urdf.joints.continuous ?? 0) > 0)],
    ['Prismatic joints', withU.filter((r) => (r.urdf.joints.prismatic ?? 0) > 0)],
    ['Mimic joints (solved as independent joints)', withU.filter((r) => r.urdf.mimicJoints > 0)],
    ['`package://` mesh references', withU.filter((r) => r.urdf.packageRefs > 0)],
    ['xacro leftovers in the URDF', withU.filter((r) => r.urdf.xacroLeftovers > 0)],
    ['Inertia tensors MuJoCo rejects (replaced)', withU.filter((r) => r.urdf.badInertias > 0)],
    ['Links without `<inertial>`', withU.filter((r) => r.urdf.linksWithoutInertial > 0)],
    ['Collision-only links (collision drawn as visual)', withU.filter((r) => r.urdf.collisionOnlyLinks > 0)],
    ['Upstream `<mujoco>` block (replaced)', withU.filter((r) => r.urdf.hasMujocoBlock)],
    ['Mesh files that failed to download (404 …), geometry dropped', ran.filter((r) => r.fetch?.meshFailed?.length)],
    ['Mesh references with no source (unknown package / skip_meshes)', ran.filter((r) => r.fetch?.meshDropped?.length)],
    ['Collada / ASCII-STL meshes re-encoded to binary STL', ran.filter((r) => r.fetch?.meshConverted > 0)],
    ['Meshes simplified to fit MuJoCo\'s 2 GB heap', ran.filter((r) => r.fetch?.meshDecimated > 0)],
    ['MuJoCo moving-joint count ≠ gallery DoF', ran.filter((r) => r.model && r.model.hinge + r.model.slide !== r.model.declaredDof)],
  ];
  lines.push('## Edge cases · 边界情况', '');
  lines.push(`Over the ${ran.length} descriptions that ran (offered + hidden):`, '');
  lines.push('| Edge case | Rows | Examples |', '|---|---|---|');
  for (const [label, list] of edge) lines.push(`| ${label} | ${list.length} | ${keys(list)} |`);
  lines.push('');

  const failed = [...offered, ...hidden].filter((r) => byKey.get(r.key)?.status === 'failed');
  lines.push('## Failures · 失败明细', '');
  if (!failed.length) lines.push('None.', '');
  for (const row of failed) {
    const r = byKey.get(row.key);
    lines.push(`### \`${row.key}\` — ${r.failure?.category ?? 'failed'}`, '');
    lines.push(`- Model: ${row.robotName}${row.variantName ? ` · ${row.variantName}` : ''} (${row.category}), \`${row.modelPath}\` @ ${row.upstream.repo}@${row.upstream.ref}`);
    lines.push(`- Stage: ${r.failure?.stage}; error: ${esc(r.failure?.message)}`);
    const failedChecks = (r.checks ?? []).filter((c) => !c.ok && c.severity === 'fail');
    for (const c of failedChecks) lines.push(`- Check \`${c.id}\`: ${c.value} (limit ${c.limit}) — ${esc(c.detail)}`);
    lines.push(`- Reproduce: \`node scripts/gallery_matrix.mjs --only ${row.key}\` (log: \`logs/${fileKey(row.key)}.log\`)`);
    lines.push('');
  }

  const warned = [...offered, ...hidden].filter((r) => (byKey.get(r.key)?.warnings ?? []).length);
  lines.push('## Warnings · 警告', '');
  if (!warned.length) lines.push('None.', '');
  for (const row of warned) {
    lines.push(`- \`${row.key}\`: ${byKey.get(row.key).warnings.map(esc).join('; ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

function appCommit() {
  try {
    const head = readFileSync('.git/HEAD', 'utf8').trim();
    if (!head.startsWith('ref:')) return head;
    const ref = head.slice(5).trim();
    if (existsSync(join('.git', ref))) return readFileSync(join('.git', ref), 'utf8').trim();
    const packed = readFileSync('.git/packed-refs', 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`));
    return packed?.split(' ')[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------- main ----------------

let exitCode = 0;
try {
  const { rows, gallery } = await loadInventory();
  console.log(`gallery: ${gallery.robots} cards → ${rows.length} descriptions (registry generated ${gallery.generated})`);

  if (COVERAGE) {
    const prev = JSON.parse(readFileSync(COVERAGE, 'utf8'));
    const page = await newHarnessPage();
    const gaps = await page.evaluate(
      async ({ rows, covered }) => {
        const { coverageGaps } = await import('/src/lib/gallery/inventory.ts');
        const g = coverageGaps(rows, covered);
        return { added: g.added.map((r) => `${r.key} (${r.category}, ${r.plan})`), changed: g.changed.map((r) => `${r.key} (${r.category}, ${r.plan})`), removed: g.removed };
      },
      { rows, covered: prev.rows },
    );
    await page.close();
    const total = gaps.added.length + gaps.changed.length + gaps.removed.length;
    console.log(`coverage vs ${COVERAGE} (registry ${prev.meta?.gallery?.generated}):`);
    for (const [k, list] of Object.entries(gaps)) for (const item of list) console.log(`  ${k}: ${item}`);
    console.log(total ? `${total} row(s) not covered by the report — re-run the matrix.` : 'report covers the live gallery.');
    writeFileSync(join(OUT, 'coverage.json'), JSON.stringify(gaps, null, 2));
    exitCode = total ? 1 : 0;
  } else {
    const selected = rows.filter(
      (r) =>
        (PLANS.includes(r.plan) || explored(r)) &&
        (!ONLY.length || ONLY.includes(r.key) || ONLY.includes(r.robotId)),
    );
    console.log(`running ${selected.length} row(s), ${CONCURRENCY} at a time`);
    if (selected.length) await warmUp();

    const previous = MERGE && existsSync(MERGE) ? JSON.parse(readFileSync(MERGE, 'utf8')).results ?? [] : [];
    const results = new Map(previous.map((r) => [r.key, r]));
    const queue = [...selected];
    let done = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let row = queue.shift(); row; row = queue.shift()) {
          const report = await runRow(row);
          results.set(row.key, report);
          done++;
          const m = report.metrics;
          console.log(
            `[${done}/${selected.length}] ${{ passed: 'PASS', failed: 'FAIL', unsupported: 'UNSUPPORTED' }[report.status] ?? 'FAIL'} ${row.key} (${report.wallSeconds}s)` +
              (report.limitation ? ` — ${report.limitation.id}` : '') +
              (report.failure ? ` — ${report.failure.category}: ${String(report.failure.message ?? '').slice(0, 160)}` : '') +
              (m ? ` [track ${fmt(m.trackingP95Cm)} cm, pen ${fmt(m.penetrationP95Cm)} cm, float ${fmt(m.floatP95Cm)} cm, tilt ${fmt(m.tiltMaxDeg, 0)}°]` : ''),
          );
        }
      }),
    );

    const live = new Set(rows.map((r) => r.key));
    const allResults = [...results.values()].filter((r) => live.has(r.key));
    // Re-rendering a previous run (--merge with nothing selected) keeps its run time and app commit.
    const previousMeta = MERGE && existsSync(MERGE) ? JSON.parse(readFileSync(MERGE, 'utf8')).meta : null;
    const meta =
      !selected.length && previousMeta
        ? { ...previousMeta, gallery }
        : { runAt: new Date().toISOString(), gallery, appCommit: appCommit(), frames: FRAMES };
    const json = { meta, rows, results: allResults };
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(json, null, 2));
    const md = buildMarkdown(meta, rows, allResults);
    writeFileSync(join(OUT, 'report.md'), md);
    if (REPORT_DIR) {
      // The committed copy: compact, without the per-check prose (it is in README.md).
      const slim = {
        ...json,
        results: allResults.map((r) => ({ ...r, checks: (r.checks ?? []).map(({ detail: _d, ...c }) => c) })),
      };
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(join(REPORT_DIR, 'report.json'), JSON.stringify(slim) + '\n');
      writeFileSync(join(REPORT_DIR, 'README.md'), md);
    }
    const offeredFailed = rows.filter((r) => r.plan === 'test' && results.get(r.key)?.status === 'failed');
    const offeredMissing = rows.filter((r) => r.plan === 'test' && PLANS.includes('test') && !ONLY.length && !results.has(r.key));
    console.log(
      `\noffered: ${rows.filter((r) => r.plan === 'test').length}, failed: ${offeredFailed.length}, not run: ${offeredMissing.length} — output in ${OUT}`,
    );
    exitCode = offeredFailed.length || offeredMissing.length ? 1 : 0;
  }
} finally {
  await browser?.close().catch(() => undefined);
  process.exitCode = exitCode;
}
