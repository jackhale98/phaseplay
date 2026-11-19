/** "Time TBD" games and events: storage, checks, notifications, calendar feed and proposals. */
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  addDays,
  dateInTz,
  tbdStartsAt,
  uuidv7,
  zonedToUtc,
  type PushPayload,
  type SyncResponse,
} from '@phaseplay/shared';
import { call, fixtureTeam, type Actor } from './helpers';
import { queueKitAtRisk, queueReminders } from '../src/lib/push/jobs';
import { dateText } from '../src/lib/notify';

const TZ = 'Europe/London';
const DAY = 86400e3;
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
async function pushesTo(who: Actor) {
  const { results } = await env.DB.prepare('SELECT payload FROM push_queue WHERE user_id = ?')
    .bind(who.userId)
    .all<{ payload: string }>();
  return results.map((r) => JSON.parse(r.payload) as PushPayload);
}
const budget = (r: { queries: number }) => expect(r.queries, 'query budget').toBeLessThanOrEqual(6);
const events = (a: Team) => `/api/v1/teams/${a.teamId}/events`;
const sync = async (who: Actor, a: Team) =>
  (
    await call('GET', `/api/v1/teams/${a.teamId}/sync?since=0&caps=proposals`, {
      cookie: who.cookie,
    })
  ).body as SyncResponse;

/** A date `n` days ahead in team time. */
const dateAhead = (n: number) => dateInTz(Date.now() + n * DAY, TZ);

