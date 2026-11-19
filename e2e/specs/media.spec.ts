/**
 * Uploaded images: picture plays (upload, reorder, caption, full-screen viewer, visibility),
 * photo-only drills, and reopening a viewed picture offline. Axe in light and dark.
 * Set MEDIA_SHOTS=<dir> to also save screenshots for review.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect, openTeam, uuid, type TeamFixture } from '../fixtures';

const asset = (n: number) => fileURLToPath(new URL(`../assets/page-${n}.png`, import.meta.url));
const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? 8787}`;

async function shot(page: Page, name: string) {
  const dir = process.env.MEDIA_SHOTS;
  if (!dir) return;
  await page.waitForTimeout(300);
  const project = test.info().project.name;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir}/${name}-${project}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: null });
}

/** A picture play made through the API (multipart upload), for tests that start from one. */
async function apiPicturePlay(team: TeamFixture, visibility: 'team' | 'coaches', title: string) {
  const id = uuid();
  await team.post(`/teams/${team.teamId}/plays`, {
    id,
    title,
    category: 'other',
    tags: [],
    format: 'any',
    visibility,
    description: null,
    kind: 'picture',
    data: {
      v: 1,
      id,
      mode: 'play',
      title,
      format: 'any',
      view: 'full',
      entities: [],
      frames: [{ id: 'f0', durationMs: 0, pos: {}, moves: {} }],
    },
  });
  const mediaId = uuid();
  const r = await team.owner.api.post(`${ORIGIN}/api/v1/teams/${team.teamId}/plays/${id}/media`, {
    headers: { origin: ORIGIN },
    multipart: {
      id: mediaId,
      caption: 'Kick-off chase',
      file: { name: 'p.png', mimeType: 'image/png', buffer: readFileSync(asset(1)) },
    },
  });
  expect(r.status()).toBe(201);
  return { id, mediaId };
}

