import { test, expect, openTeam, uuid, type TeamFixture } from '../fixtures';

const DAY = 86400e3;

// The shell reloads the page when a service worker first takes control (controllerchange), which
// races with interactions in a fresh browser context. These specs don't need the worker.
test.beforeEach(async ({ context }) => {
  await context.route('**/service-worker.js', (r) => r.abort());
});

async function addEvent(team: TeamFixture, body: Record<string, unknown>) {
  const id = uuid();
  await team.post(`/teams/:teamId/events`, { id, type: 'training', title: 'Practice', ...body });
  return id;
}
async function addName(team: TeamFixture, displayName: string, positions: number[] = []) {
  const id = uuid();
  await team.post(`/teams/:teamId/members`, { id, displayName, positions });
  return id;
}
const reply = (
  team: TeamFixture,
  eventId: string,
  memberId: string,
  status: string,
  note?: string,
) =>
  team.post(
    `/teams/:teamId/events/${eventId}/rsvps/${memberId}`,
    { status, note: note ?? null },
    'PUT',
  );

test('empty schedule invites staff to add the first training, and is accessible', async ({
  page,
  team,
  axe,
}) => {
  await openTeam(page, team.teamId, '/schedule');
  await expect(page.getByRole('heading', { name: 'Schedule', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add your first training' })).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Add your first training' }).click();
  await expect(page.getByRole('dialog', { name: 'New practice' })).toBeVisible();
  await expect(page.getByText('Repeat every week')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'New practice' });
  await dialog.getByRole('checkbox', { name: /Repeat every week/ }).check();
  await expect(dialog.getByRole('button', { name: 'Tue' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Thu' }).click();
  await dialog.getByRole('button', { name: 'Add series' }).click();
  await expect(page.getByText(/Added \d+ practices/)).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Practices/ })).toContainText(/2[56]/);
});

