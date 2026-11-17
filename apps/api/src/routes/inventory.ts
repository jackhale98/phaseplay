/**
 * Kit and inventory (PLAN.md M9). Every state change appends `inventory_events` rows in the same
 * batch as the change, guarded by the same compare-and-set condition, so history and state commit
 * together or not at all. Item details are versioned (If-Match); holder and status change only
 * through the action routes, which compare-and-set on the state they read.
 */
import type { Context, Hono } from 'hono';
import {
  HandoffCreate,
  INVENTORY_HANDOFF_TTL_MS,
  ITEM_CONDITION_LABELS,
  InventoryAssign,
  InventoryItemInput,
  InventoryNote,
  InventorySplit,
  can,
  splitSet,
  uuidv7,
  type InventoryEventKind,
  type ItemStatus,
} from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import {
  HttpError,
  badRequest,
  body,
  forbidden,
  ifMatch,
  notFound,
  now,
  parseJson,
} from '../lib/http';
import { auditStmt } from '../lib/audit';
import { flushNotifications, notifyStmt } from '../lib/notify';
import {
  HANDOFF_COLS,
  INVENTORY_EVENT_COLS,
  ITEM_COLS,
  handoffFromRow,
  inventoryEventFromRow,
  itemFromRow,
} from '../db/rows';

type C = Context<AppEnv>;
type Row = Record<string, unknown>;

const manages = (c: C) => can(c.var.perms, 'inventory.manage');
const conflict = (msg: string, extra?: Record<string, unknown>) =>
  new HttpError(409, 'conflict', msg, extra);
const raced = () => conflict('Someone else changed this item at the same time. Try again.');
const clean = (s: string | null | undefined) => (s ? s : null);

/** D1 surfaces the partial unique index on (team_id, tag) as a constraint error. */
async function tagSafe<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (/UNIQUE constraint failed: inventory_items\.(team_id|tag)/.test(String(e)))
      throw conflict('Another item already has that tag');
    throw e;
  }
}

type Log = {
  kind: InventoryEventKind;
  itemId?: string;
  from?: string | null;
  to?: string | null;
  note?: string | null;
};

/**
 * History rows, written only while `guard` (a condition on the item's columns, the same one the
 * state UPDATE uses) still holds. Goes before the UPDATE in the batch so both see the old state.
 */
function logStmt(
  c: C,
  itemId: string,
  guard: string,
  guardVals: unknown[],
  rows: Log[],
  t: number,
) {
  const me = c.var.member;
  const json = rows.map((r) => ({
    id: uuidv7(),
    item_id: r.itemId ?? itemId,
    kind: r.kind,
    from: r.from ?? null,
    to: r.to ?? null,
    note: r.note ?? null,
  }));
  return c.var.db
    .prepare(
      `INSERT INTO inventory_events (id, team_id, item_id, kind, actor_member_id, from_member_id, to_member_id, note, at)
       SELECT j.value ->> '$.id', ?, j.value ->> '$.item_id', j.value ->> '$.kind', ?, j.value ->> '$.from', j.value ->> '$.to', j.value ->> '$.note', ?
       FROM json_each(?) j
       WHERE EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = ? AND i.team_id = ? AND i.deleted_at IS NULL AND ${guard})`,
    )
    .bind(me.teamId, me.id, t, JSON.stringify(json), itemId, me.teamId, ...guardVals);
}

const OPEN_HANDOFF = `(SELECT json_object(${HANDOFF_COLS.split(', ')
  .map((col) => `'${col}', h.${col}`)
  .join(', ')}) FROM inventory_handoffs h
   WHERE h.item_id = inventory_items.id AND h.team_id = inventory_items.team_id AND h.resolved_at IS NULL)`;

/** The item (404 if it isn't this team's), its open handover, and optionally a member check. */
async function loadItem(c: C, itemId: string, memberId: string | null = null, otherId?: string) {
  const row = await c.var.db
    .prepare(
      `SELECT ${ITEM_COLS}, ${OPEN_HANDOFF} AS open_handoff,
        (SELECT id FROM memberships WHERE id = ?3 AND team_id = ?2 AND status = 'active') AS target,
        (SELECT team_id FROM inventory_items WHERE id = ?4) AS other_team
       FROM inventory_items WHERE id = ?1 AND team_id = ?2 AND deleted_at IS NULL`,
    )
    .bind(itemId, c.var.member.teamId, memberId, otherId ?? null)
    .first<Row>();
  if (!row) throw notFound('Item not found');
  const open = parseJson<Row | null>(row.open_handoff as string | null, null);
  return {
    row,
    status: row.status as ItemStatus,
    holder: (row.holder_member_id ?? null) as string | null,
    open,
    target: (row.target ?? null) as string | null,
    otherTeam: (row.other_team ?? null) as string | null,
  };
}
type Loaded = Awaited<ReturnType<typeof loadItem>>;

