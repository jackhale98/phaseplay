/**
 * The one way route handlers ask for push notifications (PLAN.md M7).
 *
 * `notifyStmt` returns a single statement that queues a notification for the given members' users
 * (skipping `exceptUserId`, users who switched the topic off, and users with no devices). Add it to
 * the handler's existing `db.batch([...])`, so it costs no extra round trip, then call
 * `flushNotifications(c)` after the batch to start sending in the background.
 *
 * Contract only for now: the push implementation fills these in.
 */
import type { Context } from 'hono';
import type { NotifyTopic, PushPayload } from '@phaseplay/shared';
import type { AppEnv } from '../env';

export type NotifyTarget =
  | { memberIds: readonly string[] }
  /** Every active member of the team. */
  | { team: true };

export function notifyStmt(
  db: D1Database,
  teamId: string,
  target: NotifyTarget,
  topic: NotifyTopic,
  message: Omit<PushPayload, 'topic' | 'teamId'>,
  exceptUserId?: string | null,
): D1PreparedStatement {
  void [teamId, target, topic, message, exceptUserId];
  // No-op until push lands (a cheap statement keeps call sites batch-shaped).
  return db.prepare('SELECT 1');
}

/** Start delivering queued notifications after the response (ctx.waitUntil). */
export function flushNotifications(c: Context<AppEnv>): void {
  void c;
}
