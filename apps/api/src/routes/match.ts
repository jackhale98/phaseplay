import type { Hono } from 'hono';
import { MatchAppend, type MatchEvent } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { body, notFound } from '../lib/http';

/** Match mode: an append-only log; the server merge is a union by id (PLAN.md M6 §Sync). */
export function matchRoutes(app: Hono<AppEnv>) {
  route(app, 'match.list', async (c) => {
    const me = c.var.member;
    const [ev, rows] = await c.var.db.batch([
      c.var.db
        .prepare('SELECT id FROM events WHERE id = ? AND team_id = ? AND deleted_at IS NULL')
        .bind(c.req.param('eventId'), me.teamId),
      c.var.db
        .prepare(
          `SELECT m.id, m.seq, m.payload, m.game_ms, m.wall_at, m.created_by, m.created_at FROM match_events m
           WHERE m.event_id = ? AND m.team_id = ? ORDER BY m.wall_at, m.seq LIMIT 2000`,
        )
        .bind(c.req.param('eventId'), me.teamId),
    ]);
    if (!ev?.results.length) throw notFound('Match not found');
    const events: MatchEvent[] = (rows!.results as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      seq: r.seq as number,
      payload: JSON.parse(r.payload as string),
      gameMs: r.game_ms as number,
      wallAt: r.wall_at as number,
      createdBy: r.created_by as string,
      createdAt: r.created_at as number,
    }));
    return c.json({ events });
  });

  route(app, 'match.append', async (c) => {
    const me = c.var.member;
    const { events } = await body(c, MatchAppend);
    const t = Date.now();
    const rows = events.map((e) => ({
      id: e.id,
      seq: e.seq,
      kind: e.payload.kind,
      payload: JSON.stringify(e.payload),
      game_ms: e.gameMs,
      wall_at: e.wallAt,
      supersedes_id: 'supersedesId' in e.payload ? e.payload.supersedesId : null,
    }));
    const r = await c.var.db
      .prepare(
        `INSERT INTO match_events (id, event_id, team_id, seq, kind, payload, game_ms, wall_at, supersedes_id, created_by, created_at)
         SELECT j.value->>'id', e.id, e.team_id, j.value->>'seq', j.value->>'kind', j.value->>'payload', j.value->>'game_ms',
           j.value->>'wall_at', j.value->>'supersedes_id', ?, ?
         FROM json_each(?) j JOIN events e ON e.id = ? AND e.team_id = ? AND e.deleted_at IS NULL AND e.status = 'confirmed'
         WHERE true ON CONFLICT(id) DO NOTHING`,
      )
      .bind(me.userId, t, JSON.stringify(rows), c.req.param('eventId'), me.teamId)
      .run();
    if (r.meta.changes === 0) {
      const exists = await c.var.db
        .prepare('SELECT 1 FROM events WHERE id = ? AND team_id = ? AND deleted_at IS NULL')
        .bind(c.req.param('eventId'), me.teamId)
        .first();
      if (!exists) throw notFound('Match not found');
    }
    return c.json({ ok: true, inserted: r.meta.changes });
  });
}
