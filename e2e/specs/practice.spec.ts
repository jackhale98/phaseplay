import { test, expect, openTeam, uuid, type TeamFixture } from '../fixtures';
import type { Page } from '@playwright/test';

const MIN = 60e3;

// The service worker's first activation reloads the page (controllerchange); offline caching
// isn't under test here, so keep it from reloading mid-test.
test.use({ serviceWorkers: 'block' });

async function training(team: TeamFixture, minutes = 90) {
  const id = uuid();
  const startsAt = Math.ceil((Date.now() + 2 * 86400e3) / (15 * MIN)) * 15 * MIN;
  await team.post(`/teams/${team.teamId}/events`, {
    id,
    type: 'training',
    title: 'Practice',
    startsAt,
    endsAt: startsAt + minutes * MIN,
  });
  return { id, startsAt };
}

async function drillIds(team: TeamFixture): Promise<Record<string, string>> {
  const sync = await team.post(`/teams/${team.teamId}/sync?since=0`, undefined, 'GET');
  return Object.fromEntries(sync.drills.map((d: { title: string; id: string }) => [d.title, d.id]));
}

async function planViaApi(
  team: TeamFixture,
  slots: [string, number][],
  eventId: string | null = null,
) {
  const ids = await drillIds(team);
  const id = uuid();
  await team.post(`/teams/${team.teamId}/plans`, {
    id,
    eventId,
    title: 'Tuesday session',
    data: {
      lanes: ['all'],
      slots: slots.map(([title, min], i) => ({
        id: `s${i}`,
        blocks: [
          title === 'Water'
            ? { id: `b${i}`, kind: 'water', title: 'Water break', durationMin: min, lane: 'all' }
            : { id: `b${i}`, kind: 'drill', drillId: ids[title], durationMin: min, lane: 'all' },
        ],
      })),
    },
  });
  return id;
}

