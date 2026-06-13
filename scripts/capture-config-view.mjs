import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = '/opt/cursor/artifacts/screenshots';
const BVH = join(ROOT, 'public/sample_motions/walk.bvh');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto(`${BASE}/bvh`, { waitUntil: 'networkidle' });

const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.getByRole('button', { name: /打开|open bvh/i }).first().click(),
]);
await chooser.setFiles(BVH);
await page.waitForSelector('text=walk.bvh', { timeout: 20000 });

await page.goto(`${BASE}/config`, { waitUntil: 'networkidle' });
await page.waitForFunction(
  () => {
    const canvas = document.querySelector('.viewport canvas');
    return canvas && canvas.width > 0;
  },
  { timeout: 20000 },
);
await page.waitForTimeout(12000);

await page.locator('.viewport').first().screenshot({ path: join(OUT, 'config-alignment-verify.png') });
await page.screenshot({ path: join(OUT, 'config-alignment-full.png') });

await browser.close();
console.log('Saved screenshots to', OUT);
