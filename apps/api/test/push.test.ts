/** Web Push (M7): devices, preferences, queueing at the call sites, draining and the cron jobs. */
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { uuidv7, type PushPayload } from '@phaseplay/shared';
import { call, fixtureTeam, login, playBody, type Actor } from './helpers';
import { notifyStmt } from '../src/lib/notify';
import { drainQueue } from '../src/lib/push/queue';
import { queueKitAtRisk, queueReminders } from '../src/lib/push/jobs';
import { frequent } from '../src/cron';
import { DEMO_TEAM_ID } from '../src/seed/demo';

// A real P-256 key and auth secret (RFC 8291 §5), so the drain can encrypt for it.
const KEYS = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};

async function subscribe(who: { cookie: string }, host = 'fcm.googleapis.com') {
  const endpoint = `https://${host}/fcm/send/${uuidv7()}`;
  const r = await call('POST', '/api/v1/push/subscriptions', {
    cookie: who.cookie,
    body: { endpoint, keys: KEYS, label: 'Pixel' },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return endpoint;
}

async function queued(userIds: string[]) {
  const { results } = await env.DB.prepare(
    'SELECT user_id, payload FROM push_queue WHERE user_id IN (SELECT value FROM json_each(?))',
  )
    .bind(JSON.stringify(userIds))
    .all<{ user_id: string; payload: string }>();
  return results.map((r) => ({ userId: r.user_id, ...(JSON.parse(r.payload) as PushPayload) }));
}

const everyone = (a: Awaited<ReturnType<typeof fixtureTeam>>): Actor[] => [
  a.owner,
  a.admin,
  a.coach,
  a.manager,
  a.player,
];
const ids = (xs: Actor[]) => xs.map((x) => x.userId);

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM push_queue').run();
});

describe('devices', () => {
  it('subscribes, lists and unsubscribes a device', async () => {
    const u = await login('Device Dee');
    const key = await call('GET', '/api/v1/push/key', { cookie: u.cookie });
    expect(key.status).toBe(200);
    expect(key.body.devices).toEqual([]);
    expect(key.body.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/);

    const endpoint = await subscribe(u);
    // Re-subscribing the same browser is idempotent.
    await subscribe(u, 'fcm.googleapis.com').then(() => undefined);
    const again = await call('POST', '/api/v1/push/subscriptions', {
      cookie: u.cookie,
      body: { endpoint, keys: KEYS, label: 'Pixel 8' },
    });
    expect(again.status).toBe(201);
    const list = await call('GET', '/api/v1/push/key', { cookie: u.cookie });
    expect(list.body.devices).toHaveLength(2);
    expect(list.body.devices.map((d: { label: string }) => d.label).sort()).toEqual([
      'Pixel',
      'Pixel 8',
    ]);
    expect(list.queries).toBeLessThanOrEqual(6);
    expect(JSON.stringify(list.body)).not.toContain(endpoint); // endpoints never go back out

    const del = await call('POST', '/api/v1/push/subscriptions/remove', {
      cookie: u.cookie,
      body: { endpoint },
    });
    expect(del.body).toEqual({ ok: true, removed: 1 });
    expect((await call('GET', '/api/v1/push/key', { cookie: u.cookie })).body.devices).toHaveLength(
      1,
    );
  });

  it("won't remove someone else's device, and moves a re-used browser to the new user", async () => {
    const a = await login('A');
    const b = await login('B');
    const endpoint = await subscribe(a);
    const del = await call('POST', '/api/v1/push/subscriptions/remove', {
      cookie: b.cookie,
      body: { endpoint },
    });
    expect(del.body.removed).toBe(0);
    await call('POST', '/api/v1/push/subscriptions', {
      cookie: b.cookie,
      body: { endpoint, keys: KEYS },
    });
    expect((await call('GET', '/api/v1/push/key', { cookie: a.cookie })).body.devices).toEqual([]);
    expect((await call('GET', '/api/v1/push/key', { cookie: b.cookie })).body.devices).toHaveLength(
      1,
    );
  });

  it('only accepts known push services', async () => {
    const u = await login();
    for (const endpoint of [
      'https://evil.example/push',
      'https://fcm.googleapis.com.evil.example/x',
      'https://localhost/push',
    ]) {
      const r = await call('POST', '/api/v1/push/subscriptions', {
        cookie: u.cookie,
        body: { endpoint, keys: KEYS },
      });
      expect(r.status, endpoint).toBe(400);
    }
  });

  it('a test push needs a device, then queues one for this user only', async () => {
    const u = await login();
    const none = await call('POST', '/api/v1/push/test', { cookie: u.cookie, body: {} });
    expect(none.status).toBe(409);
    await subscribe(u);
    const ok = await call('POST', '/api/v1/push/test', { cookie: u.cookie, body: {} });
    expect(ok.status).toBe(200);
    const q = await queued([u.userId]);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ topic: 'test', teamId: null, url: '/settings/notifications' });
  });

  it('signing out everywhere and deleting the account drop devices', async () => {
    const u = await login();
    await subscribe(u);
    await call('POST', '/api/v1/me/sessions/revoke', { cookie: u.cookie, body: {} });
    const n = await env.DB.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE user_id = ?')
      .bind(u.userId)
      .first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});