test('staff add a fundraiser and a game, then filter by Events and Games', async ({
  page,
  team,
  axe,
}) => {
  await openTeam(page, team.teamId, '/schedule?new=1');
  let dialog = page.getByRole('dialog', { name: 'Add to schedule' });
  await expect(dialog.getByRole('button', { name: /^Game/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Practice/ })).toBeVisible();
  await dialog.getByRole('button', { name: /^Event/ }).click();

  dialog = page.getByRole('dialog', { name: 'New event' });
  await dialog.getByRole('button', { name: 'Fundraiser' }).click();
  await expect(dialog.getByLabel('Opponent')).toHaveCount(0);
  await dialog.getByLabel('Title', { exact: true }).fill('Quiz night');
  await dialog.getByLabel('Location (optional)').fill('Clubhouse');
  await dialog.getByRole('button', { name: 'Add to schedule' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: /Fundraiser: Quiz night/ })).toBeVisible();

  await page.getByRole('button', { name: 'Add to schedule' }).click();
  await page
    .getByRole('dialog', { name: 'Add to schedule' })
    .getByRole('button', { name: /^Game/ })
    .click();
  dialog = page.getByRole('dialog', { name: 'New game' });
  await dialog.getByLabel('Opponent').fill('Old Albanians');
  await expect(dialog.getByText(/Times are in team time/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Add to schedule' }).click();
  await expect(dialog).toBeHidden();
  const game = page.getByRole('link', { name: /Game: v Old Albanians/ });
  const quiz = page.getByRole('link', { name: /Quiz night/ });
  await expect(game).toBeVisible();

  await page.getByRole('radio', { name: /^Events/ }).click();
  await expect(quiz).toBeVisible();
  await expect(game).toHaveCount(0);
  await page.getByRole('radio', { name: /^Games/ }).click();
  await expect(game).toBeVisible();
  await expect(quiz).toHaveCount(0);
  await expect(page).toHaveURL(/show=games/);

  // The filter is in the URL, so it survives a reload; search narrows further.
  await page.reload();
  await expect(page.getByRole('radio', { name: /^Games/ })).toHaveAttribute('aria-checked', 'true');
  await expect(game).toBeVisible();
  await expect(quiz).toHaveCount(0);
  await page.getByRole('radio', { name: /^All/ }).click();
  await page.getByRole('searchbox', { name: 'Search the schedule' }).fill('club');
  await expect(quiz).toBeVisible();
  await expect(game).toHaveCount(0);
  await axe(page);
});

test('RSVP from the schedule is one tap, queues offline and syncs when back', async ({
  page,
  team,
  context,
}) => {
  await addEvent(team, { title: 'Tuesday practice', startsAt: Date.now() + 2 * DAY });
  await openTeam(page, team.teamId, '/schedule');
  const group = page.getByRole('group', { name: 'Are you in?' }).first();
  await expect(group).toBeVisible();
  await expect(page.getByText('All changes saved').first()).toBeAttached();

  await context.setOffline(true);
  await group.getByRole('button', { name: 'In' }).click();
  await expect(group.getByRole('button', { name: 'In' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Offline · 1 change waiting/).first()).toBeAttached();

  await context.setOffline(false);
  await expect(page.getByText('All changes saved').first()).toBeAttached({ timeout: 15_000 });
  await page.reload();
  await expect(
    page.getByRole('group', { name: 'Are you in?' }).first().getByRole('button', { name: 'In' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('availability board warns about cover, nudges and replies on behalf', async ({
  page,
  team,
  axe,
}) => {
  const eventId = await addEvent(team, {
    type: 'match',
    title: 'v Harpenden',
    opponent: 'Harpenden',
    format: '15s',
    startsAt: Date.now() + 3 * DAY,
  });
  const prop = await addName(team, 'Pat Prop', [1]);
  const lock = await addName(team, 'Lou Lock', [4]);
  await addName(team, 'Wil Wing', [11]);
  await reply(team, eventId, prop, 'yes', 'Can only play one half');
  await reply(team, eventId, lock, 'no');

  await openTeam(page, team.teamId, `/events/${eventId}`);
  await expect(page.getByRole('heading', { name: 'TRFC v Harpenden', level: 1 })).toBeVisible();
  const board = page.getByRole('region', { name: "Who's in?" });
  await expect(board.getByText('Only 1 available front-rower (need 6)')).toBeVisible();
  await expect(board.getByText(/short of a starting XV/)).toBeVisible();
  await expect(board.getByText('“Can only play one half”')).toBeVisible();
  await expect(board.getByRole('button', { name: 'Copy a nudge' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Team sheet/ })).toHaveAttribute(
    'href',
    `/events/${eventId}/sheet`,
  );
  await expect(page.getByRole('link', { name: /Match mode/ })).toHaveAttribute(
    'href',
    `/events/${eventId}/match`,
  );
  await axe(page);

  await board.getByRole('button', { name: /^Wil Wing, No reply/ }).click();
  await page
    .getByRole('dialog', { name: 'Reply for Wil Wing' })
    .getByRole('button', { name: 'In' })
    .click();
  await expect(board.getByRole('button', { name: /^Wil Wing, In/ })).toBeVisible();
});

test('players see counts only, never other people’s notes', async ({ team }) => {
  const eventId = await addEvent(team, {
    title: 'Thursday practice',
    startsAt: Date.now() + 2 * DAY,
  });
  const other = await addName(team, 'Sam Secret', [9]);
  await reply(team, eventId, other, 'no', 'Hamstring niggle');
  const player = await team.join('player', 'Jo Player', [10]);
  await player.context.route('**/service-worker.js', (r) => r.abort());
  await openTeam(player.page, team.teamId, `/events/${eventId}`);
  await expect(player.page.getByRole('heading', { name: 'Are you in?' })).toBeVisible();
  await expect(player.page.getByText(/0 in.*0 maybe.*1 out/)).toBeVisible();
  await expect(player.page.getByRole('heading', { name: "Who's in?" })).toHaveCount(0);
  await expect(player.page.getByText('Hamstring niggle')).toHaveCount(0);
  await expect(player.page.getByText('Sam Secret')).toHaveCount(0);

  await player.page.getByRole('button', { name: 'Maybe' }).click();
  await player.page.getByRole('button', { name: 'Add a note for the coaches' }).click();
  await expect(player.page.getByText(/Only coaches and managers see this/)).toBeVisible();
  await player.page.getByLabel('Note for the coaches').fill('Back by 7:30');
  await player.page.getByRole('button', { name: 'Send note' }).click();
  await expect(player.page.getByText('“Back by 7:30”')).toBeVisible();
});

test('cancel shows a banner with undo, delete hides the event with undo', async ({
  page,
  team,
}) => {
  const eventId = await addEvent(team, {
    title: 'Sunday social',
    type: 'social',
    startsAt: Date.now() + 4 * DAY,
  });
  await openTeam(page, team.teamId, `/events/${eventId}`);
  await expect(page.getByRole('heading', { name: 'Sunday social', level: 1 })).toBeVisible();
  await expect(page.getByText('All changes saved').first()).toBeAttached();
  await page.getByRole('button', { name: 'Cancel event' }).click();
  await expect(page.getByText('This social is off. No need to reply.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('This social is off. No need to reply.')).toHaveCount(0);
  await expect(page.getByText('All changes saved').first()).toBeAttached();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sunday social', level: 1 })).toBeVisible();
  await expect(page.getByText('This social is off. No need to reply.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/schedule/);
  await expect(page.getByRole('link', { name: /Sunday social/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('link', { name: /Sunday social/ })).toBeVisible();
});

test('attendance is pre-filled from replies and saves', async ({ page, team, axe }) => {
  const eventId = await addEvent(team, {
    title: 'Tuesday practice',
    startsAt: Date.now() - 2 * 3600e3,
  });
  const a = await addName(team, 'Ava Adams', [9]);
  const b = await addName(team, 'Ben Brown', [10]);
  await addName(team, 'Cal Carter', [12]);
  await reply(team, eventId, a, 'yes');
  await reply(team, eventId, b, 'yes');

  await openTeam(page, team.teamId, `/events/${eventId}`);
  await page.getByRole('link', { name: /Attendance/ }).click();
  await expect(page.getByRole('heading', { name: 'Who turned up?' })).toBeVisible();
  const row = (n: string) => page.getByRole('button', { name: new RegExp(`^${n}`) });
  await expect(row('Ava Adams')).toHaveAttribute('aria-pressed', 'true');
  await expect(row('Ben Brown')).toHaveAttribute('aria-pressed', 'true');
  await expect(row('Cal Carter')).toHaveAttribute('aria-pressed', 'false');
  await axe(page);

  await row('Ben Brown').click();
  await expect(page.getByText(/1 of 3 here/)).toBeVisible();
  await page.getByRole('button', { name: 'All present' }).click();
  await expect(page.getByText(/3 of 3 here/)).toBeVisible();
  await row('Cal Carter').click();
  await page.getByRole('button', { name: 'Save attendance' }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
  await expect(page.getByText('All changes saved').first()).toBeAttached();

  await page.goto(`/events/${eventId}/attendance`);
  await expect(row('Ben Brown')).toHaveAttribute('aria-pressed', 'true');
  await expect(row('Cal Carter')).toHaveAttribute('aria-pressed', 'false');
});

test('calendar feed: create, add links, revoke', async ({ page, team }) => {
  await openTeam(page, team.teamId, '/settings/calendar');
  await page.getByRole('button', { name: 'Create my feed' }).click();
  const apple = page.getByRole('link', { name: 'Add to Apple Calendar' });
  await expect(apple).toHaveAttribute('href', /^webcal:\/\/.+\/cal\/.+\.ics$/);
  await expect(page.getByRole('link', { name: /Add to Google Calendar/ })).toHaveAttribute(
    'href',
    /^https:\/\/calendar\.google\.com\/calendar\/render\?cid=webcal%3A%2F%2F/,
  );
  const url = await page.getByLabel(/Subscription link/).inputValue();
  const ics = await page.request.get(url);
  expect(ics.headers()['content-type']).toContain('text/calendar');
  await page.getByRole('button', { name: /Create a team feed/ }).click();
  await expect(page.getByRole('heading', { name: 'Your team feed is ready' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Turn off/ })).toHaveCount(2);
  await page.getByRole('button', { name: /^Turn off personal feed/ }).click();
  await page
    .getByRole('dialog', { name: 'Turn off this feed?' })
    .getByRole('button', { name: 'Turn off' })
    .click();
  await expect(page.getByRole('button', { name: /^Turn off/ })).toHaveCount(1);
  expect((await page.request.get(url)).status()).toBe(404);
});

test("players see who's going only when the team allows it", async ({ page, team, axe }) => {
  const pat = await team.join('player', 'Pat Prop');
  const cara = await team.join('player', 'Cara Centre');
  const game = uuid();
  const practice = uuid();
  const at = Date.now() + 3 * DAY;
  await team.post(`/teams/${team.teamId}/events`, {
    id: game,
    type: 'match',
    title: 'League',
    opponent: 'Rivals',
    startsAt: at,
  });
  await team.post(`/teams/${team.teamId}/events`, {
    id: practice,
    type: 'training',
    title: 'Practice',
    startsAt: at + DAY,
  });
  for (const ev of [game, practice])
    await cara.api.put(
      `http://localhost:${process.env.E2E_PORT ?? 8787}/api/v1/teams/${team.teamId}/events/${ev}/rsvps/${cara.memberId}`,
      {
        data: { status: 'yes', note: 'Lift from Sam' },
        headers: { origin: `http://localhost:${process.env.E2E_PORT ?? 8787}` },
      },
    );

  // Default: numbers only.
  await openTeam(pat.page, team.teamId, `/events/${game}`);
  await expect(pat.page.getByText(/1\s*in/)).toBeVisible();
  await expect(pat.page.getByRole('heading', { name: "Who's going" })).toHaveCount(0);

  // The owner turns on names for games.
  await openTeam(page, team.teamId, '/settings/team');
  await page
    .getByRole('radiogroup', { name: 'What players see of replies' })
    .getByRole('radio', { name: 'Names for games' })
    .click();
  await expect(page.getByText("Players see who's going to games")).toBeVisible();

  await expect(async () => {
    await pat.page.reload();
    await expect(pat.page.getByRole('heading', { name: "Who's going" })).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 30_000 });
  const who = pat.page.getByRole('region', { name: "Who's going" });
  await expect(who).toContainText('Cara Centre');
  await expect(pat.page.getByText('Lift from Sam')).toHaveCount(0);
  await axe(pat.page);

  // Not for practices.
  await openTeam(pat.page, team.teamId, `/events/${practice}`);
  await expect(pat.page.getByRole('heading', { name: 'Practice', level: 1 })).toBeVisible();
  await expect(pat.page.getByRole('heading', { name: "Who's going" })).toHaveCount(0);
});

test('edit a whole weekly series from one session, then stop it with an end date', async ({
  page,
  team,
  axe,
}) => {
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const start = Date.now() + 2 * DAY;
  const created = await team.post(`/teams/${team.teamId}/recurrences`, {
    id: uuid(),
    title: 'Practice',
    rule: {
      weekdays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d === new Date(start).getUTCDay()),
      time: '19:00',
      durationMin: 90,
      startsOn: ymd(start),
      until: ymd(start + 7 * 7 * DAY),
    },
  });
  expect(created.count).toBe(8);

  await openTeam(page, team.teamId, `/events/${created.ids[0]}`);
  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit practice' });
  await dialog.getByRole('radio', { name: 'All upcoming' }).click();
  await expect(dialog.getByText('Repeats every week')).toBeVisible();
  await expect(dialog.getByLabel('Date')).toHaveCount(0);
  await axe(page);
  await dialog.getByLabel('Title').fill('Evening practice');
  await dialog.getByLabel('Starts').fill('18:30');
  // Stop after the third week.
  await dialog.getByLabel('Ends on').fill(ymd(start + 2 * 7 * DAY));
  await dialog.getByRole('button', { name: 'Save series' }).click();
  await expect(page.getByText(/Series saved: 3 updated, 5 removed/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Evening practice/, level: 1 })).toBeVisible();

  const sync = await team.post(`/teams/${team.teamId}/sync?since=0`, undefined, 'GET');
  const left = sync.events.filter(
    (e: { recurrenceId: string | null; deletedAt: number | null }) =>
      e.recurrenceId && !e.deletedAt,
  );
  expect(left).toHaveLength(3);
  expect(left.every((e: { title: string }) => e.title === 'Evening practice')).toBe(true);
});

test('phone screens and the new-game form never pan sideways', async ({ page, team, isMobile }) => {
  test.skip(!isMobile, 'Phone layout');
  const wide = () =>
    page.evaluate(() => {
      const root = document.documentElement;
      const dlg = document.querySelector<HTMLElement>('dialog[open] .body');
      return {
        page: root.scrollWidth - root.clientWidth,
        sheet: dlg ? dlg.scrollWidth - dlg.clientWidth : 0,
      };
    });
  for (const path of ['/home', '/schedule', '/squad', '/playbook', '/practice', '/more']) {
    await openTeam(page, team.teamId, path);
    await expect(page.locator('main h1').first()).toBeVisible();
    expect(await wide(), path).toEqual({ page: 0, sheet: 0 });
  }
  for (const kind of ['Game', 'Practice', 'Event']) {
    await openTeam(page, team.teamId, '/schedule?new=1');
    await page
      .getByRole('dialog', { name: 'Add to schedule' })
      .getByRole('button', { name: new RegExp(`^${kind}`) })
      .click();
    await expect(page.locator('dialog[open] form')).toBeVisible();
    expect(await wide(), kind).toEqual({ page: 0, sheet: 0 });
  }
});
