import type { Page } from '@playwright/test';
import { test, expect, openTeam, uuid, type TeamFixture } from '../fixtures';

const FIRST = [
  'Alex',
  'Ben',
  'Cal',
  'Dan',
  'Eli',
  'Finn',
  'Gus',
  'Hal',
  'Ivo',
  'Jack',
  'Kai',
  'Leo',
  'Max',
  'Ned',
  'Oli',
  'Pat',
  'Rob',
  'Sid',
  'Tom',
  'Uri',
  'Vic',
  'Wes',
  'Zac',
];
const BENCH_POS = [2, 1, 3, 4, 7, 9, 10, 13];

/** A game with 23 players on a team sheet (15 + 8) or a 7s tournament (7 + 5). */
async function setup(team: TeamFixture, kind: 'match' | 'tournament' = 'match') {
  const eventId = uuid();
  const seven = kind === 'tournament';
  const n = seven ? 12 : 23;
  const members = FIRST.slice(0, n).map((f, i) => ({
    id: uuid(),
    displayName: `${f} Test`,
    jersey: i + 1,
    positions: [i < 15 ? i + 1 : BENCH_POS[i - 15]!],
  }));
  await team.post(`/teams/${team.teamId}/import`, {
    events: [
      {
        id: eventId,
        type: kind,
        title: seven ? 'Summer 7s' : 'League',
        startsAt: Date.now() - 30 * 60e3,
        opponent: 'Harlow',
        format: seven ? '7s' : '15s',
      },
    ],
    members,
  });
  await team.post(
    `/teams/${team.teamId}/sheets/${uuid()}`,
    {
      eventId,
      format: seven ? '7s' : '15s',
      replacements: seven ? 5 : 8,
      slots: Object.fromEntries(members.map((m, i) => [String(i + 1), m.id])),
    },
    'PUT',
  );
  return { eventId, members };
}

// The service worker's first claim reloads the page; it isn't what these specs test.
test.use({ serviceWorkers: 'block' });

const timer = (page: Page) => page.getByRole('timer');
/** Freeze the page clock so fast-forwards are exact. */
async function freeze(page: Page) {
  const t = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(t + 1000);
}
const action = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Record' }).getByRole('button', { name, exact: true });

async function openRecorder(page: Page, team: TeamFixture, eventId: string) {
  await openTeam(page, team.teamId, `/events/${eventId}/match`);
  await expect(page.getByRole('heading', { name: /v Harlow/ })).toBeVisible();
  await expect(page.getByText('All synced')).toBeVisible();
}