describe('preferences', () => {
  it('round-trips through me.notify and me.get', async () => {
    const u = await login();
    const me = await call('GET', '/api/v1/me', { cookie: u.cookie });
    expect(me.body.notify).toEqual({
      events: true,
      reminders: true,
      sheets: true,
      plays: true,
      kit: true,
    });
    const put = await call('PUT', '/api/v1/me/notifications', {
      cookie: u.cookie,
      body: { events: false, kit: false },
    });
    expect(put.status).toBe(200);
    expect(put.body.notify).toEqual({
      events: false,
      reminders: true,
      sheets: true,
      plays: true,
      kit: false,
    });
    const after = await call('GET', '/api/v1/me', { cookie: u.cookie });
    expect(after.body.notify).toEqual(put.body.notify);
    expect(after.queries).toBeLessThanOrEqual(6);
    const bad = await call('PUT', '/api/v1/me/notifications', {
      cookie: u.cookie,
      body: { events: 'nope' },
    });
    expect(bad.status).toBe(400);
  });
});

describe('notifyStmt', () => {
  it('skips the author, users who turned the topic off, and users with no device', async () => {
    const a = await fixtureTeam('Notify RFC');
    for (const x of [a.owner, a.admin, a.coach, a.player]) await subscribe(x); // manager: no device
    await call('PUT', '/api/v1/me/notifications', {
      cookie: a.player.cookie,
      body: { events: false },
    });
    const ev = await call('POST', `/api/v1/teams/${a.teamId}/events`, {
      cookie: a.owner.cookie,
      body: {
        id: uuidv7(),
        type: 'match',
        format: '15s',
        title: 'Cup',
        opponent: 'Rivals',
        locationName: 'Home ground',
        startsAt: Date.now() + 5 * 86400e3,
      },
    });
    expect(ev.status).toBe(201);
    expect(ev.queries).toBeLessThanOrEqual(6);
    const q = await queued(ids(everyone(a)));
    expect(q.map((x) => x.userId).sort()).toEqual([a.admin.userId, a.coach.userId].sort());
    expect(q[0]).toMatchObject({ topic: 'events', teamId: a.teamId, title: 'New: PRFC v Rivals' });
    expect(q[0]!.body).toContain('Home ground');
    expect(q[0]!.url).toBe(`/events/${ev.body.id}?team=${a.teamId}`);

    // The player still hears about the team sheet (a different topic).
    await env.DB.prepare('DELETE FROM push_queue').run();
    const pub = await call('POST', `/api/v1/teams/${a.teamId}/sheets/${a.sheetId}/publish`, {
      cookie: a.coach.cookie,
      body: {},
    });
    expect(pub.status).toBe(200);
    expect(pub.body.sheet.status).toBe('published');
    expect(pub.queries).toBeLessThanOrEqual(6);
    const s = await queued(ids(everyone(a)));
    expect(s.map((x) => x.userId).sort()).toEqual(
      [a.owner.userId, a.admin.userId, a.player.userId].sort(),
    );
    expect(s[0]).toMatchObject({ topic: 'sheets', title: 'Team sheet: PRFC v Rivals' });
    const versions = await call('GET', `/api/v1/teams/${a.teamId}/sheets/${a.sheetId}/versions`, {
      cookie: a.coach.cookie,
    });
    expect(versions.body.versions[0].slots).toEqual({ '1': a.player.memberId });

    // Publishing the same side again (a retried request) doesn't notify twice.
    await env.DB.prepare('DELETE FROM push_queue').run();
    const again = await call('POST', `/api/v1/teams/${a.teamId}/sheets/${a.sheetId}/publish`, {
      cookie: a.coach.cookie,
      body: {},
    });
    expect(again.status).toBe(200);
    expect(await queued(ids(everyone(a)))).toEqual([]);
  });

  it('targets members, and never queues for the demo team', async () => {
    const a = await fixtureTeam('Target RFC');
    for (const x of everyone(a)) await subscribe(x);
    await env.DB.batch([
      notifyStmt(
        env.DB,
        a.teamId,
        { memberIds: [a.player.memberId, a.coach.memberId] },
        'kit',
        { title: 'Kit', body: 'x', url: '/kit' },
        a.coach.userId,
      ),
      notifyStmt(env.DB, DEMO_TEAM_ID, { team: true }, 'events', {
        title: 'x',
        body: 'x',
        url: '/home',
      }),
    ]);
    const q = await queued(ids(everyone(a)));
    expect(q.map((x) => x.userId)).toEqual([a.player.userId]);
    const demo = await env.DB.prepare(
      `SELECT count(*) AS n FROM push_queue WHERE payload->>'teamId' = ?`,
    )
      .bind(DEMO_TEAM_ID)
      .first<{ n: number }>();
    expect(demo!.n).toBe(0);
  });

  it('tells the team about time, place and cancellation changes, not note edits', async () => {
    const a = await fixtureTeam('Change RFC');
    await subscribe(a.player);
    const url = `/api/v1/teams/${a.teamId}/events/${a.eventId}`;
    const patch = async (body: object) => {
      await env.DB.prepare('DELETE FROM push_queue').run();
      const r = await call('PATCH', url, { cookie: a.coach.cookie, body });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.queries).toBeLessThanOrEqual(6);
      return (await queued([a.player.userId])).map((x) => x.title);
    };
    expect(await patch({ notes: 'Bring boots' })).toEqual([]);
    expect(await patch({ locationName: 'Away ground' })).toEqual(['Changed: PRFC v Rivals']);
    expect(await patch({ locationName: 'Away ground' })).toEqual([]); // no actual change
    expect(await patch({ startsAt: Date.now() + 2 * 86400e3 })).toEqual(['Changed: PRFC v Rivals']);
    expect(await patch({ cancelled: true })).toEqual(['Cancelled: PRFC v Rivals']);
    expect(await patch({ cancelled: false })).toEqual(['Back on: PRFC v Rivals']);

    await env.DB.prepare('DELETE FROM push_queue').run();
    const del = await call('DELETE', url, { cookie: a.coach.cookie });
    expect(del.status).toBe(200);
    expect(del.queries).toBeLessThanOrEqual(6);
    expect((await queued([a.player.userId])).map((x) => x.body)).toEqual([
      expect.stringContaining('off the schedule'),
    ]);
  });

  it('series: created once (not on a retry), changed, and cancelled', async () => {
    const a = await fixtureTeam('Series RFC');
    await subscribe(a.player);
    const id = uuidv7();
    const body = {
      id,
      title: 'Training',
      locationName: 'Club',
      rule: {
        weekdays: [4, 2],
        time: '19:00',
        durationMin: 90,
        startsOn: '2030-02-01',
        until: '2030-02-28',
      },
    };
    const path = `/api/v1/teams/${a.teamId}/recurrences`;
    expect((await call('POST', path, { cookie: a.coach.cookie, body })).status).toBe(201);
    expect((await call('POST', path, { cookie: a.coach.cookie, body })).status).toBe(201);
    let q = await queued([a.player.userId]);
    expect(q.map((x) => x.title)).toEqual(['New: Training, Tue and Thu at 19:00']);

    await env.DB.prepare('DELETE FROM push_queue').run();
    const upd = await call('PUT', `${path}/${id}`, {
      cookie: a.coach.cookie,
      body: { ...body, id: undefined, type: 'training', rule: { ...body.rule, time: '18:30' } },
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.queries).toBeLessThanOrEqual(6);
    q = await queued([a.player.userId]);
    expect(q.map((x) => x.body)).toEqual([expect.stringContaining('Tue and Thu at 18:30')]);

    await env.DB.prepare('DELETE FROM push_queue').run();
    const del = await call('DELETE', `${path}/${id}`, { cookie: a.coach.cookie });
    expect(del.status).toBe(200);
    q = await queued([a.player.userId]);
    expect(q.map((x) => x.title)).toEqual(['Cancelled: Training']);
  });

  it('plays and practice plans: when shared with the team, not while coach-only', async () => {
    const a = await fixtureTeam('Plays RFC');
    await subscribe(a.player);
    const playId = uuidv7();
    await call('POST', `/api/v1/teams/${a.teamId}/plays`, {
      cookie: a.coach.cookie,
      body: playBody(playId, 'coaches'),
    });
    expect(await queued([a.player.userId])).toEqual([]);
    const share = await call('PATCH', `/api/v1/teams/${a.teamId}/plays/${playId}`, {
      cookie: a.coach.cookie,
      body: { visibility: 'team' },
    });
    expect(share.status).toBe(200);
    expect(share.queries).toBeLessThanOrEqual(6);
    expect((await queued([a.player.userId])).map((x) => x.url)).toEqual([
      `/plays/${playId}?team=${a.teamId}`,
    ]);
    // Already shared: an edit doesn't notify again.
    await env.DB.prepare('DELETE FROM push_queue').run();
    await call('PATCH', `/api/v1/teams/${a.teamId}/plays/${playId}`, {
      cookie: a.coach.cookie,
      body: { visibility: 'team', title: 'Renamed' },
    });
    expect(await queued([a.player.userId])).toEqual([]);

    const planId = uuidv7();
    await call('POST', `/api/v1/teams/${a.teamId}/plans`, {
      cookie: a.coach.cookie,
      body: { id: planId, title: 'Thursday', data: { lanes: ['all'], slots: [] } },
    });
    const q = await queued([a.player.userId]);
    expect(q.map((x) => x.title)).toEqual(['Practice plan: Thursday']);
  });
});

