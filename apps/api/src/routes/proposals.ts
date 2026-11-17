/**
 * Tentative games and events ("Not confirmed yet", packages/shared/proposals.ts): members answer
 * their own dates; staff confirm one date or drop the proposal. Creating and editing go through
 * events.create / events.update.
 */
import type { Hono } from 'hono';
import { ProposalAnswerPut, ProposalConfirm } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, notFound, now } from '../lib/http';
import { EVENT_COLS, eventFromRow } from '../db/rows';
import { auditStmt } from '../lib/audit';
import { flushNotifications, notifyStmt } from '../lib/notify';
import {
  eventCreated,
  proposalConfirmed,
  proposalDropped,
  type EventInfo,
} from '../lib/push/messages';

const TEAM_INFO = `(SELECT timezone FROM teams WHERE id = events.team_id) AS timezone,
  (SELECT short_name FROM teams WHERE id = events.team_id) AS short_name`;

type Row = Record<string, unknown>;
const info = (r: Row): EventInfo => r as unknown as EventInfo;

/** Everyone who was in for a date (SQL for notifyStmt's `onlyIf`, `m` = the member). */
const IN_FOR = `m.id IN (SELECT member_id FROM proposal_answers WHERE option_id = ?8 AND answer = 'in')`;

export function proposalRoutes(app: Hono<AppEnv>) {
  /** My answers for one or more dates. Only while the proposal is open. */
  route(app, 'proposals.answer', async (c) => {
    const me = c.var.member;
    const eventId = c.req.param('eventId')!;
    const input = await body(c, ProposalAnswerPut);
    const t = now();
    const { results } = await c.var.db
      .prepare(
        `INSERT INTO proposal_answers (option_id, member_id, event_id, team_id, answer, updated_at)
         SELECT o.id, ?1, o.event_id, o.team_id, j.value->>'answer', ?2
         FROM json_each(?3) j
         JOIN event_options o ON o.id = j.value->>'optionId' AND o.event_id = ?4 AND o.team_id = ?5
           AND o.deleted_at IS NULL
         JOIN events e ON e.id = o.event_id AND e.team_id = ?5 AND e.status = 'proposed' AND e.deleted_at IS NULL
         WHERE true
         ON CONFLICT(option_id, member_id) DO UPDATE SET answer = excluded.answer, updated_at = excluded.updated_at
         RETURNING option_id`,
      )
      .bind(me.id, t, JSON.stringify(input.answers), eventId, me.teamId)
      .all<{ option_id: string }>();
    if (!results.length) {
      const ev = await c.var.db
        .prepare('SELECT status FROM events WHERE id = ? AND team_id = ? AND deleted_at IS NULL')
        .bind(eventId, me.teamId)
        .first<{ status: string }>();
      if (!ev || ev.status === 'dropped') throw notFound('Event not found');
      if (ev.status === 'confirmed')
        throw new HttpError(409, 'conflict', 'This has been decided already');
      throw notFound('That date is no longer an option');
    }
    return c.json({ ok: true, updatedAt: t, saved: results.map((r) => r.option_id) });
  });

  /**
   * Pick a date. The event takes that date's times and goes on the schedule; everyone who was in
   * becomes a "yes" asked to reconfirm, and the rest of the team hears it's on. A retry (or a
   * second tap) is a no-op that only fills in any missing replies.
   */
  route(app, 'proposals.confirm', async (c) => {
    const me = c.var.member;
    const eventId = c.req.param('eventId')!;
    const input = await body(c, ProposalConfirm);
    const t = now();
    const db = c.var.db;
    const opt = `(SELECT %s FROM event_options WHERE id = ?1 AND event_id = ?2 AND team_id = ?3)`;
    const start = `coalesce(?4, ${opt.replace('%s', 'starts_at')})`;
    const meet = `CASE WHEN ?5 = 1 THEN ?6 ELSE ${opt.replace('%s', 'meet_at')} END`;
    const end = opt.replace('%s', 'ends_at');
    const row = await db
      .prepare(
        `UPDATE events SET status = 'confirmed', starts_at = ${start},
           meet_at = CASE WHEN ${meet} <= ${start} THEN ${meet} END,
           ends_at = CASE WHEN ${end} >= ${start} THEN ${end} END,
           reminded_at = NULL, version = version + 1, updated_at = ?7
         WHERE id = ?2 AND team_id = ?3 AND status = 'proposed' AND deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM event_options WHERE id = ?1 AND event_id = ?2 AND team_id = ?3 AND deleted_at IS NULL)
         RETURNING ${EVENT_COLS}, ${TEAM_INFO}`,
      )
      .bind(
        input.optionId,
        eventId,
        me.teamId,
        input.startsAt ?? null,
        input.meetAt !== undefined ? 1 : 0,
        input.meetAt ?? null,
        t,
      )
      .first<Row>();
    // Everyone who was in for this date is a "yes" waiting for their "Still in?". Never overwrites
    // a reply someone has given since, so it is safe to repeat.
    const rsvps = db
      .prepare(
        `INSERT INTO rsvps (event_id, member_id, team_id, status, updated_at, reconfirm)
         SELECT a.event_id, a.member_id, a.team_id, 'yes', ?1, 1 FROM proposal_answers a
         JOIN memberships m ON m.id = a.member_id AND m.team_id = a.team_id AND m.status != 'removed'
         WHERE a.option_id = ?2 AND a.event_id = ?3 AND a.team_id = ?4 AND a.answer = 'in'
         ON CONFLICT(event_id, member_id) DO UPDATE SET status = 'yes', reconfirm = 1,
           updated_at = excluded.updated_at WHERE rsvps.status IS NULL`,
      )
      .bind(t, input.optionId, eventId, me.teamId);
    if (row) {
      const ev = eventFromRow(row);
      const stmts = [rsvps];
      if (ev.startsAt > t) {
        const only = (sql: string) => ({ sql, params: [input.optionId] });
        stmts.push(
          notifyStmt(
            db,
            me.teamId,
            { team: true },
            'events',
            proposalConfirmed(me.teamId, info(row)),
            me.userId,
            only(IN_FOR),
          ),
          notifyStmt(
            db,
            me.teamId,
            { team: true },
            'events',
            eventCreated(me.teamId, info(row)),
            me.userId,
            only(`NOT ${IN_FOR}`),
          ),
        );
      }
      await db.batch(stmts);
      if (stmts.length > 1) flushNotifications(c);
      return c.json({ event: ev });
    }
    const cur = await db
      .prepare(
        `SELECT ${EVENT_COLS}, (SELECT starts_at FROM event_options WHERE id = ? AND event_id = events.id) AS option_start
         FROM events WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
      )
      .bind(input.optionId, eventId, me.teamId)
      .first<Row>();
    if (!cur || cur.status === 'dropped') throw notFound('Event not found');
    const latest = eventFromRow(cur);
    if (cur.status === 'proposed') throw notFound('That date is no longer an option');
    if (latest.startsAt !== (input.startsAt ?? cur.option_start))
      throw new HttpError(409, 'conflict', 'This was confirmed for another date', { latest });
    await rsvps.run();
    return c.json({ event: latest });
  });

  /** Not going ahead: hidden from every list; everyone who answered hears about it. */
  route(app, 'proposals.drop', async (c) => {
    const me = c.var.member;
    const eventId = c.req.param('eventId')!;
    const t = now();
    const db = c.var.db;
    const row = await db
      .prepare(
        `UPDATE events SET status = 'dropped', version = version + 1, updated_at = ?
         WHERE id = ? AND team_id = ? AND status = 'proposed' AND deleted_at IS NULL
         RETURNING ${EVENT_COLS}, ${TEAM_INFO}`,
      )
      .bind(t, eventId, me.teamId)
      .first<Row>();
    if (!row) {
      const cur = await db
        .prepare(
          `SELECT ${EVENT_COLS} FROM events WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
        )
        .bind(eventId, me.teamId)
        .first<Row>();
      if (!cur) throw notFound('Event not found');
      if (cur.status === 'dropped') return c.json({ event: eventFromRow(cur) });
      throw new HttpError(409, 'conflict', 'This is on the schedule now', {
        latest: eventFromRow(cur),
      });
    }
    const ev = eventFromRow(row);
    const tell = ev.startsAt > t;
    await db.batch([
      auditStmt(db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'event.dropped',
        targetType: 'event',
        targetId: eventId,
        meta: { title: ev.title },
      }),
      ...(tell
        ? [
            notifyStmt(
              db,
              me.teamId,
              { team: true },
              'events',
              proposalDropped(me.teamId, info(row)),
              me.userId,
              {
                sql: 'm.id IN (SELECT member_id FROM proposal_answers WHERE event_id = ?8)',
                params: [eventId],
              },
            ),
          ]
        : []),
    ]);
    if (tell) flushNotifications(c);
    return c.json({ event: ev });
  });
}
