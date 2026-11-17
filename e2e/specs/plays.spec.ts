import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, openTeam, uuid, type TeamFixture } from '../fixtures';

type Pt = { x: number; y: number };

/** A small 4-frame lineout move, built by hand so the spec has no workspace imports. */
function lineoutMove(id: string, memberId?: string) {
  const ents = [
    { id: 'a2', kind: 'attack', number: 2 },
    { id: 'a4', kind: 'attack', number: 4, text: 'J' },
    { id: 'a9', kind: 'attack', number: 9 },
    { id: 'a10', kind: 'attack', number: 10, ...(memberId ? { memberId } : {}) },
    { id: 'a12', kind: 'attack', number: 12 },
    { id: 'd10', kind: 'defence', number: 10 },
    { id: 'ball', kind: 'ball' },
  ];
  return {
    v: 1,
    id,
    mode: 'play',
    title: 'Zeus',
    format: '15s',
    view: 'lineout',
    entities: ents,
    frames: [
      {
        id: 'f0',
        durationMs: 0,
        pos: {
          a2: { x: -0.8, y: 40 },
          a4: { x: 7.5, y: 40.5 },
          a9: { x: 10, y: 43 },
          a10: { x: 20, y: 49 },
          a12: { x: 27, y: 51 },
          d10: { x: 20, y: 30 },
          ball: { x: -0.8, y: 40 },
        },
        moves: {},
        ball: { holder: 'a2' },
        caption: 'Set up',
      },
      {
        id: 'f1',
        durationMs: 1500,
        pos: { a4: { x: 7.5, y: 39 } },
        moves: { ball: { kind: 'pass' } },
        ball: { holder: 'a4' },
        caption: 'Throw to 4',
      },
      {
        id: 'f2',
        durationMs: 1500,
        pos: { a9: { x: 9, y: 41 } },
        moves: {},
        ball: { holder: 'a9' },
        caption: 'Off the top to 9',
      },
      {
        id: 'f3',
        durationMs: 2000,
        pos: { a10: { x: 24, y: 42 }, a12: { x: 26, y: 38 } },
        moves: { a12: { kind: 'run', ctrl: [{ x: 30, y: 44 }] } },
        ball: { holder: 'a12' },
        caption: '12 hits the short line',
      },
    ],
  };
}

async function makePlay(team: TeamFixture, visibility: 'team' | 'coaches', memberId?: string) {
  const id = uuid();
  await team.post(`/teams/${team.teamId}/plays`, {
    id,
    title: visibility === 'team' ? 'Zeus' : 'Secret strike',
    category: 'lineout',
    tags: ['front'],
    format: '15s',
    visibility,
    description: null,
    data: { ...lineoutMove(id, memberId), title: visibility === 'team' ? 'Zeus' : 'Secret strike' },
  });
  return id;
}

const getPlay = (team: TeamFixture, id: string) =>
  team.post(`/teams/${team.teamId}/plays/${id}`, undefined, 'GET');

/** Screen point of a token, from the editor's text-alternative token list. */
async function tokenAt(page: Page, id: string): Promise<Pt> {
  const box = (await page.locator('.canvas-wrap canvas').boundingBox())!;
  const b = page.locator(`[data-token="${id}"]`);
  await expect(b).toHaveAttribute('data-x', /\d/);
  return {
    x: box.x + Number(await b.getAttribute('data-x')),
    y: box.y + Number(await b.getAttribute('data-y')),
  };
}

/** Real touch input through CDP (pointerType "touch"), with an optional bend for curved runs. */
async function touchDrag(page: Page, from: Pt, to: Pt, via?: Pt, steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  const at = (t: number) => {
    if (!via) return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    const u = 1 - t;
    return {
      x: u * u * from.x + 2 * u * t * via.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * via.y + t * t * to.y,
    };
  };
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y }],
  });
  for (let i = 1; i <= steps; i++) {
    const p = at(i / steps);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: p.x, y: p.y }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function mouseDrag(page: Page, from: Pt, to: Pt, via?: Pt) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const pts = via ? [via, to] : [to];
  let last = from;
  for (const p of pts) {
    for (let i = 1; i <= 6; i++)
      await page.mouse.move(last.x + ((p.x - last.x) * i) / 6, last.y + ((p.y - last.y) * i) / 6);
    last = p;
  }
  await page.mouse.up();
}

async function newLineoutPlay(page: Page, team: TeamFixture, name: string) {
  await openTeam(page, team.teamId, '/playbook');
  await page.getByRole('button', { name: 'New play' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New play' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('5-player lineout').check();
  await dialog.getByRole('button', { name: 'Create and edit' }).click();
  await expect(page).toHaveURL(/\/plays\/[^/]+\/edit/);
  await expect(page.locator('[data-token="a10"]')).toHaveAttribute('data-x', /\d/);
  // Wait for the route's view transition to finish so pointer input reaches the canvas.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = document.querySelector('.canvas-wrap canvas')!.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.tagName;
      }),
    )
    .toBe('CANVAS');
  return page.url().match(/plays\/([^/]+)\/edit/)![1]!;
}

