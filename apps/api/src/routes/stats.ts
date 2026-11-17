import type { Hono } from 'hono';
import {
  can,
  typesInCategory,
  type AttendanceMark,
  type EventTurnout,
  type MatchEvent,
  type StatsFeed,
} from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { badRequest } from '../lib/http';

const list = (types: string[]) => types.map((t) => `'${t}'`).join(', ');
const HELD_TYPES = list([...typesInCategory('practices'), ...typesInCategory('games')]);
const GAME_TYPES = list(typesInCategory('games'));
/** A season of match logs is a few thousand rows; the cap keeps "All time" bounded. */
const MATCH_ROW_CAP = 10_000;

/** Events that took place in [?2, ?3) before ?4: indexed by (team_id, starts_at). */
const HELD = (types: string) =>
  `e.team_id = ?1 AND e.starts_at >= ?2 AND e.starts_at < ?3 AND e.starts_at <= ?4
   AND e.deleted_at IS NULL AND e.cancelled_at IS NULL AND e.type IN (${types})`;

/**
 * Season stats feed (PLAN.md M7): one membership check plus one batch. The web computes every stat
 * client-side from this and the snapshot; nothing here is stored or aggregated per player beyond
 * what the caller may already see. RSVP notes are never selected.
 */
export function statsRoutes(app: Hono<AppEnv>) {
  route(app, 'stats.feed', async (c) => {
    const me = c.var.member;
    const t = Date.now();
    const num = (k: string, d: number) => {
      const raw = c.req.query(k);
      const n = raw === undefined || raw === '' ? d : Number(raw);
      if (!Number.isFinite(n) || n < 0) throw badRequest(`Invalid ${k}`);
      return Math.floor(n);
    };
    const from = num('from', 0);
    const to = Math.min(num('to', t + 1), 8.64e15);
    if (to < from) throw badRequest('from must be before to');
    const all = can(c.var.perms, 'availability.view') ? 1 : 0;
    const args = [me.teamId, from, to, t] as const;
    const [marks, turnout, logs] = await c.var.db.batch([
      c.var.db
        .prepare(
          `SELECT r.event_id, r.member_id, r.status, r.attended FROM events e
           JOIN rsvps r ON r.event_id = e.id AND r.team_id = ?1
           WHERE ${HELD(HELD_TYPES)} AND (?5 = 1 OR r.member_id = ?6)`,
        )
        .bind(...args, all, me.id),
      c.var.db
        .prepare(
          `SELECT r.event_id, max(r.attended IS NOT NULL) AS taken, sum(r.attended = 1) AS present,
             sum(r.status = 'yes') AS yes FROM events e
           JOIN rsvps r ON r.event_id = e.id AND r.team_id = ?1
           WHERE ${HELD(HELD_TYPES)} GROUP BY r.event_id`,
        )
        .bind(...args),
      c.var.db
        .prepare(
          `SELECT m.event_id, m.id, m.seq, m.payload, m.game_ms, m.wall_at FROM events e
           JOIN match_events m ON m.event_id = e.id AND m.team_id = ?1
           WHERE ${HELD(GAME_TYPES)}
           ORDER BY e.starts_at DESC, m.event_id, m.wall_at, m.seq LIMIT ?5`,
        )
        .bind(...args, MATCH_ROW_CAP + 1),
    ]);
    type Row = Record<string, unknown>;
    const rows = (r: { results?: unknown[] } | undefined) => (r?.results ?? []) as Row[];
    const logRows = rows(logs);
    const truncated = logRows.length > MATCH_ROW_CAP;
    // When capped, the oldest match in the page may be partial: leave it out entirely.
    const kept = truncated
      ? logRows.slice(0, MATCH_ROW_CAP).filter((r) => r.event_id !== logRows.at(-1)!.event_id)
      : logRows;
    const matches: Record<string, MatchEvent[]> = {};
    for (const r of kept)
      (matches[r.event_id as string] ??= []).push({
        id: r.id as string,
        seq: r.seq as number,
        payload: JSON.parse(r.payload as string),
        gameMs: r.game_ms as number,
        wallAt: r.wall_at as number,
      });
    const res: StatsFeed = {
      from,
      to,
      marks: rows(marks).map((r): AttendanceMark => ({
        eventId: r.event_id as string,
        memberId: r.member_id as string,
        status: (r.status as AttendanceMark['status']) ?? null,
        attended: r.attended === null || r.attended === undefined ? null : !!r.attended,
      })),
      turnout: rows(turnout).map((r): EventTurnout => ({
        eventId: r.event_id as string,
        taken: !!r.taken,
        present: Number(r.present ?? 0),
        yes: Number(r.yes ?? 0),
      })),
      matches,
      truncated,
    };
    return c.json(res);
  });
}
