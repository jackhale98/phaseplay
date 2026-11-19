/**
 * Tentative games and events ("Not confirmed yet", packages/shared/proposals.ts): members answer
 * their own dates; staff confirm one date or drop the proposal. Creating and editing go through
 * events.create / events.update.
 */
import type { Hono } from 'hono';
import { ProposalAnswerPut, ProposalConfirm, stillToCome, uuidv7 } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, notFound, now } from '../lib/http';
import { EVENT_COLS, eventFromRow } from '../db/rows';
import { flushNotifications, notifyStmt } from '../lib/notify';
import {
  eventCreated,
  proposalConfirmed,
  proposalDropped,
  type EventInfo,
} from '../lib/push/messages';

/** Event columns qualified, for reads that join a proposal's dates. */
const EVENT_COLS_E = EVENT_COLS.split(', ')
  .map((c) => `events.${c}`)
  .join(', ');
const TEAM_INFO = `(SELECT timezone FROM teams WHERE id = events.team_id) AS timezone,
  (SELECT short_name FROM teams WHERE id = events.team_id) AS short_name`;

type Row = Record<string, unknown>;
const info = (r: Row): EventInfo => r as unknown as EventInfo;

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
   * becomes a "yes" asked to reconfirm, and the rest of the team hears it's on. One read, then one
   * batch: the status change, the replies and the pushes commit together, and the pushes only go
   * out from the request that made the change. A retry of the same confirm only fills in any
   * replies still missing.
   */
  route(app, 'proposals.confirm', async (c) => {
    const me = c.var.member;
    const eventId = c.req.param('eventId')!;
    const input = await body(c, ProposalConfirm);
    const t = now();
    const db = c.var.db;
    const cur = await db
      .prepare(
        `SELECT ${EVENT_COLS_E}, events.confirmed_option_id, ${TEAM_INFO},
           o.starts_at AS o_start, o.meet_at AS o_meet, o.ends_at AS o_end, o.time_tbd AS o_tbd
         FROM events LEFT JOIN event_options o ON o.id = ? AND o.event_id = events.id
           AND o.team_id = events.team_id AND o.deleted_at IS NULL
         WHERE events.id = ? AND events.team_id = ? AND events.deleted_at IS NULL`,
      )
      .bind(input.optionId, eventId, me.teamId)
      .first<Row>();
    if (!cur || cur.status === 'dropped') throw notFound('Event not found');
    // Everyone who was in for this date is a "yes" waiting for their "Still in?". Only once the
    // event is confirmed for this date, and never over a reply someone has given since.
    const rsvps = db
      .prepare(
        `INSERT INTO rsvps (event_id, member_id, team_id, status, updated_at, reconfirm)
         SELECT a.event_id, a.member_id, a.team_id, 'yes', ?1, 1 FROM proposal_answers a
         JOIN memberships m ON m.id = a.member_id AND m.team_id = a.team_id AND m.status != 'removed'
         WHERE a.option_id = ?2 AND a.event_id = ?3 AND a.team_id = ?4 AND a.answer = 'in'
           AND EXISTS (SELECT 1 FROM events e WHERE e.id = ?3 AND e.team_id = ?4
             AND e.status = 'confirmed' AND e.confirmed_option_id = ?2)
         ON CONFLICT(event_id, member_id) DO UPDATE SET status = 'yes', reconfirm = 1,
           updated_at = excluded.updated_at WHERE rsvps.status IS NULL`,
      )
      .bind(t, input.optionId, eventId, me.teamId);
    if (cur.status === 'confirmed') {
      if (cur.confirmed_option_id !== input.optionId)
        throw new HttpError(409, 'conflict', 'This was confirmed for another date', {
          latest: eventFromRow(cur),
        });
      await rsvps.run();
      return c.json({ event: eventFromRow(cur) });
    }
    if (cur.o_start === null || cur.o_start === undefined)
      throw notFound('That date is no longer an option');
    // A "Time TBD" date stays TBD (no meet or finish) unless the confirm sets its time.
    const tbd = !!cur.o_tbd && input.startsAt === undefined;
    const start = input.startsAt ?? Number(cur.o_start);
    const meet = input.meetAt !== undefined ? input.meetAt : (cur.o_meet as number | null);
    const end = cur.o_end as number | null;
    const row = {
      ...cur,
      starts_at: start,
      meet_at: !tbd && meet !== null && meet <= start ? meet : null,
      ends_at: !tbd && end !== null && end >= start ? end : null,
      time_tbd: tbd ? 1 : 0,
    };
    const won = {
      sql: `EXISTS (SELECT 1 FROM events e WHERE e.id = ?8 AND e.status = 'confirmed'
        AND e.confirmed_option_id = ?9 AND e.updated_at = ?10)`,
      params: [eventId, input.optionId, t],
    };
    const stmts = [
      db
        .prepare(
          `UPDATE events SET status = 'confirmed', confirmed_option_id = ?1, starts_at = ?2, meet_at = ?3,
             ends_at = ?4, time_tbd = ?8, reminded_at = NULL, version = version + 1, updated_at = ?5
           WHERE id = ?6 AND team_id = ?7 AND status = 'proposed' AND deleted_at IS NULL
           RETURNING ${EVENT_COLS}`,
        )
        .bind(
          input.optionId,
          row.starts_at,
          row.meet_at,
          row.ends_at,
          t,
          eventId,
          me.teamId,
          row.time_tbd,
        ),
      rsvps,
    ];
    const tell = stillToCome({ startsAt: start, timeTbd: tbd }, String(cur.timezone), t);
    if (tell)
      // One push each: "It's on … Still in?" for those who were in, "New: …" for everyone else.
      stmts.push(
        notifyStmt(
          db,
          me.teamId,
          { team: true },
          'events',
          eventCreated(me.teamId, info(row)),
          me.userId,
          won,
          {
            when: `m.id IN (SELECT member_id FROM proposal_answers WHERE option_id = ?9 AND answer = 'in')`,
            message: proposalConfirmed(me.teamId, info(row)),
          },
        ),
      );
    const [upd] = await db.batch(stmts);
    const ev = upd?.results[0] as Row | undefined;
    if (!ev) throw new HttpError(409, 'conflict', 'Someone else changed this at the same time');
    if (tell) flushNotifications(c);
    return c.json({ event: eventFromRow(ev) });
  });

  /**
   * Not going ahead: hidden from every list; everyone who answered hears about it. One read, then
   * one batch (status, audit and pushes together; pushes only from the request that dropped it).
   */
  route(app, 'proposals.drop', async (c) => {
    const me = c.var.member;
    const eventId = c.req.param('eventId')!;
    const t = now();
    const db = c.var.db;
    const cur = await db
      .prepare(
        `SELECT ${EVENT_COLS}, ${TEAM_INFO} FROM events WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
      )
      .bind(eventId, me.teamId)
      .first<Row>();
    if (!cur) throw notFound('Event not found');
    if (cur.status === 'dropped') return c.json({ event: eventFromRow(cur) });
    if (cur.status !== 'proposed')
      throw new HttpError(409, 'conflict', 'This is on the schedule now', {
        latest: eventFromRow(cur),
      });
    const won = `EXISTS (SELECT 1 FROM events e WHERE e.id = ?8 AND e.status = 'dropped' AND e.updated_at = ?9)`;
    const tell = Number(cur.starts_at) > t;
    const stmts = [
      db
        .prepare(
          `UPDATE events SET status = 'dropped', version = version + 1, updated_at = ?
           WHERE id = ? AND team_id = ? AND status = 'proposed' AND deleted_at IS NULL
           RETURNING ${EVENT_COLS}`,
        )
        .bind(t, eventId, me.teamId),
      db
        .prepare(
          `INSERT INTO audit_log (id, team_id, actor_id, action, target_type, target_id, meta, at)
           SELECT ?1, ?2, ?3, 'event.dropped', 'event', ?4, ?5, ?6
           WHERE EXISTS (SELECT 1 FROM events e WHERE e.id = ?4 AND e.status = 'dropped' AND e.updated_at = ?6)`,
        )
        .bind(uuidv7(), me.teamId, me.userId, eventId, JSON.stringify({ title: cur.title }), t),
    ];
    if (tell)
      stmts.push(
        notifyStmt(
          db,
          me.teamId,
          { team: true },
          'events',
          proposalDropped(me.teamId, info(cur)),
          me.userId,
          {
            sql: `${won} AND m.id IN (SELECT member_id FROM proposal_answers WHERE event_id = ?8)`,
            params: [eventId, t],
          },
        ),
      );
    const [upd] = await db.batch(stmts);
    const ev = upd?.results[0] as Row | undefined;
    if (!ev) throw new HttpError(409, 'conflict', 'Someone else changed this at the same time');
    if (tell) flushNotifications(c);
    return c.json({ event: eventFromRow(ev) });
  });
}
