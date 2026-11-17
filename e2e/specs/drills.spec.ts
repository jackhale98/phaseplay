import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, openTeam, uuid, type TeamFixture } from '../fixtures';

/** Wait for the route's view transition so pointer input reaches the editor canvas. */
async function editorReady(page: Page) {
  await expect(page).toHaveURL(/\/drills\/[^/]+\/edit/);
  await expect(page.getByRole('application')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = document.querySelector('.canvas-wrap canvas')!.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.tagName;
      }),
    )
    .toBe('CANVAS');
}

async function makeDrill(team: TeamFixture, title: string, visibility: 'team' | 'coaches') {
  const id = uuid();
  await team.post(`/teams/${team.teamId}/drills`, {
    id,
    title,
    category: 'handling',
    contactLevel: 'none',
    intensity: 2,
    playersMin: 4,
    playersMax: 12,
    area: { w: 20, h: 20 },
    equipment: { balls: 2 },
    defaultDurationMin: 10,
    description: 'Hands, hands, hands',
    coachingPoints: ['Hands up early'],
    setup: 'Four cones',
    variations: [],
    diagram: null,
    visibility,
    parentId: null,
  });
  return id;
}

test.describe('drill library', () => {
  test('browse, filter and open a starter drill', async ({ page, team, axe }) => {
    await openTeam(page, team.teamId, '/playbook?tab=drills');
    await expect(
      page
        .getByRole('radio', { name: 'Drills' })
        .or(page.getByRole('button', { name: 'Drills' }))
        .first(),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /1v1 tackle box/ })).toBeVisible();
    await axe(page);

    await page.getByLabel('Contact').selectOption('full');
    await expect(page.getByRole('link', { name: /1v1 tackle box/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Triangle passing/ })).toHaveCount(0);
    await page.getByLabel('Contact').selectOption('all');
    await page.getByRole('searchbox').fill('triangle');
    await expect(page.getByRole('link', { name: /Triangle passing/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /1v1 tackle box/ })).toHaveCount(0);
    await page.getByRole('searchbox').fill('');
    await page.getByLabel('Players').fill('40');
    await expect(page.getByRole('link', { name: /1v1 tackle box/ })).toHaveCount(0);
    await page.getByLabel('Players').fill('');

    await page.getByRole('link', { name: /1v1 tackle box/ }).click();
    await expect(page.getByRole('heading', { name: '1v1 tackle box' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Coaching points' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Equipment' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add to practice' })).toHaveAttribute(
      'href',
      /\/practice\/new\?drill=/,
    );
    await expect(page.getByRole('img', { name: /1v1 tackle box/ })).toBeVisible();
    await axe(page);
  });

  test('create from a template, edit the diagram and details, then make a variation', async ({
    page,
    team,
    axe,
  }) => {
    test.setTimeout(60_000);
    await openTeam(page, team.teamId, '/playbook?tab=drills');
    await page.getByRole('button', { name: 'New drill' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New drill' });
    await dialog.getByLabel('Name').fill('Box tackle reps');
    await dialog.getByLabel('Tackle box').check();
    await dialog.getByRole('button', { name: 'Create and edit' }).click();
    await editorReady(page);
    const id = page.url().match(/drills\/([^/]+)\/edit/)![1]!;

    // Drill mode: add a line of players in one step.
    await page.getByRole('button', { name: 'Add players' }).click();
    const add = page.getByRole('dialog', { name: 'Add players' });
    await add.getByLabel('How many').fill('4');
    await add.getByRole('button', { name: 'Add 4' }).click();
    await expect(page.locator('[data-token^="pA"]')).toHaveCount(4);
    await axe(page);

    // Details live on the drill row.
    await page.getByRole('button', { name: 'Details' }).click();
    const details = page.getByRole('dialog', { name: 'Drill details' });
    await details.getByLabel('Coaching points').fill('Cheek to cheek\nRing of steel');
    await details.getByLabel('Duration (min)').fill('12');
    await details.getByLabel('Min players').fill('9');
    await details.getByLabel('Max players').fill('6');
    await details.getByRole('button', { name: 'Save details' }).click();
    await expect(details.getByText('Max players must be at least the minimum')).toBeVisible();
    await details.getByLabel('Max players').fill('12');
    await details.getByLabel('Who can see it').selectOption('team');
    await details.getByRole('button', { name: 'Save details' }).click();
    await expect(details).toBeHidden();

    await expect
      .poll(
        async () => {
          const d = (await team.post(`/teams/${team.teamId}/drills/${id}`, undefined, 'GET')).drill;
          return (
            d.coachingPoints.length === 2 &&
            d.defaultDurationMin === 12 &&
            d.diagram?.entities.filter((e: { id: string }) => e.id.startsWith('pA')).length === 4
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    await page.getByRole('button', { name: 'Done editing' }).click();
    await expect(page.getByRole('heading', { name: 'Box tackle reps' })).toBeVisible();
    await expect(page.getByText('Ring of steel', { exact: true })).toBeVisible();
    await expect(page.getByText('12 min')).toBeVisible();

    await page.getByRole('button', { name: 'Duplicate as variation' }).click();
    await editorReady(page);
    await page.getByRole('button', { name: 'Done editing' }).click();
    await expect(page.getByRole('heading', { name: 'Box tackle reps — variation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Box tackle reps' })).toBeVisible();
  });

  test('players see shared drills read-only and not coach-only ones', async ({ team }) => {
    const pat = await team.join('player', 'Pat Prop');
    const shared = await makeDrill(team, 'Shared hands drill', 'team');
    await makeDrill(team, 'Secret coach drill', 'coaches');
    await openTeam(pat.page, team.teamId, '/playbook?tab=drills');
    await expect(pat.page.getByRole('link', { name: /Shared hands drill/ })).toBeVisible();
    await expect(pat.page.getByRole('link', { name: /Secret coach drill/ })).toHaveCount(0);
    await expect(pat.page.getByRole('button', { name: 'New drill' })).toHaveCount(0);
    await openTeam(pat.page, team.teamId, `/drills/${shared}`);
    await expect(pat.page.getByRole('heading', { name: 'Shared hands drill' })).toBeVisible();
    await expect(pat.page.getByText('Hands up early')).toBeVisible();
    await expect(pat.page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await expect(pat.page.getByRole('link', { name: 'Add to practice' })).toHaveCount(0);
  });

  test('exports an A4 drill card', async ({ page, team }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'downloads on desktop');
    await openTeam(page, team.teamId, '/playbook?tab=drills');
    await page.getByRole('link', { name: /1v1 tackle box/ }).click();
    await page.getByRole('button', { name: 'Drill card' }).click();
    const dialog = page.getByRole('dialog', { name: 'Drill card' });
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: /Make card/ }).click(),
    ]);
    const buf = readFileSync((await dl.path())!);
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([2480, 3508]);
  });

  test('archive a drill and hide a template from the New drill picker', async ({
    page,
    team,
    axe,
  }) => {
    await openTeam(page, team.teamId, '/playbook?tab=drills');
    await page.getByRole('link', { name: /Triangle passing/ }).click();
    await page.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();

    await openTeam(page, team.teamId, '/playbook?tab=drills');
    await expect(page.getByRole('link', { name: /Triangle passing/ })).toHaveCount(0);
    await page.getByRole('button', { name: /Archived drills \(1\)/ }).click();
    await expect(page.getByRole('link', { name: /Triangle passing/ })).toBeVisible();
    await axe(page);
    await page.getByRole('link', { name: /Triangle passing/ }).click();
    await page.getByRole('button', { name: 'Restore' }).click();
    await openTeam(page, team.teamId, '/playbook?tab=drills');
    await expect(page.getByRole('link', { name: /Triangle passing/ })).toBeVisible();

    // Hide the tackle box template.
    await page.getByRole('link', { name: 'Templates and presets' }).click();
    await expect(page.getByRole('heading', { name: 'Templates and presets' })).toBeVisible();
    await axe(page);
    await page.getByRole('switch', { name: 'Show Tackle box' }).uncheck();
    await expect(page.getByRole('switch', { name: 'Show Tackle box' })).not.toBeChecked();
    await openTeam(page, team.teamId, '/playbook?tab=drills');
    await page.getByRole('button', { name: 'New drill' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New drill' });
    await expect(dialog.getByLabel('Triangle passing')).toBeVisible();
    await expect(dialog.getByLabel('Tackle box')).toHaveCount(0);
  });
});