const STATE_GUARD = 'status = ? AND holder_member_id IS ?';

/**
 * Move an item to a new status/holder: history, cancel any open handover, then the UPDATE, all
 * compare-and-set on the state we read. Three statements at most.
 */
async function transition(
  c: C,
  it: Loaded,
  next: { status: ItemStatus; holder: string | null },
  log: Log,
) {
  const db = c.var.db;
  const me = c.var.member;
  const id = it.row.id as string;
  const t = now();
  const gv = [it.status, it.holder];
  const logs: Log[] = [log];
  const stmts: D1PreparedStatement[] = [];
  if (it.open) {
    logs.push({
      kind: 'handoff_cancelled',
      from: (it.open.from_member_id ?? null) as string | null,
      to: it.open.to_member_id as string,
    });
  }
  stmts.push(logStmt(c, id, STATE_GUARD, gv, logs, t));
  if (it.open)
    stmts.push(
      db
        .prepare(
          `UPDATE inventory_handoffs SET resolved_at = ?, outcome = 'cancelled', updated_at = ?
           WHERE item_id = ? AND team_id = ? AND resolved_at IS NULL
             AND EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = ? AND i.team_id = ? AND i.deleted_at IS NULL AND ${STATE_GUARD})`,
        )
        .bind(t, t, id, me.teamId, id, me.teamId, ...gv),
    );
  stmts.push(
    db
      .prepare(
        `UPDATE inventory_items SET status = ?, holder_member_id = ?, updated_at = ?
         WHERE id = ? AND team_id = ? AND deleted_at IS NULL AND ${STATE_GUARD} RETURNING ${ITEM_COLS}`,
      )
      .bind(next.status, next.holder, t, id, me.teamId, ...gv),
  );
  const res = await db.batch(stmts);
  const row = res.at(-1)?.results[0] as Row | undefined;
  if (!row) throw raced();
  return c.json({ item: itemFromRow(row, manages(c)) });
}

const unchanged = (c: C, it: Loaded) => c.json({ item: itemFromRow(it.row, manages(c)) });
const holderOrManager = (c: C, it: Loaded) => {
  if (!manages(c) && (!it.holder || it.holder !== c.var.member.id))
    throw forbidden('Only the person who has it, or a kit manager, can do that');
};

/** A handover with its item's state (404 unless it's this team's and the item still exists). */
async function loadHandoff(c: C, handoffId: string) {
  const row = await c.var.db
    .prepare(
      `SELECT ${HANDOFF_COLS.split(', ')
        .map((col) => `h.${col}`)
        .join(', ')}, i.status AS item_status, i.holder_member_id AS item_holder
       FROM inventory_handoffs h JOIN inventory_items i ON i.id = h.item_id AND i.team_id = h.team_id
       WHERE h.id = ? AND h.team_id = ? AND i.deleted_at IS NULL`,
    )
    .bind(handoffId, c.var.member.teamId)
    .first<Row>();
  if (!row) throw notFound('Handover not found');
  return row;
}

/**
 * An open, unexpired handover whose item can still change hands, and is still with the person who
 * offered it (a coach may have reassigned it since: then the handover no longer applies).
 */
const HANDOFF_OPEN = `status IN ('available', 'with_someone') AND EXISTS (SELECT 1 FROM inventory_handoffs h
  WHERE h.id = ? AND h.team_id = ? AND h.resolved_at IS NULL AND h.expires_at > ?
    AND h.from_member_id IS holder_member_id)`;

