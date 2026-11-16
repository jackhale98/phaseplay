import type { Context } from 'hono';
import { type Action, can } from '@phaseplay/shared';
import type { AppEnv } from './env';
import { forbidden, notFound } from './lib/http';
import { MEMBER_COLS, memberFromRow } from './db/rows';
import { requireUser } from './auth/session';

/**
 * The only way a handler gets team access (CLAUDE.md non-negotiable #1). Loads the caller's
 * active membership with one indexed query on every request (never cached), checks the
 * permission matrix, and puts the membership on the context. Unknown, deleted or other teams'
 * resources are 404; known team but missing permission is 403.
 */
export async function requireMember(c: Context<AppEnv>, teamId: string, action: Action) {
  const user = requireUser(c);
  const row = await c.var.db
    .prepare(
      `SELECT ${MEMBER_COLS.split(', ').map((x) => 'm.' + x).join(', ')} FROM memberships m
       JOIN teams t ON t.id = m.team_id
       WHERE m.team_id = ? AND m.user_id = ? AND m.status = 'active' AND t.deleted_at IS NULL`,
    )
    .bind(teamId, user.id)
    .first();
  if (!row) throw notFound('Team not found');
  const member = memberFromRow(row);
  if (!can(member.role, action)) throw forbidden();
  c.set('member', member);
  return member;
}
