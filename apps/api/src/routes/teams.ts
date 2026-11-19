import type { Hono } from 'hono';
import * as v from 'valibot';
import {
  TeamCreate,
  TeamUpdate,
  TransferOwnership,
  TeamRoleInput,
  HiddenTemplates,
  can,
  OWNER_CLAIM_AFTER_MS,
  MAX_TEAM_ROLES,
  type AuditEntry,
  dateInTz,
  tbdStartsAt,
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
        .prepare(
          `INSERT INTO teams (${TEAM_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'counts', '[]', 20, 10)`,
        )
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

  route(app, 'teams.templates', async (c) => {
    const me = c.var.member;
    const { hidden } = await body(c, HiddenTemplates);
    const row = await c.var.db
      .prepare('SELECT hidden_templates FROM teams WHERE id = ?')
      .bind(me.teamId)
      .first<{ hidden_templates: string }>();
    const before = new Set(parseJson(row?.hidden_templates ?? '[]', [] as string[]));
    const after = new Set(hidden);
    // Each key that changes needs the matching permission: drill templates need drills.manage,
    // play presets need plays.manage.
    for (const k of new Set([...before, ...after])) {
      if (before.has(k) === after.has(k)) continue;
      const action = k.startsWith('drill:') ? 'drills.manage' : 'plays.manage';
      if (!can(c.var.perms, action)) throw forbidden("You can't change those templates");
    }
    const t = now();
    await c.var.db
      .prepare('UPDATE teams SET hidden_templates = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify([...after].sort()), t, me.teamId)
      .run();
    return c.json({ hidden: [...after].sort() });
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
      rsvpVisibility: 'rsvp_visibility',
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
    if (input.proposalTargets) {
      sets.push('proposal_target_15s = ?', 'proposal_target_7s = ?');
      vals.push(input.proposalTargets['15s'], input.proposalTargets['7s']);
    }
    if (!sets.length) return c.json({ ok: true });
    const t = now();
    const teamId = c.var.member.teamId;
    const stmts = [
      c.var.db
        .prepare(`UPDATE teams SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
        .bind(...vals, t, teamId),
    ];
    // "Time TBD" events and proposal dates sit at local noon: on a timezone change, move them to
    // noon of the same date in the new zone (noon alone only survives moves of up to ±12 h).
    if (input.timezone) {
      const db = c.var.db;
      const cur = await db
        .prepare(
          `SELECT timezone,
             (SELECT json_group_array(json_array(id, starts_at)) FROM events
               WHERE team_id = ?1 AND time_tbd = 1 AND deleted_at IS NULL) AS evs,
             (SELECT json_group_array(json_array(id, starts_at)) FROM event_options
               WHERE team_id = ?1 AND time_tbd = 1 AND deleted_at IS NULL) AS opts
           FROM teams WHERE id = ?1`,
        )
        .bind(teamId)
        .first<{ timezone: string; evs: string; opts: string }>();
      const from = cur?.timezone;
      const to = input.timezone;
      if (cur && from && from !== to) {
        const moved = (json: string) =>
          (JSON.parse(json) as [string, number][])
            .map(([id, s]) => ({ id, s: tbdStartsAt(dateInTz(s, from), to), was: s }))
            .filter((x) => x.s !== x.was);
        const evs = JSON.stringify(moved(cur.evs));
        const opts = JSON.stringify(moved(cur.opts));
        stmts.push(
          db
            .prepare(
              `UPDATE events SET starts_at = (SELECT j.value->>'s' FROM json_each(?1) j WHERE j.value->>'id' = events.id),
                 version = version + 1, updated_at = ?2
               WHERE team_id = ?3 AND time_tbd = 1 AND id IN (SELECT value->>'id' FROM json_each(?1))`,
            )
            .bind(evs, t, teamId),
          db
            .prepare(
              `UPDATE event_options SET starts_at = (SELECT j.value->>'s' FROM json_each(?1) j WHERE j.value->>'id' = event_options.id),
                 updated_at = ?2
               WHERE team_id = ?3 AND time_tbd = 1 AND id IN (SELECT value->>'id' FROM json_each(?1))`,
            )
            .bind(opts, t, teamId),
        );
      }
    }
    // Who can see whose replies changed: bump memberships so every device does a full sync
    // (newly visible replies arrive; hidden ones are dropped).
    if (input.rsvpVisibility)
      stmts.push(
        c.var.db
          .prepare(`UPDATE memberships SET updated_at = ? WHERE team_id = ? AND status = 'active'`)
          .bind(t, teamId),
      );
    await c.var.db.batch(stmts);
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

  /**
   * Swap ownership: `to` becomes owner, the previous owner an admin. The teams row moves first and
   * only if `guard` still holds (the nomination or the old owner is unchanged); the membership
   * updates only run if it moved, so a racing cancel, re-nomination or second claim can't half-apply.
   */
  async function makeOwner(
    db: D1Database,
    teamId: string,
    to: { id: string; userId: string },
    guard: { sql: string; binds: unknown[] },
  ): Promise<boolean> {
    const t = now();
    const moved = `EXISTS (SELECT 1 FROM teams WHERE id = ? AND owner_id = ? AND updated_at = ?)`;
    const [team] = await db.batch([
      db
        .prepare(
          `UPDATE teams SET owner_id = ?, pending_owner_member_id = NULL, pending_owner_at = NULL, updated_at = ?
           WHERE id = ? AND ${guard.sql} RETURNING id`,
        )
        .bind(to.userId, t, teamId, ...guard.binds),
      db
        .prepare(
          `UPDATE memberships SET role = 'admin', updated_at = ? WHERE team_id = ? AND role = 'owner' AND id != ? AND ${moved}`,
        )
        .bind(t, teamId, to.id, teamId, to.userId, t),
      db
        .prepare(
          `UPDATE memberships SET role = 'owner', updated_at = ? WHERE id = ? AND team_id = ? AND status = 'active' AND ${moved}`,
        )
        .bind(t, to.id, teamId, teamId, to.userId, t),
    ]);
    return (team?.results.length ?? 0) > 0;
  }

  route(app, 'teams.transfer.accept', async (c) => {
    const me = c.var.member;
    const ok = await makeOwner(
      c.var.db,
      me.teamId,
      { id: me.id, userId: me.userId! },
      // A nomination made before the nominee last (re)joined is stale (they were removed meanwhile).
      {
        sql: 'pending_owner_member_id = ? AND pending_owner_at >= (SELECT coalesce(joined_at, 0) FROM memberships WHERE id = ?)',
        binds: [me.id, me.id],
      },
    );
    if (!ok) throw new HttpError(409, 'conflict', "There's no ownership handover waiting for you");
    await auditStmt(c.var.db, {
      teamId: me.teamId,
      actorId: me.userId,
      action: 'team.transferred',
      targetType: 'member',
      targetId: me.id,
      meta: { to: me.displayName },
    }).run();
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
        `SELECT t.owner_id, u.deleted_at, max(coalesce(u.last_seen_at, 0),
           coalesce((SELECT max(max(s.last_seen_at, s.created_at)) FROM sessions s WHERE s.user_id = u.id), 0)) AS seen
         FROM teams t LEFT JOIN users u ON u.id = t.owner_id WHERE t.id = ?`,
      )
      .bind(me.teamId)
      .first<{ owner_id: string; deleted_at: number | null; seen: number | null }>();
    const t = now();
    const away =
      !owner || owner.deleted_at !== null || t - Number(owner.seen ?? 0) >= OWNER_CLAIM_AFTER_MS;
    if (!away)
      throw new HttpError(
        409,
        'conflict',
        'The owner has been active in the last 30 days. Ask them to hand over ownership.',
      );
    // Only if the owner hasn't changed since we checked their activity.
    const ok = await makeOwner(
      c.var.db,
      me.teamId,
      { id: me.id, userId: me.userId! },
      { sql: 'owner_id = ?', binds: [owner?.owner_id ?? ''] },
    );
    if (!ok) throw new HttpError(409, 'conflict', 'Ownership just changed. Reload and try again.');
    await auditStmt(c.var.db, {
      teamId: me.teamId,
      actorId: me.userId,
      action: 'team.ownership_claimed',
      targetType: 'member',
      targetId: me.id,
      meta: { to: me.displayName },
    }).run();
    return c.json({ ok: true });
  });

  route(app, 'roles.put', async (c) => {
    const me = c.var.member;
    const id = c.req.param('roleId')!;
    if (!v.is(v.pipe(v.string(), v.uuid()), id)) throw notFound('Role not found');
    const input = await body(c, TeamRoleInput);
    const count = await c.var.db
      .prepare(
        'SELECT count(*) AS n FROM team_roles WHERE team_id = ? AND deleted_at IS NULL AND id != ?',
      )
      .bind(me.teamId, id)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_TEAM_ROLES)
      throw new HttpError(409, 'conflict', `A team can have up to ${MAX_TEAM_ROLES} roles`);
    const t = now();
    const row = await c.var.db
      .prepare(
        `INSERT INTO team_roles (id, team_id, name, color, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, permissions = excluded.permissions,
           updated_at = excluded.updated_at, deleted_at = NULL
         WHERE team_roles.team_id = excluded.team_id AND team_roles.deleted_at IS NULL
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
    const id = c.req.param('roleId')!;
    const t = now();
    const [del] = await c.var.db.batch([
      c.var.db
        .prepare(
          'UPDATE team_roles SET deleted_at = ?, updated_at = ? WHERE id = ? AND team_id = ? AND deleted_at IS NULL RETURNING name',
        )
        .bind(t, t, id, me.teamId),
      c.var.db
        .prepare(
          `UPDATE memberships SET updated_at = ?,
             role_ids = (SELECT json_group_array(value) FROM json_each(memberships.role_ids) WHERE value != ?)
           WHERE team_id = ? AND EXISTS (SELECT 1 FROM json_each(memberships.role_ids) WHERE value = ?)`,
        )
        .bind(t, id, me.teamId, id),
    ]);
    const row = del?.results[0] as { name: string } | undefined;
    if (!row) throw notFound('Role not found');
    await auditStmt(c.var.db, {
      teamId: me.teamId,
      actorId: me.userId,
      action: 'role.deleted',
      targetType: 'role',
      targetId: id,
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
          `UPDATE memberships SET status = 'removed', role_ids = '[]', removed_at = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(t, t, me.id),
      c.var.db
        .prepare(
          'UPDATE teams SET pending_owner_member_id = NULL, pending_owner_at = NULL WHERE id = ? AND pending_owner_member_id = ?',
        )
        .bind(me.teamId, me.id),
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
}