async function waitForSaved(team: TeamFixture, id: string, check: (p: any) => boolean) {
  let last: unknown = null;
  await expect
    .poll(
      async () => {
        last = (await getPlay(team, id)).play;
        return check(last);
      },
      { timeout: 15_000, message: 'saved play matches' },
    )
    .toBe(true)
    .catch((e) => {
      const p = last as { data: { frames: unknown[] } } | null;
      throw new Error(
        `${(e as Error).message}\nLast saved frames: ${JSON.stringify(p?.data.frames)}`,
      );
    });
}

test.describe('play designer', () => {
  // The service worker's "Update available" toast can sit over the frame strip on phones.
  test.use({ serviceWorkers: 'block' });

  test('builds a 4-frame lineout move with touch on a phone', async ({ page, team, axe }, info) => {
    test.skip(info.project.name !== 'mobile-chromium', 'touch via CDP (Chromium phone)');
    test.setTimeout(90_000);
    const id = await newLineoutPlay(page, team, 'Phone lineout');
    const tool = (n: string) =>
      page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: n, exact: true });

    // Frame 2: the jumper goes up, the hooker throws to 9.
    await page.getByRole('button', { name: 'Add frame' }).click();
    await expect(page.getByRole('button', { name: /^Frame 2/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const a4 = await tokenAt(page, 'a4');
    await touchDrag(page, a4, { x: a4.x, y: a4.y - 30 });
    await tool('Pass').click();
    await page.touchscreen.tap(...(Object.values(await tokenAt(page, 'a9')) as [number, number]));
    await expect(page.locator('[data-token="a9"]')).toContainText('has the ball');

    // Frame 3: 10 runs a curved line and takes the pass.
    await page.getByRole('button', { name: 'Add frame' }).click();
    await tool('Run').click();
    const a10 = await tokenAt(page, 'a10');
    await touchDrag(page, a10, { x: a10.x + 30, y: a10.y - 70 }, { x: a10.x + 45, y: a10.y - 20 });
    await tool('Pass').click();
    await page.touchscreen.tap(...(Object.values(await tokenAt(page, 'a10')) as [number, number]));
    await expect(page.locator('[data-token="a10"]')).toContainText('has the ball');

    // Frame 4: 12 hits the line.
    await page.getByRole('button', { name: 'Add frame' }).click();
    await tool('Select').click();
    const a12 = await tokenAt(page, 'a12');
    await touchDrag(page, a12, { x: a12.x - 10, y: a12.y - 50 });
    await tool('Pass').click();
    await page.touchscreen.tap(...(Object.values(await tokenAt(page, 'a12')) as [number, number]));
    await expect(page.locator('[data-token="a12"]')).toContainText('has the ball');
    await expect(page.getByRole('button', { name: /^Frame 4/ })).toBeVisible();

    await waitForSaved(team, id, (p) => {
      const f = p.data.frames;
      return (
        f.length === 4 &&
        f[1].ball?.holder === 'a9' &&
        f[2].ball?.holder === 'a10' &&
        (f[2].moves.a10?.ctrl?.length ?? 0) > 0 &&
        f[3].ball?.holder === 'a12' &&
        f[3].pos.a12.y < f[0].pos.a12.y
      );
    });
    await axe(page);

    // Preview plays without errors.
    await page.getByRole('button', { name: 'Preview play' }).click();
    await expect(page.getByRole('button', { name: 'Stop preview' })).toBeVisible();
  });

  test('builds a 4-frame lineout move with mouse and keyboard on desktop', async ({
    page,
    team,
  }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'desktop layout');
    test.setTimeout(90_000);
    const id = await newLineoutPlay(page, team, 'Desk lineout');
    const canvasFocus = async () => page.locator('.canvas-wrap canvas').focus();

    await page.keyboard.press('n');
    await expect(page.getByRole('button', { name: /^Frame 2/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const a4 = await tokenAt(page, 'a4');
    await page.mouse.click(a4.x, a4.y);
    // Desktop draws the pitch landscape: screen-right is upfield.
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('p');
    const a9 = await tokenAt(page, 'a9');
    await page.mouse.click(a9.x, a9.y);
    await expect(page.locator('[data-token="a9"]')).toContainText('has the ball');

    await page.keyboard.press('n');
    await page.keyboard.press('r');
    const a10 = await tokenAt(page, 'a10');
    await mouseDrag(page, a10, { x: a10.x + 120, y: a10.y - 40 }, { x: a10.x + 50, y: a10.y - 70 });
    await page.keyboard.press('p');
    const a10b = await tokenAt(page, 'a10');
    await page.mouse.click(a10b.x, a10b.y);

    await page.keyboard.press('n');
    await page.keyboard.press('v');
    const a12 = await tokenAt(page, 'a12');
    await mouseDrag(page, a12, { x: a12.x + 60, y: a12.y });
    await page.keyboard.press('p');
    const a12b = await tokenAt(page, 'a12');
    await page.mouse.click(a12b.x, a12b.y);
    await expect(page.locator('[data-token="a12"]')).toContainText('has the ball');

    // Caption in the properties panel, then undo / redo it.
    await canvasFocus();
    await page.keyboard.press('Escape');
    const caption = page.getByRole('complementary', { name: 'Properties' }).getByLabel('Caption');
    await caption.fill('12 hits the short line');
    await caption.blur();
    await page.locator('.canvas-wrap canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(caption).toHaveValue('');
    await page.keyboard.press('Control+Shift+z');
    await expect(caption).toHaveValue('12 hits the short line');

    // Keyboard access: a token's properties open with Enter.
    await page.locator('[data-token="a13"]').focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('complementary', { name: 'Properties' }).getByLabel('Number'),
    ).toBeFocused();

    // Shortcut sheet.
    await page.locator('.canvas-wrap canvas').focus();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');

    await waitForSaved(team, id, (p) => {
      const f = p.data.frames;
      return (
        f.length === 4 &&
        f[1].ball?.holder === 'a9' &&
        f[1].pos.a4.y < f[0].pos.a4.y - 2 &&
        f[2].ball?.holder === 'a10' &&
        (f[2].moves.a10?.ctrl?.length ?? 0) > 0 &&
        f[3].ball?.holder === 'a12' &&
        f[3].caption === '12 hits the short line'
      );
    });
  });

  test('playback is smooth, readable and error-free', async ({ page, team, axe }) => {
    const id = await makePlay(team, 'team');
    const errors: string[] = [];
    page.on('pageerror', (e) => {
      // The shell's view transition can abort when the mobile viewport settles; unrelated to playback.
      if (!/Transition was aborted/.test(String(e))) errors.push(String(e));
    });
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('response', (r) => {
      if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
    });
    await openTeam(page, team.teamId, `/plays/${id}`);
    await expect(page.getByRole('heading', { name: 'Zeus' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Step by step' })).toBeVisible();
    await expect(page.getByText('Attacker 9 passes to Attacker 12.')).toBeVisible();
    await axe(page);

    await page.evaluate(() => {
      const w = window as unknown as { __long: number[] };
      w.__long = [];
      new PerformanceObserver((l) =>
        w.__long.push(...l.getEntries().map((e) => e.duration)),
      ).observe({ type: 'longtask' });
    });
    const controls = page.getByRole('group', { name: 'Playback' });
    await controls.getByRole('button', { name: 'Loop' }).click();
    await controls.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(controls.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.waitForTimeout(5000);
    const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
    expect(long.filter((d) => d > 50)).toEqual([]);
    await controls.getByRole('button', { name: 'Pause' }).click();
    await controls.getByRole('button', { name: /Speed normal/ }).click();
    await expect(controls.getByRole('button', { name: /Speed half/ })).toBeVisible();
    await controls.getByRole('button', { name: 'Previous frame' }).click();
    expect(errors).toEqual([]);
  });

  test('exports a PNG frame at the right size', async ({ page, team }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'downloads on desktop');
    const id = await makePlay(team, 'team');
    await openTeam(page, team.teamId, `/plays/${id}`);
    await page.getByRole('button', { name: 'Export' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await dialog.getByLabel('Frame', { exact: true }).selectOption({ index: 3 });
    await dialog.getByLabel('Size').selectOption('1920x1080');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: /Download PNG/ }).click(),
    ]);
    const buf = readFileSync((await dl.path())!);
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([3840, 2160]);
    expect(dl.suggestedFilename()).toMatch(/zeus-frame-4\.png/);
  });

  test('exports a video (MP4 via WebCodecs in a worker where available)', async ({
    page,
    team,
  }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'downloads on desktop');
    test.setTimeout(60_000);
    const id = await makePlay(team, 'team');
    await openTeam(page, team.teamId, `/plays/${id}`);
    await page.getByRole('button', { name: 'Export' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await dialog.getByRole('radio', { name: 'Video' }).click();
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 45_000 }),
      dialog.getByRole('button', { name: /Download video/ }).click(),
    ]);
    expect(dl.suggestedFilename()).toMatch(/^zeus\.(mp4|webm|gif)$/);
    expect(readFileSync((await dl.path())!).length).toBeGreaterThan(1000);
  });

  test('view tracking shows the player in Seen by, and highlights her token', async ({
    page,
    team,
  }) => {
    const pat = await team.join('player', 'Pat Prop', [1]);
    const id = await makePlay(team, 'team', pat.memberId);
    await openTeam(pat.page, team.teamId, `/plays/${id}`);
    await expect(pat.page.getByRole('heading', { name: 'Zeus' })).toBeVisible();
    await expect(pat.page.getByRole('button', { name: 'Highlight me' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(pat.page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await team.post(`/teams/${team.teamId}/plays/${id}/seen`, undefined, 'GET')).seen.length,
        { timeout: 10_000 },
      )
      .toBe(1);

    await openTeam(page, team.teamId, `/plays/${id}`);
    const seen = page.getByRole('region', { name: /Seen by/ });
    await expect(seen.getByRole('heading', { name: 'Seen by 1/1' })).toBeVisible();
    await expect(seen.getByText('Pat Prop')).toBeVisible();
    await expect(seen.getByText('The whole squad has seen it.')).toBeVisible();
  });

  test('coach-only plays are hidden from players; coaches can share them', async ({
    page,
    team,
    axe,
  }) => {
    const pat = await team.join('player', 'Pat Prop');
    const secret = await makePlay(team, 'coaches');
    const shared = await makePlay(team, 'team');

    await openTeam(pat.page, team.teamId, '/playbook');
    await expect(pat.page.getByRole('link', { name: /Zeus/ })).toBeVisible();
    await expect(pat.page.getByRole('link', { name: /Secret strike/ })).toHaveCount(0);
    await expect(pat.page.getByRole('button', { name: 'New play' })).toHaveCount(0);
    await openTeam(pat.page, team.teamId, `/plays/${secret}`);
    await expect(pat.page.getByRole('heading', { name: 'Play not found' })).toBeVisible();

    await openTeam(page, team.teamId, '/playbook');
    await expect(page.getByRole('link', { name: /Secret strike/ })).toContainText('Coaches only');
    await expect(page.getByRole('link', { name: /Zeus/ })).toContainText(/Seen by \d\/1/);
    await axe(page);
    await page.getByRole('searchbox').fill('#front');
    await expect(page.getByRole('link', { name: /Zeus/ })).toBeVisible();
    await page.getByRole('searchbox').fill('nothing like this');
    await expect(page.getByText('No plays match')).toBeVisible();

    await openTeam(page, team.teamId, `/plays/${secret}`);
    await page.getByRole('button', { name: 'Share with team' }).click();
    await expect(
      page.getByRole('main').getByText('Shared with the team', { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await getPlay(team, secret)).play.visibility, { timeout: 10_000 })
      .toBe('team');
    expect(shared).toBeTruthy();
  });

  test("remove one player's move in a frame without deleting the player", async ({
    page,
    team,
    axe,
    isMobile,
  }) => {
    const id = await makePlay(team, 'team');
    await openTeam(page, team.teamId, `/plays/${id}/edit`);
    await expect(page.locator('[data-token="a12"]')).toHaveAttribute('data-x', /\d/);
    await page.getByRole('button', { name: /^Frame 4/ }).click();
    await page.locator('[data-token="a12"]').focus();
    await page.keyboard.press('Enter');
    const scope = isMobile
      ? page.getByRole('dialog', { name: /12/ })
      : page.getByRole('complementary', { name: 'Properties' });
    await expect(scope.getByRole('button', { name: 'Delete player' })).toBeVisible();
    await axe(page);
    await scope.getByRole('button', { name: 'Remove this move' }).click();
    await expect(page.locator('[data-token="a12"]')).toBeVisible();

    if (!isMobile) {
      // Keyboard: Shift+Delete removes the selection's move, Delete would remove the player.
      await page.locator('[data-token="a10"]').focus();
      await page.keyboard.press('Shift+Delete');
      await expect(page.locator('[data-token="a10"]')).toBeVisible();
    }

    await waitForSaved(team, id, (p) => {
      const f3 = p.data.frames[3];
      const ok12 = !f3.moves.a12 && f3.pos.a12.x === 27 && f3.pos.a12.y === 51;
      const ok10 = isMobile || (f3.pos.a10.x === 20 && f3.pos.a10.y === 49);
      return ok12 && ok10 && p.data.entities.length === 7;
    });
  });

  test('duplicate and delete with undo', async ({ page, team }) => {
    const id = await makePlay(team, 'team');
    await openTeam(page, team.teamId, `/plays/${id}`);
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/playbook/);
    await expect(page.getByRole('link', { name: /Zeus/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('link', { name: /Zeus/ })).toBeVisible();

    await page.getByRole('link', { name: /Zeus/ }).click();
    await page.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page).toHaveURL(/\/plays\/[^/]+\/edit/);
    await expect(page.getByRole('button', { name: /Zeus \(copy\)/ })).toBeVisible();
  });
});
