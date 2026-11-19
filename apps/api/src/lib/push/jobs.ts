/**
 * Notifications the cron creates: day-before reply reminders and kit at risk. Each job is one
 * read and one write batch. Events are found through teams (CROSS JOIN keeps teams as the outer
 * loop) so the lookup uses the `events(team_id, starts_at)` index rather than scanning events.
 */
import { DEMO_TEAM_ID, DEMO_USER_ID } from '../../seed/demo';
import { payloadJson, wantsTopicSql, whenText } from '../notify';
import { PROPOSAL_REMIND_BEFORE_MS, stillToCome } from '@phaseplay/shared';
import { datesText, eventLabel } from './messages';

const H = 3600e3;
/**
 * Reminders go out for events starting 18–30 h from now, once each (`events.reminded_at`). A "Time
 * TBD" event is stored at local noon, so its reminder still goes out the day before.
 */
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
  time_tbd: number;
  location_name: string | null;
  timezone: string;
  short_name: string;
};

const recipientsSql = (topicParam: string) => `
  JOIN memberships m ON m.team_id = e.team_id AND m.status = 'active' AND m.user_id IS NOT NULL
  JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL AND u.id <> '${DEMO_USER_ID}'
  WHERE ${wantsTopicSql(topicParam)}
    AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = m.user_id)`;

/** Queue "are you in?" for members with no reply yet. Returns how many events were reminded. */
export async function queueReminders(db: D1Database, t: number): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.team_id, e.title, e.type, e.opponent, e.starts_at, e.time_tbd, e.location_name, t.timezone, t.short_name
       FROM teams t CROSS JOIN events e
       WHERE e.team_id = t.id AND t.deleted_at IS NULL AND t.id <> ?
         AND e.starts_at >= ? AND e.starts_at < ? AND e.reminded_at IS NULL
         AND e.deleted_at IS NULL AND e.cancelled_at IS NULL AND e.status = 'confirmed'
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
        body: `${whenText(e.starts_at, e.timezone, e.time_tbd)}${e.location_name ? ` · ${e.location_name}` : ''}. Tap to reply.`,
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

/** A "Time TBD" event is stored at local noon but runs to the end of its day (≤ 13 h later). */
const TBD_LATE = 13 * H;

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
      `SELECT e.id, e.team_id, e.title, e.type, e.opponent, e.starts_at, e.time_tbd, t.short_name,
         t.timezone, m.user_id, json_group_array(i.name) AS items
       FROM teams t CROSS JOIN events e
       JOIN rsvps r ON r.event_id = e.id AND r.status = 'no'
       JOIN inventory_items i ON i.holder_member_id = r.member_id AND i.team_id = e.team_id
         AND i.status = 'with_someone' AND i.deleted_at IS NULL
       ${recipientsSql('?5')}
         AND m.id = r.member_id
         AND e.team_id = t.id AND t.deleted_at IS NULL AND t.id <> ?1
         AND e.starts_at >= ?2 - ${TBD_LATE} AND e.starts_at < ?3 AND (e.starts_at >= ?2 OR e.time_tbd = 1)
         AND e.deleted_at IS NULL AND e.cancelled_at IS NULL
         AND e.status = 'confirmed'
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
      starts_at: number;
      time_tbd: number;
      short_name: string;
      timezone: string;
      user_id: string;
      items: string;
    }>();
  // A "Time TBD" event (stored at local noon) is still to come until its day is over.
  const due = results.filter((r) =>
    stillToCome({ startsAt: r.starts_at, timeTbd: !!r.time_tbd }, r.timezone, t),
  );
  if (!due.length) return 0;
  const rows = due.map((r) => ({
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

/**
 * "Answers due soon": two days before a proposal's answer-by time, to members who haven't answered
 * any of its dates. Once per proposal (`events.proposal_reminded_at`), looked up through the
 * partial index on proposed events' `answer_by`.
 */
export async function queueProposalReminders(db: D1Database, t: number): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.team_id, e.title, e.type, e.opponent, t.timezone, t.short_name,
         (SELECT json_group_array(o.starts_at) FROM event_options o
           WHERE o.event_id = e.id AND o.deleted_at IS NULL) AS dates
       FROM events e JOIN teams t ON t.id = e.team_id AND t.deleted_at IS NULL
       WHERE e.status = 'proposed' AND e.answer_by > ?1 AND e.answer_by <= ?2
         AND e.proposal_reminded_at IS NULL AND e.deleted_at IS NULL AND e.cancelled_at IS NULL
         AND e.team_id <> ?3
       ORDER BY e.answer_by LIMIT ${MAX_EVENTS}`,
    )
    .bind(t, t + PROPOSAL_REMIND_BEFORE_MS, DEMO_TEAM_ID)
    .all<EventRow & { dates: string }>();
  if (!results.length) return 0;
  const events = JSON.stringify(
    results.map((e) => ({
      id: e.id,
      p: payloadJson('reminders', e.team_id, {
        title: `Answers due soon: ${eventLabel(e)}`,
        body: `${datesText(JSON.parse(e.dates) as number[], e.timezone)}. Can you make it? Tap to answer.`,
        url: `/events/${e.id}?team=${e.team_id}`,
        tag: `event-${e.id}`,
      }),
    })),
  );
  await db.batch([
    db
      .prepare(
        `INSERT INTO push_queue (id, user_id, payload, created_at, attempts, next_at)
         SELECT lower(hex(randomblob(16))), m.user_id, j.value->>'p', ?1, 0, ?1
         FROM json_each(?2) j
         JOIN events e ON e.id = j.value->>'id' AND e.proposal_reminded_at IS NULL AND e.status = 'proposed'
         ${recipientsSql('?3')}
           AND NOT EXISTS (SELECT 1 FROM proposal_answers a WHERE a.event_id = e.id AND a.member_id = m.id)`,
      )
      .bind(t, events, '$.reminders'),
    db
      .prepare(
        `UPDATE events SET proposal_reminded_at = ? WHERE id IN (SELECT j.value->>'id' FROM json_each(?) j)
         AND proposal_reminded_at IS NULL`,
      )
      .bind(t, events),
  ]);
  return results.length;
}
