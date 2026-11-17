/**
 * The one way route handlers ask for push notifications (PLAN.md M7).
 *
 * `notifyStmt` returns a single statement that queues a notification for the given members' users
 * (skipping `exceptUserId`, users who switched the topic off, and users with no devices). Add it to
 * the handler's existing `db.batch([...])`, so it costs no extra round trip, then call
 * `flushNotifications(c)` after the batch to start sending in the background.
 */
import type { Context } from 'hono';
import { NOTIFY_TOPICS, type NotifyTopic, type PushPayload } from '@phaseplay/shared';
import type { AppEnv, Env } from '../env';
import { DEMO_TEAM_ID, DEMO_USER_ID } from '../seed/demo';
import { drainQueue } from './push/queue';

export type NotifyTarget =
  | { memberIds: readonly string[] }
  /** Every active member of the team. */
  | { team: true };

/** A notification is a glance: keep it short (and well under the 4 KB push limit). */
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** Builds the stored payload (JSON). Exported for the cron jobs, which build their own SQL. */
export function payloadJson(
  topic: PushPayload['topic'],
  teamId: string | null,
  m: Omit<PushPayload, 'topic' | 'teamId'>,
): string {
  const p: PushPayload = {
    topic,
    teamId,
    title: clip(m.title, 80),
    body: clip(m.body, 240),
    url: m.url.startsWith('/') && !m.url.startsWith('//') ? m.url : '/home',
    ...(m.tag ? { tag: clip(m.tag, 64) } : {}),
  };
  return JSON.stringify(p);
}

/**
 * SQL that is true when user `u` wants `topic` (bound as a JSON path, e.g. `$.events`).
 * Topics are on until switched off; a malformed prefs value counts as all on.
 */
export const wantsTopicSql = (pathParam: string) =>
  `coalesce(json_extract(CASE WHEN json_valid(u.notify_prefs) THEN u.notify_prefs END, ${pathParam}), 1) <> 0`;

export function notifyStmt(
  db: D1Database,
  teamId: string,
  target: NotifyTarget,
  topic: NotifyTopic,
  message: Omit<PushPayload, 'topic' | 'teamId'>,
  exceptUserId?: string | null,
  /** Optional extra condition (SQL with `?` params), e.g. "only if this write won". */
  onlyIf?: { sql: string; params: unknown[] },
): D1PreparedStatement {
  if (!NOTIFY_TOPICS.includes(topic)) throw new Error(`Unknown topic ${topic}`);
  // The public demo never sends pushes (its members aren't people).
  if (teamId === DEMO_TEAM_ID) return db.prepare('SELECT 1 WHERE 0');
  const t = Date.now();
  const members = 'team' in target ? null : JSON.stringify(target.memberIds);
  return db
    .prepare(
      `INSERT INTO push_queue (id, user_id, payload, created_at, attempts, next_at)
       SELECT lower(hex(randomblob(16))), m.user_id, ?1, ?2, 0, ?2
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ?3 AND m.status = 'active'
         AND (?4 IS NULL OR m.id IN (SELECT value FROM json_each(?4)))
         AND m.user_id IS NOT ?5 AND m.user_id <> ?6 AND u.deleted_at IS NULL
         AND ${wantsTopicSql('?7')}
         AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = m.user_id)
         ${onlyIf ? `AND (${onlyIf.sql})` : ''}`,
    )
    .bind(
      payloadJson(topic, teamId, message),
      t,
      teamId,
      members,
      exceptUserId ?? null,
      DEMO_USER_ID,
      `$.${topic}`,
      ...(onlyIf?.params ?? []),
    );
}

/** The VAPID `sub` claim: how push services can reach whoever runs this server. */
export function vapidSubject(env: Env) {
  const https = env.ORIGINS.split(',')
    .map((s) => s.trim())
    .find((o) => o.startsWith('https://'));
  return https ?? 'https://phaseplay.app';
}

/** End-to-end tests run against fake push endpoints: pretend every send worked. */
const fakeFetch: typeof fetch = async () => new Response(null, { status: 201 });

export function drainOptions(env: Env, limit?: number) {
  return {
    subject: vapidSubject(env),
    limit,
    fetch: env.ENV === 'test' ? fakeFetch : undefined,
  };
}

/** Requests leave CPU for the request itself: a smaller first batch. */
const FLUSH_LIMIT = 20;

/** Start delivering queued notifications after the response (ctx.waitUntil). */
export function flushNotifications(c: Context<AppEnv>): void {
  let ctx: { waitUntil(p: Promise<unknown>): void };
  try {
    ctx = c.executionCtx;
  } catch {
    return; // No execution context (unit tests calling app.request): the cron drains instead.
  }
  ctx.waitUntil(
    drainQueue(c.env.DB, drainOptions(c.env, FLUSH_LIMIT)).catch((e: unknown) =>
      console.error(JSON.stringify({ requestId: c.var.requestId, push: String(e) })),
    ),
  );
}

/** "Sat 22 Nov, 14:30" in the team's timezone (US zones get US style). */
export function whenText(ms: number, tz: string) {
  const locale = tz.startsWith('America/') ? 'en-US' : 'en-GB';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(ms);
  } catch {
    return new Date(ms).toUTCString().slice(0, 22);
  }
}
