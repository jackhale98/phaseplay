/**
 * Shared e2e fixtures. Every test gets its own team created through the API (isolation), plus
 * signed-in pages for each role via the test-only login (works on every browser; Chromium specs
 * can additionally use a CDP virtual authenticator for real passkeys, see auth.spec.ts).
 */
import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
  type BrowserContext,
} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ORIGIN = `http://localhost:${process.env.E2E_PORT ?? 8787}`;
export const uuid = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const t = Date.now();
  for (let i = 5; i >= 0; i--) b[i] = Math.floor(t / 256 ** (5 - i)) % 256;
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export type Actor = {
  userId: string;
  name: string;
  memberId: string;
  context: BrowserContext;
  page: Page;
  api: APIRequestContext;
};
export type TeamFixture = {
  teamId: string;
  name: string;
  owner: Actor;
  /** Create another signed-in member with a role (and optional positions). */
  join: (
    role: 'admin' | 'coach' | 'manager' | 'player',
    name: string,
    positions?: number[],
  ) => Promise<Actor>;
  /** Call the API as the owner. */
  post: (path: string, body: unknown, method?: string) => Promise<any>;
};

async function signIn(context: BrowserContext, userId: string, name: string) {
  const res = await context.request.post(`${ORIGIN}/api/v1/test/login`, {
    data: { userId, displayName: name },
    headers: { origin: ORIGIN },
  });
  expect(res.ok()).toBeTruthy();
}

export const test = base.extend<{ team: TeamFixture; axe: (page: Page) => Promise<void> }>({
  team: async ({ browser, page, context }, use) => {
    const teamId = uuid();
    const name = `Test RFC ${teamId.slice(-5)}`;
    const ownerId = uuid();
    await signIn(context, ownerId, 'Coach Casey');
    const call = async (ctx: BrowserContext, path: string, body: unknown, method = 'POST') => {
      const r = await ctx.request.fetch(`${ORIGIN}/api/v1${path}`, {
        method,
        data: body as object,
        headers: { origin: ORIGIN },
      });
      const text = await r.text();
      if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()} ${text}`);
      return text ? JSON.parse(text) : null;
    };
    await call(context, '/teams', {
      id: teamId,
      name,
      shortName: 'TRFC',
      colors: { primary: '#1f6f43', secondary: '#f2c230' },
      defaultFormat: '15s',
      timezone: 'Europe/London',
    });
    const me = await call(context, '/me', undefined, 'GET');
    const ownerMember = me.memberships.find((m: any) => m.team.id === teamId).member.id;
    // Make the new team the selected one in the app.
    await page.addInitScript(() => localStorage.setItem('pp:session', '1'));
    const owner: Actor = {
      userId: ownerId,
      name: 'Coach Casey',
      memberId: ownerMember,
      context,
      page,
      api: context.request,
    };
    const extra: BrowserContext[] = [];
    const fixture: TeamFixture = {
      teamId,
      name,
      owner,
      post: (path, body, method) => call(context, path.replace(':teamId', teamId), body, method),
      join: async (role, who, positions) => {
        const inv = await call(context, `/teams/${teamId}/invites`, {
          id: uuid(),
          role,
          maxUses: 1,
        });
        const ctx = await browser.newContext(test.info().project.use);
        extra.push(ctx);
        const uid = uuid();
        await signIn(ctx, uid, who);
        const acc = await call(ctx, '/invites/accept', { token: inv.token });
        if (positions?.length)
          await call(ctx, `/teams/${teamId}/members/${acc.memberId}`, { positions }, 'PATCH');
        return {
          userId: uid,
          name: who,
          memberId: acc.memberId,
          context: ctx,
          page: await ctx.newPage(),
          api: ctx.request,
        };
      },
    };
    await use(fixture);
    for (const c of extra) await c.close();
  },
  // eslint-disable-next-line no-empty-pattern
  axe: async ({}, use) => {
    await use(async (page: Page) => {
      const r = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        r.violations.map(
          (v) =>
            `${v.id}: ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(', ')}`,
        ),
      ).toEqual([]);
    });
  },
});

/** Open a path in the app with a team selected. */
export async function openTeam(page: Page, teamId: string, path: string) {
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}team=${teamId}`);
}

export { expect };
