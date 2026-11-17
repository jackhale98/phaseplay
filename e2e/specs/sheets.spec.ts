/**
 * Team sheets (PLAN.md M3): tap-to-pick on a phone, drag and drop plus keyboard on desktop,
 * publish → players see it read-only, conflicts, copy from last match, versions and PNG export.
 */
import { test, expect, openTeam, uuid, type TeamFixture, type Actor } from '../fixtures';
import type { Page } from '@playwright/test';

const DAY = 86400e3;

// A fresh context installs the service worker, which claims the page and reloads it once; that
// would wipe in-page state mid-test, so these specs run without it (offline is covered elsewhere).
test.use({ serviceWorkers: 'block' });
const pad = (n: number) => String(n).padStart(2, '0');

/** n players named "Player 01".. with their matching 15s position (bench players are props/hookers or utility). */
async function squad(team: TeamFixture, n: number): Promise<Actor[]> {
  const pos = (i: number) =>
    i <= 15 ? [i] : [[1], [2], [3], [4, 5], [6, 7], [9], [10, 12], [11, 14]][i - 16]!;
  const actors = await Promise.all(
    Array.from({ length: n }, (_, k) => team.join('player', `Player ${pad(k + 1)}`, pos(k + 1))),
  );
  // Joined players' contexts come from the fixture, so block the worker script there instead.
  await Promise.all(actors.map((a) => a.context.route('**/service-worker.js', (r) => r.abort())));
  return actors;
}

async function match(team: TeamFixture, opts: { startsAt?: number; opponent?: string } = {}) {
  const id = uuid();
  await team.post(`/teams/${team.teamId}/events`, {
    id,
    type: 'match',
    format: '15s',
    title: 'League',
    opponent: opts.opponent ?? 'Harlequins',
    startsAt: opts.startsAt ?? Date.now() + 3 * DAY,
    locationName: 'Riverside Park',
  });
  return id;
}

async function putSheet(
  team: TeamFixture,
  eventId: string,
  slots: Record<string, string>,
  captainId: string | null = null,
) {
  const id = uuid();
  await team.post(
    `/teams/${team.teamId}/sheets/${id}`,
    { eventId, format: '15s', replacements: 8, slots, captainId, viceId: null },
    'PUT',
  );
  return id;
}

const slot = (page: Page, n: number, rest = '') =>
  page.getByRole('button', { name: new RegExp(`^${n}, [^:]+: ${rest}`) });
/** Wait for sheet open animations to finish (axe reads mid-fade colours otherwise). */
const settled = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
const saved = (page: Page) =>
  expect(page.getByText('All changes saved').first()).toBeAttached({ timeout: 10_000 });

test('a coach builds a full 15s sheet on a phone by tap-to-pick, publishes it, and a player sees it', async ({
  page,
  team,
  axe,
}, info) => {
  test.skip(!info.project.name.startsWith('mobile'), 'Tap-to-pick flow is the phone flow');
  test.setTimeout(120_000);
  const players = await squad(team, 23);
  const ev = await match(team);

  await openTeam(page, team.teamId, `/events/${ev}/sheet`);
  await expect(page.getByRole('heading', { level: 1, name: /v Harlequins/ })).toBeVisible();
  await expect(page.getByText('Not started')).toBeVisible();
  await axe(page);

  const started = Date.now();
  await slot(page, 1, 'empty').click();
  const picker = page.getByRole('dialog');
  await expect(picker.getByRole('option').first()).toBeVisible();
  await settled(page);
  await axe(page);
  for (let n = 1; n <= 23; n++) {
    await expect(picker.getByRole('heading', { level: 2 })).toHaveText(new RegExp(`^${n} · `));
    const top = picker.getByRole('option').first();
    await expect(top).toContainText(`Player ${pad(n)}`);
    if (n <= 15) await expect(top).toContainText('Primary');
    await top.click();
  }
  await expect(picker).toBeHidden();
  expect(Date.now() - started).toBeLessThan(120_000);
  await expect(slot(page, 23, 'Player 23')).toBeVisible();

  // Captain from the picker of a filled slot.
  await slot(page, 8, 'Player 08').click();
  await picker.getByRole('button', { name: 'Captain' }).click();
  await picker.getByRole('button', { name: 'Close' }).click();
  await expect(slot(page, 8, 'Player 08, captain')).toBeVisible();
  await saved(page);

  // Nobody has replied, so publishing asks first.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Publish with warnings?' });
  await expect(confirm).toContainText("hasn't replied");
  await confirm.getByRole('button', { name: 'Publish anyway' }).click();
  await expect(page.getByText(/^Published/).first()).toBeVisible();
  await saved(page);

  const p = players[0]!;
  await openTeam(p.page, team.teamId, `/events/${ev}/sheet`);
  await expect(p.page.getByText("You're in at 1, Loosehead prop")).toBeVisible();
  await expect(p.page.getByRole('button', { name: /Publish/ })).toHaveCount(0);
  await expect(p.page.getByRole('button', { name: /^1, Loosehead prop/ })).toHaveCount(0);
  await expect(p.page.getByText('Captain Player 08')).toBeVisible();
  await axe(p.page);

  // The published sheet is on the player's Home.
  await openTeam(p.page, team.teamId, '/home');
  await expect(p.page.getByRole('link', { name: /v Harlequins.*Published/ })).toBeVisible();
});

