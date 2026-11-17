import { describe, expect, it } from 'vitest';
import { uuidv7, type StatsFeed } from '@phaseplay/shared';
import { call, fixtureTeam } from './helpers';

const feed = async (teamId: string, cookie: string, q = '') =>
  (await call('GET', `/api/v1/teams/${teamId}/stats${q}`, { cookie })) as {
    status: number;
    body: StatsFeed;
    queries: number;
  };

describe('season stats feed', () => {
  it('players get team turnout and only their own marks; staff get everyone; never notes', async () => {
    const a = await fixtureTeam();
    const base = `/api/v1/teams/${a.teamId}`;
    const practice = uuidv7();
    const game = uuidv7();
    const future = uuidv7();
    const at = Date.now() - 7 * 86400e3;
    for (const [id, type, startsAt] of [
      [practice, 'training', at],
      [game, 'match', at + 86400e3],
      [future, 'match', Date.now() + 86400e3],
    ] as const)
      await call('POST', `${base}/events`, {
        cookie: a.owner.cookie,
        body: { id, type, title: 'x', startsAt, opponent: 'Rivals', format: '15s' },
      });
    await call('PUT', `${base}/events/${practice}/rsvps/${a.player.memberId}`, {
      cookie: a.player.cookie,
      body: { status: 'no', note: 'secret reason' },
    });
    await call('PUT', `${base}/events/${practice}/rsvps/${a.coach.memberId}`, {
      cookie: a.coach.cookie,
      body: { status: 'yes' },
    });
    // Attendance taken for the practice only: the coach came, the player didn't.
    await call('PUT', `${base}/events/${practice}/attendance`, {
      cookie: a.coach.cookie,
      body: {
        entries: [
          { memberId: a.coach.memberId, attended: true },
          { memberId: a.player.memberId, attended: false },
        ],
      },
    });
    const log = [
      { id: uuidv7(), seq: 0, gameMs: 0, wallAt: at, payload: { kind: 'period_start', period: 1 } },
      {
        id: uuidv7(),
        seq: 1,
        gameMs: 60e3,
        wallAt: at + 60e3,
        payload: { kind: 'score', team: 'us', type: 'try', playerId: a.player.memberId },
      },
    ];
    for (const id of [game, future])
      await call('POST', `${base}/events/${id}/match`, {
        cookie: a.coach.cookie,
        body: { events: log.map((e) => ({ ...e, id: uuidv7() })) },
      });

    const p = await feed(a.teamId, a.player.cookie);
    expect(p.status).toBe(200);
    expect(p.queries).toBeLessThanOrEqual(6);
    expect(p.body.marks).toEqual([
      { eventId: practice, memberId: a.player.memberId, status: 'no', attended: false },
    ]);
    // Turnout counts people who play: the coach was there but doesn't count; nobody else was.
    expect(p.body.turnout).toContainEqual({ eventId: practice, taken: true, present: 0, yes: 0 });
    // Games already played only; the future fixture's log isn't a stat yet.
    expect(Object.keys(p.body.matches)).toEqual([game]);
    expect(p.body.matches[game]).toHaveLength(2);
    expect(JSON.stringify(p.body)).not.toContain('secret reason');
    // Even when players may see who's going, per-player attendance stays their own.
    expect(
      (await call('PATCH', base, { cookie: a.owner.cookie, body: { rsvpVisibility: 'all' } }))
        .status,
    ).toBe(200);
    expect((await feed(a.teamId, a.player.cookie)).body.marks.map((m) => m.memberId)).toEqual([
      a.player.memberId,
    ]);

    const c = await feed(a.teamId, a.coach.cookie);
    expect(c.body.marks).toHaveLength(2);
    // Staff work turnout out from the marks, so the server skips that query.
    expect(c.body.turnout).toEqual([]);
    expect(JSON.stringify(c.body)).not.toContain('secret reason');

    // The window narrows everything.
    const none = await feed(a.teamId, a.coach.cookie, `?from=${at + 2 * 86400e3}`);
    expect(none.body.marks).toEqual([]);
    expect(none.body.matches).toEqual({});
    expect((await feed(a.teamId, a.coach.cookie, '?from=10&to=5')).status).toBe(400);
    for (const bad of ['?from=abc', '?from=', '?to=%20', '?from=-1', '?from=1.5', '?to=1e3'])
      expect((await feed(a.teamId, a.coach.cookie, bad)).status, bad).toBe(400);
    expect((await feed(a.teamId, a.coach.cookie, `?from=5&to=5`)).status).toBe(200);
  });

  it("a Captain role's availability.view shows everyone's marks", async () => {
    const a = await fixtureTeam();
    const base = `/api/v1/teams/${a.teamId}`;
    const ev = uuidv7();
    await call('POST', `${base}/events`, {
      cookie: a.owner.cookie,
      body: { id: ev, type: 'training', title: 'x', startsAt: Date.now() - 86400e3 },
    });
    await call('PUT', `${base}/events/${ev}/rsvps/${a.coach.memberId}`, {
      cookie: a.coach.cookie,
      body: { status: 'yes' },
    });
    expect((await feed(a.teamId, a.player.cookie)).body.marks).toEqual([]);
    const role = uuidv7();
    await call('PUT', `${base}/roles/${role}`, {
      cookie: a.owner.cookie,
      body: { name: 'Captain', color: '#f2c230', permissions: ['availability.view'] },
    });
    await call('PATCH', `${base}/members/${a.player.memberId}`, {
      cookie: a.owner.cookie,
      body: { roleIds: [role] },
    });
    expect((await feed(a.teamId, a.player.cookie)).body.marks).toHaveLength(1);
  });
});
