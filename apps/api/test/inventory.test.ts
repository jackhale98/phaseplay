/** Kit and inventory (PLAN.md M9 §Tests). */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { uuidv7, type InventoryItem, type SyncResponse } from '@phaseplay/shared';
import { call, fixtureTeam, type Actor, type Res } from './helpers';

type Team = Awaited<ReturnType<typeof fixtureTeam>>;

const base = (t: Team) => `/api/v1/teams/${t.teamId}`;
const ok = (r: Res, status = 200) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.queries, 'query budget').toBeLessThanOrEqual(6);
  return r.body;
};

async function addItem(t: Team, who: Actor, extra: Record<string, unknown> = {}) {
  const id = uuidv7();
  const r = await call('PUT', `${base(t)}/inventory/${id}`, {
    cookie: who.cookie,
    body: { kind: 'tackle_shields', name: 'Tackle shields', quantity: 6, home: 'Shed', ...extra },
  });
  return { id, r, item: r.body.item as InventoryItem };
}
const act = (t: Team, who: Actor, id: string, action: string, body: unknown = {}) =>
  call('POST', `${base(t)}/inventory/${id}/${action}`, { cookie: who.cookie, body });
const offer = (t: Team, who: Actor, itemId: string, toMemberId: string, id = uuidv7()) =>
  call('POST', `${base(t)}/inventory/${itemId}/handoffs`, {
    cookie: who.cookie,
    body: { id, toMemberId, note: 'Can you take these?' },
  });
const answer = (t: Team, who: Actor, handoffId: string, how: 'accept' | 'decline') =>
  call('POST', `${base(t)}/handoffs/${handoffId}/${how}`, { cookie: who.cookie, body: {} });
const history = async (t: Team, who: Actor, id: string) =>
  ok(await call('GET', `${base(t)}/inventory/${id}/history`, { cookie: who.cookie })).events as {
    kind: string;
    fromMemberId: string | null;
    toMemberId: string | null;
    note: string | null;
  }[];
const sync = async (t: Team, who: Actor, since = 0) =>
  ok(await call('GET', `${base(t)}/sync?since=${since}`, { cookie: who.cookie })) as SyncResponse;

