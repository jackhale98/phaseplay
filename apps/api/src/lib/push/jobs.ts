/**
 * Notifications the cron creates: day-before reply reminders and kit at risk. Each job is one
 * read and one write batch. Events are found through teams (CROSS JOIN keeps teams as the outer
 * loop) so the lookup uses the `events(team_id, starts_at)` index rather than scanning events.
 */
import { DEMO_TEAM_ID, DEMO_USER_ID } from '../../seed/demo';
import { payloadJson, wantsTopicSql, whenText } from '../notify';

const H = 3600e3;
/** Reminders go out for events starting 18–30 h from now, once each (`events.reminded_at`). */
export const REMIND_FROM = 18 * H;
export const REMIND_TO = 30 * H;
const MAX_EVENTS = 40;

type EventRow = {
  id: string;
  team_id: string;
  title: string;
  type: string;
  opponent: string | null;
  starts_at: number;
  location_name: string | null;
  timezone: string;
  short_name: string;
};

/** "PRFC v Rivals" for games with an opponent, else the event title. */
export const eventLabel = (e: {
  title: string;
  type: string;
  opponent: string | null;
  short_name?: string;
}) =>
  (e.type === 'match' || e.type === 'tournament') && e.opponent
    ? `${e.short_name ?? e.title} v ${e.opponent}`
    : e.title;

const recipientsSql = (topicParam: string) => `
  JOIN memberships m ON m.team_id = e.team_id AND m.status = 'active' AND m.user_id IS NOT NULL
  JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL AND u.id <> '${DEMO_USER_ID}'
  WHERE ${wantsTopicSql(topicParam)}
    AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = m.user_id)`;

/** Queue "are you in?" for members with no reply yet. Returns how many events were reminded. */
export async function queueReminders(db: D1Database, t: number): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.team_id, e.title, e.type, e.opponent, e.starts_at, e.location_name, t.timezone, t.short_name
       FROM teams t CROSS JOIN events e
       WHERE e.team_id = t.id AND t.deleted_at IS NULL AND t.id <> ?
         AND e.starts_at >= ? AND e.starts_at < ? AND e.reminded_at IS NULL
         AND e.deleted_at IS NULL AND e.cancelled_at IS NULL
         AND (e.rsvp_deadline IS NULL OR e.rsvp_deadline > ?)
       ORDER BY e.starts_at LIMIT ${MAX_EVENTS}`,
    )
    .bind(DEMO_TEAM_ID, t + REMIND_FROM, t + REMIND_TO, t)
    .all<EventRow>();
  if (!results.length) return 0;
  const events = JSON.stringify(
    results.map((e) => ({
      id: e.id,
      p: payloadJson('reminders', e.team_id, {
        title: `Are you in? ${eventLabel(e)}`,
        body: `${whenText(e.starts_at, e.timezone)}${e.location_name ? ` · ${e.location_name}` : ''}. Tap to reply.`,
        url: `/events/${e.id}?team=${e.team_id}`,
        tag: `rsvp-${e.id}`,
      }),
    })),
  );
  // Same transaction: the reminder is queued exactly once, even if two crons overlap.
  await db.batch([
    db
      .prepare(
        `INSERT INTO push_queue (id, user_id, payload, created_at, attempts, next_at)
         SELECT lower(hex(randomblob(16))), m.user_id, j.value->>'p', ?1, 0, ?1
         FROM json_each(?2) j
         JOIN events e ON e.id = j.value->>'id' AND e.reminded_at IS NULL
         ${recipientsSql('?3')}
           AND NOT EXISTS (SELECT 1 FROM rsvps r WHERE r.event_id = e.id AND r.member_id = m.id AND r.status IS NOT NULL)`,
      )
      .bind(t, events, '$.reminders'),
    db
      .prepare(
        `UPDATE events SET reminded_at = ? WHERE id IN (SELECT j.value->>'id' FROM json_each(?) j) AND reminded_at IS NULL`,
      )
      .bind(t, events),
  ]);
  return results.length;
}

const listOf = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? 'kit')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * Kit at risk: someone who replied "no" to an event in the next 24 h still holds team kit.
 * Each (event, member) is caught once, by the tick in which either the event crossed the 24 h mark
 * (for replies made earlier) or the "no" arrived (for events already inside 24 h). `tick` is the
 * cron interval and `t` its scheduled time.
 */
export async function queueKitAtRisk(db: D1Database, t: number, tick: number): Promise<number> {
  const day = 24 * H;
  const { results } = await db
    .prepare(
      `SELECT e.id, e.team_id, e.title, e.type, e.opponent, t.short_name, m.user_id,
         json_group_array(i.name) AS items
       FROM teams t CROSS JOIN events e
       JOIN rsvps r ON r.event_id = e.id AND r.status = 'no'
       JOIN inventory_items i ON i.holder_member_id = r.member_id AND i.team_id = e.team_id
         AND i.status = 'with_someone' AND i.deleted_at IS NULL
       ${recipientsSql('?5')}
         AND m.id = r.member_id
         AND e.team_id = t.id AND t.deleted_at IS NULL AND t.id <> ?1
         AND e.starts_at >= ?2 AND e.starts_at < ?3 AND e.deleted_at IS NULL AND e.cancelled_at IS NULL
         AND ((e.starts_at >= ?3 - ?4 AND r.updated_at < ?2 - ?4) OR (r.updated_at >= ?2 - ?4 AND r.updated_at < ?2))
       GROUP BY e.id, m.id
       LIMIT 200`,
    )
    .bind(DEMO_TEAM_ID, t, t + day, tick, '$.kit')
    .all<{
      id: string;
      team_id: string;
      title: string;
      type: string;
      opponent: string | null;
      short_name: string;
      user_id: string;
      items: string;
    }>();
  if (!results.length) return 0;
  const rows = results.map((r) => ({
    u: r.user_id,
    p: payloadJson('kit', r.team_id, {
      title: 'Kit check',
      body: `You're not going to ${eventLabel(r)}: hand the ${listOf([...new Set(JSON.parse(r.items) as string[])])} to someone?`,
      url: `/kit?team=${r.team_id}`,
      tag: `kit-${r.id}`,
    }),
  }));
  await db
    .prepare(
      `INSERT INTO push_queue (id, user_id, payload, created_at, attempts, next_at)
       SELECT lower(hex(randomblob(16))), j.value->>'u', j.value->>'p', ?1, 0, ?1 FROM json_each(?2) j`,
    )
    .bind(t, JSON.stringify(rows))
    .run();
  return rows.length;
}
