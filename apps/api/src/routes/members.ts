import type { Hono } from 'hono';
import {
  INVITE_EXPIRIES,
  InviteAccept,
  InviteCreate,
  InviteToken,
  MemberUpdate,
  PendingMemberCreate,
  RelinkCreate,
  canChangeRole,
  canRemove,
  invitableRoles,
  isCoach,
  isStaff,
  randomToken,
  sha256Base64Url,
  type InvitePreview,
  type Role,
} from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, forbidden, notFound, now } from '../lib/http';
import { INVITE_COLS, MEMBER_COLS, inviteFromRow, memberFromRow } from '../db/rows';
import { auditStmt } from '../lib/audit';
import { rateLimit, requireUser } from '../auth/session';

const RELINK_TTL = 24 * 3600e3;

export function memberRoutes(app: Hono<AppEnv>) {
  const loadMember = async (db: D1Database, teamId: string, memberId: string) => {
    const row = await db
      .prepare(
        `SELECT ${MEMBER_COLS} FROM memberships WHERE id = ? AND team_id = ? AND status != 'removed'`,
      )
      .bind(memberId, teamId)
      .first();
    if (!row) throw notFound('Member not found');
    return memberFromRow(row);
  };

  route(app, 'members.update', async (c) => {
    const me = c.var.member;
    const input = await body(c, MemberUpdate);
    const target = await loadMember(c.var.db, me.teamId, c.req.param('memberId')!);
    const self = target.id === me.id;
    // Players may edit their own jersey and positions; staff manage everyone else.
    if (!self && !isCoach(me.role)) {
      if (!(isStaff(me.role) && target.status === 'pending')) throw forbidden();
    }
    if (input.role !== undefined && input.role !== target.role) {
      if (!canChangeRole(me.role, target.role, input.role as Role))
        throw forbidden("You can't give that role");
    }
    if (input.displayName !== undefined && target.status !== 'pending')
      throw new HttpError(400, 'bad_request', 'Members set their own name in Settings');
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (input.role !== undefined) {
      sets.push('role = ?');
      vals.push(input.role);
    }
    if (input.jersey !== undefined) {
      sets.push('jersey = ?');
      vals.push(input.jersey);
    }
    if (input.positions !== undefined) {
      sets.push('positions = ?');
      vals.push(JSON.stringify(input.positions));
    }
    if (input.displayName !== undefined) {
      sets.push('display_name = ?');
      vals.push(input.displayName);
    }
    if (!sets.length) return c.json({ ok: true });
    const stmts = [
      c.var.db
        .prepare(
          `UPDATE memberships SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND team_id = ?`,
        )
        .bind(...vals, now(), target.id, me.teamId),
    ];
    if (input.role !== undefined && input.role !== target.role)
      stmts.push(
        auditStmt(c.var.db, {
          teamId: me.teamId,
          actorId: me.userId,
          action: 'member.role_changed',
          targetType: 'member',
          targetId: target.id,
          meta: { name: target.displayName, from: target.role, to: input.role },
        }),
      );
    await c.var.db.batch(stmts);
    return c.json({ ok: true });
  });

  route(app, 'members.remove', async (c) => {
    const me = c.var.member;
    const target = await loadMember(c.var.db, me.teamId, c.req.param('memberId')!);
    if (target.id === me.id) throw new HttpError(400, 'bad_request', 'Use "Leave team" instead');
    if (!canRemove(me.role, target.role)) throw forbidden("You can't remove that member");
    const t = now();
    await c.var.db.batch([
      c.var.db
        .prepare(
          `UPDATE memberships SET status = 'removed', removed_at = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(t, t, target.id),
      c.var.db
        .prepare(
          `UPDATE invites SET revoked_at = ? WHERE team_id = ? AND target_member_id = ? AND revoked_at IS NULL`,
        )
        .bind(t, me.teamId, target.id),
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'member.removed',
        targetType: 'member',
        targetId: target.id,
        meta: { name: target.displayName },
      }),
    ]);
    return c.json({ ok: true });
  });

  route(app, 'members.pending', async (c) => {
    const me = c.var.member;
    const input = await body(c, PendingMemberCreate);
    await c.var.db
      .prepare(
        `INSERT INTO memberships (id, team_id, user_id, display_name, role, jersey, positions, status, updated_at)
         VALUES (?, ?, NULL, ?, 'player', ?, ?, 'pending', ?) ON CONFLICT DO NOTHING`,
      )
      .bind(
        input.id,
        me.teamId,
        input.displayName,
        input.jersey ?? null,
        JSON.stringify(input.positions),
        now(),
      )
      .run();
    return c.json({ ok: true }, 201);
  });

  route(app, 'members.relink', async (c) => {
    const me = c.var.member;
    const input = await body(c, RelinkCreate);
    const target = await loadMember(c.var.db, me.teamId, c.req.param('memberId')!);
    if (target.status !== 'active' || !target.userId)
      throw new HttpError(400, 'bad_request', 'Only joined members can re-link a device');
    if (input.memberId !== target.id) throw new HttpError(400, 'bad_request', 'Mismatched member');
    const token = randomToken(16);
    const t = now();
    await c.var.db.batch([
      c.var.db
        .prepare(
          `INSERT INTO invites (id, team_id, token_hash, kind, role, target_member_id, created_by, created_at, expires_at, max_uses)
           VALUES (?, ?, ?, 'relink', ?, ?, ?, ?, ?, 1)`,
        )
        .bind(
          input.id,
          me.teamId,
          await sha256Base64Url(token),
          target.role,
          target.id,
          me.userId,
          t,
          t + RELINK_TTL,
        ),
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'member.relink_issued',
        targetType: 'member',
        targetId: target.id,
        meta: { name: target.displayName },
      }),
    ]);
    return c.json({ token, path: `/relink#t=${token}`, expiresAt: t + RELINK_TTL }, 201);
  });

  route(app, 'invites.list', async (c) => {
    const { results } = await c.var.db
      .prepare(
        `SELECT ${INVITE_COLS} FROM invites WHERE team_id = ? AND kind = 'join' ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(c.var.member.teamId)
      .all();
    return c.json({ invites: results.map(inviteFromRow) });
  });

  route(app, 'invites.create', async (c) => {
    const me = c.var.member;
    const input = await body(c, InviteCreate);
    if (!invitableRoles(me.role).includes(input.role))
      throw forbidden(`You can't invite a ${input.role}`);
    const token = randomToken(16);
    const t = now();
    const expiresAt = t + INVITE_EXPIRIES[input.expiresIn];
    await c.var.db.batch([
      c.var.db
        .prepare(
          `INSERT INTO invites (id, team_id, token_hash, kind, role, created_by, created_at, expires_at, max_uses)
           VALUES (?, ?, ?, 'join', ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.id,
          me.teamId,
          await sha256Base64Url(token),
          input.role,
          me.userId,
          t,
          expiresAt,
          input.maxUses,
        ),
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'invite.created',
        targetType: 'invite',
        targetId: input.id,
        meta: { role: input.role, maxUses: input.maxUses, expiresIn: input.expiresIn },
      }),
    ]);
    return c.json({ id: input.id, token, path: `/join#t=${token}`, expiresAt }, 201);
  });

  route(app, 'invites.revoke', async (c) => {
    const me = c.var.member;
    const r = await c.var.db
      .prepare(
        'UPDATE invites SET revoked_at = ? WHERE id = ? AND team_id = ? AND revoked_at IS NULL',
      )
      .bind(now(), c.req.param('inviteId'), me.teamId)
      .run();
    if (!r.meta.changes) throw notFound('Invite not found');
    await auditStmt(c.var.db, {
      teamId: me.teamId,
      actorId: me.userId,
      action: 'invite.revoked',
      targetType: 'invite',
      targetId: c.req.param('inviteId')!,
    }).run();
    return c.json({ ok: true });
  });

  const findInvite = async (db: D1Database, token: string) => {
    const row = await db
      .prepare(
        `SELECT i.id, i.team_id, i.kind, i.role, i.target_member_id, i.created_by, t.name, t.short_name, t.colors,
          (SELECT display_name FROM users WHERE id = i.created_by) AS inviter,
          (SELECT display_name FROM memberships WHERE id = i.target_member_id) AS target_name
         FROM invites i JOIN teams t ON t.id = i.team_id
         WHERE i.token_hash = ? AND i.revoked_at IS NULL AND i.expires_at > ? AND i.uses < i.max_uses AND t.deleted_at IS NULL`,
      )
      .bind(await sha256Base64Url(token), now())
      .first<Record<string, string>>();
    if (!row)
      throw new HttpError(
        410,
        'gone',
        'This invite has expired or been used up. Ask your coach for a new link.',
      );
    return row;
  };

  route(app, 'invites.preview', async (c) => {
    await rateLimit(c, 'invite');
    const { token } = await body(c, InviteToken);
    const inv = await findInvite(c.var.db, token);
    let pending: InvitePreview['pending'] = [];
    if (inv.kind === 'join' && inv.role === 'player') {
      const { results } = await c.var.db
        .prepare(
          `SELECT id, display_name FROM memberships WHERE team_id = ? AND status = 'pending' ORDER BY display_name LIMIT 80`,
        )
        .bind(inv.team_id)
        .all<{ id: string; display_name: string }>();
      pending = results.map((r) => ({ id: r.id, displayName: r.display_name }));
    }
    const res: InvitePreview = {
      kind: inv.kind as 'join' | 'relink',
      team: {
        id: inv.team_id!,
        name: inv.name!,
        shortName: inv.short_name!,
        colors: JSON.parse(inv.colors!),
      },
      invitedBy: inv.inviter ?? 'Your coach',
      role: inv.role as Role,
      pending,
      ...(inv.target_name ? { targetName: inv.target_name } : {}),
    };
    return c.json(res);
  });

  route(app, 'invites.accept', async (c) => {
    await rateLimit(c, 'invite');
    const u = requireUser(c);
    const input = await body(c, InviteAccept);
    const inv = await findInvite(c.var.db, input.token);
    if (inv.kind !== 'join')
      throw new HttpError(400, 'bad_request', 'This is a device link, not an invite');
    const teamId = inv.team_id!;
    const existing = await c.var.db
      .prepare(`SELECT id, status FROM memberships WHERE team_id = ? AND user_id = ?`)
      .bind(teamId, u.id)
      .first<{ id: string; status: string }>();
    if (existing?.status === 'active') return c.json({ ok: true, teamId, memberId: existing.id });

    const used = await c.var.db
      .prepare('UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses RETURNING id')
      .bind(inv.id)
      .first();
    if (!used) throw new HttpError(410, 'gone', 'This invite has just been used up.');

    const t = now();
    let memberId: string;
    let stmt: D1PreparedStatement;
    if (existing) {
      memberId = existing.id;
      stmt = c.var.db
        .prepare(
          `UPDATE memberships SET status = 'active', role = ?, display_name = ?, joined_at = ?, removed_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .bind(inv.role, u.displayName, t, t, existing.id);
    } else if (input.claimMemberId) {
      memberId = input.claimMemberId;
      stmt = c.var.db
        .prepare(
          `UPDATE memberships SET user_id = ?, status = 'active', role = ?, display_name = ?, joined_at = ?, updated_at = ?
           WHERE id = ? AND team_id = ? AND status = 'pending'`,
        )
        .bind(u.id, inv.role, u.displayName, t, t, memberId, teamId);
    } else {
      memberId = crypto.randomUUID();
      stmt = c.var.db
        .prepare(
          `INSERT INTO memberships (id, team_id, user_id, display_name, role, positions, status, joined_at, updated_at)
           VALUES (?, ?, ?, ?, ?, '[]', 'active', ?, ?)`,
        )
        .bind(memberId, teamId, u.id, u.displayName, inv.role, t, t);
    }
    const [res] = await c.var.db.batch([
      stmt,
      auditStmt(c.var.db, {
        teamId,
        actorId: u.id,
        action: 'member.joined',
        targetType: 'member',
        targetId: memberId,
        meta: { name: u.displayName, role: inv.role, inviteId: inv.id },
      }),
    ]);
    if (!res?.meta.changes)
      throw new HttpError(409, 'conflict', 'That name has already been claimed');
    return c.json({ ok: true, teamId, memberId });
  });
}
