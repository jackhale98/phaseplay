import type { Context } from 'hono';
import { type Action, can, parseRolePermissions } from '@phaseplay/shared';
import type { AppEnv } from './env';
import { forbidden, notFound, parseJson } from './lib/http';
import { MEMBER_COLS, memberFromRow } from './db/rows';
import { requireUser } from './auth/session';

/**
 * The only way a handler gets team access (CLAUDE.md non-negotiable #1). Loads the caller's
 * active membership and the permissions granted by their team roles in one indexed query on every
 * request (never cached), checks the permission model, and puts both on the context. Unknown,
 * deleted or other teams' resources are 404; known team but missing permission is 403.
 */
export async function requireMember(c: Context<AppEnv>, teamId: string, action: Action) {
  const user = requireUser(c);
  const row = await c.var.db
    .prepare(
      `SELECT ${MEMBER_COLS.split(', ')
        .map((x) => 'm.' + x)
        .join(', ')},
        (SELECT json_group_array(p.value) FROM team_roles r, json_each(r.permissions) p
          WHERE r.team_id = m.team_id AND r.deleted_at IS NULL
            AND r.id IN (SELECT value FROM json_each(m.role_ids))) AS grants,
        (SELECT max(r.updated_at) FROM team_roles r
          WHERE r.team_id = m.team_id AND r.id IN (SELECT value FROM json_each(m.role_ids))) AS roles_updated,
        t.role_permissions AS role_permissions, t.role_permissions_at AS role_permissions_at
       FROM memberships m
       JOIN teams t ON t.id = m.team_id
       WHERE m.team_id = ? AND m.user_id = ? AND m.status = 'active' AND t.deleted_at IS NULL`,
    )
    .bind(teamId, user.id)
    .first();
  if (!row) throw notFound('Team not found');
  const member = memberFromRow(row);
  const perms = {
    role: member.role,
    grants: parseJson(row.grants as string | null, [] as string[]),
    overrides: parseRolePermissions(row.role_permissions as string | null, () =>
      console.warn(JSON.stringify({ warn: 'role_permissions malformed, using defaults', teamId })),
    ),
  };
  if (!can(perms, action)) throw forbidden();
  c.set('member', member);
  c.set('perms', perms);
  c.set('rolePermissionsAt', Number(row.role_permissions_at ?? 0));
  // Editing a held team role or the team's base-role settings changes what this member may see.
  c.set(
    'rolesUpdatedAt',
    Math.max(Number(row.roles_updated ?? 0), Number(row.role_permissions_at ?? 0)),
  );
  return member;
}
