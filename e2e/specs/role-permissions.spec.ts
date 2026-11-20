/**
 * Configurable base roles (PLAN.md §2): admins choose what coaches, managers and players can do,
 * and the app and API follow. Also the invite → join → Squad path under the default settings and
 * the "Club with a committee" preset (the offseason critical path).
 */
import type { Browser, Page } from '@playwright/test';
import { test, expect, openTeam, uuid, type Actor, type TeamFixture } from '../fixtures';

test.use({ serviceWorkers: 'block' });
// Several signed-in people and devices picking up settings on their next sync.
test.describe.configure({ timeout: 90_000 });

const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? 8787}`;
const SHOTS = process.env.PP_SHOTS;

async function noWorker(...actors: Actor[]) {
  await Promise.all(actors.map((a) => a.context.route('**/service-worker.js', (r) => r.abort())));
}

/** Reload until the condition holds: other devices pick up settings on their next sync. */
async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 30_000 });
}

async function openSettings(page: Page, teamId: string) {
  await openTeam(page, teamId, '/settings/roles');
  await expect(page.getByRole('heading', { name: 'What each role can do' })).toBeVisible();
}

/** Save the editor's draft through the confirm step; returns the confirm text. */
async function save(page: Page) {
  await page
    .getByRole('group', { name: 'Unsaved role settings' })
    .getByRole('button', { name: 'Save changes' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Change what roles can do?' });
  await expect(dialog).toBeVisible();
  const text = (await dialog.textContent()) ?? '';
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Role settings saved')).toBeVisible();
  return text;
}

async function choosePreset(page: Page, name: RegExp) {
  await page.getByRole('radio', { name }).check();
}

/** Show a role's column (phones show one at a time). */
async function showColumn(page: Page, role: 'Coach' | 'Manager' | 'Player') {
  const picker = page.getByRole('radiogroup', { name: 'Show the settings for' });
  if (await picker.isVisible()) await picker.getByRole('radio', { name: role }).click();
}

/** Make an invite in the Squad screen's invite sheet and return its link. */
async function inviteFromSquad(page: Page, teamId: string, role: string) {
  await openTeam(page, teamId, '/squad');
  await page.getByRole('button', { name: 'Invite' }).first().click();
  const sheet = page.getByRole('dialog', { name: /Invite to/ });
  await sheet.getByRole('radiogroup', { name: 'Role' }).getByRole('radio', { name: role }).click();
  const created = page.waitForResponse(
    (r) => r.url().endsWith(`/teams/${teamId}/invites`) && r.request().method() === 'POST',
  );
  await sheet.getByRole('button', { name: 'Create invite link' }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const { path } = (await res.json()) as { path: string };
  await page.keyboard.press('Escape');
  return `${ORIGIN}${path}`;
}

/** A brand-new account opens the link and joins from the /join page. */
async function joinByLink(browser: Browser, link: string, name: string, team: TeamFixture) {
  const ctx = await browser.newContext(test.info().project.use);
  await ctx.route('**/service-worker.js', (r) => r.abort());
  const res = await ctx.request.post(`${ORIGIN}/api/v1/test/login`, {
    data: { userId: uuid(), displayName: name },
    headers: { origin: ORIGIN },
  });
  expect(res.ok()).toBeTruthy();
  const page = await ctx.newPage();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: team.name })).toBeVisible();
  // Signed in already (an existing account, or one just made): the button names the team.
  await page.getByRole('button', { name: 'Join TRFC' }).click();
  await expect(page).toHaveURL(/\/home/);
  return { ctx, page };
}

async function inSquad(page: Page, teamId: string, name: string) {
  await eventually(page, async () => {
    await expect(page.getByRole('link', { name: new RegExp(name) }).first()).toBeVisible({
      timeout: 5_000,
    });
  });
  void teamId;
}

test('invite → join → Squad works under the default settings', async ({ browser, team }) => {
  const admin = await team.join('admin', 'Admin Ada');
  const manager = await team.join('manager', 'Manager Mo');
  await noWorker(admin, manager);

  const fromAdmin = await inviteFromSquad(admin.page, team.teamId, 'Player');
  const fromManager = await inviteFromSquad(manager.page, team.teamId, 'Manager');
  const a = await joinByLink(browser, fromAdmin, 'Newbie Nia', team);
  const b = await joinByLink(browser, fromManager, 'Helper Hal', team);

  await openTeam(admin.page, team.teamId, '/squad');
  await inSquad(admin.page, team.teamId, 'Newbie Nia');
  await inSquad(admin.page, team.teamId, 'Helper Hal');
  // Each joined with exactly the invite's role.
  const me = async (p: Page) =>
    (await (await p.request.get(`${ORIGIN}/api/v1/me`)).json()).memberships.find(
      (m: { team: { id: string } }) => m.team.id === team.teamId,
    ).member;
  expect((await me(a.page)).role).toBe('player');
  expect((await me(b.page)).role).toBe('manager');
  await a.ctx.close();
  await b.ctx.close();
});

test('Club with a committee: coaches run rugby, managers run the squad; reset restores', async ({
  browser,
  team,
  axe,
}) => {
  const admin = await team.join('admin', 'Admin Ada');
  const coach = await team.join('coach', 'Coach Cara');
  const manager = await team.join('manager', 'Manager Mo');
  const player = await team.join('player', 'Player Pip', [9]);
  await noWorker(admin, coach, manager, player);
  const eventId = uuid();
  await team.post(`/teams/${team.teamId}/events`, {
    id: eventId,
    type: 'match',
    format: '15s',
    title: 'League',
    opponent: 'Harlow',
    startsAt: Date.now() + 3 * 86400e3,
  });

  // Before: the coach can invite.
  await openTeam(coach.page, team.teamId, '/squad');
  await expect(coach.page.getByRole('button', { name: 'Invite' }).first()).toBeVisible();

  const page = admin.page;
  await openSettings(page, team.teamId);
  await expect(page.getByRole('radio', { name: /^Coach-led team/ })).toBeChecked();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // Scrolled, targets sit under the sticky header (axe overlap); scan from the top.
    await page.evaluate(() => window.scrollTo(0, 0));
    await axe(page);
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/${test.info().project.name}-${scheme}-default.png`,
        fullPage: true,
      });
  }
  await page.emulateMedia({ colorScheme: null });

  await choosePreset(page, /^Club with a committee/);
  await showColumn(page, 'Coach');
  await expect(page.getByRole('switch', { name: 'Coach: Manage members' })).not.toBeChecked();
  await expect(
    page.getByRole('switch', { name: 'Coach: Build and publish team sheets' }),
  ).toBeChecked();
  const summary = await save(page);
  expect(summary).toContain(
    'Coaches will no longer be able to: remove members, change their roles or make device links, create invites',
  );
  // Managers already invite under the defaults, so member management is the only gain.
  expect(summary).toContain('Managers will now be able to: remove members or change their roles.');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // Scrolled, targets sit under the sticky header (axe overlap); scan from the top.
    await page.evaluate(() => window.scrollTo(0, 0));
    await axe(page);
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/${test.info().project.name}-${scheme}-club.png`,
        fullPage: true,
      });
  }
  await page.emulateMedia({ colorScheme: null });

  // The coach: no invite button and no remove action...
  await openTeam(coach.page, team.teamId, '/squad');
  await eventually(coach.page, async () => {
    await expect(coach.page.getByRole('heading', { name: 'Squad', level: 1 })).toBeVisible();
    await expect(coach.page.getByRole('button', { name: 'Invite' })).toHaveCount(0, {
      timeout: 3_000,
    });
  });
  await openTeam(coach.page, team.teamId, `/squad/${player.memberId}`);
  await expect(coach.page.getByRole('heading', { name: 'Player Pip' })).toBeVisible();
  await expect(coach.page.getByRole('button', { name: 'Remove from team' })).toHaveCount(0);
  // ...the role description says the club set it, and the settings are read-only.
  await openSettings(coach.page, team.teamId);
  await expect(coach.page.getByText(/This team uses\s+Club with a committee/)).toBeVisible();
  await expect(coach.page.getByRole('switch')).toHaveCount(0);
  await axe(coach.page);
  // ...but still plans practice and builds the sheet.
  await openTeam(coach.page, team.teamId, '/practice');
  await expect(coach.page.getByRole('link', { name: 'New plan' }).first()).toBeVisible();
  await openTeam(coach.page, team.teamId, `/events/${eventId}/sheet`);
  await expect(coach.page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
  // The API agrees.
  const coachInvite = await coach.page.request.post(
    `${ORIGIN}/api/v1/teams/${team.teamId}/invites`,
    {
      data: { id: uuid(), role: 'player' },
      headers: { origin: ORIGIN },
    },
  );
  expect(coachInvite.status()).toBe(403);

  // The manager invites; a new person joins and appears in the Squad.
  await eventually(manager.page, async () => {
    await openTeam(manager.page, team.teamId, `/squad/${player.memberId}`);
    await expect(manager.page.getByRole('button', { name: 'Remove from team' })).toBeVisible({
      timeout: 5_000,
    });
  });
  const link = await inviteFromSquad(manager.page, team.teamId, 'Player');
  const joined = await joinByLink(browser, link, 'Fresh Fay', team);
  await openTeam(coach.page, team.teamId, '/squad');
  await inSquad(coach.page, team.teamId, 'Fresh Fay');
  await joined.ctx.close();

  // Reset to default restores the coach's squad tools.
  await openSettings(page, team.teamId);
  await expect(page.getByRole('radio', { name: /^Club with a committee/ })).toBeChecked();
  await choosePreset(page, /^Coach-led team/);
  await save(page);
  await openTeam(coach.page, team.teamId, '/squad');
  await eventually(coach.page, async () => {
    await expect(coach.page.getByRole('button', { name: 'Invite' }).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});

test('players can be allowed to record matches; a tweak shows Custom with Reset', async ({
  team,
  axe,
}) => {
  const admin = await team.join('admin', 'Admin Ada');
  const player = await team.join('player', 'Player Pip', [9]);
  await noWorker(admin, player);
  const eventId = uuid();
  await team.post(`/teams/${team.teamId}/events`, {
    id: eventId,
    type: 'match',
    format: '15s',
    title: 'League',
    opponent: 'Harlow',
    startsAt: Date.now() - 30 * 60e3,
  });
  await team.post(
    `/teams/${team.teamId}/sheets/${uuid()}`,
    { eventId, format: '15s', replacements: 8, slots: { '9': player.memberId } },
    'PUT',
  );

  // Before: the player is sent to the summary.
  await openTeam(player.page, team.teamId, `/events/${eventId}/match`);
  await expect(player.page).toHaveURL(/\/match\/summary/);

  const page = admin.page;
  await openSettings(page, team.teamId);
  await showColumn(page, 'Player');
  // Only the safe set is offered to players.
  await expect(page.getByRole('switch', { name: /^Player: / })).toHaveCount(2);
  await page.getByRole('switch', { name: 'Player: Record match events' }).check();
  await expect(page.getByRole('radio', { name: /^Custom/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Reset to default' })).toBeVisible();
  // Scrolled, targets sit under the sticky header (axe overlap); scan from the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  await axe(page);
  if (SHOTS)
    await page.screenshot({
      path: `${SHOTS}/${test.info().project.name}-light-custom.png`,
      fullPage: true,
    });
  const summary = await save(page);
  expect(summary).toContain('Players will now be able to: record match events');

  await eventually(player.page, async () => {
    // A device still on its cached settings sends the player to the summary until it has synced,
    // so judge the page only once this load's sync is back.
    const synced = player.page.waitForResponse((r) => r.url().includes('/sync?'));
    await openTeam(player.page, team.teamId, `/events/${eventId}/match`);
    await synced;
    await expect(player.page).toHaveURL(/\/match\?/);
    await expect(player.page.getByRole('button', { name: 'Kick off' })).toBeVisible({
      timeout: 5_000,
    });
  });
  const posted = player.page.waitForResponse(
    (r) => r.url().endsWith(`/events/${eventId}/match`) && r.request().method() === 'POST',
  );
  await player.page.getByRole('button', { name: 'Kick off' }).click();
  expect((await posted).status()).toBe(200);
  await expect(player.page.getByText('Running', { exact: true })).toBeVisible();

  // Reset to default takes it away again.
  await openSettings(page, team.teamId);
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await expect(page.getByRole('radio', { name: /^Coach-led team/ })).toBeChecked();
  await save(page);
  await expect(page.getByRole('button', { name: 'Reset to default' })).toHaveCount(0);
});
