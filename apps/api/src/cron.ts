import type { Env } from './env';
import { ensureDemo } from './seed/load-demo';
import { drainOptions } from './lib/notify';
import { drainQueue, MAX_DEVICE_FAILURES } from './lib/push/queue';
import { queueKitAtRisk, queueReminders } from './lib/push/jobs';

/** Every few minutes: reply reminders, kit at risk, and the next batch of queued pushes. */
export const FREQUENT_CRON = '*/5 * * * *';
const TICK_MS = 5 * 60e3;

/** Run the job for a cron schedule (the controller's `cron` string from wrangler.toml). */
export async function scheduled(env: Env, cron?: string, scheduledTime = Date.now()) {
  if (cron === FREQUENT_CRON) return frequent(env, scheduledTime);
  return nightly(env);
}

export async function frequent(env: Env, t: number) {
  // One failing job must not hold up the others (or the queue).
  const jobs = [
    () => queueReminders(env.DB, t),
    () => queueKitAtRisk(env.DB, t, TICK_MS),
    () => drainQueue(env.DB, drainOptions(env)),
  ];
  for (const job of jobs)
    await job().catch((e: unknown) => console.error(JSON.stringify({ cron: String(e) })));
}

/** Nightly housekeeping: expire RSVP notes, purge tombstones after 30 days, drop dead sessions. */
export async function nightly(env: Env) {
  const t = Date.now();
  const month = t - 30 * 86400e3;
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE rsvps SET note = NULL, note_expires_at = NULL, updated_at = ? WHERE note_expires_at IS NOT NULL AND note_expires_at < ?',
    ).bind(t, t),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').bind(t),
    env.DB.prepare('DELETE FROM events WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(
      month,
    ),
    env.DB.prepare('DELETE FROM plays WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(month),
    env.DB.prepare('DELETE FROM drills WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(
      month,
    ),
    env.DB.prepare(
      'DELETE FROM practice_plans WHERE deleted_at IS NOT NULL AND deleted_at < ?',
    ).bind(month),
    env.DB.prepare('DELETE FROM seasons WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(
      month,
    ),
    env.DB.prepare('DELETE FROM invites WHERE expires_at < ?').bind(month),
    env.DB.prepare(
      `DELETE FROM team_sheet_versions WHERE rowid IN (SELECT rowid FROM (SELECT rowid, row_number() OVER (PARTITION BY sheet_id ORDER BY version DESC) AS rn FROM team_sheet_versions) WHERE rn > 10)`,
    ),
    env.DB.prepare('DELETE FROM play_views WHERE first_viewed_at < ?').bind(t - 400 * 86400e3),
    // Pushes nobody could deliver in two days, and devices that keep failing.
    env.DB.prepare('DELETE FROM push_queue WHERE created_at < ?').bind(t - 2 * 86400e3),
    env.DB.prepare('DELETE FROM push_subscriptions WHERE failures >= ?').bind(MAX_DEVICE_FAILURES),
  ]);
  // Keep the public demo's dates current (weekly practices, upcoming games).
  await ensureDemo(env.DB, t, true);
}
