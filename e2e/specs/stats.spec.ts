/**
 * Season stats (PLAN.md M7): coaches see everyone's attendance and minutes, players see team
 * totals plus only their own line; season picker; axe clean in light and dark on every device.
 */
import { test, expect, openTeam, uuid, type Actor, type TeamFixture } from '../fixtures';

const DAY = 86400e3;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A season with one practice (register taken, plan attached) and one recorded, won game. */
async function seed(team: TeamFixture, player: Actor) {
  const t = team.teamId;
  const now = Date.now();
  const season = (name: string, from: number, to: number) => {
    const id = uuid();
    return team.post(
      `/teams/${t}/seasons/${id}`,
      { id, name, startsOn: iso(from), endsOn: iso(to) },
      'PUT',
    );
  };
  await season('This season', now - 60 * DAY, now + 60 * DAY);
  await season('Last season', now - 400 * DAY, now - 200 * DAY);
  // 14 more names, so the sheet has a full XV with our player at 9.
  const others: string[] = [];
  for (let i = 0; i < 14; i++) {
    const id = uuid();
    others.push(id);
    await team.post(`/teams/${t}/members`, {
      id,
      displayName: i === 0 ? 'Rhian Lewis' : `Squad ${String.fromCharCode(65 + i)}`,
      positions: [i + 1 < 9 ? i + 1 : i + 2],
    });
  }
  const practice = uuid();
  const game = uuid();
  await team.post(`/teams/${t}/events`, {
    id: practice,
    type: 'training',
    title: 'Practice',
    startsAt: now - 3 * DAY,
  });
  await team.post(`/teams/${t}/events`, {
    id: game,
    type: 'match',
    title: 'League',
    format: '15s',
    opponent: 'Harlow',
    startsAt: now - 2 * DAY,
  });
  await team.post(
    `/teams/${t}/events/${practice}/attendance`,
    {
      entries: [
        { memberId: player.memberId, attended: true },
        { memberId: others[0], attended: false },
        ...others.slice(1).map((memberId) => ({ memberId, attended: true })),
      ],
    },
    'PUT',
  );
  const sync = await team.post(`/teams/${t}/sync?since=0`, undefined, 'GET');
  const contact = sync.drills.find((d: { contactLevel: string }) => d.contactLevel === 'full');
  await team.post(`/teams/${t}/plans`, {
    id: uuid(),
    eventId: practice,
    title: 'Contact night',
    data: {
      lanes: ['all'],
      slots: [
        {
          id: 's1',
          blocks: [{ id: 'b1', kind: 'drill', drillId: contact.id, durationMin: 20, lane: 'all' }],
        },
      ],
    },
  });
  const xv = [...others.slice(0, 8), player.memberId, ...others.slice(8)];
  const sheetId = uuid();
  await team.post(
    `/teams/${t}/sheets/${sheetId}`,
    {
      eventId: game,
      format: '15s',
      replacements: 8,
      slots: Object.fromEntries(xv.map((id, i) => [String(i + 1), id])),
    },
    'PUT',
  );
  await team.post(`/teams/${t}/sheets/${sheetId}/publish`, {});
  const ko = now - 2 * DAY;
  const at = (min: number, payload: object, seq: number) => ({
    id: uuid(),
    seq,
    payload,
    gameMs: min * 60e3,
    wallAt: ko + min * 60e3,
  });
  await team.post(`/teams/${t}/events/${game}/match`, {
    events: [
      at(0, { kind: 'period_start', period: 1 }, 0),
      at(10, { kind: 'score', team: 'us', type: 'try', playerId: player.memberId }, 1),
      at(11, { kind: 'score', team: 'us', type: 'conversion', playerId: others[9] }, 2),
      at(20, { kind: 'penalty', side: 'against', offence: 'offside' }, 3),
      at(30, { kind: 'score', team: 'them', type: 'penalty_goal' }, 4),
      at(40, { kind: 'period_end', period: 1 }, 5),
    ],
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('a coach sees the whole squad; the season picker switches the window', async ({
      page,
      team,
      axe,
    }) => {
      const player = await team.join('player', 'Pia Player', [9]);
      await seed(team, player);
      await openTeam(page, team.teamId, '/stats');
      await expect(page.getByRole('heading', { name: 'Season stats', level: 1 })).toBeVisible();
      await expect(page.getByText('Up to date')).toBeVisible();
      await expect(page.getByLabel('Season', { exact: true })).toHaveValue(/.+/);
      const glance = page.getByRole('list', { name: 'Season at a glance' });
      await expect(glance).toContainText('1–0–0');
      await expect(glance).toContainText('7–3');

      const att = page.getByRole('region', { name: 'Attendance' });
      await expect(att.getByRole('row', { name: /Pia Player/ })).toContainText('100%');
      // Long lists start at 12; the 0% line is below the fold until "Show all".
      await expect(att.getByRole('row', { name: /Rhian Lewis/ })).toBeHidden();
      await att.getByRole('button', { name: 'Show all 15 players' }).click();
      await expect(att.getByRole('row', { name: /Rhian Lewis/ })).toContainText('0%');
      const minutes = page.getByRole('region', { name: 'Minutes played' });
      await minutes.getByRole('button', { name: 'Show all 15 players' }).click();
      await expect(minutes).toContainText('Pia Player');
      await expect(minutes).toContainText("40'");
      const scoring = page.getByRole('region', { name: 'Scoring and cards' });
      await expect(scoring.getByRole('row', { name: /Pia Player/ })).toContainText('5');
      await expect(page.getByRole('region', { name: 'Penalties conceded' })).toContainText(
        'Offside',
      );
      const load = page.getByRole('region', { name: 'Training load' });
      await load.getByText('Show as a table').click();
      await expect(load.getByRole('table')).toContainText("20'");
      await axe(page);

      await page.getByLabel('Season', { exact: true }).selectOption({ label: 'Last season' });
      await expect(page.getByRole('heading', { name: 'Nothing played yet' })).toBeVisible();
      await page.getByLabel('Season', { exact: true }).selectOption({ label: 'All time' });
      await expect(glance).toContainText('1–0–0');
    });

    test('a player sees team totals and only their own attendance and minutes', async ({
      team,
      axe,
    }) => {
      const player = await team.join('player', 'Pia Player', [9]);
      await seed(team, player);
      const page = player.page;
      await openTeam(page, team.teamId, '/stats');
      await expect(page.getByText('Up to date')).toBeVisible();
      const glance = page.getByRole('list', { name: 'Season at a glance' });
      await expect(glance).toContainText('1–0–0');
      await expect(glance).toContainText('Your attendance');
      await expect(glance).toContainText('100%');

      const att = page.getByRole('region', { name: 'Attendance' });
      // Team turnout comes from the server: 14 of 15 were there.
      await expect(att).toContainText('14 there on average');
      await expect(att.getByRole('row', { name: /Pia Player/ })).toBeVisible();
      await expect(att).not.toContainText('Rhian Lewis');
      const minutes = page.getByRole('region', { name: 'Minutes played' });
      await expect(minutes).toContainText("40'");
      await expect(minutes).toContainText('for you');
      await expect(minutes).not.toContainText('Squad');
      // Scoring is for everyone.
      await expect(page.getByRole('region', { name: 'Scoring and cards' })).toContainText(
        'Pia Player',
      );
      await axe(page);
    });
  });
}

test('Stats is in the sidebar (key 7) on desktop and under More on phones', async ({
  page,
  team,
  isMobile,
}) => {
  await openTeam(page, team.teamId, '/home');
  if (isMobile) {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'More' })
      .click();
    await page.getByRole('link', { name: 'Season stats' }).click();
  } else {
    await expect(page.locator('aside nav').getByRole('link', { name: 'Stats' })).toBeVisible();
    await page.keyboard.press('7');
  }
  await expect(page).toHaveURL(/\/stats/);
  await expect(page.getByRole('heading', { name: 'Nothing played yet' })).toBeVisible();
});