/** Add a drill through the bottom sheet (phone flow). */
async function addDrill(page: Page, title: string, lane?: string) {
  await page.getByRole('button', { name: 'Add drill' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add to the session' });
  if (lane)
    await sheet.getByRole('radiogroup', { name: 'For' }).getByRole('radio', { name: lane }).click();
  await sheet.getByRole('searchbox', { name: 'Search drills' }).fill(title);
  await sheet.getByRole('button', { name: new RegExp(`^${title}`) }).click();
  await expect(sheet).toBeHidden();
}

async function setMinutes(page: Page, title: string, minutes: number) {
  await page.getByRole('button', { name: `Edit ${title}` }).click();
  const sheet = page.getByRole('dialog', { name: title });
  await sheet.getByRole('spinbutton', { name: 'Minutes' }).fill(String(minutes));
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();
}

test('a coach builds a 90-minute split session on a phone', async ({
  page,
  team,
  axe,
  isMobile,
}) => {
  test.skip(!isMobile, 'Phone flow; desktop uses the library side panel (covered below)');
  // A long flow (14 sheet round-trips); CI's WebKit runner needs more than the default 30 s.
  test.setTimeout(90_000);
  const ev = await training(team);
  await openTeam(page, team.teamId, '/practice');
  await page
    .getByRole('link', { name: /Plan \w+'s practice/ })
    .first()
    .click();
  await expect(page.getByRole('combobox', { name: 'Practice' })).toHaveValue(ev.id);
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('textbox', { name: 'Plan title' })).toBeVisible();

  await page
    .getByRole('radiogroup', { name: 'Groups' })
    .getByRole('radio', { name: 'Forwards / Backs' })
    .click();
  await addDrill(page, 'Dynamic warm-up');
  await addDrill(page, 'Channel passing lines');
  await page.getByRole('button', { name: 'Water break', exact: true }).click();
  await addDrill(page, 'Ruck-clearing lanes', 'Forwards');
  await page.getByRole('button', { name: 'Add for Backs' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add for Backs' });
  await sheet.getByRole('searchbox', { name: 'Search drills' }).fill('3 v 2');
  await sheet.getByRole('button', { name: /^3 v 2 overload/ }).click();
  await page.getByRole('button', { name: 'Water break', exact: true }).click();
  await addDrill(page, 'Defensive line speed');
  await addDrill(page, 'Touch rugby game');

  await setMinutes(page, 'Ruck-clearing lanes', 20);
  await setMinutes(page, '3 v 2 overload', 20);
  await setMinutes(page, 'Defensive line speed', 19);
  await setMinutes(page, 'Touch rugby game', 25);

  const totals = page.getByRole('status', { name: 'Session totals' });
  await expect(totals).toContainText('1 h 30 min');
  await expect(totals).toContainText('of 1 h 30 min');
  await expect(totals).not.toContainText('Over by');
  // Ruck lanes (shields) is the only contact; 3 v 2 and ruck lanes are intensity 4.
  await expect(totals).toContainText('Contact 20 min');
  await expect(totals).toContainText('High intensity 20 min');

  // One more minute of warm-up runs over the slot.
  const warm = page.getByRole('group', { name: 'Dynamic warm-up minutes' });
  await warm.getByRole('button', { name: 'More' }).click();
  await expect(totals).toContainText('Over by 1 min');
  await warm.getByRole('button', { name: 'Less' }).click();
  await expect(totals).not.toContainText('Over by');

  const eq = page.getByRole('region', { name: /Equipment/ });
  await expect(eq.getByText('Tackle shields')).toBeVisible();
  await expect(eq.getByRole('listitem').filter({ hasText: 'Bibs' })).toContainText('× 15');
  await expect(eq.getByRole('listitem').filter({ hasText: 'Balls' })).toContainText('× 5');

  // Scroll to the top so the sticky header doesn't overlap targets during the scan.
  await page.evaluate(() => scrollTo(0, 0));
  await axe(page);
  await expect(page.getByText('All changes saved').first()).toBeAttached({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole('status', { name: 'Session totals' })).toContainText('1 h 30 min');
  await expect(page.getByRole('article', { name: '3 v 2 overload' })).toBeVisible();
});

test('desktop planner: library side panel, reorder by keyboard, accessible', async ({
  page,
  team,
  axe,
  isMobile,
}) => {
  test.skip(isMobile, 'Side panel is desktop-only');
  const ev = await training(team, 60);
  const planId = await planViaApi(
    team,
    [
      ['Dynamic warm-up', 10],
      ['Touch rugby game', 15],
    ],
    ev.id,
  );
  await openTeam(page, team.teamId, `/practice/${planId}`);
  const lib = page.getByRole('complementary', { name: 'Drill library' });
  await lib.getByRole('button', { name: /^Triangle passing/ }).click();
  const timeline = page.getByRole('list', { name: 'Session timeline' });
  await expect(timeline.getByRole('article')).toHaveCount(3);
  await expect(timeline.getByRole('article').nth(2)).toHaveAccessibleName('Triangle passing');
  // Keyboard reorder: move it up one.
  await page.getByRole('button', { name: /Reorder Triangle passing/ }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(timeline.getByRole('article').nth(1)).toHaveAccessibleName('Triangle passing');
  await expect(page.getByRole('status', { name: 'Session totals' })).toContainText('33 min');
  await axe(page);
});

test('runner: block 2 is current 16 minutes in, with the right countdown', async ({
  page,
  team,
}) => {
  const ev = await training(team, 60);
  const planId = await planViaApi(
    team,
    [
      ['Dynamic warm-up', 10],
      ['Channel passing lines', 10],
      ['Water', 3],
      ['Touch rugby game', 15],
    ],
    ev.id,
  );
  await page.clock.install();
  await openTeam(page, team.teamId, `/practice/${planId}/run`);
  const start = page.getByRole('button', { name: 'Start session' });
  await expect(start).toBeVisible();
  await page.clock.pauseAt(Date.now() + 60_000);
  await start.click();
  await expect(page.getByTestId('countdown')).toHaveText('10:00');
  await expect(page.locator('.now-title')).toHaveText('Dynamic warm-up');
  await page.clock.fastForward('16:00');
  await expect(page.getByText('Block 2 of 4')).toBeVisible();
  await expect(page.locator('.now-title')).toHaveText('Channel passing lines');
  await expect(page.getByTestId('countdown')).toHaveText('4:00');

  // +2 min shifts the clock; pause freezes it.
  await page.getByRole('button', { name: '+2 min' }).click();
  await expect(page.getByTestId('countdown')).toHaveText('6:00');
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.clock.fastForward('05:00');
  await expect(page.getByTestId('countdown')).toHaveText('6:00');
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.locator('.now-title')).toHaveText('Water break');
});

test('runner is accessible before and during a session', async ({ page, team, axe }) => {
  const planId = await planViaApi(team, [
    ['Dynamic warm-up', 10],
    ['Touch rugby game', 15],
  ]);
  await openTeam(page, team.teamId, `/practice/${planId}/run`);
  await expect(page.getByRole('button', { name: 'Start session' })).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Show diagram' }).click();
  await axe(page);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  // Leaving and coming back resumes from the stored log.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
});

test('assistant coaches follow the live session: both groups, their own countdowns, shared controls', async ({
  page,
  team,
}) => {
  const ids = await drillIds(team);
  const assistant = await team.join('coach', 'Assistant Ash');
  const planId = uuid();
  await team.post(`/teams/${team.teamId}/plans`, {
    id: planId,
    title: 'Split session',
    data: {
      lanes: ['forwards', 'backs'],
      slots: [
        {
          id: 's0',
          blocks: [
            {
              id: 'f0',
              kind: 'drill',
              drillId: ids['Ruck-clearing lanes'],
              durationMin: 20,
              lane: 'forwards',
              coachId: team.owner.memberId,
            },
            {
              id: 'k0',
              kind: 'drill',
              drillId: ids['3 v 2 overload'],
              durationMin: 15,
              lane: 'backs',
              coachId: assistant.memberId,
            },
          ],
        },
        {
          id: 's1',
          blocks: [
            {
              id: 'a1',
              kind: 'drill',
              drillId: ids['Touch rugby game'],
              durationMin: 15,
              lane: 'all',
            },
          ],
        },
      ],
    },
  });

  // Head coach starts the session.
  await openTeam(page, team.teamId, `/practice/${planId}/run`);
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(page.getByText('Block 1 of 2')).toBeVisible();

  // The assistant opens the same live session on their phone and sees both groups.
  await openTeam(assistant.page, team.teamId, `/practice/${planId}/run`);
  await expect(assistant.page.getByText('Block 1 of 2')).toBeVisible({ timeout: 15_000 });
  const lanes = assistant.page.locator('.lanes.split li');
  await expect(lanes).toHaveCount(2);
  await expect(lanes.filter({ hasText: 'Forwards' })).toContainText('Ruck-clearing lanes');
  await expect(lanes.filter({ hasText: 'Backs' })).toContainText('You');
  await expect(lanes.filter({ hasText: 'Backs' })).toContainText(/1[45]:\d\d left/);

  // The assistant moves everyone on; the head coach's screen follows.
  await assistant.page.getByRole('button', { name: /^Next/ }).click();
  await expect(assistant.page.getByText('Block 2 of 2')).toBeVisible();
  await expect(page.getByText('Block 2 of 2')).toBeVisible({ timeout: 15_000 });
});
