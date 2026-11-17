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
    // Bulk assign is a desktop table feature: phones keep the plain list.
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Assign…' })).toHaveCount(0);
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

test('a player asks before marking kit lost, and hand-over suggests the coaches', async ({
  team,
  axe,
}) => {
  const pip = await team.join('player', 'Pip Player');
  const id = await addItem(team, { kind: 'balls', name: 'Training balls', quantity: 10 });
  await team.post(`/teams/:teamId/inventory/${id}/assign`, { memberId: pip.memberId });
  const page = pip.page;

  // Hand over: with no replies to go on, coaches and kit managers come first.
  await openTeam(page, team.teamId, `/kit/${id}`);
  await page.getByRole('button', { name: 'Hand over', exact: true }).click();
  const give = page.getByRole('dialog').first();
  await expect(
    give.locator('optgroup[label="Coaches and kit managers"] option', { hasText: 'Coach Casey' }),
  ).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Mark lost asks first, and cancelling changes nothing.
  await page.getByRole('button', { name: 'Mark lost' }).click();
  const confirm = page.getByRole('dialog', { name: /Mark the .* lost\?/ });
  await expect(confirm).toContainText('only a coach or kit manager can mark it found');
  await axe(page);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('region', { name: 'Where it is' })).toContainText('With you');
  await page.getByRole('button', { name: 'Mark lost' }).click();
  await confirm.getByRole('button', { name: 'Mark lost' }).click();
  await expect(page.getByText(/Marked the .* lost/)).toBeVisible();
});