async function joinPlayer(t: Team, name: string): Promise<Actor> {
  const inv = await call('POST', `${base(t)}/invites`, {
    cookie: t.owner.cookie,
    body: { id: uuidv7(), role: 'player', maxUses: 1 },
  });
  const login = await call('POST', '/api/v1/test/login', {
    body: { userId: uuidv7(), displayName: name },
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
  const acc = await call('POST', '/api/v1/invites/accept', {
    cookie,
    body: { token: inv.body.token },
  });
  return { userId: '', cookie, displayName: name, memberId: acc.body.memberId };
}

describe('kit items', () => {
  it('creates, edits with If-Match, and appends history', async () => {
    const t = await fixtureTeam();
    const { id, r, item } = await addItem(t, t.coach, { tag: 'SH-01', notes: 'Two have tears' });
    ok(r, 201);
    expect(item).toMatchObject({ status: 'available', holderMemberId: null, version: 1 });

    const edit = (version: number, condition = 'worn') =>
      call('PUT', `${base(t)}/inventory/${id}`, {
        cookie: t.manager.cookie,
        ifMatch: version,
        body: { kind: 'tackle_shields', name: 'Tackle shields', quantity: 6, condition },
      });
    expect(ok(await edit(1)).item).toMatchObject({ condition: 'worn', version: 2, tag: null });
    const stale = await edit(1, 'good');
    expect(stale.status).toBe(409);
    expect(stale.body.error.latest.version).toBe(2);

    const coachView = await history(t, t.coach, id);
    expect(coachView.map((e) => e.kind)).toEqual(['created', 'condition_changed']);
    expect(coachView[1]!.note).toBe('Good → Worn');
    // Notes are for kit managers.
    expect((await history(t, t.player, id))[1]!.note).toBeNull();
  });

  it('tags are unique per team, not across teams', async () => {
    const a = await fixtureTeam('Team A');
    const b = await fixtureTeam('Team B');
    ok((await addItem(a, a.owner, { tag: 'BALL-1' })).r, 201);
    const dup = await addItem(a, a.coach, { tag: 'BALL-1' });
    expect(dup.r.status).toBe(409);
    ok((await addItem(b, b.owner, { tag: 'BALL-1' })).r, 201);
    // Editing another item onto a used tag is also a conflict.
    const other = await addItem(a, a.owner, { tag: 'BALL-2' });
    const clash = await call('PUT', `${base(a)}/inventory/${other.id}`, {
      cookie: a.owner.cookie,
      body: { kind: 'balls', name: 'Ball', tag: 'BALL-1' },
    });
    expect(clash.status).toBe(409);
  });

  it("another team's item is 404 on every route", async () => {
    const a = await fixtureTeam('Team A');
    const b = await fixtureTeam('Team B');
    const { id } = await addItem(a, a.owner);
    for (const action of ['assign', 'return', 'lost', 'found', 'retire'])
      expect((await act(b, b.owner, id, action, { memberId: null })).status).toBe(404);
    expect(
      (await call('GET', `${base(b)}/inventory/${id}/history`, { cookie: b.owner.cookie })).status,
    ).toBe(404);
    const put = await call('PUT', `${base(b)}/inventory/${id}`, {
      cookie: b.owner.cookie,
      body: { kind: 'balls', name: 'Mine now' },
    });
    expect(put.status).toBe(404);
  });

  it('splits a set and refuses to split the whole of it', async () => {
    const t = await fixtureTeam();
    const { id } = await addItem(t, t.coach, { kind: 'bibs', name: 'Bibs, red', quantity: 15 });
    ok(await act(t, t.coach, id, 'assign', { memberId: t.player.memberId }));
    const newId = uuidv7();
    const r = ok(await act(t, t.coach, id, 'split', { id: newId, quantity: 5 }), 201);
    expect(r.item).toMatchObject({ quantity: 10, version: 2 });
    expect(r.created).toMatchObject({
      id: newId,
      quantity: 5,
      status: 'with_someone',
      holderMemberId: t.player.memberId,
    });
    // A retry is harmless.
    ok(await act(t, t.coach, id, 'split', { id: newId, quantity: 5 }));
    expect((await act(t, t.coach, id, 'split', { id: uuidv7(), quantity: 10 })).status).toBe(400);
    expect((await history(t, t.coach, id)).map((e) => e.kind)).toEqual([
      'created',
      'assigned',
      'split',
    ]);
    expect((await history(t, t.coach, newId))[0]).toMatchObject({
      kind: 'created',
      toMemberId: t.player.memberId,
    });
  });
});

describe('holding kit', () => {
  it("a player can't assign, or mark someone else's item lost", async () => {
    const t = await fixtureTeam();
    const pip2 = await joinPlayer(t, 'Pip Two');
    const { id } = await addItem(t, t.coach);
    expect((await act(t, t.player, id, 'assign', { memberId: t.player.memberId })).status).toBe(
      403,
    );
    // In the store: only a kit manager can mark it lost.
    expect((await act(t, t.player, id, 'lost')).status).toBe(403);
    ok(await act(t, t.coach, id, 'assign', { memberId: pip2.memberId }));
    expect((await act(t, t.player, id, 'lost')).status).toBe(403);
    expect((await act(t, t.player, id, 'return')).status).toBe(403);
    // The holder can.
    expect(
      ok(await act(t, pip2, id, 'lost', { note: 'Left at the away ground' })).item,
    ).toMatchObject({ status: 'lost', holderMemberId: null });
    expect((await act(t, pip2, id, 'found')).status).toBe(403);
    expect(ok(await act(t, t.manager, id, 'found')).item.status).toBe('available');
    const h = await history(t, t.coach, id);
    expect(h.map((e) => e.kind)).toEqual(['created', 'assigned', 'marked_lost', 'found']);
    // The last holder is kept in the history.
    expect(h[2]).toMatchObject({ fromMemberId: pip2.memberId, note: 'Left at the away ground' });
  });

  it('a Kit manager team role lets a player manage kit', async () => {
    const t = await fixtureTeam();
    const roleId = uuidv7();
    await call('PUT', `${base(t)}/roles/${roleId}`, {
      cookie: t.owner.cookie,
      body: { name: 'Kit manager', color: '#1f6f43', permissions: ['inventory.manage'] },
    });
    await call('PATCH', `${base(t)}/members/${t.player.memberId}`, {
      cookie: t.owner.cookie,
      body: { roleIds: [roleId] },
    });
    ok((await addItem(t, t.player)).r, 201);
  });

  it('return, retire and take-back are logged and idempotent', async () => {
    const t = await fixtureTeam();
    const { id } = await addItem(t, t.coach);
    ok(await act(t, t.coach, id, 'assign', { memberId: t.player.memberId }));
    expect(ok(await act(t, t.player, id, 'return')).item.status).toBe('available');
    ok(await act(t, t.player, id, 'return'));
    ok(await act(t, t.coach, id, 'assign', { memberId: t.player.memberId }));
    expect(ok(await act(t, t.coach, id, 'assign', { memberId: null })).item.status).toBe(
      'available',
    );
    expect(ok(await act(t, t.coach, id, 'retire')).item.status).toBe('retired');
    expect((await act(t, t.coach, id, 'assign', { memberId: t.player.memberId })).status).toBe(409);
    expect((await history(t, t.coach, id)).map((e) => e.kind)).toEqual([
      'created',
      'assigned',
      'returned',
      'assigned',
      'returned',
      'retired',
    ]);
  });
});

describe('handovers', () => {
  async function held(t: Team) {
    const { id } = await addItem(t, t.coach);
    ok(await act(t, t.coach, id, 'assign', { memberId: t.player.memberId }));
    return id;
  }

  it('the holder offers, the teammate accepts, and only then it moves', async () => {
    const t = await fixtureTeam();
    const mate = await joinPlayer(t, 'Mate Mo');
    const id = await held(t);
    const handoffId = uuidv7();
    const r = ok(await offer(t, t.player, id, mate.memberId, handoffId), 201);
    expect(r.handoff).toMatchObject({ fromMemberId: t.player.memberId, toMemberId: mate.memberId });
    // A retry returns the same request.
    ok(await offer(t, t.player, id, mate.memberId, handoffId));
    // Not the holder: 403. A second request while one is waiting: 409.
    expect((await offer(t, mate, id, mate.memberId)).status).toBe(403);
    expect((await offer(t, t.coach, id, t.manager.memberId)).status).toBe(409);
    // Until they accept, the holder still has it.
    let s = await sync(t, mate);
    expect(s.items.find((i) => i.id === id)?.holderMemberId).toBe(t.player.memberId);
    expect(s.handoffs.map((h) => h.id)).toEqual([handoffId]);
    // Someone else can't accept it for them.
    expect((await answer(t, t.player, handoffId, 'accept')).status).toBe(403);
    const acc = ok(await answer(t, mate, handoffId, 'accept'));
    expect(acc.item).toMatchObject({ status: 'with_someone', holderMemberId: mate.memberId });
    s = await sync(t, mate);
    expect(s.handoffs).toEqual([]);
    expect((await history(t, t.coach, id)).map((e) => e.kind)).toEqual([
      'created',
      'assigned',
      'handoff_requested',
      'handoff_accepted',
    ]);
  });

  it('two accepts race: exactly one wins, the other gets 409', async () => {
    const t = await fixtureTeam();
    const mate = await joinPlayer(t, 'Mate Mo');
    const id = await held(t);
    const handoffId = uuidv7();
    ok(await offer(t, t.player, id, mate.memberId, handoffId), 201);
    const results = await Promise.all([
      answer(t, mate, handoffId, 'accept'),
      answer(t, t.coach, handoffId, 'accept'),
      answer(t, mate, handoffId, 'accept'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const h = await history(t, t.coach, id);
    expect(h.filter((e) => e.kind === 'handoff_accepted')).toHaveLength(1);
  });

  it("an expired handover can't be accepted, and a new one takes its place", async () => {
    const t = await fixtureTeam();
    const mate = await joinPlayer(t, 'Mate Mo');
    const id = await held(t);
    const old = uuidv7();
    ok(await offer(t, t.player, id, mate.memberId, old), 201);
    await env.DB.prepare('UPDATE inventory_handoffs SET expires_at = ? WHERE id = ?')
      .bind(Date.now() - 1000, old)
      .run();
    const late = await answer(t, mate, old, 'accept');
    expect(late.status).toBe(409);
    expect(late.body.error.message).toMatch(/expired/);
    const fresh = uuidv7();
    ok(await offer(t, t.player, id, t.manager.memberId, fresh), 201);
    expect(ok(await answer(t, t.manager, fresh, 'accept')).item.holderMemberId).toBe(
      t.manager.memberId,
    );
  });

  it('staff can complete or cancel anyone’s handover', async () => {
    const t = await fixtureTeam();
    const mate = await joinPlayer(t, 'Mate Mo');
    const id = await held(t);
    const first = uuidv7();
    ok(await offer(t, t.player, id, mate.memberId, first), 201);
    const done = ok(await answer(t, t.coach, first, 'accept'));
    expect(done.handoff.outcome).toBe('accepted');
    expect(done.item.holderMemberId).toBe(mate.memberId);

    const second = uuidv7();
    ok(await offer(t, mate, id, t.player.memberId, second), 201);
    expect((await answer(t, joinedOutsider(t), second, 'decline')).status).toBe(401);
    const cancel = ok(await answer(t, t.manager, second, 'decline'));
    expect(cancel.handoff.outcome).toBe('cancelled');

    const third = uuidv7();
    ok(await offer(t, mate, id, t.player.memberId, third), 201);
    expect(ok(await answer(t, t.player, third, 'decline')).handoff.outcome).toBe('declined');
    const h = await history(t, t.coach, id);
    expect(h.map((e) => e.kind).slice(2)).toEqual([
      'handoff_requested',
      'handoff_accepted',
      'handoff_requested',
      'handoff_cancelled',
      'handoff_requested',
      'handoff_declined',
    ]);
    expect(h[3]!.note).toBe('Completed by a kit manager');
  });

  it('assigning cancels a waiting handover', async () => {
    const t = await fixtureTeam();
    const mate = await joinPlayer(t, 'Mate Mo');
    const id = await held(t);
    const handoffId = uuidv7();
    ok(await offer(t, t.player, id, mate.memberId, handoffId), 201);
    ok(await act(t, t.coach, id, 'assign', { memberId: t.manager.memberId }));
    expect((await answer(t, mate, handoffId, 'accept')).status).toBe(409);
    expect((await sync(t, mate)).handoffs).toEqual([]);
  });
});

/** An actor with no session at all. */
const joinedOutsider = (t: Team): Actor => ({ ...t.player, cookie: '' });

describe('kit sync', () => {
  it('sends items, open handoffs and tombstones in one statement', async () => {
    const t = await fixtureTeam();
    const keep = await addItem(t, t.coach, { notes: 'Pump in the bag' });
    const gone = await addItem(t, t.coach, { name: 'Mistake' });
    const full = await sync(t, t.player);
    expect(full.items.map((i) => i.id).sort()).toEqual([keep.id, gone.id].sort());
    // Notes stay with kit managers.
    expect(full.items.find((i) => i.id === keep.id)?.notes).toBeNull();
    expect((await sync(t, t.coach)).items.find((i) => i.id === keep.id)?.notes).toBe(
      'Pump in the bag',
    );

    ok(await call('DELETE', `${base(t)}/inventory/${gone.id}`, { cookie: t.coach.cookie }));
    const delta = await sync(t, t.player, full.cursor);
    expect(delta.full).toBe(false);
    expect(delta.items.find((i) => i.id === gone.id)?.deletedAt).toBeTruthy();
    const fresh = await sync(t, t.player);
    expect(fresh.items.map((i) => i.id)).toEqual([keep.id]);

    // Resolved handovers arrive once in a delta so devices can clear them.
    ok(await act(t, t.coach, keep.id, 'assign', { memberId: t.player.memberId }));
    const hid = uuidv7();
    ok(await offer(t, t.player, keep.id, t.manager.memberId, hid), 201);
    const before = await sync(t, t.manager);
    expect(before.handoffs.map((h) => h.id)).toEqual([hid]);
    ok(await answer(t, t.manager, hid, 'decline'));
    const after = await sync(t, t.manager, before.cursor);
    expect(after.handoffs.map((h) => h.outcome)).toEqual(['declined']);
    expect((await sync(t, t.manager)).handoffs).toEqual([]);
  });
});