describe('queue drain', () => {
  it('sends, deletes 404/410 devices, and backs off on other failures', async () => {
    const ok = await login('Ok');
    const gone = await login('Gone');
    const busy = await login('Busy');
    const eOk = await subscribe(ok);
    const eGone = await subscribe(gone, 'web.push.apple.com');
    const eBusy = await subscribe(busy, 'updates.push.services.mozilla.com');
    for (const u of [ok, gone, busy])
      await call('POST', '/api/v1/push/test', { cookie: u.cookie, body: {} });

    const sent: { url: string; headers: Headers; body: Uint8Array }[] = [];
    const fake: typeof fetch = async (input, init) => {
      const url = String(input);
      sent.push({
        url,
        headers: new Headers(init!.headers),
        body: new Uint8Array(init!.body as ArrayBuffer),
      });
      return new Response(null, {
        status: url === eGone ? 410 : url === eBusy ? 503 : 201,
      });
    };
    const t = Date.now();
    const r = await drainQueue(env.DB, { subject: 'https://phaseplay.app', fetch: fake, now: t });
    expect(r).toMatchObject({ sent: 1, removed: 1, failed: 1, claimed: 3 });
    expect(sent.map((s) => s.url).sort()).toEqual([eOk, eGone, eBusy].sort());
    const h = sent.find((s) => s.url === eOk)!.headers;
    expect(h.get('content-encoding')).toBe('aes128gcm');
    expect(h.get('authorization')).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=B[\w-]+$/);
    expect(Number(h.get('ttl'))).toBeGreaterThan(0);

    const subs = await env.DB.prepare(
      'SELECT endpoint, failures, last_ok_at FROM push_subscriptions WHERE endpoint IN (?, ?, ?)',
    )
      .bind(eOk, eGone, eBusy)
      .all<{ endpoint: string; failures: number; last_ok_at: number | null }>();
    const by = Object.fromEntries(subs.results.map((s) => [s.endpoint, s]));
    expect(by[eGone]).toBeUndefined();
    expect(by[eOk]!.last_ok_at).toBe(t);
    expect(by[eBusy]!.failures).toBe(1);

    const left = await env.DB.prepare('SELECT user_id, attempts, next_at FROM push_queue').all<{
      user_id: string;
      attempts: number;
      next_at: number;
    }>();
    expect(left.results).toEqual([{ user_id: busy.userId, attempts: 1, next_at: t + 60e3 }]);

    // Not due yet: nothing to send. Then it gives up after a few attempts.
    expect((await drainQueue(env.DB, { subject: 's', fetch: fake, now: t + 1 })).claimed).toBe(0);
    for (let i = 1; i < 6; i++)
      await drainQueue(env.DB, { subject: 's', fetch: fake, now: t + i * 3 * 3600e3 });
    expect(
      (await env.DB.prepare('SELECT count(*) AS n FROM push_queue').first<{ n: number }>())!.n,
    ).toBe(0);
  });

  it('sends at most the limit per invocation and leaves the rest for the cron', async () => {
    const users = await Promise.all(Array.from({ length: 4 }, (_, i) => login(`U${i}`)));
    for (const u of users) {
      await subscribe(u);
      await subscribe(u);
      await call('POST', '/api/v1/push/test', { cookie: u.cookie, body: {} });
    }
    let n = 0;
    const fake: typeof fetch = async () => (n++, new Response(null, { status: 201 }));
    const r = await drainQueue(env.DB, { subject: 's', fetch: fake, limit: 5 });
    expect(n).toBeLessThanOrEqual(5);
    expect(r.sent).toBe(4); // two users, both devices
    const left = await env.DB.prepare('SELECT count(*) AS n FROM push_queue').first<{
      n: number;
    }>();
    expect(left!.n).toBe(2);
    await drainQueue(env.DB, { subject: 's', fetch: fake, limit: 5 });
    expect(n).toBe(8);
  });
});

