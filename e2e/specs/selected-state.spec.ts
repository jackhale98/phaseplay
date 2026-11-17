import type { Locator, Page } from '@playwright/test';
import { test, expect, openTeam, uuid, type TeamFixture } from '../fixtures';

/**
 * The selected tab, nav item and designer tool must be obvious in both themes (docs/design.md
 * §Accessibility): a solid fill differing from the surface around it by >= 3:1, with >= 4.5:1
 * text or icon on it.
 */

/** Resolve CSS colours (any syntax, any alpha) to opaque sRGB and return their contrast ratio. */
async function ratio(page: Page, fg: string, bg: string, under = 'var(--surface)') {
  return page.evaluate(
    ([fg, bg, under]) => {
      const probe = document.createElement('div');
      document.body.append(probe);
      const css = (v: string) => {
        probe.style.color = v;
        return getComputedStyle(probe).color;
      };
      const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
      const px = (...layers: string[]) => {
        c.clearRect(0, 0, 1, 1);
        for (const l of layers) {
          c.fillStyle = css(l);
          c.fillRect(0, 0, 1, 1);
        }
        return [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const lum = (rgb: number[]) => {
        const [r, g, b] = rgb.map((v) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const B = px(under, bg);
      const F = px(under, bg, fg);
      probe.remove();
      const [a, b] = [lum(F), lum(B)].sort((x, y) => y - x);
      return (a! + 0.05) / (b! + 0.05);
    },
    [fg, bg, under],
  );
}

const style = (l: Locator, prop: string, pseudo?: string) =>
  l.evaluate((el, [prop, pseudo]) => getComputedStyle(el, pseudo || null).getPropertyValue(prop!), [
    prop,
    pseudo,
  ] as const);

async function expectSelected(
  page: Page,
  on: Locator,
  around: string,
  opts: { pseudo?: string; fgOf?: Locator } = {},
) {
  // Polled: the fill transitions in (120 ms) after a click or theme switch.
  const bg = () => style(on, 'background-color', opts.pseudo);
  await expect
    .poll(async () => ratio(page, await bg(), around), { message: 'selected fill vs surroundings' })
    .toBeGreaterThanOrEqual(3);
  await expect
    .poll(async () => ratio(page, await style(opts.fgOf ?? on, 'color'), await bg()), {
      message: 'text/icon on the selected fill',
    })
    .toBeGreaterThanOrEqual(4.5);
}

async function makePlay(team: TeamFixture) {
  const id = uuid();
  await team.post(`/teams/${team.teamId}/plays`, {
    id,
    title: 'Zeus',
    category: 'lineout',
    tags: [],
    format: '15s',
    visibility: 'team',
    description: null,
    data: {
      v: 1,
      id,
      mode: 'play',
      title: 'Zeus',
      format: '15s',
      view: 'lineout',
      entities: [{ id: 'a2', kind: 'attack', number: 2 }],
      frames: [{ id: 'f0', durationMs: 0, pos: { a2: { x: -0.8, y: 40 } }, moves: {} }],
    },
  });
  return id;
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('selected tab, nav item and segment are unmistakable', async ({
      page,
      team,
      axe,
      isMobile,
    }) => {
      await openTeam(page, team.teamId, '/playbook');
      const plays = page.getByRole('radio', { name: 'Plays' });
      await expect(plays).toHaveAttribute('aria-checked', 'true');
      const track = await style(plays.locator('..'), 'background-color');
      await expectSelected(page, plays, track);
      // Unselected segments stay readable on the track.
      const drills = page.getByRole('radio', { name: 'Drills' });
      expect(await ratio(page, await style(drills, 'color'), track)).toBeGreaterThanOrEqual(4.5);

      const current = isMobile
        ? page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]')
        : page.locator('aside nav a[aria-current="page"]');
      await expect(current).toHaveText('Playbook');
      if (isMobile)
        await expectSelected(page, current, 'var(--surface)', {
          pseudo: '::before',
          fgOf: current.locator('svg'),
        });
      else await expectSelected(page, current, 'var(--surface)');
      await axe(page);
    });

    test('the active designer tool and toggles are unmistakable', async ({ page, team, axe }) => {
      const id = await makePlay(team);
      await openTeam(page, team.teamId, `/plays/${id}/edit`);
      await expect(page.locator('[data-token="a2"]')).toHaveAttribute('data-x', /\d/);
      const run = page.getByRole('navigation', { name: 'Tools' }).getByRole('button', {
        name: 'Run',
      });
      await run.click();
      await expect(run).toHaveAttribute('aria-pressed', 'true');
      await expectSelected(page, run, 'var(--surface)');
      const snap = page.getByRole('button', { name: /^Snap to/ });
      await expect(snap).toHaveAttribute('aria-pressed', 'true');
      await expectSelected(page, snap, 'var(--surface)');
      await axe(page);
    });

    test('chosen positions are unmistakable, and the primary stands out', async ({
      page,
      team,
      axe,
    }) => {
      const pat = await team.join('player', 'Pat Prop', [2, 9]);
      await openTeam(page, team.teamId, `/squad/${pat.memberId}`);
      const picker = page.getByRole('group', { name: /^Positions/ });
      const hooker = picker.getByRole('button', { name: 'Hooker, primary' });
      const scrum = picker.getByRole('button', { name: 'Scrum-half' });
      const fly = picker.getByRole('button', { name: 'Fly-half' });
      await expect(hooker).toHaveAttribute('aria-pressed', 'true');
      await expect(scrum).toHaveAttribute('aria-pressed', 'true');
      await expect(fly).toHaveAttribute('aria-pressed', 'false');
      await expectSelected(page, hooker, 'var(--surface)');
      await expectSelected(page, scrum, 'var(--surface)');
      // A shape cue as well as the fill: a star on the primary, a check on the others.
      await expect(hooker.locator('.mark svg')).toHaveCount(1);
      await expect(scrum.locator('.mark svg')).toHaveCount(1);
      await expect(fly.locator('.mark')).toHaveCount(0);
      await fly.click();
      await expect(fly).toHaveAttribute('aria-pressed', 'true');
      await expectSelected(page, fly, 'var(--surface)');
      await axe(page);
    });

    test('switching theme in the app re-derives the selected fill', async ({ page, team }) => {
      const other = scheme === 'light' ? 'Dark' : 'Light';
      await openTeam(page, team.teamId, '/more');
      await page.getByRole('radio', { name: other }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', other.toLowerCase());
      const on = page.getByRole('radio', { name: other });
      await expectSelected(page, on, await style(on.locator('..'), 'background-color'));
    });
  });
}
