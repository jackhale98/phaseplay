/**
 * Configurable base roles (PLAN.md §2): the tenancy matrix again under the club preset and a
 * custom configuration, plus the member guardrails, validation, audit, sync and fallbacks.
 * The default-configuration matrix stays in tenancy.test.ts, unchanged.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  CONFIGURABLE,
  DEFAULT_ROLE_PERMISSIONS,
  ROLES,
  ROLE_PRESETS,
  ROUTES,
  can,
  routePath,
  uuidv7,
  type Action,
  type RolePermissions,
  type RouteId,
  type SyncResponse,
} from '@phaseplay/shared';
import { call, fixtureTeam, login } from './helpers';

type Fixture = Awaited<ReturnType<typeof fixtureTeam>>;
const CLUB = ROLE_PRESETS.club.permissions;
const CUSTOM: RolePermissions = {
  coach: [],
  manager: [...CONFIGURABLE],
  player: ['match.record', 'practice.run'],
};

const put = (a: Fixture, cookie: string, body: unknown) =>
  call('PUT', `/api/v1/teams/${a.teamId}/role-permissions`, { cookie, body });
async function configure(a: Fixture, cfg: RolePermissions) {
  const r = await put(a, a.admin.cookie, cfg);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r;
}
const sync = async (teamId: string, cookie: string, since = 0) =>
  (await call('GET', `/api/v1/teams/${teamId}/sync?since=${since}`, { cookie })) as {
    status: number;
    body: SyncResponse;
    queries: number;
  };
const matchEvent = () => ({
  id: uuidv7(),
  seq: 0,
  gameMs: 0,
  wallAt: Date.now(),
  payload: { kind: 'period_start', period: 1 },
});

/** Handler-level narrowing beyond the route's action (rank rules, holders, own records). */
const REFINED: Partial<Record<RouteId, string[]>> = {
  'members.update': ['coach', 'manager', 'player'],
  'members.relink': ['manager'],
  // Replying for someone else needs events.manage, which a config may take away.
  'rsvps.put': ['coach', 'manager', 'player'],
  'inventory.return': ['player'],
  'inventory.lost': ['player'],
  'inventory.handoff.create': ['player'],
  'inventory.handoff.accept': ['player'],
  'inventory.handoff.decline': ['player'],
};

const teamRoutes = (Object.keys(ROUTES) as RouteId[]).filter((id) => ROUTES[id].auth === 'team');

for (const [name, cfg] of [
  ['club preset', CLUB],
  ['custom', CUSTOM],
] as const) {
  describe(`tenancy matrix: ${name}`, () => {
    for (const id of teamRoutes) {
      it(id, async () => {
        const a = await fixtureTeam('Team A');
        await configure(a, cfg);
        const r = ROUTES[id] as { method: string; path: string; action: Action };
        const path = routePath(id, {
          teamId: a.teamId,
          memberId: a.player.memberId,
          eventId: a.eventId,
          sheetId: a.sheetId,
          playId: a.playId,
          drillId: a.drillId,
          planId: a.planId,
          inviteId: a.inviteId,
          recurrenceId: a.recurrenceId,
          roleId: a.roleId,
          itemId: uuidv7(),
          handoffId: uuidv7(),
          seasonId: uuidv7(),
          mediaId: uuidv7(),
        });
        const opts = r.method === 'GET' ? {} : { body: {} };
        const actors = {
          owner: a.owner,
          admin: a.admin,
          coach: a.coach,
          manager: a.manager,
          player: a.player,
        };
        for (const role of [...ROLES].reverse()) {
          const res = await call(r.method, path, { ...opts, cookie: actors[role].cookie });
          expect(res.status, `${role}: ${JSON.stringify(res.body)}`).not.toBe(500);
          if (can({ role, overrides: cfg }, r.action)) {
            if (!REFINED[id]?.includes(role))
              expect([401, 403], `${role} allowed: ${JSON.stringify(res.body)}`).not.toContain(
                res.status,
              );
          } else expect(res.status, `${role} denied`).toBe(403);
          expect(res.queries, `${role} query budget`).toBeLessThanOrEqual(6);
        }
      });
    }
  });
}

