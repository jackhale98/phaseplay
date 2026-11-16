import { uuidv7 } from '@phaseplay/shared';

export function auditStmt(
  db: D1Database,
  e: {
    teamId: string;
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    meta?: Record<string, unknown>;
  },
) {
  return db
    .prepare(
      'INSERT INTO audit_log (id, team_id, actor_id, action, target_type, target_id, meta, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      uuidv7(),
      e.teamId,
      e.actorId,
      e.action,
      e.targetType,
      e.targetId,
      e.meta ? JSON.stringify(e.meta) : null,
      Date.now(),
    );
}
