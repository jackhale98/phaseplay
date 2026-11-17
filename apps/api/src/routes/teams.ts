import type { Hono } from 'hono';
import * as v from 'valibot';
import {
  IMPORT_CHUNK,
  ImportInput,
  TeamCreate,
  TeamUpdate,
  TransferOwnership,
  type AuditEntry,
} from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, notFound, now, parseJson } from '../lib/http';
import { TEAM_COLS, teamFromRow, memberFromRow, MEMBER_COLS } from '../db/rows';
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
        .prepare(`INSERT INTO teams (${TEAM_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
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

  route(app, 'teams.transfer', async (c) => {
    const { memberId } = await body(c, TransferOwnership);
    const me = c.var.member;
    const t = now();
    const target = await c.var.db
      .prepare(
        `SELECT ${MEMBER_COLS} FROM memberships WHERE id = ? AND team_id = ? AND status = 'active' AND user_id IS NOT NULL`,
      )
      .bind(memberId, me.teamId)
      .first();
    if (!target || memberId === me.id) throw notFound('Member not found');
    const tm = memberFromRow(target);
    await c.var.db.batch([
      c.var.db
        .prepare(`UPDATE memberships SET role = 'owner', updated_at = ? WHERE id = ?`)
        .bind(t, memberId),
      c.var.db
        .prepare(`UPDATE memberships SET role = 'coach', updated_at = ? WHERE id = ?`)
        .bind(t, me.id),
      c.var.db
        .prepare('UPDATE teams SET owner_id = ?, updated_at = ? WHERE id = ?')
        .bind(tm.userId, t, me.teamId),
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'team.transferred',
        targetType: 'member',
        targetId: memberId,
        meta: { to: tm.displayName },
      }),
    ]);
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