export function inventoryRoutes(app: Hono<AppEnv>) {
  route(app, 'inventory.history', async (c) => {
    const me = c.var.member;
    const id = c.req.param('itemId');
    const [item, events] = await c.var.db.batch([
      c.var.db
        .prepare(
          'SELECT id FROM inventory_items WHERE id = ? AND team_id = ? AND deleted_at IS NULL',
        )
        .bind(id, me.teamId),
      c.var.db
        .prepare(
          `SELECT ${INVENTORY_EVENT_COLS} FROM inventory_events WHERE item_id = ? AND team_id = ? ORDER BY at, id`,
        )
        .bind(id, me.teamId),
    ]);
    if (!item?.results.length) throw notFound('Item not found');
    const notes = manages(c);
    return c.json({
      events: (events!.results as Row[]).map((r) => inventoryEventFromRow(r, notes)),
    });
  });

  route(app, 'inventory.put', async (c) => {
    const me = c.var.member;
    const id = c.req.param('itemId')!;
    const input = await body(c, InventoryItemInput);
    const db = c.var.db;
    const t = now();
    const vals = [
      input.kind,
      input.name,
      clean(input.tag),
      input.quantity,
      input.condition,
      clean(input.home),
      clean(input.notes),
      input.matchDay ? 1 : 0,
    ];
    const existing = await db
      .prepare(`SELECT ${ITEM_COLS} FROM inventory_items WHERE id = ?`)
      .bind(id)
      .first<Row>();
    if (existing && (existing.team_id !== me.teamId || existing.deleted_at))
      throw notFound('Item not found');

    if (!existing) {
      const [, ins] = await tagSafe(
        db.batch([
          db
            .prepare(
              `INSERT INTO inventory_events (id, team_id, item_id, kind, actor_member_id, at)
               SELECT ?, ?, ?, 'created', ?, ? WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE id = ?)`,
            )
            .bind(uuidv7(), me.teamId, id, me.id, t, id),
          db
            .prepare(
              `INSERT INTO inventory_items (id, team_id, kind, name, tag, quantity, condition, home, notes, match_day, status, version, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', 1, ?, ?, ?)
               ON CONFLICT (id) DO NOTHING RETURNING ${ITEM_COLS}`,
            )
            .bind(id, me.teamId, ...vals, me.userId, t, t),
        ]),
      );
      const row = ins?.results[0] as Row | undefined;
      if (!row) throw conflict('Item id already used');
      return c.json({ item: itemFromRow(row) }, 201);
    }

    const version = ifMatch(c) ?? (existing.version as number);
    if (version !== existing.version)
      throw conflict('Someone else changed this item', { latest: itemFromRow(existing) });
    const from = existing.condition as keyof typeof ITEM_CONDITION_LABELS;
    const changed = from !== input.condition;
    const [, upd] = await tagSafe(
      db.batch([
        logStmt(
          c,
          id,
          'version = ?',
          [version],
          [
            changed
              ? {
                  kind: 'condition_changed',
                  note: `${ITEM_CONDITION_LABELS[from]} → ${ITEM_CONDITION_LABELS[input.condition]}`,
                }
              : { kind: 'edited' },
          ],
          t,
        ),
        db
          .prepare(
            `UPDATE inventory_items SET kind = ?, name = ?, tag = ?, quantity = ?, condition = ?, home = ?, notes = ?, match_day = ?,
               version = version + 1, updated_at = ?
             WHERE id = ? AND team_id = ? AND deleted_at IS NULL AND version = ? RETURNING ${ITEM_COLS}`,
          )
          .bind(...vals, t, id, me.teamId, version),
      ]),
    );
    const row = upd?.results[0] as Row | undefined;
    if (row) return c.json({ item: itemFromRow(row) });
    const latest = await db
      .prepare(
        `SELECT ${ITEM_COLS} FROM inventory_items WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
      )
      .bind(id, me.teamId)
      .first<Row>();
    if (!latest) throw notFound('Item not found');
    throw conflict('Someone else changed this item', { latest: itemFromRow(latest) });
  });

  route(app, 'inventory.delete', async (c) => {
    const me = c.var.member;
    const id = c.req.param('itemId')!;
    const t = now();
    const [, del] = await c.var.db.batch([
      c.var.db
        .prepare(
          `UPDATE inventory_handoffs SET resolved_at = ?, outcome = 'cancelled', updated_at = ?
           WHERE item_id = ? AND team_id = ? AND resolved_at IS NULL`,
        )
        .bind(t, t, id, me.teamId),
      c.var.db
        .prepare(
          `UPDATE inventory_items SET deleted_at = ?, updated_at = ?, version = version + 1
           WHERE id = ? AND team_id = ? AND deleted_at IS NULL RETURNING name`,
        )
        .bind(t, t, id, me.teamId),
    ]);
    const row = del?.results[0] as { name: string } | undefined;
    if (!row) throw notFound('Item not found');
    await auditStmt(c.var.db, {
      teamId: me.teamId,
      actorId: me.userId,
      action: 'inventory.deleted',
      targetType: 'inventory_item',
      targetId: id,
      meta: { name: row.name },
    }).run();
    return c.json({ ok: true });
  });

  route(app, 'inventory.assign', async (c) => {
    const input = await body(c, InventoryAssign);
    const it = await loadItem(c, c.req.param('itemId')!, input.memberId);
    const note = clean(input.note);
    if (it.status === 'retired') throw conflict("Retired kit can't be given out");
    if (input.memberId && !it.target) throw badRequest("They aren't an active member of the team");
    if (input.memberId) {
      if (it.status === 'with_someone' && it.holder === input.memberId) return unchanged(c, it);
      return transition(
        c,
        it,
        { status: 'with_someone', holder: input.memberId },
        { kind: 'assigned', from: it.holder, to: input.memberId, note },
      );
    }
    if (it.status === 'available') return unchanged(c, it);
    return transition(
      c,
      it,
      { status: 'available', holder: null },
      { kind: it.status === 'lost' ? 'found' : 'returned', from: it.holder, note },
    );
  });

  route(app, 'inventory.return', async (c) => {
    const input = await body(c, InventoryNote);
    const it = await loadItem(c, c.req.param('itemId')!);
    if (it.status === 'available') return unchanged(c, it);
    holderOrManager(c, it);
    if (it.status !== 'with_someone') throw conflict('Only kit someone has can be returned');
    return transition(
      c,
      it,
      { status: 'available', holder: null },
      { kind: 'returned', from: it.holder, note: clean(input.note) },
    );
  });

  route(app, 'inventory.lost', async (c) => {
    const input = await body(c, InventoryNote);
    const it = await loadItem(c, c.req.param('itemId')!);
    holderOrManager(c, it);
    if (it.status === 'lost') return unchanged(c, it);
    if (it.status === 'retired') throw conflict('Retired kit is already out of service');
    return transition(
      c,
      it,
      { status: 'lost', holder: null },
      { kind: 'marked_lost', from: it.holder, note: clean(input.note) },
    );
  });

  route(app, 'inventory.found', async (c) => {
    const input = await body(c, InventoryNote);
    const it = await loadItem(c, c.req.param('itemId')!);
    if (it.status === 'available') return unchanged(c, it);
    if (it.status !== 'lost') throw conflict("It isn't marked lost");
    return transition(
      c,
      it,
      { status: 'available', holder: null },
      { kind: 'found', note: clean(input.note) },
    );
  });

  route(app, 'inventory.retire', async (c) => {
    const input = await body(c, InventoryNote);
    const it = await loadItem(c, c.req.param('itemId')!);
    if (it.status === 'retired') return unchanged(c, it);
    return transition(
      c,
      it,
      { status: 'retired', holder: null },
      { kind: 'retired', from: it.holder, note: clean(input.note) },
    );
  });

  route(app, 'inventory.split', async (c) => {
    const me = c.var.member;
    const db = c.var.db;
    const input = await body(c, InventorySplit);
    const id = c.req.param('itemId')!;
    if (input.id === id) throw badRequest('The new item needs its own id');
    const it = await loadItem(c, id, null, input.id);
    // A retry of a split that already happened.
    if (it.otherTeam === me.teamId) return unchanged(c, it);
    if (it.otherTeam) throw conflict('Item id already used');
    const v = ifMatch(c);
    if (v !== null && v !== it.row.version)
      throw conflict('Someone else changed this item', { latest: itemFromRow(it.row) });
    if (it.status !== 'available' && it.status !== 'with_someone')
      throw conflict('Only kit in the store or with someone can be split');
    const qty = it.row.quantity as number;
    const parts = splitSet(qty, input.quantity);
    if (!parts) throw badRequest(`Split off between 1 and ${Math.max(1, qty - 1)}`);
    const t = now();
    const guard = `quantity = ? AND ${STATE_GUARD}`;
    const gv = [qty, it.status, it.holder];
    const name = it.row.name as string;
    const res = await db.batch([
      logStmt(
        c,
        id,
        guard,
        gv,
        [
          { kind: 'split', note: `Split ${parts.take} of ${qty} off into a new item` },
          {
            kind: 'created',
            itemId: input.id,
            to: it.holder,
            note: `Split from ${name}`.slice(0, 140),
          },
        ],
        t,
      ),
      db
        .prepare(
          `INSERT INTO inventory_items (id, team_id, kind, name, tag, quantity, condition, status, holder_member_id, home, notes, match_day, version, created_by, created_at, updated_at)
           SELECT ?, team_id, kind, name, NULL, ?, condition, status, holder_member_id, home, notes, match_day, 1, ?, ?, ?
           FROM inventory_items WHERE id = ? AND team_id = ? AND deleted_at IS NULL AND ${guard}
           ON CONFLICT DO NOTHING RETURNING ${ITEM_COLS}`,
        )
        .bind(input.id, parts.take, me.userId, t, t, id, me.teamId, ...gv),
      db
        .prepare(
          `UPDATE inventory_items SET quantity = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND team_id = ? AND deleted_at IS NULL AND ${guard} RETURNING ${ITEM_COLS}`,
        )
        .bind(parts.keep, t, id, me.teamId, ...gv),
    ]);
    const created = res[1]?.results[0] as Row | undefined;
    const row = res[2]?.results[0] as Row | undefined;
    if (!row || !created) throw raced();
    return c.json({ item: itemFromRow(row), created: itemFromRow(created) }, 201);
  });

  route(app, 'inventory.handoff.create', async (c) => {
    const me = c.var.member;
    const db = c.var.db;
    const input = await body(c, HandoffCreate);
    const itemId = c.req.param('itemId')!;
    const it = await loadItem(c, itemId, input.toMemberId);
    const t = now();
    // A retry of this same request.
    if (it.open?.id === input.id) return c.json({ handoff: handoffFromRow(it.open) });
    if (it.status === 'available' ? !manages(c) : it.status === 'with_someone')
      holderOrManager(c, it);
    if (it.status !== 'with_someone' && it.status !== 'available')
      throw conflict('Lost or retired kit can’t be handed over');
    if (!it.target) throw badRequest("They aren't an active member of the team");
    if (input.toMemberId === it.holder) throw badRequest('They already have it');
    if (it.open && (it.open.expires_at as number) > t)
      throw conflict('There’s already a handover waiting for an answer');
    const guard = `${STATE_GUARD} AND NOT EXISTS (SELECT 1 FROM inventory_handoffs h
      WHERE h.item_id = ? AND h.resolved_at IS NULL AND h.expires_at > ?)`;
    const gv = [it.status, it.holder, itemId, t];
    const note = clean(input.note);
    const name = it.row.name as string;
    const res = await db.batch([
      logStmt(
        c,
        itemId,
        guard,
        gv,
        [{ kind: 'handoff_requested', from: it.holder, to: input.toMemberId, note }],
        t,
      ),
      // An expired request still holds the one-open-per-item slot: the new one takes it over.
      db
        .prepare(
          `INSERT INTO inventory_handoffs (id, team_id, item_id, from_member_id, to_member_id, note, created_at, expires_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = ? AND i.team_id = ? AND i.deleted_at IS NULL AND ${guard})
           ON CONFLICT (item_id) WHERE resolved_at IS NULL DO UPDATE SET
             id = excluded.id, from_member_id = excluded.from_member_id, to_member_id = excluded.to_member_id,
             note = excluded.note, created_at = excluded.created_at, expires_at = excluded.expires_at,
             updated_at = excluded.updated_at
           WHERE inventory_handoffs.expires_at <= excluded.created_at
           ON CONFLICT DO NOTHING
           RETURNING ${HANDOFF_COLS}`,
        )
        .bind(
          input.id,
          me.teamId,
          itemId,
          it.holder,
          input.toMemberId,
          note,
          t,
          t + INVENTORY_HANDOFF_TTL_MS,
          t,
          itemId,
          me.teamId,
          ...gv,
        ),
      notifyStmt(
        db,
        me.teamId,
        { memberIds: [input.toMemberId] },
        'kit',
        {
          title: `${me.displayName} wants to hand you the ${name.toLowerCase()}`,
          body: note ?? 'Open Phaseplay to accept or decline.',
          url: `/kit/${itemId}?team=${me.teamId}`,
          tag: `kit-${itemId}`,
        },
        me.userId,
      ),
    ]);
    const row = res[1]?.results[0] as Row | undefined;
    if (!row) throw raced();
    flushNotifications(c);
    return c.json({ handoff: handoffFromRow(row) }, 201);
  });

  route(app, 'inventory.handoff.accept', async (c) => {
    const me = c.var.member;
    const db = c.var.db;
    const h = await loadHandoff(c, c.req.param('handoffId')!);
    if (h.to_member_id !== me.id && !manages(c))
      throw forbidden('Only the person it was offered to, or a kit manager, can accept');
    // Two accepts race: exactly one wins, the other (even a retry) gets 409.
    if (h.resolved_at) throw conflict(`This handover was already ${h.outcome}`);
    const t = now();
    if ((h.expires_at as number) <= t) throw conflict('This handover has expired');
    if (h.item_status !== 'available' && h.item_status !== 'with_someone')
      throw conflict('Lost or retired kit can’t be handed over');
    const itemId = h.item_id as string;
    const gv = [h.id, me.teamId, t];
    const res = await db.batch([
      logStmt(
        c,
        itemId,
        HANDOFF_OPEN,
        gv,
        [
          {
            kind: 'handoff_accepted',
            from: (h.from_member_id ?? null) as string | null,
            to: h.to_member_id as string,
            note: me.id === h.to_member_id ? null : 'Completed by a kit manager',
          },
        ],
        t,
      ),
      db
        .prepare(
          `UPDATE inventory_items SET status = 'with_someone', holder_member_id = ?, updated_at = ?
           WHERE id = ? AND team_id = ? AND deleted_at IS NULL AND ${HANDOFF_OPEN} RETURNING ${ITEM_COLS}`,
        )
        .bind(h.to_member_id, t, itemId, me.teamId, ...gv),
      db
        .prepare(
          `UPDATE inventory_handoffs SET resolved_at = ?, outcome = 'accepted', updated_at = ?
           WHERE id = ? AND team_id = ? AND resolved_at IS NULL AND expires_at > ?
             AND EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = ? AND i.team_id = ?
               AND i.holder_member_id = ? AND i.updated_at = ?)
           RETURNING ${HANDOFF_COLS}`,
        )
        .bind(t, t, h.id, me.teamId, t, itemId, me.teamId, h.to_member_id, t),
    ]);
    const item = res[1]?.results[0] as Row | undefined;
    const done = res[2]?.results[0] as Row | undefined;
    if (!item || !done)
      throw conflict(
        h.item_holder === h.from_member_id
          ? 'This handover was already answered'
          : 'This kit has changed hands since, so the handover no longer applies',
      );
    return c.json({ handoff: handoffFromRow(done), item: itemFromRow(item, manages(c)) });
  });

  route(app, 'inventory.handoff.decline', async (c) => {
    const me = c.var.member;
    const db = c.var.db;
    const h = await loadHandoff(c, c.req.param('handoffId')!);
    const recipient = h.to_member_id === me.id;
    if (!recipient && h.from_member_id !== me.id && !manages(c))
      throw forbidden('Only the two people involved, or a kit manager, can cancel this');
    if (h.resolved_at) {
      if (h.outcome !== 'accepted') return c.json({ handoff: handoffFromRow(h) });
      throw conflict('This handover was already accepted');
    }
    const t = now();
    const outcome = recipient ? 'declined' : 'cancelled';
    const res = await db.batch([
      logStmt(
        c,
        h.item_id as string,
        `EXISTS (SELECT 1 FROM inventory_handoffs h WHERE h.id = ? AND h.team_id = ? AND h.resolved_at IS NULL)`,
        [h.id, me.teamId],
        [
          {
            kind: recipient ? 'handoff_declined' : 'handoff_cancelled',
            from: (h.from_member_id ?? null) as string | null,
            to: h.to_member_id as string,
          },
        ],
        t,
      ),
      db
        .prepare(
          `UPDATE inventory_handoffs SET resolved_at = ?, outcome = ?, updated_at = ?
           WHERE id = ? AND team_id = ? AND resolved_at IS NULL RETURNING ${HANDOFF_COLS}`,
        )
        .bind(t, outcome, t, h.id, me.teamId),
    ]);
    const done = res[1]?.results[0] as Row | undefined;
    if (!done) throw conflict('This handover was already answered');
    return c.json({ handoff: handoffFromRow(done) });
  });
}