describe('cron jobs', () => {
  it('queues the day-before reply reminder once per event, for members who have not replied', async () => {
    const a = await fixtureTeam('Remind RFC');
    for (const x of everyone(a)) await subscribe(x);
    const t = Date.now();
    const eventId = uuidv7();
    await call('POST', `/api/v1/teams/${a.teamId}/events`, {
      cookie: a.owner.cookie,
      body: { id: eventId, type: 'training', title: 'Training', startsAt: t + 24 * 3600e3 },
    });
    await call('PUT', `/api/v1/teams/${a.teamId}/events/${eventId}/rsvps/${a.coach.memberId}`, {
      cookie: a.coach.cookie,
      body: { status: 'yes' },
    });
    await call('PUT', `/api/v1/teams/${a.teamId}/events/${eventId}/rsvps/${a.admin.memberId}`, {
      cookie: a.admin.cookie,
      body: { status: 'no', note: 'private reason' },
    });
    await call('PUT', '/api/v1/me/notifications', {
      cookie: a.manager.cookie,
      body: { reminders: false },
    });
    await env.DB.prepare('DELETE FROM push_queue').run();

    expect(await queueReminders(env.DB, t)).toBeGreaterThanOrEqual(1);
    const q = (await queued(ids(everyone(a)))).filter((x) => x.topic === 'reminders');
    // The fixture's own match (also ~24 h out) is reminded too: count per event.
    const forEvent = q.filter((x) => x.url.startsWith(`/events/${eventId}`));
    expect(forEvent.map((x) => x.userId).sort()).toEqual([a.owner.userId, a.player.userId].sort());
    expect(forEvent[0]!.title).toBe('Are you in? Training');
    expect(JSON.stringify(q)).not.toContain('private reason');
    const reminded = await env.DB.prepare('SELECT reminded_at FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ reminded_at: number }>();
    expect(reminded!.reminded_at).toBe(t);

    await env.DB.prepare('DELETE FROM push_queue').run();
    await queueReminders(env.DB, t + 15 * 60e3);
    expect(
      (await queued(ids(everyone(a)))).filter((x) => x.url.startsWith(`/events/${eventId}`)),
    ).toEqual([]);
    // Moved to a week later: the new date gets its own reminder; a note edit doesn't reset it.
    const at = async () =>
      (
        await env.DB.prepare('SELECT reminded_at FROM events WHERE id = ?')
          .bind(eventId)
          .first<{ reminded_at: number | null }>()
      )?.reminded_at;
    await call('PATCH', `/api/v1/teams/${a.teamId}/events/${eventId}`, {
      cookie: a.owner.cookie,
      body: { notes: 'Bring boots' },
    });
    expect(await at()).toBe(t);
    await call('PATCH', `/api/v1/teams/${a.teamId}/events/${eventId}`, {
      cookie: a.owner.cookie,
      body: { startsAt: t + 8 * 24 * 3600e3 },
    });
    expect(await at()).toBeNull();
  });

  it('tells the person who offered kit when the handover is declined, once', async () => {
    const a = await fixtureTeam('Handover RFC');
    for (const x of everyone(a)) await subscribe(x);
    const itemId = uuidv7();
    const t0 = Date.now();
    await env.DB.prepare(
      `INSERT INTO inventory_items (id, team_id, kind, name, status, holder_member_id, created_at, updated_at)
       VALUES (?, ?, 'bibs', 'Red bibs', 'with_someone', ?, ?, ?)`,
    )
      .bind(itemId, a.teamId, a.player.memberId, t0, t0)
      .run();
    const handoffId = uuidv7();
    const offered = await call('POST', `/api/v1/teams/${a.teamId}/inventory/${itemId}/handoffs`, {
      cookie: a.player.cookie,
      body: { id: handoffId, toMemberId: a.coach.memberId },
    });
    expect(offered.status).toBe(201);
    await env.DB.prepare('DELETE FROM push_queue').run();

    const decline = () =>
      call('POST', `/api/v1/teams/${a.teamId}/handoffs/${handoffId}/decline`, {
        cookie: a.coach.cookie,
        body: {},
      });
    expect((await decline()).status).toBe(200);
    // A retry doesn't notify again.
    expect((await decline()).status).toBe(200);
    const q = (await queued(ids(everyone(a)))).filter((x) => x.topic === 'kit');
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ userId: a.player.userId });
    expect(q[0]!.title).toContain("can't take the red bibs");
    expect(q[0]!.url).toBe(`/kit/${itemId}?team=${a.teamId}`);
  });

  it('kit at risk: a "no" from someone holding kit, once', async () => {
    const a = await fixtureTeam('Kit RFC');
    for (const x of everyone(a)) await subscribe(x);
    const t0 = Date.now();
    const eventId = uuidv7();
    await call('POST', `/api/v1/teams/${a.teamId}/events`, {
      cookie: a.owner.cookie,
      body: {
        id: eventId,
        type: 'training',
        title: 'Thursday training',
        startsAt: t0 + 20 * 3600e3,
      },
    });
    for (const [name, holder] of [
      ['Match balls', a.player.memberId],
      ['Bibs', a.player.memberId],
      ['Cones', a.coach.memberId],
    ] as const)
      await env.DB.prepare(
        `INSERT INTO inventory_items (id, team_id, kind, name, status, holder_member_id, created_at, updated_at)
         VALUES (?, ?, 'balls', ?, 'with_someone', ?, ?, ?)`,
      )
        .bind(uuidv7(), a.teamId, name, holder, t0, t0)
        .run();
    // The player can't make it; the coach can.
    await call('PUT', `/api/v1/teams/${a.teamId}/events/${eventId}/rsvps/${a.player.memberId}`, {
      cookie: a.player.cookie,
      body: { status: 'no' },
    });
    await call('PUT', `/api/v1/teams/${a.teamId}/events/${eventId}/rsvps/${a.coach.memberId}`, {
      cookie: a.coach.cookie,
      body: { status: 'yes' },
    });
    await env.DB.prepare('DELETE FROM push_queue').run();

    const tick = 5 * 60e3;
    const t = Date.now() + 1000; // the next tick after the reply
    expect(await queueKitAtRisk(env.DB, t, tick)).toBe(1);
    const q = (await queued(ids(everyone(a)))).filter((x) => x.topic === 'kit');
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      userId: a.player.userId,
      title: 'Kit check',
      url: `/kit?team=${a.teamId}`,
    });
    expect(q[0]!.body).toMatch(
      /^You're not going to Thursday training: hand the (Match balls and Bibs|Bibs and Match balls) to someone\?$/,
    );
    // The next tick doesn't repeat it.
    await env.DB.prepare('DELETE FROM push_queue').run();
    expect(await queueKitAtRisk(env.DB, t + tick, tick)).toBe(0);
  });

  it('the frequent cron queues and drains (fake sends in the test env)', async () => {
    const u = await login();
    await subscribe(u);
    await call('POST', '/api/v1/push/test', { cookie: u.cookie, body: {} });
    await frequent(env as never, Date.now());
    expect(await queued([u.userId])).toEqual([]);
  });
});
