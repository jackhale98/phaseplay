/**
 * Tentative games and events ("Not confirmed yet"): a coach proposes dates, players answer per
 * date, the coach sees counts, front-row cover and the best date, confirms one, and everyone who
 * was in is asked "Still in?". Axe clean in light and dark on every device.
 */
import { test, expect, openTeam, type Actor, type TeamFixture } from '../fixtures';
import type { Page } from '@playwright/test';

const DAY = 86400e3;
const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? 8787}`;

test.beforeEach(async ({ context }) => {
  await context.route('**/service-worker.js', (r) => r.abort());
});

/** The team is on London time; dates are picked as YYYY-MM-DD there (no DST edge at noon). */
const ymd = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(ms);
/** Two Saturdays in next month, so the month view shows both on one page. */
function nextMonthSaturdays() {
  const now = new Date();
  const first = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 12);
  const dow = new Date(first).getUTCDay();
  const sat = first + ((6 - dow + 7) % 7) * DAY;
  return [sat, sat + 7 * DAY];
}
const sat = (ms: number) => `Sat ${new Date(ms).getUTCDate()}`;

async function answerAs(who: Actor, teamId: string, eventId: string, answers: unknown[]) {
  const r = await who.api.put(`${ORIGIN}/api/v1/teams/${teamId}/events/${eventId}/answers`, {
    data: { answers },
    headers: { origin: ORIGIN },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
}
async function optionIds(team: TeamFixture, eventId: string): Promise<string[]> {
  const s = await team.post(`/teams/${team.teamId}/sync?since=0`, undefined, 'GET');
  return (s.options as { id: string; eventId: string; startsAt: number }[])
    .filter((o) => o.eventId === eventId)
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((o) => o.id);
}
const cardIn = (page: Page, name: RegExp) =>
  page.getByRole('article').filter({ has: page.getByRole('heading', { name }) });

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('a date poll: propose, answer, see cover and the best date, confirm, reconfirm', async ({
      page,
      team,
      axe,
    }) => {
      test.setTimeout(90_000);
      const [d1, d2] = nextMonthSaturdays() as [number, number];
      const jess = await team.join('player', 'Jess Hook', [2]);
      const pat = await team.join('player', 'Pat Prop', [1]);
      const tess = await team.join('player', 'Tess Tight', [3]);

      // Coach: a 2-date poll for a game, needing 3 (so the front row is the test).
      await openTeam(page, team.teamId, '/schedule?new=1');
      await page
        .getByRole('dialog', { name: 'Add to schedule' })
        .getByRole('button', { name: /^Game/ })
        .click();
      const dialog = page.getByRole('dialog', { name: 'New game' });
      await dialog.getByLabel('Opponent').fill('Harlequins');
      await dialog.getByRole('radio', { name: 'Not confirmed yet' }).click();
      await expect(dialog.getByText('Repeat every week')).toHaveCount(0);
      await dialog.getByLabel('Date', { exact: true }).fill(ymd(d1));
      await dialog.getByLabel('Kickoff').first().fill('14:30');
      await dialog.getByRole('button', { name: 'Add another date' }).click();
      await dialog.getByLabel('Date 2', { exact: true }).fill(ymd(d2));
      await expect(dialog.getByText(/Answers by .+ · need 20 · checks front row/)).toBeVisible();
      await dialog.getByRole('button', { name: 'Change', exact: true }).click();
      await dialog.getByLabel('Players needed').fill('3');
      await axe(page);
      await dialog.getByRole('button', { name: 'Add date poll' }).click();
      await expect(dialog).toBeHidden();
      const coachCard = cardIn(page, /v Harlequins\?/);
      await expect(coachCard).toContainText('Date poll');
      const href = await coachCard
        .getByRole('link', { name: 'v Harlequins?' })
        .getAttribute('href');
      const eventId = href!.split('/').pop()!;

      // Two teammates answer through the API: Pat works both dates, Tess only the first.
      // The write goes through the outbox: wait until the server has it.
      await expect.poll(async () => (await optionIds(team, eventId)).length).toBe(2);
      const [o1, o2] = (await optionIds(team, eventId)) as [string, string];
      await answerAs(pat, team.teamId, eventId, [
        { optionId: o1, answer: 'in' },
        { optionId: o2, answer: 'in' },
      ]);
      await answerAs(tess, team.teamId, eventId, [
        { optionId: o1, answer: 'in' },
        { optionId: o2, answer: 'cant' },
      ]);

      // Player: the bar jumps to the poll; answering both dates folds the card to one line.
      await openTeam(jess.page, team.teamId, '/schedule');
      const p = jess.page;
      const card = cardIn(p, /v Harlequins\?/);
      await expect(card.getByRole('listitem').filter({ hasText: sat(d1) })).toContainText('2 in');
      await expect(card.getByRole('listitem').filter({ hasText: sat(d2) })).toContainText('1 in');
      await axe(p);
      await p.getByRole('button', { name: /1 needs your answer/ }).click();
      // Focus lands on the first answer button.
      await expect(
        card
          .getByRole('group', { name: new RegExp(sat(d1)) })
          .getByRole('button', { name: 'Works' }),
      ).toBeFocused();
      await card
        .getByRole('group', { name: new RegExp(sat(d1)) })
        .getByRole('button', { name: 'Works' })
        .click();
      await card
        .getByRole('group', { name: new RegExp(sat(d2)) })
        .getByRole('button', { name: 'Works' })
        .click();
      await expect(card).toContainText(`Works: ${sat(d1)}, ${sat(d2)}`);
      await expect(card.getByRole('button', { name: 'Works' })).toHaveCount(0);
      await expect(p.getByRole('button', { name: /needs your answer/ })).toHaveCount(0);
      await axe(p);
      await card.getByRole('button', { name: /^Change/ }).click();
      await expect(card.getByRole('button', { name: 'None work' })).toBeVisible();
      await card.getByRole('button', { name: 'Done' }).click();
      await expect(card).toContainText('Works:');

      // Month view (laptop): a dashed "?" pill on each candidate date.
      if (test.info().project.name.startsWith('desktop')) {
        await openTeam(page, team.teamId, '/schedule?view=month');
        await page.getByRole('button', { name: 'Next month' }).click();
        await expect(page.getByRole('link', { name: /Date poll, possible date/ })).toHaveCount(2);
        await axe(page);
      }

      // Coach: counts, cover and the best date; confirm in one step.
      await openTeam(page, team.teamId, `/events/${eventId}`);
      await expect(page.getByRole('heading', { name: /v Harlequins\?/, level: 1 })).toBeVisible();
      const first = page.getByRole('listitem').filter({ hasText: /3 in of 3 needed/ });
      await expect(first).toContainText('Best date');
      await expect(first).toContainText('Front row ✓ (2 props, 1 hooker)');
      const second = page.getByRole('listitem').filter({ hasText: /2 in of 3 needed/ });
      await expect(second).toContainText('Only 1 prop');
      await axe(page);
      await first.getByRole('button', { name: new RegExp(`Confirm ${sat(d1)}`) }).click();
      await expect(first).toContainText(
        `Confirm ${sat(d1)}? 3 people are in. They'll be marked Yes and asked to reconfirm.`,
      );
      await first.getByRole('button', { name: `Confirm ${sat(d1)}` }).click();
      await expect(page.getByRole('heading', { name: /v Harlequins/, level: 1 })).not.toContainText(
        '?',
      );
      await expect(page.getByRole('heading', { name: 'Are you in?' })).toBeVisible();

      // Player: "Still in?" on Home; the event is a Yes.
      await openTeam(p, team.teamId, '/home');
      await expect(p.getByRole('heading', { name: 'Still in?' })).toBeVisible();
      const still = p.getByRole('article').filter({ hasText: "It's on" });
      await expect(still).toContainText("It's on");
      await axe(p);
      await still.getByRole('button', { name: 'Still in' }).click();
      await expect(p.getByRole('heading', { name: 'Still in?' })).toHaveCount(0);
      await openTeam(p, team.teamId, `/events/${eventId}`);
      await expect(
        p.getByRole('group', { name: 'Are you in?' }).getByRole('button', { name: 'In' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });

    test('a single-date tentative event works the same way', async ({ page, team, axe }) => {
      test.setTimeout(60_000);
      const pip = await team.join('player', 'Pip Player', [10]);
      const friday = Date.now() + 9 * DAY;

      await openTeam(page, team.teamId, '/schedule?new=1');
      await page
        .getByRole('dialog', { name: 'Add to schedule' })
        .getByRole('button', { name: /^Event/ })
        .click();
      const dialog = page.getByRole('dialog', { name: 'New event' });
      await dialog.getByRole('button', { name: 'Social' }).click();
      await dialog.getByLabel('Title', { exact: true }).fill('Curry night');
      await dialog.getByRole('radio', { name: 'Not confirmed yet' }).click();
      await dialog.getByLabel('Date', { exact: true }).fill(ymd(friday));
      await expect(dialog.getByText(/Answers by/)).toBeVisible();
      await dialog.getByRole('button', { name: 'Add as not confirmed' }).click();
      await expect(dialog).toBeHidden();
      await expect(cardIn(page, /Curry night\?/)).toContainText('Tentative');

      // Player answers from Home; the card folds, then leaves the "Can you make it?" spot.
      const p = pip.page;
      await openTeam(p, team.teamId, '/home');
      await expect(p.getByRole('heading', { name: 'Can you make it?' })).toBeVisible();
      const card = cardIn(p, /Curry night\?/);
      await axe(p);
      await card.getByRole('button', { name: "I'm in" }).click();
      await expect(card).toContainText("You're in");
      await expect(p.getByRole('heading', { name: 'Can you make it?' })).toHaveCount(0);
      await openTeam(p, team.teamId, '/schedule');
      await expect(cardIn(p, /Curry night\?/)).toContainText("You're in");

      // Coach confirms; the player is asked to reconfirm and says they can't now.
      await openTeam(page, team.teamId, '/schedule');
      await cardIn(page, /Curry night\?/)
        .getByRole('link', { name: 'Curry night?' })
        .click();
      await expect(page.getByRole('listitem').filter({ hasText: /1 in · 0 can't/ })).toBeVisible();
      await page.getByRole('button', { name: /^Confirm/ }).click();
      await page
        .getByRole('group', { name: /Confirm/ })
        .getByRole('button', { name: /^Confirm/ })
        .click();
      await expect(page.getByRole('heading', { name: 'Curry night', level: 1 })).toBeVisible();

      await openTeam(p, team.teamId, '/home');
      const still = p.getByRole('article').filter({ hasText: "It's on" });
      await expect(still).toContainText('Still in?');
      await still.getByRole('button', { name: "Can't now" }).click();
      await expect(p.getByRole('heading', { name: 'Still in?' })).toHaveCount(0);
    });
  });
}
