import type { Hono } from 'hono';
import { EVENT_TYPE_LABELS, sha256Base64Url } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { buildIcs } from '../lib/ics';

export function calendarRoutes(app: Hono<AppEnv>) {
  route(app, 'cal.feed', async (c) => {
    const token = (c.req.param('token') ?? '').replace(/\.ics$/, '');
    if (token.length < 16 || token.length > 64) return c.text('Not found', 404);
    const feed = await c.var.db
      .prepare(
        `SELECT ct.user_id, ct.team_id, ct.scope, u.display_name FROM calendar_tokens ct JOIN users u ON u.id = ct.user_id
         WHERE ct.token_hash = ? AND ct.revoked_at IS NULL AND u.deleted_at IS NULL`,
      )
      .bind(await sha256Base64Url(token))
      .first<{ user_id: string; team_id: string | null; scope: string; display_name: string }>();
    if (!feed) return c.text('Not found', 404);
    // Only teams the user is still an active member of; staff-only team feeds re-check the role.
    const { results } = await c.var.db
      .prepare(
        `SELECT e.id, e.type, e.title, e.starts_at, e.meet_at, e.ends_at, e.location_name, e.location_url, e.opponent, e.notes,
           e.cancelled_at, e.version, e.updated_at, t.short_name, t.name AS team_name, m.role
         FROM memberships m JOIN teams t ON t.id = m.team_id AND t.deleted_at IS NULL
         JOIN events e ON e.team_id = m.team_id AND e.deleted_at IS NULL AND e.starts_at > ?
         WHERE m.user_id = ? AND m.status = 'active' AND (? IS NULL OR m.team_id = ?)
           AND (? != 'team' OR m.role != 'player')
         ORDER BY e.starts_at LIMIT 500`,
      )
      .bind(Date.now() - 90 * 86400e3, feed.user_id, feed.team_id, feed.team_id, feed.scope)
      .all<Record<string, string | number | null>>();
    const ics = buildIcs(
      feed.team_id && results[0] ? `${results[0].team_name}` : 'Phaseplay',
      results.map((e) => {
        const start = Number(e.starts_at);
        const label = e.type === 'match' && e.opponent ? `v ${e.opponent}` : String(e.title);
        const meet = e.meet_at ? `Meet ${new Date(Number(e.meet_at)).toISOString().slice(11, 16)} UTC. ` : '';
        return {
          uid: String(e.id),
          start: e.meet_at ? Number(e.meet_at) : start,
          end: e.ends_at ? Number(e.ends_at) : start + (e.type === 'tournament' ? 8 : 2) * 3600e3,
          summary: `${e.short_name} ${EVENT_TYPE_LABELS[e.type as keyof typeof EVENT_TYPE_LABELS] ?? ''}: ${label}`.replace(/\s+/g, ' '),
          location: e.location_name as string | null,
          description: `${meet}${e.notes ?? ''}\nhttps://phaseplay.app/events/${e.id}`.trim(),
          url: e.location_url as string | null,
          cancelled: e.cancelled_at !== null,
          updated: Number(e.updated_at),
          sequence: Number(e.version),
        };
      }),
    );
    return c.body(ics, 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'private, max-age=900',
      'Content-Disposition': 'inline; filename="phaseplay.ics"',
    });
  });
}