async function tbdSocial(a: Team, date = dateAhead(5)) {
  const id = uuidv7();
  const r = await call('POST', events(a), {
    cookie: a.coach.cookie,
    body: {
      id,
      type: 'social',
      title: 'Quiz night',
      startsAt: tbdStartsAt(date, TZ),
      timeTbd: true,
      locationName: 'Clubhouse',
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  budget(r);
  return { id, date };
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM push_queue').run();
});

describe('time TBD', () => {
  it('creates a TBD social stored at local noon; the squad hears "time TBD"', async () => {
    const a = await fixtureTeam('Tbd RFC');
    await subscribe(a.player);
    const { id, date } = await tbdSocial(a);
    const ev = (await sync(a.player, a)).events.find((e) => e.id === id)!;
    expect(ev).toMatchObject({ timeTbd: true, meetAt: null, endsAt: null });
    expect(ev.startsAt).toBe(zonedToUtc(date, '12:00', TZ));
    const [push] = await pushesTo(a.player);
    expect(push!.title).toBe('New: Quiz night');
    expect(push!.body).toBe(`${dateText(ev.startsAt, TZ)}, time TBD · Clubhouse. Can you make it?`);
    // Timed events still say the time, and default to timeTbd false.
    expect((await sync(a.player, a)).events.find((e) => e.id === a.eventId)!.timeTbd).toBe(false);
  });

  it('refuses TBD practices and meet or finish times on a TBD event', async () => {
    const a = await fixtureTeam('Tbd Checks RFC');
    const start = tbdStartsAt(dateAhead(4), TZ);
    const bad = [
      { type: 'training', title: 'Practice', startsAt: start, timeTbd: true },
      { type: 'social', title: 'x', startsAt: start, timeTbd: true, endsAt: start + 3600e3 },
      { type: 'match', title: 'x', startsAt: start, timeTbd: true, meetAt: start - 3600e3 },
    ];
    for (const b of bad) {
      const r = await call('POST', events(a), {
        cookie: a.coach.cookie,
        body: { id: uuidv7(), ...b },
      });
      expect(r.status, JSON.stringify(b)).toBe(400);
    }
    const { id } = await tbdSocial(a);
    const patch = (body: unknown) =>
      call('PATCH', `${events(a)}/${id}`, { cookie: a.coach.cookie, body });
    // A meet or finish time needs a time first; a TBD event can't become a practice.
    for (const body of [
      { meetAt: start - 3600e3 },
      { endsAt: start + 3600e3 },
      { type: 'training' },
    ]) {
      const r = await patch(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      budget(r);
    }
    // Turning a timed event with a meet time into TBD must clear it too.
    const timed = await call('PATCH', `${events(a)}/${a.eventId}`, {
      cookie: a.coach.cookie,
      body: { meetAt: Date.now() + DAY - 3600e3 },
    });
    expect(timed.status).toBe(200);
    const r = await call('PATCH', `${events(a)}/${a.eventId}`, {
      cookie: a.coach.cookie,
      body: { timeTbd: true },
    });
    expect(r.status).toBe(400);
    // Practices can't go TBD by a patch either.
    const practice = (await sync(a.coach, a)).events.find((e) => e.type === 'training')!;
    const p = await call('PATCH', `${events(a)}/${practice.id}`, {
      cookie: a.coach.cookie,
      body: { timeTbd: true, meetAt: null, endsAt: null },
    });
    expect(p.status).toBe(400);
  });

  it('setting the time says "Time set", taking it back says "Time now TBD"', async () => {
    const a = await fixtureTeam('Tbd Push RFC');
    await subscribe(a.player);
    const { id, date } = await tbdSocial(a);
    await env.DB.prepare('DELETE FROM push_queue').run();
    const at = zonedToUtc(date, '14:30', TZ);
    const set = await call('PATCH', `${events(a)}/${id}`, {
      cookie: a.coach.cookie,
      body: { startsAt: at, timeTbd: false },
      ifMatch: 1,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    budget(set);
    expect(set.body.event).toMatchObject({ timeTbd: false, startsAt: at, version: 2 });
    let q = await pushesTo(a.player);
    expect(q.map((x) => [x.title, x.body])).toEqual([
      ['Changed: Quiz night', `Time set: 14:30 · ${dateText(at, TZ)} · Clubhouse.`],
    ]);

    await env.DB.prepare('DELETE FROM push_queue').run();
    const back = await call('PATCH', `${events(a)}/${id}`, {
      cookie: a.coach.cookie,
      body: { startsAt: tbdStartsAt(date, TZ), timeTbd: true, meetAt: null, endsAt: null },
    });
    expect(back.status).toBe(200);
    q = await pushesTo(a.player);
    expect(q.map((x) => x.body)).toEqual([`Time now TBD · ${dateText(at, TZ)} · Clubhouse.`]);
  });

  it('a TBD event today still counts as upcoming after noon (edits still notify)', async () => {
    const a = await fixtureTeam('Tbd Today RFC');
    await subscribe(a.player);
    const id = uuidv7();
    const today = dateInTz(Date.now(), TZ);
    // Noon today may already have passed; the event is still on until the end of the day.
    await call('POST', events(a), {
      cookie: a.coach.cookie,
      body: { id, type: 'social', title: 'BBQ', startsAt: tbdStartsAt(today, TZ), timeTbd: true },
    });
    const end = zonedToUtc(addDays(today, 1), '00:00', TZ);
    if (end - Date.now() > 10 * 60e3) {
      expect((await pushesTo(a.player)).map((x) => x.title)).toEqual(['New: BBQ']);
    }
  });

  it('the calendar feed shows TBD events as all-day; setting a time updates it', async () => {
    const a = await fixtureTeam('Tbd Cal RFC');
    const { id, date } = await tbdSocial(a);
    const cal = await call('GET', `/api/v1/teams/${a.teamId}/calendar`, {
      cookie: a.player.cookie,
    });
    const feed = async () => {
      const text = String((await call('GET', cal.body.path)).body);
      return text
        .split('BEGIN:VEVENT')
        .find((x) => x.includes(`UID:${id}@`))!
        .replace(/\r\n /g, '');
    };
    const ymd = (d: string) => d.replace(/-/g, '');
    let ev = await feed();
    expect(ev).toContain(`DTSTART;VALUE=DATE:${ymd(date)}`);
    expect(ev).toContain(`DTEND;VALUE=DATE:${ymd(addDays(date, 1))}`);
    expect(ev).toContain('DESCRIPTION:Time TBD.');
    expect(ev).toContain('SEQUENCE:1');
    const at = zonedToUtc(date, '19:30', TZ);
    await call('PATCH', `${events(a)}/${id}`, {
      cookie: a.coach.cookie,
      body: { startsAt: at, timeTbd: false },
    });
    ev = await feed();
    expect(ev).not.toContain('VALUE=DATE');
    expect(ev).toContain(
      `DTSTART:${new Date(at).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    );
    expect(ev).toContain('SEQUENCE:2');
    expect(ev).not.toContain('Time TBD');
  });

  it('day-before reply reminders go out for TBD events with the date', async () => {
    const a = await fixtureTeam('Tbd Remind RFC');
    await subscribe(a.player);
    const date = dateAhead(3);
    const { id } = await tbdSocial(a, date);
    await env.DB.prepare('DELETE FROM push_queue').run();
    // The morning of the day before.
    const t = zonedToUtc(addDays(date, -1), '09:00', TZ);
    expect(await queueReminders(env.DB, t)).toBeGreaterThanOrEqual(1);
    const q = (await pushesTo(a.player)).filter((x) => x.url.startsWith(`/events/${id}`));
    expect(q.map((x) => x.body)).toEqual([
      `${dateText(tbdStartsAt(date, TZ), TZ)}, time TBD · Clubhouse. Tap to reply.`,
    ]);
  });

  it('proposal dates can be TBD; confirming keeps TBD unless a time is given', async () => {
    const a = await fixtureTeam('Tbd Poll RFC');
    for (const x of [a.player, a.manager]) await subscribe(x);
    const d1 = dateAhead(6);
    const d2 = dateAhead(13);
    const opts = [
      { id: uuidv7(), startsAt: tbdStartsAt(d1, TZ), timeTbd: true },
      { id: uuidv7(), startsAt: zonedToUtc(d2, '15:00', TZ), meetAt: zonedToUtc(d2, '14:00', TZ) },
    ];
    const create = (id: string, options: unknown[]) =>
      call('POST', events(a), {
        cookie: a.coach.cookie,
        body: {
          id,
          type: 'match',
          format: '15s',
          title: 'Friendly',
          opponent: 'Quins',
          startsAt: opts[0]!.startsAt,
          status: 'proposed',
          options,
        },
      });
    // A TBD date can't have a meet time.
    expect(
      (await create(uuidv7(), [{ ...opts[0], meetAt: opts[0]!.startsAt - 3600e3 }])).status,
    ).toBe(400);
    const id = uuidv7();
    const r = await create(id, opts);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    budget(r);
    const s = await sync(a.coach, a);
    // The event mirrors its earliest date, TBD included.
    expect(s.events.find((e) => e.id === id)).toMatchObject({ timeTbd: true, meetAt: null });
    const byId = Object.fromEntries(
      s.options!.filter((o) => o.eventId === id).map((o) => [o.id, o]),
    );
    expect(byId[opts[0]!.id]!.timeTbd).toBe(true);
    expect(byId[opts[1]!.id]!.timeTbd).toBe(false);

    // Editing: the second date becomes TBD too (its meet time goes).
    const edit = await call('PATCH', `${events(a)}/${id}`, {
      cookie: a.coach.cookie,
      body: {
        options: [opts[0], { id: opts[1]!.id, startsAt: tbdStartsAt(d2, TZ), timeTbd: true }],
      },
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const s2 = await sync(a.coach, a);
    expect(s2.options!.find((o) => o.id === opts[1]!.id)).toMatchObject({
      timeTbd: true,
      meetAt: null,
    });

    await env.DB.prepare('DELETE FROM push_queue').run();
    const confirm = await call('POST', `${events(a)}/${id}/confirm`, {
      cookie: a.coach.cookie,
      body: { optionId: opts[0]!.id, meetAt: opts[0]!.startsAt - 3600e3 },
    });
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
    budget(confirm);
    // Still TBD: no time given, so no meet time either.
    expect(confirm.body.event).toMatchObject({
      status: 'confirmed',
      timeTbd: true,
      startsAt: opts[0]!.startsAt,
      meetAt: null,
    });
    expect((await pushesTo(a.manager)).map((x) => x.body)).toEqual([
      `${dateText(opts[0]!.startsAt, TZ)}, time TBD. Can you make it?`,
    ]);

    // Confirming with a time sets it.
    const id2 = uuidv7();
    expect(
      (await create(id2, [{ id: uuidv7(), startsAt: tbdStartsAt(d2, TZ), timeTbd: true }])).status,
    ).toBe(201);
    const opt = (await sync(a.coach, a)).options!.find((o) => o.eventId === id2)!;
    const at = zonedToUtc(d2, '14:30', TZ);
    const c2 = await call('POST', `${events(a)}/${id2}/confirm`, {
      cookie: a.coach.cookie,
      body: { optionId: opt.id, startsAt: at, meetAt: at - 3600e3 },
    });
    expect(c2.body.event).toMatchObject({ timeTbd: false, startsAt: at, meetAt: at - 3600e3 });
  });
});

describe('time TBD: review follow-ups', () => {
  const reminded = async (id: string) =>
    (
      await env.DB.prepare('SELECT reminded_at FROM events WHERE id = ?')
        .bind(id)
        .first<{ reminded_at: number | null }>()
    )?.reminded_at ?? null;

  it('setting the time the same day keeps the sent reminder; a new date clears it', async () => {
    const a = await fixtureTeam('Tbd Keep RFC');
    const { id, date } = await tbdSocial(a);
    await env.DB.prepare('UPDATE events SET reminded_at = 1 WHERE id = ?').bind(id).run();
    const patch = (body: unknown) =>
      call('PATCH', `${events(a)}/${id}`, { cookie: a.coach.cookie, body });
    expect((await patch({ startsAt: zonedToUtc(date, '19:00', TZ), timeTbd: false })).status).toBe(
      200,
    );
    expect(await reminded(id)).toBe(1);
    expect((await patch({ timeTbd: true })).status).toBe(200);
    expect(await reminded(id)).toBe(1);
    expect((await patch({ startsAt: tbdStartsAt(addDays(date, 1), TZ) })).status).toBe(200);
    expect(await reminded(id)).toBeNull();
  });

  it('an older build sets the time with only a start (and a meet time); "Time set" goes out', async () => {
    const a = await fixtureTeam('Tbd Old RFC');
    await subscribe(a.player);
    const { id, date } = await tbdSocial(a);
    await env.DB.prepare('DELETE FROM push_queue').run();
    const at = zonedToUtc(date, '18:00', TZ);
    const r = await call('PATCH', `${events(a)}/${id}`, {
      cookie: a.coach.cookie,
      body: { startsAt: at, meetAt: at - 1800e3 },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    budget(r);
    expect(r.body.event).toMatchObject({ timeTbd: false, startsAt: at, meetAt: at - 1800e3 });
    expect((await pushesTo(a.player)).map((x) => x.body)).toEqual([
      `Time set: 18:00 · ${dateText(at, TZ)} · Clubhouse.`,
    ]);
    // A start at local noon from an old build (its form shows 12:00) keeps it TBD, e.g. a new date.
    const { id: id2, date: d2 } = await tbdSocial(a, dateAhead(8));
    const moved = await call('PATCH', `${events(a)}/${id2}`, {
      cookie: a.coach.cookie,
      body: { startsAt: tbdStartsAt(addDays(d2, 1), TZ) },
    });
    expect(moved.body.event.timeTbd).toBe(true);
  });

  it('TBD is always stored at local noon', async () => {
    const a = await fixtureTeam('Tbd Noon RFC');
    const date = dateAhead(6);
    const id = uuidv7();
    // A timed game made TBD with a patch, and a create with an off-noon start.
    await call('POST', events(a), {
      cookie: a.coach.cookie,
      body: { id, type: 'match', title: 'v X', startsAt: zonedToUtc(date, '15:00', TZ) },
    });
    const r = await call('PATCH', `${events(a)}/${id}`, {
      cookie: a.coach.cookie,
      body: { timeTbd: true },
    });
    expect(r.body.event).toMatchObject({ timeTbd: true, startsAt: tbdStartsAt(date, TZ) });
  });

  it('kit at risk: a TBD event is still to come all afternoon, not after its day', async () => {
    const a = await fixtureTeam('Tbd Kit RFC');
    await subscribe(a.player);
    const { id, date } = await tbdSocial(a, dateAhead(3));
    await env.DB.prepare(
      `INSERT INTO inventory_items (id, team_id, kind, name, status, holder_member_id, created_at, updated_at)
       VALUES (?, ?, 'balls', 'Match balls', 'with_someone', ?, 0, 0)`,
    )
      .bind(uuidv7(), a.teamId, a.player.memberId)
      .run();
    await call('PUT', `${events(a)}/${id}/rsvps/${a.player.memberId}`, {
      cookie: a.player.cookie,
      body: { status: 'no' },
    });
    const tick = 5 * 60e3;
    const at = async (t: number) => {
      await env.DB.prepare('DELETE FROM push_queue').run();
      await env.DB.prepare('UPDATE rsvps SET updated_at = ? WHERE event_id = ?')
        .bind(t - 1000, id)
        .run();
      return queueKitAtRisk(env.DB, t, tick);
    };
    expect(await at(zonedToUtc(date, '16:00', TZ))).toBe(1);
    expect(await at(zonedToUtc(addDays(date, 1), '00:30', TZ))).toBe(0);
  });

  it('a team timezone change keeps TBD events (and proposal dates) on their date', async () => {
    const a = await fixtureTeam('Tbd Zone RFC');
    const { id, date } = await tbdSocial(a);
    const pid = uuidv7();
    const oid = uuidv7();
    await call('POST', events(a), {
      cookie: a.coach.cookie,
      body: {
        id: pid,
        type: 'social',
        title: 'BBQ',
        startsAt: tbdStartsAt(date, TZ),
        status: 'proposed',
        options: [{ id: oid, startsAt: tbdStartsAt(date, TZ), timeTbd: true }],
      },
    });
    const NZ = 'Pacific/Auckland';
    const r = await call('PATCH', `/api/v1/teams/${a.teamId}`, {
      cookie: a.owner.cookie,
      body: { timezone: NZ },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    budget(r);
    const s = await sync(a.coach, a);
    expect(s.events.find((e) => e.id === id)!.startsAt).toBe(tbdStartsAt(date, NZ));
    expect(s.options!.find((o) => o.id === oid)!.startsAt).toBe(tbdStartsAt(date, NZ));
    expect(dateInTz(tbdStartsAt(date, NZ), NZ)).toBe(date);
  });
});