test.describe('picture plays', () => {
  test.use({ serviceWorkers: 'block' });

  test('a coach uploads two pages, reorders and captions them; a player pages through full screen', async ({
    page,
    team,
    axe,
  }) => {
    await openTeam(page, team.teamId, '/playbook');
    await page.getByRole('button', { name: 'Upload a play' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Upload a play' });
    await expect(sheet).toBeVisible();
    await sheet.locator('input[type="file"]').setInputFiles([asset(1), asset(2)]);
    const pages = sheet.getByRole('list', { name: 'Pages' }).getByRole('listitem');
    await expect(pages).toHaveCount(2);
    // Both prepared in the browser (size shown once re-encoded).
    await expect(sheet.getByText(/800×500 · \d+ KB/)).toHaveCount(2, { timeout: 15_000 });
    await sheet.getByRole('button', { name: 'Move page 2 up' }).click();
    await sheet.getByLabel('Caption for page 1').fill('Exit call');
    await sheet.getByLabel('Name', { exact: true }).fill('Whiteboard exit');
    await sheet.getByLabel('Category').selectOption('exit');
    await sheet.getByLabel('Who can see it').selectOption('team');
    await shot(page, 'upload-sheet');
    await axe(page);
    await sheet.getByRole('button', { name: 'Save play' }).click();
    await expect(page).toHaveURL(/\/plays\/[^/]+$/, { timeout: 20_000 });
    const playId = page.url().split('/').pop()!.split('?')[0]!;
    await expect(page.getByRole('heading', { name: 'Whiteboard exit' })).toBeVisible();
    await expect(page.getByText(/2 pages/).first()).toBeVisible();

    // Saved as uploaded: reordered, captioned, metadata stripped server side, shared with the team.
    await expect
      .poll(async () => {
        const p = (await team.post(`/teams/${team.teamId}/plays/${playId}`, undefined, 'GET')).play;
        return [p.kind, p.visibility, p.media.length, p.media[0]?.caption];
      })
      .toEqual(['picture', 'team', 2, 'Exit call']);

    // The playbook shows it with a thumbnail and a Picture marker; no designer for picture plays.
    await page.goto('/playbook');
    const card = page.getByRole('link', { name: /Whiteboard exit/ });
    await expect(card.getByText('Picture')).toBeVisible();
    await expect(card.getByText(/2 pages/)).toBeVisible();
    await expect(card.locator('img')).toHaveJSProperty('complete', true);
    await shot(page, 'playbook-list');
    await page.goto(`/plays/${playId}`);
    await expect(page.getByRole('button', { name: 'Edit pages' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Duplicate' })).toHaveCount(0);

    // A player views it full screen and pages through with the keyboard.
    const jess = await team.join('player', 'Jess Player');
    await openTeam(jess.page, team.teamId, `/plays/${playId}`);
    const p = jess.page;
    await expect(p.getByRole('heading', { name: 'Whiteboard exit' })).toBeVisible();
    await expect(p.getByRole('button', { name: /Exit call.*Open full screen/ })).toBeVisible();
    await axe(p);
    await p.emulateMedia({ colorScheme: 'dark' });
    await axe(p);
    await p.emulateMedia({ colorScheme: 'light' });
    await p.getByRole('button', { name: 'Full screen', exact: true }).click();
    const viewer = p.getByRole('dialog', { name: 'Whiteboard exit: pictures' });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText('Page 1 of 2 · Exit call')).toBeVisible();
    await expect(viewer.getByRole('img', { name: /Exit call/ })).toHaveJSProperty('complete', true);
    await shot(p, 'viewer');
    await axe(p);
    await p.keyboard.press('ArrowRight');
    await expect(viewer.getByText('Page 2 of 2')).toBeVisible();
    await p.keyboard.press('+');
    await expect(viewer.getByRole('button', { name: 'Reset zoom' })).toBeEnabled();
    await p.keyboard.press('0');
    await expect(viewer.getByRole('button', { name: 'Reset zoom' })).toBeDisabled();
    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    await expect(viewer.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    // Zoomed in, arrows move around the picture; PageUp/PageDown still turn pages.
    await p.keyboard.press('ArrowLeft');
    await expect(viewer.getByText('Page 2 of 2')).toBeVisible();
    await p.keyboard.press('PageUp');
    await expect(viewer.getByText('Page 1 of 2 · Exit call')).toBeVisible();
    await p.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    // Players can't upload or edit.
    await expect(p.getByRole('button', { name: 'Edit pages' })).toHaveCount(0);

    // Seen-by counts the player's view.
    await expect
      .poll(async () =>
        (await team.post(`/teams/${team.teamId}/plays/${playId}/seen`, undefined, 'GET')).seen.some(
          (x: { memberId: string }) => x.memberId === jess.memberId,
        ),
      )
      .toBe(true);
  });

  test('a coaches-only picture play is hidden from players', async ({ team }) => {
    const { id, mediaId } = await apiPicturePlay(team, 'coaches', 'Secret chase');
    const jess = await team.join('player', 'Jess Player');
    await openTeam(jess.page, team.teamId, '/playbook');
    await expect(jess.page.getByRole('heading', { name: 'Playbook' })).toBeVisible();
    await expect(jess.page.getByText('Secret chase')).toHaveCount(0);
    const img = await jess.api.get(`${ORIGIN}/api/v1/teams/${team.teamId}/media/${mediaId}?v=1`);
    expect(img.status()).toBe(404);
    await jess.page.goto(`/plays/${id}`);
    await expect(jess.page.getByText('Play not found')).toBeVisible();
    // The coach sees it, with the image served as a nosniff PNG.
    const own = await team.owner.api.get(`${ORIGIN}/api/v1/teams/${team.teamId}/media/${mediaId}`);
    expect(own.status()).toBe(200);
    expect(own.headers()['content-type']).toBe('image/png');
    expect(own.headers()['x-content-type-options']).toBe('nosniff');
  });
});

test('a photo-only drill is created with a photo and viewed', async ({ page, team, axe }) => {
  await openTeam(page, team.teamId, '/playbook?tab=drills');
  await page.getByRole('button', { name: 'New drill' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'New drill' });
  await sheet.getByLabel('Name').fill('Ruck lanes (whiteboard)');
  await sheet.getByLabel('Photos only').check();
  await sheet.getByRole('button', { name: 'Create and add photos' }).click();
  await expect(page).toHaveURL(/\/drills\/[^/?]+/);
  const photos = page.getByRole('dialog', { name: 'Drill photos' });
  await expect(photos).toBeVisible();
  await photos.locator('input[type="file"]').setInputFiles([asset(2)]);
  await expect(photos.getByText(/800×500 · \d+ KB/)).toBeVisible({ timeout: 15_000 });
  await photos.getByLabel('Caption for photo 1').fill('Cone layout');
  await axe(page);
  await photos.getByRole('button', { name: 'Save photos' }).click();
  await expect(photos).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Ruck lanes (whiteboard)' })).toBeVisible();
  const shotBtn = page.getByRole('button', { name: /Cone layout.*Open full screen/ });
  await expect(shotBtn).toBeVisible();
  await expect(shotBtn.locator('img')).toHaveJSProperty('complete', true);
  await expect(page.getByText('No diagram yet')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Drill card' })).toBeVisible();
  await shot(page, 'photo-drill');
  await axe(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await axe(page);
  await page.emulateMedia({ colorScheme: 'light' });
  // The drill card shows a Photo marker in the library.
  await page.goto('/playbook?tab=drills');
  await expect(
    page.getByRole('link', { name: /Ruck lanes \(whiteboard\)/ }).getByText('Photo'),
  ).toBeVisible();
});

test('a viewed picture play reopens offline', async ({ page, context, team }, info) => {
  const { id } = await apiPicturePlay(team, 'team', 'Field day exit');
  await openTeam(page, team.teamId, '/playbook');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(async () => {
    if (!navigator.serviceWorker.controller)
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }),
      );
  });
  // Open it from the playbook (as at the field), so this tab has both screens loaded.
  await page.getByRole('link', { name: /Field day exit/ }).click();
  await expect(page).toHaveURL(new RegExp(`/plays/${id}`));
  const img = page.getByRole('button', { name: /Kick-off chase.*Open full screen/ }).locator('img');
  await expect(img).toHaveJSProperty('complete', true);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(800);
  // Opened once online: the service worker kept the image.
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.open('pp-media')).keys()).length))
    .toBeGreaterThan(0);
  // Playwright's WebKit offline mode fails requests before the service worker can answer them
  // (the same limitation as smoke.spec.ts), so the offline half runs on Chromium; WebKit checks
  // above that the worker stored the image.
  if (info.project.name.includes('webkit')) return;
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Playbook' }).first().click();
  await expect(page.getByRole('link', { name: /Field day exit/ })).toBeVisible();
  await page.getByRole('link', { name: /Field day exit/ }).click();
  const again = page
    .getByRole('button', { name: /Kick-off chase.*Open full screen/ })
    .locator('img');
  await expect
    .poll(() => again.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth))
    .toBe(800);
  // Uploading needs a connection, and says so.
  await page.getByRole('link', { name: 'Playbook' }).first().click();
  await page.getByRole('button', { name: 'Upload a play' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Upload a play' });
  await expect(sheet.getByText(/You're offline/)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Save play' })).toBeDisabled();
  await page.keyboard.press('Escape');
  // Cold start offline too.
  await page.goto(`/plays/${id}`);
  const cold = page
    .getByRole('button', { name: /Kick-off chase.*Open full screen/ })
    .locator('img');
  await expect
    .poll(() => cold.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth))
    .toBe(800);
  await context.setOffline(false);
});