/** Four assignable items (bibs already with Pip) and a lost tee that can't be given out. */
async function bulkSetup(team: TeamFixture) {
  const pip = await team.join('player', 'Pip Player');
  const tess = await team.join('player', 'Tess Teammate');
  const ids = {
    balls: await addItem(team, { kind: 'balls', name: 'Training balls', quantity: 10 }),
    shields: await addItem(team, { kind: 'tackle_shields', name: 'Tackle shields', quantity: 6 }),
    cones: await addItem(team, { kind: 'cones', name: 'Cones', quantity: 40 }),
    bibs: await addItem(team, { kind: 'bibs', name: 'Bibs, red', quantity: 15 }),
    tee: await addItem(team, { kind: 'kicking_tees', name: 'Kicking tee', quantity: 1 }),
  };
  await team.post(`/teams/:teamId/inventory/${ids.bibs}/assign`, { memberId: pip.memberId });
  await team.post(`/teams/:teamId/inventory/${ids.tee}/lost`, { note: null });
  return { pip, tess, ids };
}
const holders = async (team: TeamFixture) =>
  Object.fromEntries(
    (await team.post(`/teams/:teamId/sync?since=0`, undefined, 'GET')).items.map(
      (i: { id: string; holderMemberId: string | null }) => [i.id, i.holderMemberId],
    ),
  );

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`bulk assign (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test('desktop: tick several items, give them all to one person, change one, assign', async ({
      page,
      team,
      axe,
    }) => {
      test.skip(!test.info().project.name.startsWith('desktop'), 'Bulk assign is desktop-only');
      const { pip, tess, ids } = await bulkSetup(team);
      await openTeam(page, team.teamId, '/kit');
      const table = page.getByRole('table');
      const pick = (name: string) => table.getByRole('checkbox', { name: `Select ${name}` });
      const all = page.getByRole('checkbox', { name: /Select all shown/ });
      const bar = page.getByRole('group', { name: 'Selected kit' });
      await expect(table.getByRole('row')).toHaveCount(6);
      await expect(
        table.getByRole('checkbox', { name: "Kicking tee is lost, so it can't be given out" }),
      ).toBeDisabled();

      await pick('Training balls × 10').check();
      await pick('Tackle shields × 6').check();
      await pick('Bibs, red × 15').check();
      await expect(bar.getByRole('status')).toHaveText('3 selected');
      await expect(all).not.toBeChecked();
      expect(await all.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
      await axe(page);

      await bar.getByRole('button', { name: 'Assign…' }).click();
      const sheet = page.getByRole('dialog', { name: 'Assign 3 items' });
      await sheet.getByLabel('Give them all to').selectOption({ label: 'Pip Player' });
      await expect(sheet.getByLabel('Training balls × 10')).toHaveValue(pip.memberId);
      await expect(sheet.getByLabel('Tackle shields × 6')).toHaveValue(pip.memberId);
      // Pip already has the bibs: skipped.
      await expect(sheet).toContainText('already with them, skipped');
      await sheet.getByLabel('Tackle shields × 6').selectOption({ label: 'Tess Teammate' });
      await axe(page);
      await sheet.getByRole('button', { name: 'Assign 2 items' }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByText('Assigned 2 items')).toBeVisible();

      // Optimistic straight away, then on the server; the selection clears.
      await expect(table.getByRole('row', { name: /Training balls/ })).toContainText('Pip Player');
      await expect(table.getByRole('row', { name: /Tackle shields/ })).toContainText(
        'Tess Teammate',
      );
      await expect(table.getByRole('row', { name: /Bibs, red/ })).toContainText('Pip Player');
      await expect(table.getByRole('row', { name: /Cones/ })).toContainText('In the store');
      await expect(table.getByRole('checkbox', { checked: true })).toHaveCount(0);
      await expect(bar.getByRole('button', { name: 'Assign…' })).toHaveCount(0);
      await expect
        .poll(() => holders(team))
        .toMatchObject({
          [ids.balls]: pip.memberId,
          [ids.shields]: tess.memberId,
          [ids.bibs]: pip.memberId,
          [ids.cones]: null,
          [ids.tee]: null,
        });
      await axe(page);
    });

    test('desktop: bulk assign with the keyboard only', async ({ page, team, axe }) => {
      test.skip(!test.info().project.name.startsWith('desktop'), 'Bulk assign is desktop-only');
      const { pip, tess, ids } = await bulkSetup(team);
      await openTeam(page, team.teamId, '/kit');
      const table = page.getByRole('table');
      const all = page.getByRole('checkbox', { name: /Select all shown/ });
      const bar = page.getByRole('group', { name: 'Selected kit' });

      // Select all (the lost tee is left out), then untick the bibs.
      await all.focus();
      await page.keyboard.press('Space');
      await expect(bar.getByRole('status')).toHaveText('4 selected');
      await expect(all).toBeChecked();
      await table.getByRole('checkbox', { name: 'Select Bibs, red × 15' }).focus();
      await page.keyboard.press('Space');
      await expect(bar.getByRole('status')).toHaveText('3 selected');

      // From the table, back up to the bar: Clear, then Assign….
      await all.focus();
      await page.keyboard.press('Shift+Tab');
      await expect(bar.getByRole('button', { name: 'Clear' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(bar.getByRole('button', { name: 'Assign…' })).toBeFocused();
      await page.keyboard.press('Enter');
      const sheet = page.getByRole('dialog', { name: 'Assign 3 items' });
      await expect(sheet).toBeVisible();

      const everyone = sheet.getByLabel('Give them all to');
      while (!(await everyone.evaluate((el) => el === document.activeElement)))
        await page.keyboard.press('Tab');
      await page.keyboard.press('ArrowDown'); // Coach Casey
      await page.keyboard.press('ArrowDown'); // Pip Player
      await expect(everyone).toHaveValue(pip.memberId);
      const cones = sheet.getByLabel('Cones × 40');
      while (!(await cones.evaluate((el) => el === document.activeElement)))
        await page.keyboard.press('Tab');
      await page.keyboard.press('ArrowDown'); // Tess Teammate
      await expect(cones).toHaveValue(tess.memberId);
      await axe(page);
      const go = sheet.getByRole('button', { name: 'Assign 3 items' });
      while (!(await go.evaluate((el) => el === document.activeElement)))
        await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await expect(sheet).toBeHidden();
      await expect(page.getByText('Assigned 3 items')).toBeVisible();
      await expect(all).toBeFocused();
      await expect(table.getByRole('row', { name: /Cones/ })).toContainText('Tess Teammate');
      await expect
        .poll(() => holders(team))
        .toMatchObject({
          [ids.balls]: pip.memberId,
          [ids.shields]: pip.memberId,
          [ids.cones]: tess.memberId,
          [ids.bibs]: pip.memberId,
        });
    });
  });
}
