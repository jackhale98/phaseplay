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

  it('imported pending names are claimed on join', async () => {
    const a = await fixtureTeam();
    const pid = uuidv7();
    await call('POST', `/api/v1/teams/${a.teamId}/import`, {
      cookie: a.manager.cookie,
      body: {
        events: [],
        members: [{ id: pid, displayName: 'Jess Taylor', jersey: 9, positions: [9] }],
      },
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
    const rsvp = await call('PUT', `/api/v1/teams/${team.id}/events/${ev.id}/rsvps/${s.body.me.id}`, { cookie, body: { status: 'yes' } });
    expect(rsvp.status).toBe(403);
    expect(rsvp.body.error.code).toBe('demo');
    expect((await call('POST', '/api/v1/me/passkeys/options', { cookie, body: {} })).status).toBe(403);
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