describe('role permissions', () => {
  it('defaults: everyone reads them, nothing is stored', async () => {
    const a = await fixtureTeam();
    const r = await call('GET', `/api/v1/teams/${a.teamId}/role-permissions`, {
      cookie: a.player.cookie,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      rolePermissions: null,
      effective: DEFAULT_ROLE_PERMISSIONS,
      preset: 'default',
      version: 1,
    });
    expect((await sync(a.teamId, a.player.cookie)).body.team.rolePermissions).toBeNull();
  });

  it('only admins change them; bad actions are 400; changes are audited', async () => {
    const a = await fixtureTeam();
    for (const who of [a.coach, a.manager, a.player])
      expect((await put(a, who.cookie, CLUB)).status).toBe(403);
    expect((await put(a, a.admin.cookie, { ...CLUB, player: ['sheets.view_draft'] })).status).toBe(
      400,
    );
    expect((await put(a, a.admin.cookie, { ...CLUB, player: ['availability.view'] })).status).toBe(
      400,
    );
    expect((await put(a, a.admin.cookie, { ...CLUB, coach: ['roles.manage'] })).status).toBe(400);
    expect((await put(a, a.admin.cookie, { ...CLUB, manager: ['team.manage'] })).status).toBe(400);
    // Old clients and partial bodies: every role list is required; nothing else is.
    expect((await put(a, a.admin.cookie, { coach: [] })).status).toBe(400);

    // Normalised: a manage permission brings its view.
    const r = await put(a, a.owner.cookie, { ...CLUB, manager: ['sheets.manage'] });
    expect(r.status).toBe(200);
    expect(r.body.effective.manager).toEqual(['sheets.manage', 'sheets.view_draft']);
    expect(r.body.preset).toBeNull();
    expect(r.queries).toBeLessThanOrEqual(6);

    const log = await call('GET', `/api/v1/teams/${a.teamId}/audit`, { cookie: a.owner.cookie });
    const e = log.body.entries.find((x: { action: string }) => x.action === 'roles.base_changed');
    expect(e.meta.before).toEqual(DEFAULT_ROLE_PERMISSIONS);
    expect(e.meta.after.manager).toEqual(['sheets.manage', 'sheets.view_draft']);

    // Back to the defaults stores NULL.
    const reset = await put(a, a.admin.cookie, DEFAULT_ROLE_PERMISSIONS);
    expect(reset.body).toMatchObject({ rolePermissions: null, preset: 'default' });
    const row = await env.DB.prepare('SELECT role_permissions FROM teams WHERE id = ?')
      .bind(a.teamId)
      .first<{ role_permissions: string | null }>();
    expect(row?.role_permissions).toBeNull();
  });

  it('club preset: the coach runs rugby, the manager runs the squad', async () => {
    const a = await fixtureTeam();
    await configure(a, CLUB);
    const base = `/api/v1/teams/${a.teamId}`;
    // Coach: no member management or invites.
    expect(
      (await call('DELETE', `${base}/members/${a.player.memberId}`, { cookie: a.coach.cookie }))
        .status,
    ).toBe(403);
    expect(
      (
        await call('POST', `${base}/invites`, {
          cookie: a.coach.cookie,
          body: { id: uuidv7(), role: 'player' },
        })
      ).status,
    ).toBe(403);
    expect((await call('GET', `${base}/invites`, { cookie: a.coach.cookie })).status).toBe(403);
    expect(
      (
        await call('PATCH', `${base}/members/${a.player.memberId}`, {
          cookie: a.coach.cookie,
          body: { role: 'manager' },
        })
      ).status,
    ).toBe(403);
    // ...but still builds sheets and records matches.
    expect(
      (
        await call('POST', `${base}/events/${a.eventId}/match`, {
          cookie: a.coach.cookie,
          body: { events: [matchEvent()] },
        })
      ).status,
    ).toBe(200);

    // Manager: invites players and managers only, never coaches or admins.
    for (const [role, status] of [
      ['player', 201],
      ['manager', 201],
      ['coach', 403],
      ['admin', 403],
    ] as const)
      expect(
        (
          await call('POST', `${base}/invites`, {
            cookie: a.manager.cookie,
            body: { id: uuidv7(), role },
          })
        ).status,
        role,
      ).toBe(status);
    // Can't promote above themselves or touch admins and the owner.
    expect(
      (
        await call('PATCH', `${base}/members/${a.player.memberId}`, {
          cookie: a.manager.cookie,
          body: { role: 'coach' },
        })
      ).status,
    ).toBe(403);
    for (const target of [a.admin, a.owner, a.coach])
      expect(
        (await call('DELETE', `${base}/members/${target.memberId}`, { cookie: a.manager.cookie }))
          .status,
      ).toBe(403);
    expect(
      (
        await call('PATCH', `${base}/members/${a.admin.memberId}`, {
          cookie: a.manager.cookie,
          body: { jersey: 9 },
        })
      ).status,
    ).toBe(200); // shirts and positions: members.manage, as today for coaches
    // Removes a player.
    expect(
      (await call('DELETE', `${base}/members/${a.player.memberId}`, { cookie: a.manager.cookie }))
        .status,
    ).toBe(200);
  });

  it('players can be given match recording; owner and admin are never affected', async () => {
    const a = await fixtureTeam();
    const url = `/api/v1/teams/${a.teamId}/events/${a.eventId}/match`;
    const rec = (cookie: string) => call('POST', url, { cookie, body: { events: [matchEvent()] } });
    expect((await rec(a.player.cookie)).status).toBe(403);
    await configure(a, { coach: [], manager: [], player: ['match.record'] });
    const r = await rec(a.player.cookie);
    expect(r.status).toBe(200);
    expect(r.queries).toBeLessThanOrEqual(6);
    expect((await rec(a.coach.cookie)).status).toBe(403);
    expect((await rec(a.manager.cookie)).status).toBe(403);
    expect((await rec(a.admin.cookie)).status).toBe(200);
    expect((await rec(a.owner.cookie)).status).toBe(200);
    // Admin keeps everything, including changing the settings back.
    expect((await put(a, a.admin.cookie, DEFAULT_ROLE_PERMISSIONS)).status).toBe(200);
    expect((await rec(a.player.cookie)).status).toBe(403);
  });

  it('sync carries the settings and a change forces a full sync', async () => {
    const a = await fixtureTeam();
    const first = await sync(a.teamId, a.coach.cookie);
    await new Promise((r) => setTimeout(r, 5));
    await configure(a, CLUB);
    const next = await sync(a.teamId, a.coach.cookie, first.body.cursor);
    expect(next.body.full).toBe(true);
    expect(next.body.team.rolePermissions).toEqual(CLUB);
    expect(next.queries).toBeLessThanOrEqual(6);
  });

  it('RSVP notes follow availability for the base role', async () => {
    const a = await fixtureTeam();
    await call('PUT', `/api/v1/teams/${a.teamId}/events/${a.eventId}/rsvps/${a.player.memberId}`, {
      cookie: a.player.cookie,
      body: { status: 'no', note: 'Away' },
    });
    const note = async (cookie: string) =>
      (await sync(a.teamId, cookie)).body.rsvps.find((r) => r.memberId === a.player.memberId)?.note;
    expect(await note(a.coach.cookie)).toBe('Away');
    await configure(a, { ...DEFAULT_ROLE_PERMISSIONS, coach: [] });
    expect(await note(a.coach.cookie)).toBeFalsy();
  });

  it('a malformed stored value falls back to the defaults', async () => {
    const a = await fixtureTeam();
    for (const junk of ['{not json', '{"coach":"events.manage","manager":[],"player":[]}', '[]']) {
      await env.DB.prepare('UPDATE teams SET role_permissions = ? WHERE id = ?')
        .bind(junk, a.teamId)
        .run();
      const s = await sync(a.teamId, a.coach.cookie);
      expect(s.status).toBe(200);
      expect(s.body.team.rolePermissions).toBeNull();
      expect(
        (await call('GET', `/api/v1/teams/${a.teamId}/invites`, { cookie: a.coach.cookie })).status,
      ).toBe(200);
      expect(
        (await call('GET', `/api/v1/teams/${a.teamId}/audit`, { cookie: a.manager.cookie })).status,
      ).toBe(403);
    }
  });

  it('an unknown stored action is dropped; the rest of the settings still apply', async () => {
    const a = await fixtureTeam();
    await env.DB.prepare('UPDATE teams SET role_permissions = ? WHERE id = ?')
      .bind(
        JSON.stringify({ coach: ['events.manage', 'renamed.action'], manager: [], player: [] }),
        a.teamId,
      )
      .run();
    const s = await sync(a.teamId, a.coach.cookie);
    expect(s.body.team.rolePermissions).toEqual({
      coach: ['events.manage'],
      manager: [],
      player: [],
    });
    // Removed powers stay removed.
    expect(
      (await call('GET', `/api/v1/teams/${a.teamId}/invites`, { cookie: a.coach.cookie })).status,
    ).toBe(403);
  });

  it('a stale editor gets 409 with the latest; no If-Match still saves', async () => {
    const a = await fixtureTeam();
    const url = `/api/v1/teams/${a.teamId}/role-permissions`;
    const loaded = (await call('GET', url, { cookie: a.admin.cookie })).body.version;
    expect(loaded).toBe(1);
    const first = await call('PUT', url, { cookie: a.owner.cookie, body: CLUB, ifMatch: loaded });
    expect(first.status).toBe(200);
    expect(first.body.version).toBeGreaterThan(1);
    const stale = await call('PUT', url, { cookie: a.admin.cookie, body: CUSTOM, ifMatch: loaded });
    expect(stale.status).toBe(409);
    expect(stale.body.error.latest).toMatchObject({ preset: 'club', version: first.body.version });
    const sync0 = await sync(a.teamId, a.admin.cookie);
    expect(sync0.body.team.rolePermissionsVersion).toBe(first.body.version);
    // Older builds send no If-Match.
    expect((await put(a, a.admin.cookie, CUSTOM)).status).toBe(200);
  });

  it('device links: never for someone who can manage members in another team', async () => {
    const a = await fixtureTeam('Team A');
    const b = await fixtureTeam('Team B');
    // Team B's manager also plays for Team A.
    const inv = await call('POST', `/api/v1/teams/${a.teamId}/invites`, {
      cookie: a.owner.cookie,
      body: { id: uuidv7(), role: 'player' },
    });
    const acc = await call('POST', '/api/v1/invites/accept', {
      cookie: b.manager.cookie,
      body: { token: inv.body.token },
    });
    expect(acc.status).toBe(200);
    const relink = () =>
      call('POST', `/api/v1/teams/${a.teamId}/members/${acc.body.memberId}/relink`, {
        cookie: a.coach.cookie,
        body: { id: uuidv7(), memberId: acc.body.memberId },
      });
    // Default settings in Team B: managers there can't manage members, so this works as before.
    expect((await relink()).status).toBe(201);
    // Club preset in Team B: its managers manage members, so no device link from Team A.
    await configure(b, CLUB);
    const r = await relink();
    expect(r.status).toBe(403);
    expect(r.queries).toBeLessThanOrEqual(6);
    // Malformed settings in Team B read as the defaults, without a 500.
    await env.DB.prepare('UPDATE teams SET role_permissions = ? WHERE id = ?')
      .bind('{not json', b.teamId)
      .run();
    expect((await relink()).status).toBe(201);
  });

  it('revoking invites: as before under the defaults, own roles only once customised', async () => {
    const a = await fixtureTeam();
    const base = `/api/v1/teams/${a.teamId}`;
    const invite = async (role: string) =>
      (
        await call('POST', `${base}/invites`, {
          cookie: a.owner.cookie,
          body: { id: uuidv7(), role },
        })
      ).body.id as string;
    const revoke = (cookie: string, id: string) =>
      call('DELETE', `${base}/invites/${id}`, { cookie });
    // Defaults: a coach may revoke an admin invite (unchanged).
    expect((await revoke(a.coach.cookie, await invite('admin'))).status).toBe(200);
    await configure(a, CLUB);
    const adminInv = await invite('admin');
    const coachInv = await invite('coach');
    const playerInv = await invite('player');
    expect((await revoke(a.manager.cookie, adminInv)).status).toBe(403);
    expect((await revoke(a.manager.cookie, coachInv)).status).toBe(403);
    expect((await revoke(a.manager.cookie, playerInv)).status).toBe(200);
    expect((await revoke(a.manager.cookie, playerInv)).status).toBe(404);
    expect((await revoke(a.coach.cookie, coachInv)).status).toBe(403); // no members.manage
    expect((await revoke(a.admin.cookie, adminInv)).status).toBe(200);
  });

  it('invite → join gives exactly the invite role, whatever the configuration', async () => {
    const a = await fixtureTeam();
    const base = `/api/v1/teams/${a.teamId}`;
    const invite = async (cookie: string, role: string) =>
      call('POST', `${base}/invites`, { cookie, body: { id: uuidv7(), role } });
    const join = async (token: string, name: string) => {
      const u = await login(name);
      const acc = await call('POST', '/api/v1/invites/accept', {
        cookie: u.cookie,
        body: { token },
      });
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      const s = await sync(a.teamId, u.cookie);
      return { me: s.body.me, members: s.body.members };
    };
    // A coach's invite made under the defaults still works after the club takes invites away.
    const early = await invite(a.coach.cookie, 'player');
    expect(early.status).toBe(201);
    await configure(a, CLUB);
    expect((await invite(a.coach.cookie, 'player')).status).toBe(403);
    const byManager = await invite(a.manager.cookie, 'player');
    expect(byManager.status).toBe(201);
    const byAdmin = await invite(a.admin.cookie, 'coach');
    for (const [token, role] of [
      [early.body.token, 'player'],
      [byManager.body.token, 'player'],
      [byAdmin.body.token, 'coach'],
    ] as const) {
      const { me, members } = await join(token, `New ${role}`);
      expect(me.role).toBe(role);
      expect(me.roleIds).toEqual([]);
      expect(members.some((m) => m.id === me.id && m.status === 'active')).toBe(true);
    }
    // Even with every action switched on for managers, a manager never hands out coach or admin.
    await configure(a, CUSTOM);
    expect((await invite(a.manager.cookie, 'coach')).status).toBe(403);
    expect((await invite(a.manager.cookie, 'admin')).status).toBe(403);
    const mgr = await invite(a.manager.cookie, 'manager');
    expect((await join(mgr.body.token, 'New manager')).me.role).toBe('manager');
    // Players can't invite: invites aren't in the player-safe set.
    expect((await invite(a.player.cookie, 'player')).status).toBe(403);
  });
});
