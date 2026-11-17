import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { uuidv7, type SyncResponse } from '@phaseplay/shared';
import { call, fixtureTeam, login, playBody } from './helpers';

const sync = async (teamId: string, cookie: string, since = 0) =>
  (await call('GET', `/api/v1/teams/${teamId}/sync?since=${since}`, { cookie })) as {
    status: number;
    body: SyncResponse;
    queries: number;
  };

describe('auth & sessions', () => {
  it('rejects state-changing requests without an allowlisted Origin', async () => {
    const u = await login();
    expect(
      (await call('POST', '/api/v1/teams', { cookie: u.cookie, body: {}, origin: null })).status,
    ).toBe(403);
    expect(
      (
        await call('POST', '/api/v1/teams', {
          cookie: u.cookie,
          body: {},
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
  });

  it('recovery codes are single use and sign you in', async () => {
    const u = await login('Recover Me');
    const { body } = await call('POST', '/api/v1/me/recovery-codes', {
      cookie: u.cookie,
      body: {},
    });
    expect(body.recoveryCodes).toHaveLength(10);
    await call('POST', '/api/v1/auth/logout', { cookie: u.cookie, body: {} });
    expect((await call('GET', '/api/v1/me', { cookie: u.cookie })).status).toBe(401);
    const code = body.recoveryCodes[3].toUpperCase();
    const r = await call('POST', '/api/v1/auth/recover', { body: { code } });
    expect(r.status).toBe(200);
    const cookie = r.headers.get('set-cookie')!.split(';')[0]!;
    expect((await call('GET', '/api/v1/me', { cookie })).body.user.displayName).toBe('Recover Me');
    expect((await call('POST', '/api/v1/auth/recover', { body: { code } })).status).toBe(400);
  });

  it('sign out everywhere kills every session', async () => {
    const u = await login();
    await call('POST', '/api/v1/me/sessions/revoke', { cookie: u.cookie, body: {} });
    expect((await call('GET', '/api/v1/me', { cookie: u.cookie })).status).toBe(401);
  });

  it('registration challenges expire and are single use', async () => {
    const r = await call('POST', '/api/v1/auth/register/options', { body: { displayName: 'New' } });
    expect(r.status).toBe(200);
    expect(r.body.options.authenticatorSelection.residentKey).toBe('required');
    await env.DB.prepare('UPDATE auth_challenges SET expires_at = 0 WHERE id = ?')
      .bind(r.body.challengeId)
      .run();
    const v = await call('POST', '/api/v1/auth/register/verify', {
      body: { challengeId: r.body.challengeId, response: { id: 'x' } },
    });
    expect(v.status).toBe(400);
    expect(v.body.error.message).toMatch(/expired/);
  });
});

describe('invites and membership', () => {
  it('enforces max uses, revocation and expiry', async () => {
    const a = await fixtureTeam();
    const inv = await call('POST', `/api/v1/teams/${a.teamId}/invites`, {
      cookie: a.owner.cookie,
      body: { id: uuidv7(), role: 'player', maxUses: 1 },
    });
    const p1 = await login('P1');
    const p2 = await login('P2');
    const preview = await call('POST', '/api/v1/invites/preview', {
      body: { token: inv.body.token },
    });
    expect(preview.body.team.name).toBe('Phaseplay RFC');
    expect(preview.body.invitedBy).toContain('Owner');
    expect(
      (
        await call('POST', '/api/v1/invites/accept', {
          cookie: p1.cookie,
          body: { token: inv.body.token },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('POST', '/api/v1/invites/accept', {
          cookie: p2.cookie,
          body: { token: inv.body.token },
        })
      ).status,
    ).toBe(410);

    const inv2 = await call('POST', `/api/v1/teams/${a.teamId}/invites`, {
      cookie: a.coach.cookie,
      body: { id: uuidv7(), role: 'player' },
    });
    await call('DELETE', `/api/v1/teams/${a.teamId}/invites/${inv2.body.id}`, {
      cookie: a.coach.cookie,
    });
    expect(
      (
        await call('POST', '/api/v1/invites/accept', {
          cookie: p2.cookie,
          body: { token: inv2.body.token },
        })
      ).status,
    ).toBe(410);

    const inv3 = await call('POST', `/api/v1/teams/${a.teamId}/invites`, {
      cookie: a.owner.cookie,
      body: { id: uuidv7(), role: 'player', expiresIn: '1h' },
    });
    await env.DB.prepare('UPDATE invites SET expires_at = 1 WHERE id = ?').bind(inv3.body.id).run();
    expect(
      (await call('POST', '/api/v1/invites/preview', { body: { token: inv3.body.token } })).status,
    ).toBe(410);
  });

  it('managers can only invite players and managers', async () => {
    const a = await fixtureTeam();
    expect(
      (
        await call('POST', `/api/v1/teams/${a.teamId}/invites`, {
          cookie: a.manager.cookie,
          body: { id: uuidv7(), role: 'coach' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('POST', `/api/v1/teams/${a.teamId}/invites`, {
          cookie: a.manager.cookie,
          body: { id: uuidv7(), role: 'player' },
        })
      ).status,
    ).toBe(201);
  });

  it('a removed member is cut off on her very next request', async () => {
    const a = await fixtureTeam();
    expect((await sync(a.teamId, a.player.cookie)).status).toBe(200);
    await call('DELETE', `/api/v1/teams/${a.teamId}/members/${a.player.memberId}`, {
      cookie: a.coach.cookie,
    });
    expect((await sync(a.teamId, a.player.cookie)).status).toBe(404);
    const audit = await call('GET', `/api/v1/teams/${a.teamId}/audit`, { cookie: a.coach.cookie });
    expect(audit.body.entries.map((e: { action: string }) => e.action)).toContain('member.removed');
  });

  it('pending names added by a coach are claimed on join', async () => {
    const a = await fixtureTeam();
    const pid = uuidv7();
    await call('POST', `/api/v1/teams/${a.teamId}/members`, {
      cookie: a.coach.cookie,
      body: { id: pid, displayName: 'Jess Taylor', jersey: 9, positions: [9] },
    });
    const inv = await call('POST', `/api/v1/teams/${a.teamId}/invites`, {
      cookie: a.owner.cookie,
      body: { id: uuidv7(), role: 'player' },
    });
    const preview = await call('POST', '/api/v1/invites/preview', {
      body: { token: inv.body.token },
    });
    expect(preview.body.pending.map((p: { displayName: string }) => p.displayName)).toContain(
      'Jess Taylor',
    );
    const jess = await login('Jess T');
    const acc = await call('POST', '/api/v1/invites/accept', {
      cookie: jess.cookie,
      body: { token: inv.body.token, claimMemberId: pid },
    });
    expect(acc.body.memberId).toBe(pid);
    const s = await sync(a.teamId, jess.cookie);
    expect(s.body.me.jersey).toBe(9);
    expect(s.body.me.status).toBe('active');
  });

  it('device re-link links are single use', async () => {
    const a = await fixtureTeam();
    const r = await call('POST', `/api/v1/teams/${a.teamId}/members/${a.player.memberId}/relink`, {
      cookie: a.coach.cookie,
      body: { id: uuidv7(), memberId: a.player.memberId },
    });
    expect(r.status).toBe(201);
    const opts = await call('POST', '/api/v1/auth/relink/options', {
      body: { token: r.body.token },
    });
    expect(opts.status).toBe(200);
    expect(opts.body.displayName).toBe('Player Pip');
  });
});

describe('privacy in sync', () => {
  it('players see counts and their own RSVP, never other notes', async () => {
    const a = await fixtureTeam();
    const path = (m: string) => `/api/v1/teams/${a.teamId}/events/${a.eventId}/rsvps/${m}`;
    expect(
      (
        await call('PUT', path(a.player.memberId), {
          cookie: a.player.cookie,
          body: { status: 'no', note: 'away at a wedding' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('PUT', path(a.manager.memberId), {
          cookie: a.player.cookie,
          body: { status: 'yes' },
        })
      ).status,
    ).toBe(403);
    await call('PUT', path(a.coach.memberId), {
      cookie: a.coach.cookie,
      body: { status: 'yes', note: 'coach note' },
    });

    const ps = await sync(a.teamId, a.player.cookie);
    expect(ps.body.rsvps).toHaveLength(1);
    expect(ps.body.rsvps[0]!.note).toBe('away at a wedding');
    expect(ps.body.rsvpCounts[a.eventId]).toEqual({ yes: 1, no: 1, maybe: 0 });
    expect(JSON.stringify(ps.body)).not.toContain('coach note');

    const cs = await sync(a.teamId, a.coach.cookie);
    expect(cs.body.rsvps.map((r) => r.note).sort()).toEqual(['away at a wedding', 'coach note']);
    expect(cs.queries).toBeLessThanOrEqual(3);
  });

  it('draft sheets and coach-only plays stay hidden from players', async () => {
    const a = await fixtureTeam();
    expect((await sync(a.teamId, a.player.cookie)).body.sheets).toHaveLength(0);
    await call('POST', `/api/v1/teams/${a.teamId}/sheets/${a.sheetId}/publish`, {
      cookie: a.coach.cookie,
      body: {},
    });
    // Coach keeps editing after publishing: players still see the published snapshot.
    const cur = (await sync(a.teamId, a.coach.cookie)).body.sheets[0]!;
    await call('PUT', `/api/v1/teams/${a.teamId}/sheets/${a.sheetId}`, {
      cookie: a.coach.cookie,
      ifMatch: cur.version,
      body: {
        eventId: a.eventId,
        format: '15s',
        replacements: 8,
        slots: { '1': a.coach.memberId },
        captainId: null,
        viceId: null,
      },
    });
    const ps = (await sync(a.teamId, a.player.cookie)).body.sheets[0]!;
    expect(ps.slots['1']).toBe(a.player.memberId);
    expect(ps.status).toBe('published');

    const secret = uuidv7();
    await call('POST', `/api/v1/teams/${a.teamId}/plays`, {
      cookie: a.coach.cookie,
      body: playBody(secret, 'coaches'),
    });
    const plays = (await sync(a.teamId, a.player.cookie)).body.plays.map((p) => p.id);
    expect(plays).toContain(a.playId);
    expect(plays).not.toContain(secret);
    expect(
      (await call('GET', `/api/v1/teams/${a.teamId}/plays/${secret}`, { cookie: a.player.cookie }))
        .status,
    ).toBe(404);
  });
});

describe('writes', () => {
  it('versioned writes return 409 with the latest copy', async () => {
    const a = await fixtureTeam();
    const url = `/api/v1/teams/${a.teamId}/plays/${a.playId}`;
    const ok = await call('PATCH', url, {
      cookie: a.coach.cookie,
      ifMatch: 1,
      body: { title: 'Mine' },
    });
    expect(ok.body.play.version).toBe(2);
    const stale = await call('PATCH', url, {
      cookie: a.owner.cookie,
      ifMatch: 1,
      body: { title: 'Theirs' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.latest.title).toBe('Mine');
  });

  it('match events append exactly once and stay scoped to the team', async () => {
    const a = await fixtureTeam();
    const b = await fixtureTeam('Team B');
    const events = [
      {
        id: uuidv7(),
        seq: 0,
        gameMs: 0,
        wallAt: Date.now(),
        payload: { kind: 'period_start', period: 1 },
      },
      {
        id: uuidv7(),
        seq: 1,
        gameMs: 60000,
        wallAt: Date.now() + 60000,
        payload: { kind: 'score', team: 'us', type: 'try' },
      },
    ];
    const url = `/api/v1/teams/${a.teamId}/events/${a.eventId}/match`;
    expect(
      (await call('POST', url, { cookie: a.manager.cookie, body: { events } })).body.inserted,
    ).toBe(2);
    expect(
      (await call('POST', url, { cookie: a.manager.cookie, body: { events } })).body.inserted,
    ).toBe(0);
    expect((await call('GET', url, { cookie: a.player.cookie })).body.events).toHaveLength(2);
    // Team B can't append to Team A's event through its own team id.
    const cross = await call('POST', `/api/v1/teams/${b.teamId}/events/${a.eventId}/match`, {
      cookie: b.owner.cookie,
      body: { events: [{ ...events[0], id: uuidv7() }] },
    });
    expect(cross.status).toBe(404);
  });

  it('recurring trainings expand in the team timezone; delta sync returns tombstones', async () => {
    const a = await fixtureTeam();
    const s0 = await sync(a.teamId, a.owner.cookie);
    const trainings = s0.body.events.filter((e) => e.recurrenceId === a.recurrenceId);
    expect(trainings).toHaveLength(10); // 5 Tuesdays + 5 Thursdays in January 2030
    expect(new Date(trainings[0]!.startsAt).toISOString()).toBe('2030-01-01T19:00:00.000Z');
    const del = await call('DELETE', `/api/v1/teams/${a.teamId}/events/${a.eventId}`, {
      cookie: a.manager.cookie,
    });
    expect(del.status).toBe(200);
    const s1 = await sync(a.teamId, a.player.cookie, s0.body.cursor);
    expect(s1.body.full).toBe(false);
    expect(s1.body.events.find((e) => e.id === a.eventId)?.deletedAt).toBeTruthy();
  });

  it('serves a calendar feed with cache headers', async () => {
    const a = await fixtureTeam();
    const f = await call('POST', '/api/v1/me/calendar-feeds', {
      cookie: a.player.cookie,
      body: { teamId: a.teamId, scope: 'me' },
    });
    const ics = await call('GET', f.body.path);
    expect(ics.status).toBe(200);
    expect(ics.headers.get('content-type')).toContain('text/calendar');
    expect(String(ics.body)).toContain('SUMMARY:PRFC Game: v Rivals');
    await call('DELETE', `/api/v1/me/calendar-feeds/${f.body.id}`, { cookie: a.player.cookie });
    expect((await call('GET', f.body.path)).status).toBe(404);
  });

  it('new teams get the starter drill pack', async () => {
    const a = await fixtureTeam();
    const drills = (await sync(a.teamId, a.player.cookie)).body.drills;
    expect(drills.filter((d) => d.source === 'starter').length).toBeGreaterThanOrEqual(15);
  });
});

describe('public demo', () => {
  it('signs anyone in to a fresh, read-only demo team', async () => {
    const start = await call('POST', '/api/v1/demo', { body: {} });
    expect(start.status).toBe(200);
    const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
    const me = await call('GET', '/api/v1/me', { cookie });
    expect(me.body.demo).toBe(true);
    const team = me.body.memberships[0].team;
    expect(team.name).toBe('Phaseplay RFC');

    const s = await sync(team.id, cookie);
    expect(s.status).toBe(200);
    expect(s.body.members.length).toBeGreaterThan(30);
    expect(s.body.events.some((e) => e.type === 'fundraiser')).toBe(true);
    expect(s.body.events.some((e) => e.startsAt > Date.now())).toBe(true);

    // Every write is refused, including adding a passkey (so nobody can take the account over).
    const ev = s.body.events[0]!;
    const rsvp = await call(
      'PUT',
      `/api/v1/teams/${team.id}/events/${ev.id}/rsvps/${s.body.me.id}`,
      { cookie, body: { status: 'yes' } },
    );
    expect(rsvp.status).toBe(403);
    expect(rsvp.body.error.code).toBe('demo');
    expect((await call('POST', '/api/v1/me/passkeys/options', { cookie, body: {} })).status).toBe(
      403,
    );
    expect((await call('DELETE', '/api/v1/me', { cookie })).status).toBe(403);

    // A second visitor gets the same team; it's only re-seeded when stale.
    const again = await call('POST', '/api/v1/demo', { body: {} });
    expect(again.queries).toBeLessThanOrEqual(4);
    expect((await call('POST', '/api/v1/auth/logout', { cookie, body: {} })).status).toBe(200);
  });

  it('is invisible to other teams', async () => {
    await call('POST', '/api/v1/demo', { body: {} });
    const a = await fixtureTeam();
    const s = await sync(a.teamId, a.owner.cookie);
    expect(s.body.members.some((m) => m.displayName === 'Jess Taylor')).toBe(false);
    expect((await sync('a0000000-0000-7000-8000-000000000001', a.owner.cookie)).status).toBe(404);
  });
});

describe('review fixes', () => {
  it('coaches cannot make device links for the owner or other coaches', async () => {
    const a = await fixtureTeam();
    const relink = (cookie: string, memberId: string) =>
      call('POST', `/api/v1/teams/${a.teamId}/members/${memberId}/relink`, {
        cookie,
        body: { id: uuidv7(), memberId },
      });
    expect((await relink(a.coach.cookie, a.owner.memberId)).status).toBe(403);
    expect((await relink(a.coach.cookie, a.player.memberId)).status).toBe(201);
    expect((await relink(a.owner.cookie, a.coach.memberId)).status).toBe(201);
    // A player who coaches another team can't be re-linked from here either.
    const b = await fixtureTeam('Team B');
    const inv = await call('POST', `/api/v1/teams/${b.teamId}/invites`, {
      cookie: b.owner.cookie,
      body: { id: uuidv7(), role: 'coach' },
    });
    await call('POST', '/api/v1/invites/accept', {
      cookie: a.player.cookie,
      body: { token: inv.body.token },
    });
    expect((await relink(a.coach.cookie, a.player.memberId)).status).toBe(403);
  });

  it('a second sheet for the same match is a 409 with the existing sheet, not a 500', async () => {
    const a = await fixtureTeam();
    const r = await call('PUT', `/api/v1/teams/${a.teamId}/sheets/${uuidv7()}`, {
      cookie: a.coach.cookie,
      body: {
        eventId: a.eventId,
        format: '15s',
        replacements: 8,
        slots: {},
        captainId: null,
        viceId: null,
      },
    });
    expect(r.status).toBe(409);
    expect(r.body.error.latest.id).toBe(a.sheetId);
  });

  it('a failed name claim does not use up the invite', async () => {
    const a = await fixtureTeam();
    const inv = await call('POST', `/api/v1/teams/${a.teamId}/invites`, {
      cookie: a.owner.cookie,
      body: { id: uuidv7(), role: 'player', maxUses: 1 },
    });
    const u1 = await login('U1');
    const bad = await call('POST', '/api/v1/invites/accept', {
      cookie: u1.cookie,
      body: { token: inv.body.token, claimMemberId: uuidv7() },
    });
    expect(bad.status).toBe(409);
    const u2 = await login('U2');
    expect(
      (
        await call('POST', '/api/v1/invites/accept', {
          cookie: u2.cookie,
          body: { token: inv.body.token },
        })
      ).status,
    ).toBe(200);
  });

  it('a play made coach-only disappears from players on their next delta sync', async () => {
    const a = await fixtureTeam();
    const s0 = await sync(a.teamId, a.player.cookie);
    expect(s0.body.plays.map((p) => p.id)).toContain(a.playId);
    await call('PATCH', `/api/v1/teams/${a.teamId}/plays/${a.playId}`, {
      cookie: a.coach.cookie,
      ifMatch: 1,
      body: { visibility: 'coaches', title: 'Secret' },
    });
    const s1 = await sync(a.teamId, a.player.cookie, s0.body.cursor);
    const p = s1.body.plays.find((x) => x.id === a.playId)!;
    expect(p.deletedAt).toBeTruthy();
    expect(JSON.stringify(s1.body)).not.toContain('Secret');
  });

  it('a role change forces a full sync', async () => {
    const a = await fixtureTeam();
    const s0 = await sync(a.teamId, a.player.cookie);
    await call('PATCH', `/api/v1/teams/${a.teamId}/members/${a.player.memberId}`, {
      cookie: a.owner.cookie,
      body: { role: 'coach' },
    });
    const s1 = await sync(a.teamId, a.player.cookie, s0.body.cursor);
    expect(s1.body.full).toBe(true);
  });

  it('a demo cookie does not block signing in, recovering or previewing an invite', async () => {
    const d = await call('POST', '/api/v1/demo', { body: {} });
    const cookie = d.headers.get('set-cookie')!.split(';')[0]!;
    expect((await call('POST', '/api/v1/auth/login/options', { cookie, body: {} })).status).toBe(
      200,
    );
    expect(
      (await call('POST', '/api/v1/invites/accept', { cookie, body: { token: 'x'.repeat(22) } }))
        .status,
    ).toBe(403);
  });

  it('creating a team stays within the query budget', async () => {
    const u = await login();
    const r = await call('POST', '/api/v1/teams', {
      cookie: u.cookie,
      body: {
        id: uuidv7(),
        name: 'Budget RFC',
        shortName: 'BRFC',
        colors: { primary: '#1f6f43', secondary: '#f2c230' },
        defaultFormat: '15s',
        timezone: 'Europe/London',
      },
    });
    expect(r.status).toBe(201);
    expect(r.queries).toBeLessThanOrEqual(6);
  });
});

describe('team roles and ownership', () => {
  const plan = (id: string) => ({
    id,
    title: 'Captains only',
    visibility: 'coaches',
    data: { lanes: ['all'], slots: [] },
  });

  it('a Captain role lets a player see coach-only practice plans, and only that', async () => {
    const a = await fixtureTeam();
    const planId = uuidv7();
    await call('POST', `/api/v1/teams/${a.teamId}/plans`, {
      cookie: a.owner.cookie,
      body: plan(planId),
    });
    const hidden = await sync(a.teamId, a.player.cookie);
    expect(hidden.body.plans.map((p) => p.id)).not.toContain(planId);
    expect(hidden.body.roles.map((r) => r.id)).toContain(a.roleId);

    // Coaches can't hand out team roles; admins can.
    const assign = { body: { roleIds: [a.roleId] } };
    const path = `/api/v1/teams/${a.teamId}/members/${a.player.memberId}`;
    expect((await call('PATCH', path, { cookie: a.coach.cookie, ...assign })).status).toBe(403);
    expect((await call('PATCH', path, { cookie: a.admin.cookie, ...assign })).status).toBe(200);

    const s1 = await sync(a.teamId, a.player.cookie, hidden.body.cursor);
    expect(s1.body.full).toBe(true);
    expect(s1.body.plans.map((p) => p.id)).toContain(planId);
    expect(s1.body.me.roleIds).toEqual([a.roleId]);
    // Still a player for everything else.
    expect(
      (
        await call('POST', `/api/v1/teams/${a.teamId}/plans`, {
          cookie: a.player.cookie,
          body: plan(uuidv7()),
        })
      ).status,
    ).toBe(403);

    // Deleting the role takes it away again.
    await call('DELETE', `/api/v1/teams/${a.teamId}/roles/${a.roleId}`, { cookie: a.admin.cookie });
    const s2 = await sync(a.teamId, a.player.cookie, s1.body.cursor);
    expect(s2.body.full).toBe(true);
    expect(s2.body.plans.map((p) => p.id)).not.toContain(planId);
  });

  it('roles can only carry grantable permissions and unknown roles are refused', async () => {
    const a = await fixtureTeam();
    const put = (permissions: string[]) =>
      call('PUT', `/api/v1/teams/${a.teamId}/roles/${uuidv7()}`, {
        cookie: a.owner.cookie,
        body: { name: 'Sneaky', color: '#123456', permissions },
      });
    expect((await put(['team.delete'])).status).toBe(400);
    expect((await put(['roles.manage'])).status).toBe(400);
    expect((await put(['events.manage'])).status).toBe(200);
    const res = await call('PATCH', `/api/v1/teams/${a.teamId}/members/${a.player.memberId}`, {
      cookie: a.owner.cookie,
      body: { roleIds: [uuidv7()] },
    });
    expect(res.status).toBe(400);
  });

  it('an events role lets a manager-less player add to the schedule', async () => {
    const a = await fixtureTeam();
    const roleId = uuidv7();
    await call('PUT', `/api/v1/teams/${a.teamId}/roles/${roleId}`, {
      cookie: a.owner.cookie,
      body: { name: 'Social sec', color: '#aa3366', permissions: ['events.manage'] },
    });
    const ev = {
      id: uuidv7(),
      type: 'social',
      title: 'Quiz night',
      startsAt: Date.now() + 86400e3,
    };
    const make = () =>
      call('POST', `/api/v1/teams/${a.teamId}/events`, {
        cookie: a.player.cookie,
        body: { ...ev, id: uuidv7() },
      });
    expect((await make()).status).toBe(403);
    await call('PATCH', `/api/v1/teams/${a.teamId}/members/${a.player.memberId}`, {
      cookie: a.owner.cookie,
      body: { roleIds: [roleId] },
    });
    expect((await make()).status).toBe(201);
  });

  it('ownership hands over only when the nominee accepts', async () => {
    const a = await fixtureTeam();
    const t = `/api/v1/teams/${a.teamId}`;
    expect(
      (
        await call('POST', `${t}/transfer`, {
          cookie: a.admin.cookie,
          body: { memberId: a.coach.memberId },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('POST', `${t}/transfer`, {
          cookie: a.owner.cookie,
          body: { memberId: a.admin.memberId },
        })
      ).status,
    ).toBe(200);
    // Someone else can't accept or cancel it.
    expect(
      (await call('POST', `${t}/transfer/accept`, { cookie: a.coach.cookie, body: {} })).status,
    ).toBe(409);
    expect(
      (await call('POST', `${t}/transfer/cancel`, { cookie: a.coach.cookie, body: {} })).status,
    ).toBe(409);
    const before = await sync(a.teamId, a.admin.cookie);
    expect(before.body.team.pendingOwnerMemberId).toBe(a.admin.memberId);

    expect(
      (await call('POST', `${t}/transfer/accept`, { cookie: a.admin.cookie, body: {} })).status,
    ).toBe(200);
    const after = await sync(a.teamId, a.admin.cookie);
    expect(after.body.me.role).toBe('owner');
    expect(after.body.team.pendingOwnerMemberId).toBeNull();
    expect(after.body.members.find((m) => m.id === a.owner.memberId)!.role).toBe('admin');
    // The old owner is now an admin: can't delete the team.
    expect(
      (await call('DELETE', t, { cookie: a.owner.cookie, body: { confirmName: 'Test RFC' } }))
        .status,
    ).toBe(403);
  });

  it('the nominee can decline', async () => {
    const a = await fixtureTeam();
    const t = `/api/v1/teams/${a.teamId}`;
    await call('POST', `${t}/transfer`, {
      cookie: a.owner.cookie,
      body: { memberId: a.coach.memberId },
    });
    expect(
      (await call('POST', `${t}/transfer/cancel`, { cookie: a.coach.cookie, body: {} })).status,
    ).toBe(200);
    expect(
      (await call('POST', `${t}/transfer/accept`, { cookie: a.coach.cookie, body: {} })).status,
    ).toBe(409);
  });

  it('an admin can take over only after the owner has been away for 30 days', async () => {
    const a = await fixtureTeam();
    const t = `/api/v1/teams/${a.teamId}`;
    expect(
      (await call('POST', `${t}/claim-ownership`, { cookie: a.admin.cookie, body: {} })).status,
    ).toBe(409);
    expect(
      (await call('POST', `${t}/claim-ownership`, { cookie: a.coach.cookie, body: {} })).status,
    ).toBe(403);

    const old = Date.now() - 31 * 86400e3;
    const owner = await env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?')
      .bind(a.teamId)
      .first<{ owner_id: string }>();
    await env.DB.batch([
      env.DB.prepare('UPDATE sessions SET created_at = ?, last_seen_at = ? WHERE user_id = ?').bind(
        old,
        old,
        owner!.owner_id,
      ),
      env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(old, owner!.owner_id),
    ]);
    expect(
      (await call('POST', `${t}/claim-ownership`, { cookie: a.admin.cookie, body: {} })).status,
    ).toBe(200);
    const s = await sync(a.teamId, a.admin.cookie);
    expect(s.body.me.role).toBe('owner');
    expect(s.body.members.filter((m) => m.role === 'owner')).toHaveLength(1);
  });

  it('admins manage roles and members but cannot delete the team', async () => {
    const a = await fixtureTeam();
    const t = `/api/v1/teams/${a.teamId}`;
    expect(
      (
        await call('PATCH', `${t}/members/${a.coach.memberId}`, {
          cookie: a.admin.cookie,
          body: { role: 'admin' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('PATCH', `${t}/members/${a.admin.memberId}`, {
          cookie: a.manager.cookie,
          body: { role: 'player' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call('DELETE', t, { cookie: a.admin.cookie, body: { confirmName: 'Test RFC' } }))
        .status,
    ).toBe(403);
  });
});

describe('roles review fixes', () => {
  const invite = async (a: Awaited<ReturnType<typeof fixtureTeam>>, role = 'player') =>
    (
      await call('POST', `/api/v1/teams/${a.teamId}/invites`, {
        cookie: a.owner.cookie,
        body: { id: uuidv7(), role, maxUses: 5 },
      })
    ).body.token as string;

  it('a team role shows replies but never other people’s RSVP notes', async () => {
    const a = await fixtureTeam();
    const roleId = uuidv7();
    await call('PUT', `/api/v1/teams/${a.teamId}/roles/${roleId}`, {
      cookie: a.owner.cookie,
      body: { name: 'Captain', color: '#f2c230', permissions: ['availability.view'] },
    });
    await call('PATCH', `/api/v1/teams/${a.teamId}/members/${a.player.memberId}`, {
      cookie: a.owner.cookie,
      body: { roleIds: [roleId] },
    });
    await call('PUT', `/api/v1/teams/${a.teamId}/events/${a.eventId}/rsvps/${a.manager.memberId}`, {
      cookie: a.manager.cookie,
      body: { status: 'no', note: 'Private reason' },
    });
    const s = await sync(a.teamId, a.player.cookie);
    const r = s.body.rsvps.find((x) => x.memberId === a.manager.memberId)!;
    expect(r.status).toBe('no');
    expect(JSON.stringify(s.body)).not.toContain('Private reason');
    const coach = await sync(a.teamId, a.coach.cookie);
    expect(JSON.stringify(coach.body)).toContain('Private reason');
  });

  it('removal clears team roles and a stale ownership nomination', async () => {
    const a = await fixtureTeam();
    const t = `/api/v1/teams/${a.teamId}`;
    const roleId = uuidv7();
    await call('PUT', `${t}/roles/${roleId}`, {
      cookie: a.owner.cookie,
      body: { name: 'Social', color: '#7b4fa0', permissions: ['events.manage'] },
    });
    await call('PATCH', `${t}/members/${a.player.memberId}`, {
      cookie: a.owner.cookie,
      body: { roleIds: [roleId] },
    });
    await call('POST', `${t}/transfer`, {
      cookie: a.owner.cookie,
      body: { memberId: a.player.memberId },
    });
    await call('DELETE', `${t}/members/${a.player.memberId}`, { cookie: a.owner.cookie });
    await new Promise((r) => setTimeout(r, 5));
    const back = await call('POST', '/api/v1/invites/accept', {
      cookie: a.player.cookie,
      body: { token: await invite(a) },
    });
    expect(back.status).toBe(200);
    const s = await sync(a.teamId, a.player.cookie);
    expect(s.body.me.roleIds).toEqual([]);
    expect(
      (await call('POST', `${t}/transfer/accept`, { cookie: a.player.cookie, body: {} })).status,
    ).toBe(409);
    const ev = { id: uuidv7(), type: 'social', title: 'Quiz', startsAt: Date.now() + 86400e3 };
    expect((await call('POST', `${t}/events`, { cookie: a.player.cookie, body: ev })).status).toBe(
      403,
    );
  });

  it('deleting a role strips it from holders and it cannot be brought back', async () => {
    const a = await fixtureTeam();
    const t = `/api/v1/teams/${a.teamId}`;
    const body = { name: 'Captain', color: '#f2c230', permissions: ['practice.view_private'] };
    await call('PATCH', `${t}/members/${a.player.memberId}`, {
      cookie: a.owner.cookie,
      body: { roleIds: [a.roleId] },
    });
    expect(
      (await call('DELETE', `${t}/roles/${a.roleId}`, { cookie: a.owner.cookie })).status,
    ).toBe(200);
    expect(
      (await call('PUT', `${t}/roles/${a.roleId}`, { cookie: a.owner.cookie, body })).status,
    ).toBe(404);
    const s = await sync(a.teamId, a.player.cookie);
    expect(s.body.me.roleIds).toEqual([]);
    expect(
      (await call('PUT', `${t}/roles/not-a-uuid`, { cookie: a.owner.cookie, body })).status,
    ).toBe(404);
  });
});

describe('team emblem', () => {
  // A 1×1 transparent PNG.
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('admins upload a checked image that members can fetch; others cannot', async () => {
    const a = await fixtureTeam();
    const t = `/api/v1/teams/${a.teamId}/crest`;
    expect((await call('GET', t, { cookie: a.player.cookie })).status).toBe(404);
    expect(
      (await call('PUT', t, { cookie: a.player.cookie, body: { type: 'image/png', data: PNG } }))
        .status,
    ).toBe(403);
    // Bytes must match the declared type (no SVG/HTML smuggled in as an "image").
    const html = btoa('<svg onload=alert(1)>');
    expect(
      (await call('PUT', t, { cookie: a.admin.cookie, body: { type: 'image/png', data: html } }))
        .status,
    ).toBe(400);
    const up = await call('PUT', t, {
      cookie: a.admin.cookie,
      body: { type: 'image/png', data: PNG },
    });
    expect(up.status).toBe(200);
    expect(up.body.team.crestVersion).toBeGreaterThan(0);
    const s = await sync(a.teamId, a.player.cookie);
    expect(s.body.team.crestVersion).toBe(up.body.team.crestVersion);

    const res = await call('GET', t, { cookie: a.player.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const other = await fixtureTeam('Other');
    expect((await call('GET', t, { cookie: other.owner.cookie })).status).toBe(404);

    expect((await call('DELETE', t, { cookie: a.admin.cookie })).status).toBe(200);
    expect((await sync(a.teamId, a.player.cookie)).body.team.crestVersion).toBeNull();
  });
});

describe("who's going setting", () => {
  it('players see names only as the team allows, and never notes', async () => {
    const a = await fixtureTeam();
    const t = `/api/v1/teams/${a.teamId}`;
    const practice = uuidv7();
    await call('POST', `${t}/events`, {
      cookie: a.owner.cookie,
      body: { id: practice, type: 'training', title: 'Practice', startsAt: Date.now() + 86400e3 },
    });
    for (const ev of [a.eventId, practice])
      await call('PUT', `${t}/events/${ev}/rsvps/${a.coach.memberId}`, {
        cookie: a.coach.cookie,
        body: { status: 'yes', note: 'Secret note' },
      });
    const others = (s: Awaited<ReturnType<typeof sync>>) =>
      s.body.rsvps.filter((r) => r.memberId === a.coach.memberId).map((r) => r.eventId);

    const s0 = await sync(a.teamId, a.player.cookie);
    expect(others(s0)).toEqual([]);
    expect(s0.body.team.rsvpVisibility).toBe('counts');

    // Only admins/owners change it.
    expect(
      (await call('PATCH', t, { cookie: a.coach.cookie, body: { rsvpVisibility: 'all' } })).status,
    ).toBe(403);
    await call('PATCH', t, { cookie: a.owner.cookie, body: { rsvpVisibility: 'games' } });
    const s1 = await sync(a.teamId, a.player.cookie, s0.body.cursor);
    expect(s1.body.full).toBe(true);
    expect(others(s1)).toEqual([a.eventId]);
    expect(JSON.stringify(s1.body)).not.toContain('Secret note');

    await call('PATCH', t, { cookie: a.owner.cookie, body: { rsvpVisibility: 'all' } });
    const s2 = await sync(a.teamId, a.player.cookie, s1.body.cursor);
    expect(others(s2).sort()).toEqual([a.eventId, practice].sort());
    expect(JSON.stringify(s2.body)).not.toContain('Secret note');

    await call('PATCH', t, { cookie: a.owner.cookie, body: { rsvpVisibility: 'counts' } });
    const s3 = await sync(a.teamId, a.player.cookie, s2.body.cursor);
    expect(s3.body.full).toBe(true);
    expect(others(s3)).toEqual([]);
  });
});

describe('editing a weekly series', () => {
  const series = (s: Awaited<ReturnType<typeof sync>>, id: string) =>
    s.body.events
      .filter((e) => e.recurrenceId === id && !e.deletedAt)
      .sort((x, y) => x.startsAt - y.startsAt);

  it('changes time, details and days for upcoming sessions, keeping replies', async () => {
    const a = await fixtureTeam();
    const t = `/api/v1/teams/${a.teamId}`;
    const s0 = await sync(a.teamId, a.owner.cookie);
    const before = series(s0, a.recurrenceId);
    const firstTue = before[0]!;
    await call('PUT', `${t}/events/${firstTue.id}/rsvps/${a.player.memberId}`, {
      cookie: a.player.cookie,
      body: { status: 'yes' },
    });
    const got = await call('GET', `${t}/recurrences/${a.recurrenceId}`, {
      cookie: a.manager.cookie,
    });
    expect(got.status).toBe(200);
    expect(got.body.recurrence.rule.weekdays).toEqual([2, 4]);
    expect(got.body.recurrence.upcoming).toBe(10);
    // Players can't.
    expect(
      (await call('GET', `${t}/recurrences/${a.recurrenceId}`, { cookie: a.player.cookie })).status,
    ).toBe(403);

    const res = await call('PUT', `${t}/recurrences/${a.recurrenceId}`, {
      cookie: a.manager.cookie,
      body: {
        type: 'training',
        title: 'Evening practice',
        locationName: 'Main pitch',
        rule: { ...got.body.recurrence.rule, weekdays: [2], time: '18:30', until: '2030-02-12' },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 5, removed: 5, added: 2 });
    const s1 = await sync(a.teamId, a.owner.cookie);
    const after = series(s1, a.recurrenceId);
    expect(after).toHaveLength(7); // 7 Tuesdays from 1 Jan to 12 Feb 2030
    expect(
      after.every((e) => e.title === 'Evening practice' && e.locationName === 'Main pitch'),
    ).toBe(true);
    expect(new Date(after[0]!.startsAt).toISOString()).toBe('2030-01-01T18:30:00.000Z');
    // Same session, same id, reply kept.
    expect(after[0]!.id).toBe(firstTue.id);
    const mine = await sync(a.teamId, a.player.cookie);
    expect(mine.body.rsvps.find((r) => r.eventId === firstTue.id)?.status).toBe('yes');
  });

  it('an earlier end date stops the series', async () => {
    const a = await fixtureTeam();
    const t = `/api/v1/teams/${a.teamId}`;
    const got = await call('GET', `${t}/recurrences/${a.recurrenceId}`, { cookie: a.owner.cookie });
    const r = got.body.recurrence;
    const res = await call('PUT', `${t}/recurrences/${a.recurrenceId}`, {
      cookie: a.owner.cookie,
      body: { type: r.type, title: r.title, rule: { ...r.rule, until: '2030-01-09' } },
    });
    expect(res.body).toMatchObject({ added: 0, removed: 7 });
    expect(series(await sync(a.teamId, a.player.cookie), a.recurrenceId)).toHaveLength(3);
    // Another team can't touch it.
    const b = await fixtureTeam('B');
    expect(
      (
        await call('PUT', `/api/v1/teams/${b.teamId}/recurrences/${a.recurrenceId}`, {
          cookie: b.owner.cookie,
          body: { type: r.type, title: 'x', rule: r.rule },
        })
      ).status,
    ).toBe(404);
  });

  it('non-practice events can repeat too', async () => {
    const a = await fixtureTeam();
    const id = uuidv7();
    const res = await call('POST', `/api/v1/teams/${a.teamId}/recurrences`, {
      cookie: a.owner.cookie,
      body: {
        id,
        type: 'meeting',
        title: 'Committee',
        rule: {
          weekdays: [1],
          time: '20:00',
          durationMin: 60,
          startsOn: '2030-03-04',
          until: '2030-03-25',
        },
      },
    });
    expect(res.status).toBe(201);
    const ev = series(await sync(a.teamId, a.owner.cookie), id);
    expect(ev).toHaveLength(4);
    expect(ev.every((e) => e.type === 'meeting')).toBe(true);
  });
});
