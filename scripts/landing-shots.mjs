#!/usr/bin/env node
/**
 * Regenerate the landing page screenshots from the demo team (light and dark, phone and desktop).
 *
 *   pnpm build
 *   E2E_PORT=8795 pnpm --filter @phaseplay/api e2e:serve     # in another terminal
 *   node scripts/landing-shots.mjs [http://localhost:8795]
 *
 * Writes WebP files to apps/web/static/landing/. The demo banner and toasts are hidden, and each
 * image is encoded in the browser (no image tooling needed). Re-run after UI or demo-data changes.
 */
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:8795';
const TEAM = 'a0000000-0000-7000-8000-000000000001';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps/web/static/landing');
mkdirSync(OUT, { recursive: true });

const HIDE = `aside.demo, .toasts { display: none !important; }`;
const PHONE = { ...devices['iPhone 15'], deviceScaleFactor: 2 };
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

/** Encode a PNG buffer to WebP (optionally resized to `width`) inside the page. */
async function webp(page, png, width, quality = 0.82) {
  const b64 = await page.evaluate(
    async ({ data, width, quality }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const k = width ? width / img.naturalWidth : 1;
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', quality));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000)
        s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { data: png.toString('base64'), width, quality },
  );
  return Buffer.from(b64, 'base64');
}

async function save(page, name, png, width) {
  const out = await webp(page, png, width);
  writeFileSync(join(OUT, `${name}.webp`), out);
  console.log(`${name}.webp ${(out.length / 1024).toFixed(0)} KB`);
}

async function open(page, path) {
  await page.goto(BASE + path);
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const sfx = scheme === 'dark' ? '-dark' : '';
  for (const [kind, opts] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ]) {
    const ctx = await browser.newContext({ ...opts, colorScheme: scheme, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/demo`);
    await page.waitForURL(/\/home/, { timeout: 20_000 });
    const sync = await (await page.request.get(`${BASE}/api/v1/teams/${TEAM}/sync?since=0`)).json();
    const now = Date.now();
    const events = sync.events.filter((e) => !e.deletedAt).sort((a, z) => a.startsAt - z.startsAt);
    const nextGame = events.find((e) => e.type === 'match' && e.startsAt > now);
    const lastGame = [...events].reverse().find((e) => e.type === 'match' && e.startsAt < now);
    const plan = sync.plans.find((p) => p.data.lanes.length > 1) ?? sync.plans[0];
    const play = sync.plays.find((p) => /lineout/i.test(p.title)) ?? sync.plays[0];
    const bibs = (sync.items ?? []).find((i) => i.name === 'Red bibs');
    const shot = () => page.screenshot();

    if (kind === 'phone') {
      await open(page, '/home');
      await save(page, `phone-home${sfx}`, await shot(), 640);
      // A smaller hero for phones (it's the landing page's largest paint).
      await save(page, `phone-home${sfx}-480`, await shot(), 480);
      await open(page, `/events/${lastGame.id}/match`);
      await save(page, `phone-match${sfx}`, await shot(), 640);
      await open(page, `/events/${lastGame.id}/match/summary`);
      await save(page, `phone-summary${sfx}`, await shot(), 640);
      await open(page, `/plays/${play.id}`);
      await save(page, `phone-play${sfx}`, await shot(), 640);
      // Kit: the red bibs, with a handover waiting for an answer.
      if (bibs) {
        await open(page, `/kit/${bibs.id}`);
        await save(page, `phone-kit${sfx}`, await shot(), 640);
      }
      // A live split session: start it and move on to the first forwards/backs block.
      await open(page, `/practice/${plan.id}/run`);
      await page.getByRole('button', { name: 'Start session' }).click();
      for (let i = 0; i < 8 && !(await page.locator('.lanes.split').count()); i++) {
        await page.getByRole('button', { name: /^Next/ }).click();
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(600);
      // Bring both groups into view under the clock.
      await page.locator('.lanes.split').evaluate((el) => {
        const r = el.getBoundingClientRect();
        window.scrollBy(0, Math.max(0, r.bottom - window.innerHeight + 24));
      });
      await page.waitForTimeout(300);
      await save(page, `phone-live${sfx}`, await shot(), 640);
    } else {
      await open(page, `/events/${nextGame.id}`);
      await save(page, `desktop-availability${sfx}`, await shot());
      await open(page, `/events/${nextGame.id}/sheet`);
      await save(page, `desktop-sheet${sfx}`, await shot());
      await open(page, `/practice/${plan.id}`);
      await save(page, `desktop-practice${sfx}`, await shot());
      await open(page, `/plays/${play.id}/edit`);
      await save(page, `desktop-play${sfx}`, await shot());
      await open(page, '/kit');
      await save(page, `desktop-kit${sfx}`, await shot());
      if (!sfx) {
        // The exported team sheet image (same for both themes: it uses team colours).
        await open(page, `/events/${nextGame.id}/sheet`);
        await page.getByRole('button', { name: 'Export image' }).click();
        const img = page.getByRole('dialog', { name: 'Export team sheet' }).locator('img');
        await img.waitFor();
        await page.waitForFunction(
          () => document.querySelector('dialog[open] img')?.complete,
          undefined,
          { timeout: 20_000 },
        );
        // Copy the rendered preview through a canvas (its blob URL is short-lived).
        const b64 = await img.evaluate((el) => {
          const c = document.createElement('canvas');
          c.width = el.naturalWidth;
          c.height = el.naturalHeight;
          c.getContext('2d').drawImage(el, 0, 0);
          return c.toDataURL('image/png').split(',')[1];
        });
        await save(page, 'sheet-story', Buffer.from(b64, 'base64'), 540);
      }
    }
    await ctx.close();
  }
}
await browser.close();