test('players get a friendly empty state until the sheet is published', async ({ team, axe }) => {
  const [p] = await squad(team, 1);
  const ev = await match(team);
  await putSheet(team, ev, { '1': p!.memberId });
  await openTeam(p!.page, team.teamId, `/events/${ev}/sheet`);
  await expect(p!.page.getByText("The team's not out yet")).toBeVisible();
  await axe(p!.page);
});

test('desktop: drag and drop, swap, keyboard pick and clear, autosave', async ({
  page,
  team,
  axe,
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Drag and drop is the desktop flow');
  test.setTimeout(60_000);
  await squad(team, 6);
  const ev = await match(team);
  await openTeam(page, team.teamId, `/events/${ev}/sheet`);
  const panel = page.getByRole('complementary', { name: 'Squad' });
  await expect(panel).toBeVisible();

  // Drag from the ranked panel onto slot 1, then drag slot 1 onto slot 2 (swap).
  await panel.getByRole('button', { name: /^Player 01:/ }).dragTo(slot(page, 1, 'empty'));
  await expect(slot(page, 1, 'Player 01')).toBeVisible();
  await slot(page, 1, 'Player 01').dragTo(slot(page, 2, 'empty'));
  await expect(slot(page, 2, 'Player 01')).toBeVisible();
  await expect(slot(page, 1, 'empty')).toBeVisible();

  // Keyboard: focus a slot, Enter opens the picker, type, arrows move, Enter assigns.
  await slot(page, 3, 'empty').focus();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog');
  const search = picker.getByRole('combobox', { name: 'Search players' });
  await expect(search).toBeFocused();
  await search.fill('Player 0');
  await expect(picker.getByRole('option').first()).toContainText('Player 03');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  // The picker moves on to the next empty slot; Escape closes it.
  await expect(picker.getByRole('heading', { level: 2 })).toHaveText(/^4 · /);
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(slot(page, 3, 'Player 03')).toBeVisible();

  // Arrow keys move between slots; C makes captain; Delete clears with an undo toast.
  await slot(page, 3, 'Player 03').focus();
  await page.keyboard.press('ArrowRight');
  await expect(slot(page, 4, 'empty')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('c');
  await expect(slot(page, 3, 'Player 03, captain')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(slot(page, 3, 'empty')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(slot(page, 3, 'Player 03')).toBeVisible();

  await page.getByRole('button', { name: /things? to check/ }).click();
  await expect(page.getByText(/starting spots still empty/)).toBeVisible();
  await axe(page);

  await saved(page);
  await page.reload();
  await expect(slot(page, 2, 'Player 01')).toBeVisible();
  await expect(slot(page, 3, 'Player 03, captain')).toBeVisible();
  await expect(page.getByText('Draft · coaches only')).toBeVisible();
});

test("another coach's change wins on conflict", async ({ page, team }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop only');
  const [a, b] = await squad(team, 2);
  const ev = await match(team);
  const sid = await putSheet(team, ev, { '1': a!.memberId });
  await openTeam(page, team.teamId, `/events/${ev}/sheet`);
  await expect(slot(page, 1, 'Player 01')).toBeVisible();
  // Someone else saves (no If-Match: unconditional), then we edit our stale copy.
  await team.post(
    `/teams/${team.teamId}/sheets/${sid}`,
    {
      eventId: ev,
      format: '15s',
      replacements: 8,
      slots: { '2': b!.memberId },
      captainId: null,
      viceId: null,
    },
    'PUT',
  );
  await slot(page, 1, 'Player 01').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByText(/someone else changed this/)).toBeVisible({ timeout: 10_000 });
  await expect(slot(page, 2, 'Player 02')).toBeVisible();
});

test('copy from last match, versions, and PNG export in three sizes', async ({
  page,
  team,
  axe,
}, info) => {
  test.setTimeout(60_000);
  const ps = await squad(team, 3);
  const old = await match(team, { startsAt: Date.now() - 7 * DAY, opponent: 'Saracens' });
  const oldSheet = await putSheet(
    team,
    old,
    { '1': ps[0]!.memberId, '2': ps[1]!.memberId, '16': ps[2]!.memberId },
    ps[1]!.memberId,
  );
  await team.post(`/teams/${team.teamId}/sheets/${oldSheet}/publish`, {});
  const ev = await match(team);

  await openTeam(page, team.teamId, `/events/${ev}/sheet`);
  await page.getByRole('button', { name: 'Copy from last match' }).click();
  await expect(page.getByText(/Copied the team v Saracens/)).toBeVisible();
  await expect(slot(page, 2, 'Player 02, captain')).toBeVisible();
  await expect(page.getByRole('button', { name: /^16, Replacement: Player 03/ })).toBeVisible();

  await page.getByRole('button', { name: 'Export image' }).click();
  const dlg = page.getByRole('dialog', { name: 'Export team sheet' });
  const sizes = { Story: [1080, 1920], Square: [1080, 1080], Landscape: [1920, 1080] } as const;
  for (const [label, [w, h]] of Object.entries(sizes)) {
    await dlg.getByRole('radio', { name: label }).click();
    const img = dlg.locator(`img[data-template="${label.toLowerCase()}"]`);
    await expect(img).toBeVisible();
    await expect
      .poll(() =>
        img.evaluate((el: HTMLImageElement) =>
          el.complete ? [el.naturalWidth, el.naturalHeight] : null,
        ),
      )
      .toEqual([w, h]);
  }
  await settled(page);
  await axe(page);
  if (!info.project.name.startsWith('mobile')) {
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      dlg.getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(dl.suggestedFilename()).toBe('team-sheet-v-harlequins-landscape.png');
    await expect(dlg.getByRole('button', { name: 'Copy image' })).toBeEnabled();
  } else {
    await expect(dlg.getByRole('button', { name: 'Share' })).toBeEnabled();
  }
  await dlg.getByRole('button', { name: 'Close' }).click();

  // Publish, then the version shows up and can be restored.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Publish with warnings?' })
    .getByRole('button', { name: 'Publish anyway' })
    .click();
  await expect(page.getByText(/^Published/).first()).toBeVisible();
  await saved(page);
  await page.getByRole('button', { name: 'Versions' }).click();
  const vs = page.getByRole('dialog', { name: 'Published versions' });
  await expect(vs.getByRole('button', { name: /^Restore/ })).toHaveCount(1);
  await vs.getByRole('button', { name: /^Restore/ }).click();
  await expect(page.getByText(/Restored the version/)).toBeVisible();
});

test('a player-coach: staff switch on "Plays for the team" and can be picked', async ({
  page,
  team,
  axe,
}) => {
  await openTeam(page, team.teamId, `/squad/${team.owner.memberId}`);
  await expect(page.getByRole('heading', { name: 'Playing' })).toBeVisible();
  const plays = page.getByRole('switch', { name: /Plays for the team/ });
  await expect(plays).not.toBeChecked();
  await plays.check();
  // They need a position before saving.
  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: /^Scrum-half/ }).click();
  await axe(page);
  await save.click();
  await expect(save).toBeDisabled(); // saved: nothing left to save
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(plays).toBeChecked();

  // Listed with the coaches and under their position.
  await openTeam(page, team.teamId, '/squad');
  await expect(page.getByRole('link', { name: /Coach Casey/ })).toHaveCount(2);

  // And they can be picked for the scrum-half slot.
  const ev = await match(team);
  await openTeam(page, team.teamId, `/events/${ev}/sheet`);
  await slot(page, 9, 'empty').click();
  const picker = page.getByRole('dialog');
  await expect(picker.getByRole('option').first()).toContainText('Coach Casey');
});
