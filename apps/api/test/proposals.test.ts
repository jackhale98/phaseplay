/** Tentative games and events ("Not confirmed yet"): proposals, answers, confirm and drop. */
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { uuidv7, type PushPayload, type SyncResponse } from '@phaseplay/shared';
import { call, fixtureTeam, type Actor } from './helpers';
import { queueKitAtRisk, queueProposalReminders, queueReminders } from '../src/lib/push/jobs';

const H = 3600e3;
const DAY = 24 * H;
type Team = Awaited<ReturnType<typeof fixtureTeam>>;

const KEYS = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};
async function subscribe(who: { cookie: string }) {
  const r = await call('POST', '/api/v1/push/subscriptions', {
    cookie: who.cookie,
    body: { endpoint: `https://fcm.googleapis.com/fcm/send/${uuidv7()}`, keys: KEYS },
  });
  expect(r.status).toBe(201);
}
const everyone = (a: Team): Actor[] => [a.owner, a.admin, a.coach, a.manager, a.player];
async function queued(a: Team) {
  const { results } = await env.DB.prepare(
    'SELECT user_id, payload FROM push_queue WHERE user_id IN (SELECT value FROM json_each(?))',
  )
    .bind(JSON.stringify(everyone(a).map((x) => x.userId)))
    .all<{ user_id: string; payload: string }>();
  return results.map((r) => ({ userId: r.user_id, ...(JSON.parse(r.payload) as PushPayload) }));
}

const budget = (r: { queries: number }) => expect(r.queries, 'query budget').toBeLessThanOrEqual(6);

