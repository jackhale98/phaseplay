import type { Hono } from 'hono';
import * as v from 'valibot';
import {
  IMPORT_CHUNK,
  ImportInput,
  TeamCreate,
  TeamUpdate,
  TransferOwnership,
  TeamRoleInput,
  OWNER_CLAIM_AFTER_MS,
  type AuditEntry,
} from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, forbidden, notFound, now, parseJson } from '../lib/http';
import {
  TEAM_COLS,
  teamFromRow,
  memberFromRow,
  MEMBER_COLS,
  ROLE_COLS,
  roleFromRow,
} from '../db/rows';
import { requireUser } from '../auth/session';
import { auditStmt } from '../lib/audit';
import { starterDrillRows } from '../seed/starter-drills';
import { bulkInsert } from '../lib/bulk';

export function teamRoutes(app: Hono<AppEnv>) {
  route(app, 'teams.create', async (c) => {
    const u = requireUser(c);
    const input = await body(c, TeamCreate);
    const t = now();
    const existing = await c.var.db
      .prepare('SELECT owner_id FROM teams WHERE id = ?')
      .bind(input.id)
      .first<{ owner_id: string }>();
    if (existing) {
      if (existing.owner_id === u.id) return c.json({ ok: true, id: input.id }); // idempotent retry
      throw new HttpError(409, 'conflict', 'Team id already used');
    }
    const memberId = crypto.randomUUID();
    await c.var.db.batch([
      c.var.db
        .prepare(`INSERT INTO teams (${TEAM_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
        .bind(
          input.id,
          input.name,
          input.shortName,
          JSON.stringify(input.colors),
          input.defaultFormat,
          input.timezone,
          u.id,
          t,
          t,
        ),
      c.var.db
        .prepare(
          `INSERT INTO memberships (id, team_id, user_id, display_name, role, positions, status, joined_at, updated_at)
           VALUES (?, ?, ?, ?, 'owner', '[]', 'active', ?, ?)`,
        )
        .bind(memberId, input.id, u.id, u.displayName, t, t),
      bulkInsert(c.var.db, 'drills', starterDrillRows(input.id, t))!,
      auditStmt(c.var.db, {
        teamId: input.id,
        actorId: u.id,
        action: 'team.created',
        targetType: 'team',
        targetId: input.id,
      }),
    ]);
    return c.json({ ok: true, id: input.id }, 201);
  });

  route(app, 'teams.get', async (c) => {
    const row = await c.var.db
      .prepare(`SELECT ${TEAM_COLS} FROM teams WHERE id = ?`)
      .bind(c.var.member.teamId)
      .first();
    if (!row) throw notFound();
    return c.json({ team: teamFromRow(row) });
  });

  route(app, 'teams.update', async (c) => {
    const input = await body(c, TeamUpdate);
    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<string, string> = {
      name: 'name',
      shortName: 'short_name',
      defaultFormat: 'default_format',
      timezone: 'timezone',
    };
    for (const [k, col] of Object.entries(map)) {
      const val = (input as Record<string, unknown>)[k];
      if (val !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(val);
      }
    }
    if (input.colors) {
      sets.push('colors = ?');
      vals.push(JSON.stringify(input.colors));
    }
    if (!sets.length) return c.json({ ok: true });
    await c.var.db
      .prepare(`UPDATE teams SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...vals, now(), c.var.member.teamId)
      .run();
    return c.json({ ok: true });
  });

  route(app, 'teams.delete', async (c) => {
    const { confirmName } = await body(c, v.object({ confirmName: v.string() }));
    const team = await c.var.db
      .prepare('SELECT name FROM teams WHERE id = ?')
      .bind(c.var.member.teamId)
      .first<{ name: string }>();
    if (!team || team.name.trim().toLowerCase() !== confirmName.trim().toLowerCase())
      throw new HttpError(400, 'bad_request', 'Type the team name to confirm');
    const t = now();
    await c.var.db.batch([
      c.var.db
        .prepare('UPDATE teams SET deleted_at = ?, updated_at = ? WHERE id = ?')
        .bind(t, t, c.var.member.teamId),
      c.var.db
        .prepare('UPDATE invites SET revoked_at = ? WHERE team_id = ? AND revoked_at IS NULL')
        .bind(t, c.var.member.teamId),
    ]);
    return c.json({ ok: true });
  });

  /** The owner nominates a successor; nothing changes until they accept. */
  route(app, 'teams.transfer', async (c) => {
    const { memberId } = await body(c, TransferOwnership);
    const me = c.var.member;
    const target = await c.var.db
      .prepare(
        `SELECT ${MEMBER_COLS} FROM memberships WHERE id = ? AND team_id = ? AND status = 'active' AND user_id IS NOT NULL`,
      )
      .bind(memberId, me.teamId)
      .first();
    if (!target || memberId === me.id) throw notFound('Member not found');
    const tm = memberFromRow(target);
    const t = now();
    await c.var.db.batch([
      c.var.db
        .prepare(
          'UPDATE teams SET pending_owner_member_id = ?, pending_owner_at = ?, updated_at = ? WHERE id = ?',
        )
        .bind(memberId, t, t, me.teamId),
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'team.ownership_nominated',
        targetType: 'member',
        targetId: memberId,
        meta: { to: tm.displayName },
      }),
    ]);
    return c.json({ ok: true });
  });

  /** Swap ownership: `to` becomes owner, the previous owner becomes an admin. */
  const makeOwner = (
    db: D1Database,
    teamId: string,
    to: { id: string; userId: string },
    t: number,
  ) => [
    db
      .prepare(
        `UPDATE memberships SET role = 'admin', updated_at = ? WHERE team_id = ? AND role = 'owner'`,
      )
      .bind(t, teamId),
    db
      .prepare(`UPDATE memberships SET role = 'owner', updated_at = ? WHERE id = ? AND team_id = ?`)
      .bind(t, to.id, teamId),
    db
      .prepare(
        'UPDATE teams SET owner_id = ?, pending_owner_member_id = NULL, pending_owner_at = NULL, updated_at = ? WHERE id = ?',
      )
      .bind(to.userId, t, teamId),
  ];

  route(app, 'teams.transfer.accept', async (c) => {
    const me = c.var.member;
    const team = await c.var.db
      .prepare('SELECT pending_owner_member_id FROM teams WHERE id = ?')
      .bind(me.teamId)
      .first<{ pending_owner_member_id: string | null }>();
    if (team?.pending_owner_member_id !== me.id)
      throw new HttpError(409, 'conflict', "There's no ownership handover waiting for you");
    const t = now();
    await c.var.db.batch([
      ...makeOwner(c.var.db, me.teamId, { id: me.id, userId: me.userId! }, t),
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'team.transferred',
        targetType: 'member',
        targetId: me.id,
        meta: { to: me.displayName },
      }),
    ]);
    return c.json({ ok: true });
  });

  route(app, 'teams.transfer.cancel', async (c) => {
    const me = c.var.member;
    // The owner cancels, or the nominee declines; nobody else.
    const r = await c.var.db
      .prepare(
        `UPDATE teams SET pending_owner_member_id = NULL, pending_owner_at = NULL, updated_at = ?
         WHERE id = ? AND pending_owner_member_id IS NOT NULL AND (owner_id = ? OR pending_owner_member_id = ?)
         RETURNING pending_owner_member_id`,
      )
      .bind(now(), me.teamId, me.userId, me.id)
      .first();
    if (!r) throw new HttpError(409, 'conflict', 'No handover to cancel');
    await auditStmt(c.var.db, {
      teamId: me.teamId,
      actorId: me.userId,
      action: me.role === 'owner' ? 'team.ownership_cancelled' : 'team.ownership_declined',
      targetType: 'team',
      targetId: me.teamId,
    }).run();
    return c.json({ ok: true });
  });

  /** An admin takes over when the owner hasn't signed in for 30 days (e-board changed hands). */
  route(app, 'teams.claim', async (c) => {
    const me = c.var.member;
    if (me.role === 'owner') throw new HttpError(409, 'conflict', 'You already own the team');
    if (me.role !== 'admin') throw forbidden('Only admins can take over ownership');
    const owner = await c.var.db
      .prepare(
        `SELECT u.deleted_at, max(coalesce(u.last_seen_at, 0),
           coalesce((SELECT max(max(s.last_seen_at, s.created_at)) FROM sessions s WHERE s.user_id = u.id), 0)) AS seen
         FROM teams t LEFT JOIN users u ON u.id = t.owner_id WHERE t.id = ?`,
      )
      .bind(me.teamId)
      .first<{ deleted_at: number | null; seen: number | null }>();
    const t = now();
    const away =
      !owner || owner.deleted_at !== null || t - Number(owner.seen ?? 0) >= OWNER_CLAIM_AFTER_MS;
    if (!away)
      throw new HttpError(
        409,
        'conflict',
        'The owner has been active in the last 30 days. Ask them to hand over ownership.',
      );
    await c.var.db.batch([
      ...makeOwner(c.var.db, me.teamId, { id: me.id, userId: me.userId! }, t),
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'team.ownership_claimed',
        targetType: 'member',
        targetId: me.id,
        meta: { to: me.displayName },
      }),
    ]);
    return c.json({ ok: true });
  });

  route(app, 'roles.put', async (c) => {
    const me = c.var.member;
    const id = c.req.param('roleId')!;
    const input = await body(c, TeamRoleInput);
    const t = now();
    const row = await c.var.db
      .prepare(
        `INSERT INTO team_roles (id, team_id, name, color, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, permissions = excluded.permissions,
           updated_at = excluded.updated_at, deleted_at = NULL
         WHERE team_roles.team_id = excluded.team_id
         RETURNING ${ROLE_COLS}`,
      )
      .bind(id, me.teamId, input.name, input.color, JSON.stringify(input.permissions), t, t)
      .first();
    if (!row) throw notFound('Role not found');
    await auditStmt(c.var.db, {
      teamId: me.teamId,
      actorId: me.userId,
      action: 'role.saved',
      targetType: 'role',
      targetId: id,
      meta: { name: input.name, permissions: input.permissions },
    }).run();
    return c.json({ role: roleFromRow(row) });
  });

  route(app, 'roles.delete', async (c) => {
    const me = c.var.member;
    const t = now();
    const row = await c.var.db
      .prepare(
        'UPDATE team_roles SET deleted_at = ?, updated_at = ? WHERE id = ? AND team_id = ? AND deleted_at IS NULL RETURNING name',
      )
      .bind(t, t, c.req.param('roleId'), me.teamId)
      .first<{ name: string }>();
    if (!row) throw notFound('Role not found');
    await auditStmt(c.var.db, {
      teamId: me.teamId,
      actorId: me.userId,
      action: 'role.deleted',
      targetType: 'role',
      targetId: c.req.param('roleId')!,
      meta: { name: row.name },
    }).run();
    return c.json({ ok: true });
  });

  route(app, 'teams.leave', async (c) => {
    const me = c.var.member;
    if (me.role === 'owner')
      throw new HttpError(409, 'conflict', 'Transfer ownership before leaving the team.');
    const t = now();
    await c.var.db.batch([
      c.var.db
        .prepare(
          `UPDATE memberships SET status = 'removed', removed_at = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(t, t, me.id),
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'member.left',
        targetType: 'member',
        targetId: me.id,
        meta: { name: me.displayName },
      }),
    ]);
    return c.json({ ok: true });
  });

  route(app, 'teams.audit', async (c) => {
    const before = Number(c.req.query('before') ?? Date.now() + 1);
    const { results } = await c.var.db
      .prepare(
        `SELECT a.id, a.action, a.target_type, a.target_id, a.meta, a.at,
          (SELECT display_name FROM memberships m WHERE m.team_id = a.team_id AND m.user_id = a.actor_id) AS actor_name
         FROM audit_log a WHERE a.team_id = ? AND a.at < ? ORDER BY a.at DESC LIMIT 50`,
      )
      .bind(c.var.member.teamId, before)
      .all<Record<string, unknown>>();
    const entries: AuditEntry[] = results.map((r) => ({
      id: r.id as string,
      actorName: (r.actor_name as string | null) ?? null,
      action: r.action as string,
      targetType: r.target_type as string,
      targetId: r.target_id as string,
      meta: parseJson(r.meta as string | null, null),
      at: r.at as number,
    }));
    return c.json({ entries });
  });

  route(app, 'teams.import', async (c) => {
    const input = await body(c, ImportInput);
    if (input.events.length + input.members.length > IMPORT_CHUNK)
      throw new HttpError(400, 'bad_request', `Send at most ${IMPORT_CHUNK} rows per request`);
    const me = c.var.member;
    const t = now();
    const eventRows = input.events.map((e) => ({
      id: e.id,
      team_id: me.teamId,
      season_id: e.seasonId ?? null,
      type: e.type,
      format: e.format ?? null,
      title: e.title,
      starts_at: e.startsAt,
      meet_at: e.meetAt ?? null,
      ends_at: e.endsAt ?? null,
      location_name: e.locationName ?? null,
      location_url: e.locationUrl ?? null,
      opponent: e.opponent ?? null,
      notes: e.notes ?? null,
      rsvp_deadline: e.rsvpDeadline ?? null,
      settings: e.settings ? JSON.stringify(e.settings) : null,
      version: 1,
      created_by: me.userId,
      updated_at: t,
    }));
    const memberRows = input.members.map((m) => ({
      id: m.id,
      team_id: me.teamId,
      user_id: null,
      display_name: m.displayName,
      role: 'player',
      jersey: m.jersey ?? null,
      positions: JSON.stringify(m.positions ?? []),
      status: 'pending',
      updated_at: t,
    }));
    const stmts = [
      bulkInsert(c.var.db, 'events', eventRows, { ignoreConflicts: true }),
      bulkInsert(c.var.db, 'memberships', memberRows, { ignoreConflicts: true }),
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'team.imported',
        targetType: 'team',
        targetId: me.teamId,
        meta: { events: input.events.length, members: input.members.length },
      }),
    ].filter((x): x is D1PreparedStatement => x !== null);
    await c.var.db.batch(stmts);
    return c.json({ ok: true, events: input.events.length, members: input.members.length });
  });
}