test('a full match recorded in airplane mode syncs exactly once on reconnect', async ({
  page,
  context,
  team,
}) => {
  const { eventId } = await setup(team);
  const matchPath = `/teams/${team.teamId}/events/${eventId}/match`;
  const delivered: string[] = [];
  page.on('requestfinished', async (req) => {
    if (req.method() !== 'POST' || !req.url().endsWith(matchPath)) return;
    if ((await req.response())?.ok())
      delivered.push(...(req.postDataJSON().events as { id: string }[]).map((e) => e.id));
  });
  await openRecorder(page, team, eventId);

  await context.setOffline(true);
  await expect(page.getByText('Offline. Saved on this device')).toBeVisible();

  await page.getByRole('button', { name: 'Kick off' }).click();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();

  await action(page, 'Score').click();
  await page.getByRole('dialog', { name: 'Score' }).getByRole('button', { name: /^Try/ }).click();
  const who = page.getByRole('dialog', { name: 'Try: who?' });
  await who.getByRole('button', { name: /^Ned Test/ }).click();
  await who.getByRole('button', { name: 'Save try' }).click();
  const conv = page.getByRole('dialog', { name: 'Conversion?' });
  await conv.getByRole('button', { name: /^Jack Test/ }).click();
  await conv.getByRole('button', { name: /^Made/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('TRFC 7, Harlow 0.')).toBeVisible();

  await action(page, 'Card').click();
  await page
    .getByRole('dialog', { name: 'Card' })
    .getByRole('button', { name: 'Yellow card' })
    .click();
  await expect(page.getByText(/Players on the field: 15 v 14/)).toBeVisible();

  await action(page, 'Sub').click();
  const sub = page.getByRole('dialog', { name: 'Substitution' });
  await sub
    .getByRole('group', { name: 'Off' })
    .getByRole('button', { name: /^Alex Test/ })
    .click();
  await sub
    .getByRole('group', { name: 'On' })
    .getByRole('button', { name: /^Pat Test/ })
    .click();
  await sub.getByRole('button', { name: 'Pat on for Alex' }).click();
  await expect(
    page.getByRole('complementary').getByText('Pat Test on for Alex Test', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Half time' }).click();
  await expect(page.getByRole('button', { name: 'Start 2nd half' })).toBeVisible();
  expect(delivered).toEqual([]);

  await context.setOffline(false);
  await expect(page.getByText('All synced')).toBeVisible({ timeout: 15_000 });

  // Local-first: with the server log unreachable, a reload still shows the whole match.
  await page.route(`**${matchPath}`, (r) =>
    r.request().method() === 'GET' ? r.abort() : r.continue(),
  );
  await page.reload();
  await expect(page.getByText('TRFC 7, Harlow 0.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start 2nd half' })).toBeVisible();
  await page.unroute(`**${matchPath}`);

  const viewer = await team.join('coach', 'Second Device');
  const res = await viewer.api.get(`/api/v1${matchPath}`);
  expect(res.ok()).toBeTruthy();
  const { events } = (await res.json()) as {
    events: { id: string; payload: { kind: string; team?: string; type?: string } }[];
  };
  expect(events.map((e) => e.payload.kind)).toEqual([
    'period_start',
    'score',
    'score',
    'card',
    'sub',
    'period_end',
  ]);
  expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  expect([...delivered].sort()).toEqual(events.map((e) => e.id).sort());
  const pts: Record<string, number> = { try: 5, conversion: 2 };
  const us = events
    .filter((e) => e.payload.kind === 'score' && e.payload.team === 'us')
    .reduce((n, e) => n + (pts[e.payload.type!] ?? 0), 0);
  expect(us).toBe(7);

  // The second device sees the same score in the summary.
  await openTeam(viewer.page, team.teamId, `/events/${eventId}/match/summary`);
  await expect(viewer.page.getByRole('region', { name: 'Final score' })).toContainText('7');
});

test('game clock is derived from timestamps (10 minutes fast-forward)', async ({
  page,
  team,
}) => {
  const { eventId } = await setup(team);
  await page.clock.install();
  await openRecorder(page, team, eventId);
  await freeze(page);
  await page.getByRole('button', { name: 'Kick off' }).click();
  await expect(timer(page)).toHaveText('00:00');
  await page.clock.fastForward('10:00');
  await expect(timer(page)).toHaveText('10:00');
  await page.clock.fastForward('30:00');
  await expect(timer(page)).toHaveText('40:00');
  await expect(page.getByText('Real time 40:00')).toBeVisible();
});

test('sin-bin timers pause during time off', async ({ page, team }) => {
  const { eventId } = await setup(team);
  await page.clock.install();
  await openRecorder(page, team, eventId);
  await freeze(page);
  await page.getByRole('button', { name: 'Kick off' }).click();
  await action(page, 'Card').click();
  await page
    .getByRole('dialog', { name: 'Card' })
    .getByRole('button', { name: 'Yellow card' })
    .click();
  const bin = page.getByRole('list', { name: 'Sin bin' });
  await expect(bin).toContainText('10:00');

  await page.clock.fastForward('03:00');
  await expect(bin).toContainText('07:00');
  await action(page, 'Stoppage').click();
  await page
    .getByRole('dialog', { name: 'Time off' })
    .getByRole('button', { name: 'Referee time off' })
    .click();
  await expect(page.getByText('Time off · Referee time off', { exact: true })).toBeVisible();
  await page.clock.fastForward('02:00');
  await expect(page.getByText('Stopped 02:00')).toBeVisible();
  await expect(timer(page)).toHaveText('03:00');
  await expect(bin).toContainText('07:00');

  await action(page, 'Time on').click();
  await page.clock.fastForward('01:00');
  await expect(bin).toContainText('06:00');
  await expect(timer(page)).toHaveText('04:00');

  // Runs out after the rest of the 10 minutes on the game clock, then prompts to return.
  await page.clock.fastForward('06:00');
  const due = page.getByRole('alert').filter({ hasText: 'can come back on' });
  await expect(due).toBeVisible();
  await due.getByRole('button', { name: 'Return player' }).click();
  await expect(page.getByText(/Players on the field: 15 v 15/)).toBeVisible();
});

test('undo last and edit an entry (recorder is accessible)', async ({ page, team, axe }) => {
  const { eventId } = await setup(team);
  // Sheets animate in; measure contrast on the settled UI.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openRecorder(page, team, eventId);
  await axe(page);
  await page.getByRole('button', { name: 'Kick off' }).click();
  await action(page, 'Score').click();
  await page.getByRole('dialog', { name: 'Score' }).getByRole('radio', { name: 'Harlow' }).click();
  await page
    .getByRole('dialog', { name: 'Score' })
    .getByRole('button', { name: /^Penalty goal/ })
    .click();
  await expect(page.getByText('Harlow 3.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo last' }).click();
  await expect(page.getByText('Harlow 0.')).toBeVisible();

  await axe(page);
  await action(page, 'Penalty').click();
  const pen = page.getByRole('dialog', { name: 'Penalty' });
  await expect(pen.getByRole('button', { name: 'Save penalty' })).toBeVisible();
  await axe(page);
  await pen.getByRole('button', { name: 'Offside' }).click();
  await pen.getByRole('button', { name: 'Their 22, middle' }).click();
  await pen.getByRole('button', { name: 'Save penalty' }).click();
  await page.getByRole('button', { name: /^Edit Penalty to Harlow/ }).click();
  const edit = page.getByRole('dialog', { name: /^Edit Penalty/ });
  await edit.getByLabel('Game time').fill('12:30');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Edit Penalty to Harlow at 12:30' })).toBeVisible();
});

test('summary shows the score, chart and minutes, and is accessible', async ({
  page,
  team,
  axe,
}) => {
  const { eventId, members } = await setup(team);
  const t0 = Date.now() - 100 * 60e3;
  let seq = 0;
  const ev = (min: number, payload: object, wall = 0) => ({
    id: uuid(),
    seq: seq++,
    payload,
    gameMs: min * 60e3,
    wallAt: t0 + min * 60e3 + wall,
  });
  await team.post(`/teams/${team.teamId}/events/${eventId}/match`, {
    events: [
      ev(0, { kind: 'period_start', period: 1 }),
      ev(6, { kind: 'score', team: 'us', type: 'try', playerId: members[13]!.id }),
      ev(7, { kind: 'score', team: 'us', type: 'conversion', playerId: members[9]!.id }),
      ev(14, { kind: 'penalty', side: 'against', offence: 'ruck', zone: { x: 0.36, y: 0.5 } }),
      ev(18, { kind: 'score', team: 'them', type: 'penalty_goal' }),
      ev(23, { kind: 'time_off', reason: 'injury' }),
      ev(23, { kind: 'time_on' }, 120e3),
      ev(31, { kind: 'card', team: 'them', colour: 'yellow' }, 120e3),
      ev(40, { kind: 'period_end', period: 1 }, 120e3),
      ev(40, { kind: 'period_start', period: 2 }, 900e3),
      ev(
        52,
        { kind: 'sub', team: 'us', offId: members[0]!.id, onId: members[15]!.id, type: 'tactical' },
        900e3,
      ),
      ev(80, { kind: 'period_end', period: 2 }, 900e3),
    ],
  });
  await openTeam(page, team.teamId, `/events/${eventId}/match/summary`);
  const score = page.getByRole('region', { name: 'Final score' });
  await expect(score).toContainText('7');
  await expect(score).toContainText('Win');
  await expect(page.getByRole('img', { name: /Score progression/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Minutes played' })).toContainText('Alex Test');
  await expect(page.getByRole('region', { name: 'Stoppages' })).toContainText('Injury stoppage');
  await expect(page.getByRole('button', { name: 'Share match report' })).toBeVisible();
  await axe(page);

  // A player can read the summary but is sent away from the recorder.
  const player = await team.join('player', 'Jess Player');
  await openTeam(player.page, team.teamId, `/events/${eventId}/match`);
  await expect(player.page).toHaveURL(/\/match\/summary/);
});

test('tournament day shows each game and minutes across the day', async ({ page, team, axe }) => {
  const { eventId } = await setup(team, 'tournament');
  await openRecorder(page, team, eventId);
  await page.getByRole('button', { name: 'Kick off' }).click();
  await action(page, 'Score').click();
  await page.getByRole('dialog', { name: 'Score' }).getByRole('button', { name: /^Try/ }).click();
  await page
    .getByRole('dialog', { name: 'Try: who?' })
    .getByRole('button', { name: 'Save without a name' })
    .click();
  await page
    .getByRole('dialog', { name: 'Conversion?' })
    .getByRole('button', { name: 'Not yet' })
    .click();
  await page.getByRole('button', { name: 'Half time' }).click();
  await page.getByRole('button', { name: 'Start 2nd half' }).click();
  await page.getByRole('button', { name: 'Full time' }).click();
  await page.getByRole('button', { name: 'Kick off game 2' }).click();
  await expect(page.getByRole('heading', { name: 'Game 2 · 1st half' })).toBeVisible();
  await expect(page.getByText('TRFC 0, Harlow 0.')).toBeVisible();

  await page.getByRole('link', { name: 'Tournament day' }).click();
  await expect(page.getByRole('heading', { name: 'Summer 7s' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Game 1/ })).toContainText('Won');
  await expect(page.getByRole('link', { name: /Game 2/ })).toContainText('Live');
  await expect(page.getByRole('table')).toContainText('Alex Test');
  await axe(page);
});
