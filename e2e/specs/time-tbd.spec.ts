/**
 * "Time TBD": a social with its date set and its time still to be decided shows "Time TBD" on the
 * agenda, the event page and Home (and "TBD" in the month view, on the right day); setting the
 * time later shows it. A proposed game date can be TBD and stays TBD when confirmed. Axe clean in
 * light and dark on every device.
 */
import { test, expect, openTeam } from '../fixtures';
import type { Page } from '@playwright/test';

const DAY = 86400e3;

test.beforeEach(async ({ context }) => {
  await context.route('**/service-worker.js', (r) => r.abort());
});

/** The fixture team is on London time; dates are typed as YYYY-MM-DD there. */
const ymd = (ms: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(ms);
/** The month view's hidden day name for a date ("Saturday, November 22" in en-US). */
const longDay = (date: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(Date.parse(`${date}T12:00:00Z`));
const cardIn = (page: Page, name: RegExp) =>
  page.getByRole('article').filter({ has: page.getByRole('heading', { name }) });

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('a social with Time TBD, then its time is set', async ({ page, team, axe }) => {
      test.setTimeout(60_000);
      const date = ymd(Date.now() + 3 * DAY);

      await openTeam(page, team.teamId, '/schedule?new=1');
      await page
        .getByRole('dialog', { name: 'Add to schedule' })
        .getByRole('button', { name: /^Event/ })
        .click();
      const dialog = page.getByRole('dialog', { name: 'New event' });
      await dialog.getByRole('button', { name: 'Social' }).click();
      await dialog.getByLabel('Title', { exact: true }).fill('Quiz night');
      await dialog.getByLabel('Date', { exact: true }).fill(date);
      const tbd = dialog.getByRole('checkbox', { name: /Time TBD/ });
      await tbd.check();
      // One control: the time, meet and finish fields go; so does the weekly repeat.
      await expect(tbd).toBeFocused();
      await expect(dialog.getByLabel('Starts')).toHaveCount(0);
      await expect(dialog.getByLabel('Meet (optional)')).toHaveCount(0);
      await expect(dialog.getByLabel('Finish (optional)')).toHaveCount(0);
      await expect(dialog.getByText('Repeat every week')).toHaveCount(0);
      await axe(page);
      await dialog.getByRole('button', { name: 'Add to schedule' }).click();
      await expect(dialog).toBeHidden();

      // Agenda.
      const link = page.getByRole('link', { name: /Social: Quiz night, .+, time TBD/ });
      await expect(link).toBeVisible();
      await expect(cardIn(page, /Quiz night/)).toContainText('Time TBD');
      await axe(page);

      // Month view on a laptop: "TBD" on the right day.
      if (test.info().project.name.startsWith('desktop')) {
        await openTeam(page, team.teamId, '/schedule?view=month');
        if (date.slice(0, 7) !== ymd(Date.now()).slice(0, 7))
          await page.getByRole('button', { name: 'Next month' }).click();
        const cell = page.getByRole('cell').filter({ hasText: longDay(date) });
        await expect(cell.getByRole('link', { name: /Quiz night/ })).toContainText('TBD');
        await axe(page);
      }

      // Home: the hero says Time TBD too.
      await openTeam(page, team.teamId, '/home');
      await expect(cardIn(page, /Quiz night/)).toContainText('Time TBD');
      await axe(page);

      // The event page, then set the time.
      await openTeam(page, team.teamId, '/schedule');
      await page.getByRole('link', { name: /Social: Quiz night/ }).click();
      await expect(page.getByRole('heading', { name: 'Quiz night', level: 1 })).toBeVisible();
      const hero = page.locator('header.hero');
      await expect(hero).toContainText('Time TBD');
      await axe(page);
      await hero.getByRole('button', { name: 'Set time' }).click();
      const edit = page.getByRole('dialog', { name: 'Edit social' });
      const box = edit.getByRole('checkbox', { name: /Time TBD/ });
      await expect(box).toBeChecked();
      await box.uncheck();
      await expect(box).toBeFocused();
      // No usual time for socials yet: the time is empty and required.
      await expect(edit.getByLabel('Starts')).toHaveValue('');
      await edit.getByRole('button', { name: 'Save changes' }).click();
      await expect(edit.getByText('Pick a start time')).toBeVisible();
      await edit.getByLabel('Starts').fill('19:30');
      await edit.getByRole('button', { name: 'Save changes' }).click();
      await expect(edit).toBeHidden();
      await expect(hero).toContainText('7:30');
      await expect(hero).not.toContainText('Time TBD');
      // Setting the time isn't a move: no "moved" banner.
      await expect(page.getByText(/^Moved to/)).toHaveCount(0);
    });

    test('a proposed game date with Time TBD, confirmed without a time', async ({
      page,
      team,
      axe,
    }) => {
      test.setTimeout(60_000);
      const d1 = Date.now() + 10 * DAY;
      await openTeam(page, team.teamId, '/schedule?new=1');
      await page
        .getByRole('dialog', { name: 'Add to schedule' })
        .getByRole('button', { name: /^Game/ })
        .click();
      const dialog = page.getByRole('dialog', { name: 'New game' });
      await dialog.getByLabel('Opponent').fill('Harlequins');
      await dialog.getByRole('radio', { name: 'Not confirmed yet' }).click();
      await dialog.getByLabel('Date', { exact: true }).fill(ymd(d1));
      await dialog.getByRole('checkbox', { name: /^Time TBD/ }).check();
      await expect(dialog.getByLabel('Kickoff', { exact: true })).toHaveCount(0);
      // A second date with a time.
      await dialog.getByRole('button', { name: 'Add another date' }).click();
      await dialog.getByLabel('Date 2', { exact: true }).fill(ymd(d1 + 7 * DAY));
      const row2 = dialog.getByRole('checkbox', { name: 'Time TBD for date 2' });
      await expect(row2).toBeChecked();
      await row2.uncheck();
      await dialog.getByLabel('Kickoff', { exact: true }).fill('14:30');
      await axe(page);
      await dialog.getByRole('button', { name: 'Add date poll' }).click();
      await expect(dialog).toBeHidden();
      const card = cardIn(page, /v Harlequins\?/);
      await expect(card).toContainText('Time TBD');
      await expect(card).toContainText('2:30');

      await card.getByRole('link', { name: 'v Harlequins?' }).click();
      const first = page
        .getByRole('listitem')
        .filter({ hasText: /Time TBD/ })
        .last();
      await expect(first).toBeVisible();
      await axe(page);
      await first.getByRole('button', { name: /^Confirm/ }).click();
      // The confirm step offers a time but doesn't need one.
      await expect(first.getByLabel('Kickoff time (optional)')).toHaveValue('');
      await expect(first.getByLabel('Meet time (optional)')).toHaveCount(0);
      await first
        .getByRole('group', { name: /Confirm/ })
        .getByRole('button', { name: /^Confirm/ })
        .click();
      const h1 = page.getByRole('heading', { name: /v Harlequins/, level: 1 });
      await expect(h1).not.toContainText('?');
      await expect(page.locator('header.hero')).toContainText('Time TBD');
      // Back to the top: scrolled, the reply buttons sit under the sticky header (axe overlap).
      await page.evaluate(() => window.scrollTo(0, 0));
      await axe(page);
    });
  });
}
