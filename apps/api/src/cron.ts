import type { Env } from './env';

/** Nightly housekeeping: expire RSVP notes, purge tombstones after 30 days, drop dead sessions. */
export async function scheduled(env: Env) {
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
  ]);
}
