import { test, expect, openTeam, uuid } from '../fixtures';

test.use({ serviceWorkers: 'block' });

test('an admin makes a Captain role and the captain sees coach-only practice plans', async ({
  team,
  axe,
}) => {
  const admin = await team.join('admin', 'Admin Ada');
  const cap = await team.join('player', 'Cap Carter');
  const planId = uuid();
  await team.post(`/teams/${team.teamId}/plans`, {
    id: planId,
    title: 'Captains preview',
    visibility: 'coaches',
    data: { lanes: ['all'], slots: [] },
  });

  await openTeam(cap.page, team.teamId, '/practice');
  await expect(cap.page.getByRole('heading', { name: 'Practice', level: 1 })).toBeVisible();
  await expect(cap.page.getByText('Captains preview')).toHaveCount(0);

  const page = admin.page;
  await openTeam(page, team.teamId, '/settings/roles');
  await expect(page.getByRole('heading', { name: 'Roles and permissions' })).toBeVisible();
  await axe(page);
  // Start from the Captain suggestion.
  await page.getByRole('button', { name: 'Captain' }).click();
  const sheet = page.getByRole('dialog', { name: 'New team role' });
  await expect(sheet.getByLabel('Name')).toHaveValue('Captain');
  await expect(sheet.getByLabel('See coach-only practice plans')).toBeChecked();
  await sheet.getByLabel(/Cap Carter/).check();
  await axe(page);
  await sheet.getByRole('button', { name: 'Save role' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: 'Captain' })).toContainText(
    'Cap Carter',
  );

  // Reload until the captain's device has synced the new role (allow time to render each time).
  await expect(async () => {
    await cap.page.reload();
    await expect(cap.page.getByText('Captains preview')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  // Still a player: no planning controls.
  await expect(cap.page.getByRole('link', { name: 'New plan' })).toHaveCount(0);

  // The member page shows the role and what it adds.
  await openTeam(page, team.teamId, `/squad/${cap.memberId}`);
  await expect(page.getByText(/they can: .*coach-only practice plans/i)).toBeVisible();
});

test('the owner hands over ownership and the nominee accepts', async ({ page, team, axe }) => {
  const chair = await team.join('admin', 'New Chair');
  await openTeam(page, team.teamId, '/settings/team');
  await page.getByRole('button', { name: 'Hand over ownership' }).click();
  const sheet = page.getByRole('dialog', { name: 'Hand over ownership' });
  await sheet.getByLabel('New owner').selectOption({ label: 'New Chair · Admin' });
  await sheet.getByRole('button', { name: 'Ask them' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Waiting for' })).toContainText(
    'New Chair',
  );

  await openTeam(chair.page, team.teamId, '/home');
  const banner = chair.page.getByRole('complementary', { name: 'Ownership handover' });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await axe(chair.page);
  await banner.getByRole('button', { name: 'Accept' }).click();
  await expect(banner).toBeHidden();

  await openTeam(chair.page, team.teamId, '/settings/team');
  await expect(chair.page.getByText('New Chair owns the team')).toBeVisible();
  await expect(chair.page.getByRole('button', { name: /^Delete / })).toBeVisible();

  // The old owner is now an admin: can still edit the team, can't delete it.
  await page.reload();
  await expect(page.getByText('New Chair owns the team')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
});

test('an admin uploads the club emblem and it replaces the initials crest', async ({
  team,
  axe,
}) => {
  const admin = await team.join('admin', 'Admin Ada');
  const page = admin.page;
  await openTeam(page, team.teamId, '/settings/team');
  await expect(page.getByRole('heading', { name: 'Emblem' })).toBeVisible();
  await axe(page);
  // A green badge on a plain white background, generated in the page (no fixture file).
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#1f6f43';
    ctx.beginPath();
    ctx.arc(32, 32, 22, 0, Math.PI * 2);
    ctx.fill();
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), 'image/png'));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: Buffer.from(png) });

  // Review: shown on light and dark, with the white background taken out by default.
  const sheet = page.getByRole('dialog', { name: 'Your emblem' });
  await expect(sheet.getByRole('img', { name: /on a dark background/ })).toBeVisible();
  await expect(sheet.getByRole('checkbox', { name: 'Remove the background' })).toBeChecked();
  await expect(sheet.getByText(/took out the plain background/)).toBeVisible();
  await axe(page);
  await sheet.getByRole('button', { name: 'Use this emblem' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: 'Replace emblem' })).toBeVisible({
    timeout: 15_000,
  });

  // The crest is now the uploaded image, with transparent corners.
  const emblem = page.getByRole('region', { name: 'Emblem' });
  const img = emblem.locator('img.crest-img');
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
    .toBe(true);
  const corner = await img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(i, 0, 0);
    return [ctx.getImageData(2, 2, 1, 1).data[3], ctx.getImageData(128, 128, 1, 1).data[3]];
  });
  expect(corner).toEqual([0, 255]);

  await page.getByRole('button', { name: 'Use initials instead' }).click();
  await expect(page.getByRole('button', { name: 'Upload emblem' })).toBeVisible();
  await expect(emblem.locator('img.crest-img')).toHaveCount(0);
});