/** A 2-date poll for a friendly, created by the coach. */
async function poll(a: Team, extra: Record<string, unknown> = {}) {
  const id = uuidv7();
  const t = Date.now();
  const options = [
    { id: uuidv7(), startsAt: t + 12 * DAY, meetAt: t + 12 * DAY - H },
    { id: uuidv7(), startsAt: t + 5 * DAY },
  ];
  const r = await call('POST', `/api/v1/teams/${a.teamId}/events`, {
    cookie: a.coach.cookie,
    body: {
      id,
      type: 'match',
      format: '15s',
      title: 'Friendly',
      opponent: 'Harlequins',
      startsAt: options[1]!.startsAt,
      status: 'proposed',
      options,
      ...extra,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  budget(r);
  return { id, options: options.sort((x, y) => x.startsAt - y.startsAt), t };
}

const answer = (a: Team, who: Actor, eventId: string, answers: unknown[]) =>
  call('PUT', `/api/v1/teams/${a.teamId}/events/${eventId}/answers`, {
    cookie: who.cookie,
    body: { answers },
  });
const sync = async (who: Actor, a: Team, since = 0) =>
  (await call('GET', `/api/v1/teams/${a.teamId}/sync?since=${since}`, { cookie: who.cookie }))
    .body as SyncResponse;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM push_queue').run();
});

describe('proposals', () => {
  it('creates a poll with dates; the event mirrors the earliest date', async () => {
    const a = await fixtureTeam('Poll RFC');
    const p = await poll(a);
    const s = await sync(a.player, a);
    const ev = s.events.find((e) => e.id === p.id)!;
    expect(ev).toMatchObject({ status: 'proposed', startsAt: p.options[0]!.startsAt });
    // Default answer-by: two days before the first date (sooner than a week).
    expect(ev.answerBy).toBe(p.options[0]!.startsAt - 2 * DAY);
    expect(ev.checkPositions).toBe(true);
    expect(s.options.filter((o) => o.eventId === p.id).map((o) => o.id)).toEqual(
      expect.arrayContaining(p.options.map((o) => o.id)),
    );
    expect(s.team.proposalTargets).toEqual({ '15s': 20, '7s': 10 });
  });

  it('rejects proposals for practices and answers for other people', async () => {
    const a = await fixtureTeam('Rules RFC');
    const bad = await call('POST', `/api/v1/teams/${a.teamId}/events`, {
      cookie: a.coach.cookie,
      body: {
        id: uuidv7(),
        type: 'training',
        title: 'Practice',
        startsAt: Date.now() + DAY,
        status: 'proposed',
        options: [{ id: uuidv7(), startsAt: Date.now() + DAY }],
      },
    });
    expect(bad.status).toBe(400);
    const p = await poll(a);
    // Answers are always your own: there is no member in the path or body to spoof.
    const r = await answer(a, a.player, p.id, [
      { optionId: p.options[0]!.id, answer: 'in', memberId: a.coach.memberId },
    ]);
    expect(r.status).toBe(200);
    budget(r);
    const own = await env.DB.prepare('SELECT member_id FROM proposal_answers WHERE event_id = ?')
      .bind(p.id)
      .all<{ member_id: string }>();
    expect(own.results.map((x) => x.member_id)).toEqual([a.player.memberId]);
    // Another team's member can't answer (404 through tenancy), nor a date from another event.
    const b = await fixtureTeam('Other RFC');
    expect(
      (await answer(a, b.player, p.id, [{ optionId: p.options[0]!.id, answer: 'in' }])).status,
    ).toBe(404);
    const q = await poll(b);
    expect(
      (await answer(a, a.player, p.id, [{ optionId: q.options[0]!.id, answer: 'in' }])).status,
    ).toBe(404);
  });

  it('players see counts for every date; names follow the team reply setting; staff see all', async () => {
    const a = await fixtureTeam('Seen RFC');
    const p = await poll(a);
    await answer(a, a.player, p.id, [
      { optionId: p.options[0]!.id, answer: 'in' },
      { optionId: p.options[1]!.id, answer: 'cant' },
    ]);
    await answer(a, a.manager, p.id, [{ optionId: p.options[0]!.id, answer: 'in' }]);

    const asPlayer = await sync(a.player, a);
    expect(asPlayer.answerCounts[p.options[0]!.id]).toEqual({ in: 2, cant: 0 });
    expect(asPlayer.answerCounts[p.options[1]!.id]).toEqual({ in: 0, cant: 1 });
    expect(asPlayer.answers.map((x) => x.memberId)).toEqual([a.player.memberId, a.player.memberId]);
    const asCoach = await sync(a.coach, a);
    expect(new Set(asCoach.answers.map((x) => x.memberId))).toEqual(
      new Set([a.player.memberId, a.manager.memberId]),
    );
    // "Names for games": players see who's in for proposed games too.
    await call('PATCH', `/api/v1/teams/${a.teamId}`, {
      cookie: a.owner.cookie,
      body: { rsvpVisibility: 'games' },
    });
    expect(new Set((await sync(a.player, a)).answers.map((x) => x.memberId)).size).toBe(2);
    // Delta syncs carry fresh counts.
    const cursor = (await sync(a.player, a)).cursor;
    await answer(a, a.coach, p.id, [{ optionId: p.options[1]!.id, answer: 'in' }]);
    const delta = await sync(a.player, a, cursor);
    expect(delta.answerCounts[p.options[1]!.id]).toEqual({ in: 1, cant: 1 });
  });

  it('editing keeps answers on kept dates and drops those on removed dates', async () => {
    const a = await fixtureTeam('Edit RFC');
    const p = await poll(a);
    await answer(a, a.player, p.id, [
      { optionId: p.options[0]!.id, answer: 'in' },
      { optionId: p.options[1]!.id, answer: 'in' },
    ]);
    const before = (await sync(a.player, a)).cursor;
    const added = { id: uuidv7(), startsAt: p.t + 20 * DAY };
    const r = await call('PATCH', `/api/v1/teams/${a.teamId}/events/${p.id}`, {
      cookie: a.coach.cookie,
      body: { options: [p.options[1], added], target: 18 },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    budget(r);
    expect(r.body.event).toMatchObject({ startsAt: p.options[1]!.startsAt, target: 18 });
    const s = await sync(a.player, a);
    expect(
      s.options
        .filter((o) => o.eventId === p.id)
        .map((o) => o.id)
        .sort(),
    ).toEqual([p.options[1]!.id, added.id].sort());
    expect(s.answers.map((x) => x.optionId)).toEqual([p.options[1]!.id]);
    // Delta sync: the removed date arrives as a tombstone.
    await env.DB.prepare('UPDATE memberships SET updated_at = 1 WHERE team_id = ?')
      .bind(a.teamId)
      .run();
    const d = await sync(a.player, a, before);
    expect(d.options.find((o) => o.id === p.options[0]!.id)?.deletedAt).toBeTruthy();
    // Answering a removed date is refused.
    expect(
      (await answer(a, a.player, p.id, [{ optionId: p.options[0]!.id, answer: 'in' }])).status,
    ).toBe(404);
  });

  it('confirm: takes the date, marks everyone who was in as yes to reconfirm, once', async () => {
    const a = await fixtureTeam('Confirm RFC');
    for (const x of everyone(a)) await subscribe(x);
    const p = await poll(a);
    const pick = p.options[1]!;
    await answer(a, a.player, p.id, [{ optionId: pick.id, answer: 'in' }]);
    await answer(a, a.admin, p.id, [{ optionId: pick.id, answer: 'cant' }]);
    await answer(a, a.manager, p.id, [{ optionId: p.options[0]!.id, answer: 'in' }]);
    await env.DB.prepare('DELETE FROM push_queue').run();

    const confirm = () =>
      call('POST', `/api/v1/teams/${a.teamId}/events/${p.id}/confirm`, {
        cookie: a.coach.cookie,
        body: { optionId: pick.id },
      });
    const r = await confirm();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    budget(r);
    expect(r.body.event).toMatchObject({
      status: 'confirmed',
      startsAt: pick.startsAt,
      meetAt: pick.meetAt,
    });
    const rsvps = await env.DB.prepare(
      'SELECT member_id, status, reconfirm FROM rsvps WHERE event_id = ?',
    )
      .bind(p.id)
      .all<{ member_id: string; status: string; reconfirm: number }>();
    expect(rsvps.results).toEqual([{ member_id: a.player.memberId, status: 'yes', reconfirm: 1 }]);
    const q = await queued(a);
    const onIt = q.filter((x) => x.title.startsWith("It's on"));
    expect(onIt.map((x) => x.userId)).toEqual([a.player.userId]);
    expect(onIt[0]!.body).toMatch(/Still in\?$/);
    // The rest of the team (not the coach who confirmed) hears it's on the schedule.
    expect(
      q
        .filter((x) => x.title.startsWith('New:'))
        .map((x) => x.userId)
        .sort(),
    ).toEqual([a.owner.userId, a.admin.userId, a.manager.userId].sort());

    // The player says "Can't now": a retried confirm neither overwrites it nor notifies again.
    const rsvp = await call(
      'PUT',
      `/api/v1/teams/${a.teamId}/events/${p.id}/rsvps/${a.player.memberId}`,
      { cookie: a.player.cookie, body: { status: 'no' } },
    );
    expect(rsvp.status).toBe(200);
    await env.DB.prepare('DELETE FROM push_queue').run();
    const again = await confirm();
    expect(again.status).toBe(200);
    budget(again);
    expect(await queued(a)).toEqual([]);
    const after = await env.DB.prepare('SELECT status, reconfirm FROM rsvps WHERE event_id = ?')
      .bind(p.id)
      .first();
    expect(after).toEqual({ status: 'no', reconfirm: 0 });
    // Confirming a different date afterwards is a conflict; answers are closed.
    const other = await call('POST', `/api/v1/teams/${a.teamId}/events/${p.id}/confirm`, {
      cookie: a.coach.cookie,
      body: { optionId: p.options[0]!.id },
    });
    expect(other.status).toBe(409);
    expect((await answer(a, a.player, p.id, [{ optionId: pick.id, answer: 'in' }])).status).toBe(
      409,
    );
    // Players can't confirm.
    expect(
      (
        await call('POST', `/api/v1/teams/${a.teamId}/events/${p.id}/confirm`, {
          cookie: a.player.cookie,
          body: { optionId: pick.id },
        })
      ).status,
    ).toBe(403);
  });

  it('confirm takes a missing meet time', async () => {
    const a = await fixtureTeam('Meet RFC');
    const p = await poll(a);
    const pick = p.options[0]!; // no meet time
    const r = await call('POST', `/api/v1/teams/${a.teamId}/events/${p.id}/confirm`, {
      cookie: a.coach.cookie,
      body: { optionId: pick.id, meetAt: pick.startsAt - 45 * 60e3 },
    });
    expect(r.body.event.meetAt).toBe(pick.startsAt - 45 * 60e3);
  });

  it('drop: hidden from a fresh sync, people who answered hear, retries are quiet', async () => {
    const a = await fixtureTeam('Drop RFC');
    for (const x of everyone(a)) await subscribe(x);
    const p = await poll(a);
    await answer(a, a.player, p.id, [{ optionId: p.options[0]!.id, answer: 'cant' }]);
    await env.DB.prepare('DELETE FROM push_queue').run();
    const drop = () =>
      call('POST', `/api/v1/teams/${a.teamId}/events/${p.id}/drop`, {
        cookie: a.manager.cookie,
        body: {},
      });
    const r = await drop();
    expect(r.status).toBe(200);
    budget(r);
    expect(r.body.event.status).toBe('dropped');
    const q = await queued(a);
    expect(q.map((x) => x.userId)).toEqual([a.player.userId]);
    expect(q[0]!.title).toMatch(/^Not going ahead/);
    await env.DB.prepare('DELETE FROM push_queue').run();
    expect((await drop()).status).toBe(200);
    expect(await queued(a)).toEqual([]);
    expect((await sync(a.player, a)).events.find((e) => e.id === p.id)).toBeUndefined();
    // Not a proposal: can't be dropped.
    const fixture = await call('POST', `/api/v1/teams/${a.teamId}/events/${a.eventId}/drop`, {
      cookie: a.coach.cookie,
      body: {},
    });
    expect(fixture.status).toBe(409);
  });

  it('notifies on propose, once even when the write is retried', async () => {
    const a = await fixtureTeam('Ping RFC');
    for (const x of everyone(a)) await subscribe(x);
    const id = uuidv7();
    const t = Date.now();
    const body = {
      id,
      type: 'social',
      title: 'Curry night',
      startsAt: t + 10 * DAY,
      status: 'proposed',
      options: [{ id: uuidv7(), startsAt: t + 10 * DAY }],
    };
    const send = () =>
      call('POST', `/api/v1/teams/${a.teamId}/events`, { cookie: a.coach.cookie, body });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    const q = await queued(a);
    expect(q).toHaveLength(4); // everyone but the coach, once
    expect(q[0]).toMatchObject({ title: 'Are you in?' });
    expect(q[0]!.body).toMatch(/^Curry night: \w{3} \d{1,2}\. Not confirmed yet/);
  });

  it('reminds people who have not answered two days before answers are due, once', async () => {
    const a = await fixtureTeam('Due RFC');
    for (const x of everyone(a)) await subscribe(x);
    const t = Date.now();
    const p = await poll(a, { answerBy: t + 4 * DAY });
    await answer(a, a.player, p.id, [{ optionId: p.options[0]!.id, answer: 'in' }]);
    await env.DB.prepare('DELETE FROM push_queue').run();
    // Not yet: answers are due in four days.
    const mine = async () => (await queued(a)).filter((x) => x.url.startsWith(`/events/${p.id}`));
    await queueProposalReminders(env.DB, t);
    expect(await mine()).toEqual([]);
    const later = t + 2 * DAY + H;
    expect(await queueProposalReminders(env.DB, later)).toBeGreaterThanOrEqual(1);
    const q = await mine();
    // Everyone but the player who answered (and the coach, who created it, is reminded too).
    expect(q.map((x) => x.userId).sort()).toEqual(
      [a.owner.userId, a.admin.userId, a.coach.userId, a.manager.userId].sort(),
    );
    expect(q[0]!.title).toBe('Answers due soon: PRFC v Harlequins');
    await env.DB.prepare('DELETE FROM push_queue').run();
    await queueProposalReminders(env.DB, later + 10 * 60e3);
    expect(await mine()).toEqual([]);
  });

  it('proposals stay out of the calendar feed, reply reminders, kit at risk and stats', async () => {
    const a = await fixtureTeam('Out RFC');
    for (const x of everyone(a)) await subscribe(x);
    const t = Date.now();
    const id = uuidv7();
    await call('POST', `/api/v1/teams/${a.teamId}/events`, {
      cookie: a.coach.cookie,
      body: {
        id,
        type: 'social',
        title: 'Maybe a BBQ',
        startsAt: t + 20 * H,
        status: 'proposed',
        options: [{ id: uuidv7(), startsAt: t + 20 * H }],
      },
    });
    // Calendar feed.
    const cal = await call('GET', `/api/v1/teams/${a.teamId}/calendar`, {
      cookie: a.player.cookie,
    });
    const ics = String((await call('GET', cal.body.path)).body);
    expect(ics).toContain('v Rivals');
    expect(ics).not.toContain('Maybe a BBQ');
    // Replies aren't taken for proposals (answers are), so no RSVP rows, reminders or kit flags.
    const rsvp = await call(
      'PUT',
      `/api/v1/teams/${a.teamId}/events/${id}/rsvps/${a.player.memberId}`,
      {
        cookie: a.player.cookie,
        body: { status: 'no' },
      },
    );
    expect(rsvp.status).toBe(404);
    await env.DB.prepare(
      `INSERT INTO rsvps (event_id, member_id, team_id, status, updated_at) VALUES (?, ?, ?, 'no', ?)`,
    )
      .bind(id, a.player.memberId, a.teamId, t)
      .run();
    await env.DB.prepare(
      `INSERT INTO inventory_items (id, team_id, kind, name, status, holder_member_id, created_at, updated_at)
       VALUES (?, ?, 'balls', 'Balls', 'with_someone', ?, ?, ?)`,
    )
      .bind(uuidv7(), a.teamId, a.player.memberId, t, t)
      .run();
    await env.DB.prepare('DELETE FROM push_queue').run();
    await queueReminders(env.DB, t);
    await queueKitAtRisk(env.DB, t + 1000, 5 * 60e3);
    const q = await queued(a);
    expect(q.filter((x) => x.url.includes(id))).toEqual([]);
    expect(q.filter((x) => x.topic === 'kit')).toEqual([]);
    // Stats feed: a past proposal isn't a held event.
    await env.DB.prepare('UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?')
      .bind(t - 2 * DAY, t - 2 * DAY + H, id)
      .run();
    await env.DB.prepare("UPDATE events SET type = 'training' WHERE id = ?").bind(id).run();
    const stats = await call('GET', `/api/v1/teams/${a.teamId}/stats`, { cookie: a.player.cookie });
    expect(stats.status).toBe(200);
    expect(stats.body.marks.map((m: { eventId: string }) => m.eventId)).not.toContain(id);
  });
});
