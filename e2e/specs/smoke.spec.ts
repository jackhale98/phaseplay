import { test, expect, openTeam } from '../fixtures';

test('landing renders, is accessible and has no console errors', async ({ page, axe }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('from one app');
  await axe(page);
  expect(errors).toEqual([]);
});

test('signed-in owner lands on Home for a new team', async ({ page, team, axe }) => {
  await openTeam(page, team.teamId, '/home');
  await expect(page.getByRole('heading', { name: /Evening|Morning|Afternoon/ })).toBeVisible();
  await expect(page.getByText('Add your first training')).toBeVisible();
  await axe(page);
});

test('RSVP from Home is one tap and survives a reload', async ({ page, team }) => {
  const id = crypto.randomUUID();
  await team.post(`/teams/${team.teamId}/events`, {
    id,
    type: 'training',
    title: 'Training',
    startsAt: Date.now() + 2 * 86400e3,
  });
  await openTeam(page, team.teamId, '/home');
  const inBtn = page
    .getByRole('group', { name: 'Are you in?' })
    .first()
    .getByRole('button', { name: 'In' });
  await inBtn.click();
  await expect(inBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('All changes saved').first()).toBeAttached();
  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Are you in?' }).first().getByRole('button', { name: 'In' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('Home opens offline from the on-device cache', async ({ page, context, team }, info) => {
  // Playwright's WebKit can't reload a page while offline ("WebKit encountered an internal error"),
  // even with a service worker in control; Chromium covers the offline cold start.
  test.skip(info.project.name.includes('webkit'), 'WebKit cannot reload offline under Playwright');
  const id = crypto.randomUUID();
  await team.post(`/teams/${team.teamId}/events`, {
    id,
    type: 'social',
    title: 'Offline quiz night',
    startsAt: Date.now() + 3 * 86400e3,
  });
  await openTeam(page, team.teamId, '/home');
  await expect(page.getByText('Offline quiz night').first()).toBeVisible();
  // Wait for the service worker to take control so the app shell itself is available offline.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(async () => {
    if (!navigator.serviceWorker.controller)
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }),
      );
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Offline quiz night').first()).toBeVisible();
  await expect(
    page.getByText('Offline', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
  await context.setOffline(false);
});

test('replying on Home confirms clearly before the next event moves up', async ({ page, team }) => {
  const at = Date.now() + 2 * 86400e3;
  // The first upcoming event is the hero; the rest queue under "Waiting for your reply".
  for (const [i, title] of ['Hero practice', 'Quiz night', 'Kit collection'].entries())
    await team.post(`/teams/${team.teamId}/events`, {
      id: crypto.randomUUID(),
      type: i === 0 ? 'training' : 'social',
      title,
      startsAt: at + i * 86400e3,
    });
  await openTeam(page, team.teamId, '/home');
  const waiting = page.locator('.wait');
  await expect(waiting).toHaveCount(2);
  await expect(waiting.first()).toContainText('Quiz night');

  await waiting.first().getByRole('button', { name: 'In', exact: true }).click();
  // A visible confirmation names the event that was answered, and screen readers hear it too.
  await expect(page.getByText("You're in · Quiz night")).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Saved: You' })).toContainText(
    'Next: Kit collection',
  );
  // Then the answered card leaves and the next one is first.
  await expect(waiting).toHaveCount(1, { timeout: 5_000 });
  await expect(waiting.first()).toContainText('Kit collection');

  await waiting.first().getByRole('button', { name: 'Out', exact: true }).click();
  await expect(page.getByText("You're out · Kit collection")).toBeVisible();
  await expect(page.getByText("You're all caught up")).toBeVisible({ timeout: 5_000 });
});

test('an active invite link can be copied again later', async ({ page, team, axe }) => {
  await openTeam(page, team.teamId, '/squad');
  await page.getByRole('button', { name: 'Invite' }).first().click();
  let sheet = page.getByRole('dialog', { name: /Invite to/ });
  await sheet.getByRole('button', { name: 'Create invite link' }).click();
  const url = await sheet.locator('.url').textContent();
  expect(url).toContain('/join#');
  await sheet.getByRole('button', { name: 'Back to invites' }).click();
  await page.keyboard.press('Escape');

  // Later: reopen and copy or show the same link.
  await page.getByRole('button', { name: 'Invite' }).first().click();
  sheet = page.getByRole('dialog', { name: /Invite to/ });
  await expect(sheet.getByRole('heading', { name: 'Active invites' })).toBeVisible();
  await axe(page);
  await sheet.getByRole('button', { name: /^Show/ }).first().click();
  await expect(sheet.getByRole('img', { name: 'QR code for the invite link' })).toBeVisible();
  await expect(sheet.locator('.url')).toHaveText(url!);
});

test("Home's who's-in summary is for coaches and captains, not every player", async ({
  page,
  team,
}) => {
  await team.post(`/teams/${team.teamId}/events`, {
    id: crypto.randomUUID(),
    type: 'training',
    title: 'Tuesday training',
    startsAt: Date.now() + 2 * 86400e3,
  });
  const glance = (p: typeof page) => p.getByRole('heading', { name: /^Who's in ·/ });
  // The coach sees it.
  await openTeam(page, team.teamId, '/home');
  await expect(glance(page)).toBeVisible();
  // A player doesn't.
  const pip = await team.join('player', 'Pip Player');
  await openTeam(pip.page, team.teamId, '/home');
  await expect(pip.page.getByRole('heading', { name: /Tuesday training/ }).first()).toBeVisible();
  await expect(glance(pip.page)).toHaveCount(0);
});
