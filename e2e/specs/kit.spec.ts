import { test, expect, openTeam, uuid, type TeamFixture } from '../fixtures';

const DAY = 86400e3;

// The shell reloads when a service worker first takes control; these specs don't need it.
test.beforeEach(async ({ context }) => {
  await context.route('**/service-worker.js', (r) => r.abort());
});

const addItem = async (team: TeamFixture, body: Record<string, unknown>) => {
  const id = uuid();
  await team.post(`/teams/:teamId/inventory/${id}`, body, 'PUT');
  return id;
};
const addEvent = async (team: TeamFixture, body: Record<string, unknown>) => {
  const id = uuid();
  await team.post(`/teams/:teamId/events`, { id, type: 'training', title: 'Training', ...body });
  return id;
};
const reply = (team: TeamFixture, eventId: string, memberId: string, status: string) =>
  team.post(`/teams/:teamId/events/${eventId}/rsvps/${memberId}`, { status, note: null }, 'PUT');

test('shields at risk: the holder is out, hands over to a teammate who accepts, flag clears', async ({
  page,
  team,
  axe,
}) => {
  const pip = await team.join('player', 'Pip Player');
  const tess = await team.join('player', 'Tess Teammate');
  const eventId = await addEvent(team, { startsAt: Date.now() + 2 * DAY });
  await reply(team, eventId, tess.memberId, 'yes');

  // A coach logs the shields and gives them to Pip.
  await openTeam(page, team.teamId, '/kit');
  await expect(page.getByRole('heading', { name: 'Log your first kit' })).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Add kit' }).first().click();
  const add = page.getByRole('dialog', { name: 'Add kit' });
  await add.getByLabel('Kind').selectOption('tackle_shields');
  await expect(add.getByLabel('Name')).toHaveValue('Tackle shields');
  await add.getByLabel('How many').fill('6');
  await expect(add.getByText(/Don't write anything about anyone's health/)).toBeVisible();
  await add.getByRole('button', { name: 'Add kit' }).click();
  await expect(add).toBeHidden();
  await page.getByRole('link', { name: /Tackle shields × 6/ }).click();
  await expect(page.getByRole('heading', { name: 'Tackle shields × 6', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Give it to someone' }).click();
  const give = page.getByRole('dialog', { name: 'Give it to' });
  await give.getByLabel('Teammate').selectOption({ label: 'Pip Player' });
  await give.getByRole('button', { name: 'Give it to them' }).click();
  await expect(page.getByRole('region', { name: 'Where it is' })).toContainText('Pip Player');
  await expect(page.getByText('You gave it to Pip Player')).toBeVisible();
  await axe(page);

  // Pip can't make it.
  await openTeam(pip.page, team.teamId, `/events/${eventId}`);
  await pip.page.getByRole('button', { name: 'Out' }).click();
  await expect(pip.page.getByRole('button', { name: 'Out' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(async () => {
      const s = await team.post(`/teams/:teamId/sync?since=0`, undefined, 'GET');
      return s.rsvps.find((r: { memberId: string }) => r.memberId === pip.memberId)?.status;
    })
    .toBe('no');

  // The event shows the flag to staff.
  await openTeam(page, team.teamId, `/events/${eventId}`);
  const flag = page.getByRole('region', { name: 'Kit at risk' });
  await expect(flag).toContainText('Tackle shields × 6');
  await expect(flag).toContainText("Pip Player isn't going");
  await axe(page);

  // Home nudges Pip to hand them over.
  await openTeam(pip.page, team.teamId, '/home');
  const nudge = pip.page.getByRole('complementary', { name: 'Kit you have' });
  await expect(nudge).toContainText(/You're not going .+: hand the tackle shields to someone\?/);
  await axe(pip.page);
  await nudge.getByRole('button', { name: 'Hand over' }).click();
  const hand = pip.page.getByRole('dialog', { name: 'Hand it over' });
  await hand.getByLabel('Teammate').selectOption({ label: 'Tess Teammate' });
  await hand.getByLabel('Message').fill('Can you bring them Thursday?');
  await hand.getByRole('button', { name: 'Send request' }).click();
  await expect(nudge).toContainText('Waiting for Tess Teammate to accept.');
  await expect
    .poll(async () => (await team.post(`/teams/:teamId/sync?since=0`, undefined, 'GET')).handoffs)
    .toHaveLength(1);

  // Tess accepts from the banner; offline it waits to send.
  await openTeam(tess.page, team.teamId, '/home');
  const banner = tess.page.getByRole('complementary', { name: 'Kit handover' });
  await expect(banner).toContainText('Pip Player wants to hand you the');
  await expect(banner).toContainText('Can you bring them Thursday?');
  await axe(tess.page);
  await tess.context.setOffline(true);
  await banner.getByRole('button', { name: 'Accept' }).click();
  await expect(banner).toContainText('Accepted, waiting to send');
  await tess.context.setOffline(false);
  await expect(banner).toBeHidden({ timeout: 15_000 });

  // The flag clears: the shields are with someone who's going.
  await openTeam(page, team.teamId, `/events/${eventId}`);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Kit at risk' })).toHaveCount(0);
  await openTeam(page, team.teamId, '/kit');
  await page.getByRole('link', { name: /Tackle shields × 6/ }).click();
  await expect(page.getByText('Tess Teammate took it over from Pip Player')).toBeVisible();
});

test('kit list: table with filters on desktop, grouped list on phones; match-day checklist', async ({
  page,
  team,
  axe,
}) => {
  const pip = await team.join('player', 'Pip Player');
  const balls = await addItem(team, { kind: 'balls', name: 'Match balls', quantity: 4 });
  await addItem(team, { kind: 'bibs', name: 'Bibs, red', quantity: 15, condition: 'needs_repair' });
  await addItem(team, {
    kind: 'flags',
    name: 'Corner flags',
    quantity: 4,
    matchDay: true,
    home: 'Clubhouse cage',
  });
  await team.post(`/teams/:teamId/inventory/${balls}/assign`, { memberId: pip.memberId });

  await openTeam(page, team.teamId, '/kit');
  await expect(page.getByRole('heading', { name: 'Kit', level: 1 })).toBeVisible();
  await expect(page.getByText(/1\s*need repair/)).toBeVisible();
  if (test.info().project.name.startsWith('desktop')) {
    const table = page.getByRole('table');
    await expect(table.getByRole('row')).toHaveCount(4);
    await page.getByLabel('Holder').selectOption({ label: 'Pip Player' });
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table).toContainText('Match balls × 4');
    await page.getByLabel('Holder').selectOption({ label: 'Anyone' });
    await page.getByRole('button', { name: 'Item' }).click();
    await expect(page.getByRole('columnheader', { name: 'Item' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await expect(table.getByRole('row').nth(1)).toContainText('Bibs, red');
  } else {
    await expect(page.getByRole('region', { name: /With someone/ })).toContainText(
      'Match balls × 4',
    );
    await page.getByRole('radio', { name: 'Holder' }).click();
    await expect(page.getByRole('region', { name: /Lost or needs repair/ })).toContainText(
      'Bibs, red',
    );
    await expect(page.getByRole('region', { name: /Pip Player/ })).toContainText('Match balls');
  }
  await axe(page);

  // The match-day checklist on a game.
  const game = await addEvent(team, {
    type: 'match',
    title: 'League',
    opponent: 'Rivals',
    startsAt: Date.now() + 3 * DAY,
  });
  await openTeam(page, team.teamId, `/events/${game}`);
  const md = page.getByRole('region', { name: /Match-day kit/ });
  await expect(md).toContainText('Corner flags × 4');
  await expect(md).toContainText('In the store · Clubhouse cage');
  await md.getByRole('checkbox').check();
  await expect(md).toContainText('1/1 ready');
  await axe(page);
});
