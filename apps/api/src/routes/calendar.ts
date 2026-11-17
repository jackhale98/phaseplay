import type { Hono } from 'hono';
import {
  EVENT_TYPE_LABELS,
  randomToken,
  sha256Base64Url,
  type TeamCalendar,
} from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { buildIcs } from '../lib/ics';
import { auditStmt } from '../lib/audit';

/** Events from this long ago stay in the feed, so last week's games don't vanish. */
const PAST_MS = 90 * 86400e3;

const EVENT_SQL = `SELECT e.id, e.type, e.title, e.starts_at, e.meet_at, e.ends_at, e.location_name, e.location_url,
    e.opponent, e.notes, e.cancelled_at, e.version, e.updated_at, t.short_name, t.name AS team_name, t.timezone
  FROM teams t JOIN events e ON e.team_id = t.id AND e.deleted_at IS NULL AND e.status = 'confirmed' AND e.starts_at > ?`;

type EventRow = Record<string, string | number | null>;

/** "6:45 PM" in the team's timezone. */
function clock(ms: number, tz: string) {
  try {
    return new Intl.DateTimeFormat(tz.startsWith('America/') ? 'en-US' : 'en-GB', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
    }).format(ms);
  } catch {
    return `${new Date(ms).toISOString().slice(11, 16)} UTC`;
  }
}

function ics(name: string, rows: EventRow[]) {
  return buildIcs(
    name,
    rows.map((e) => {
      const start = Number(e.starts_at);
      const label = e.type === 'match' && e.opponent ? `v ${e.opponent}` : String(e.title);
      const meet = e.meet_at ? `Meet ${clock(Number(e.meet_at), String(e.timezone))}. ` : '';
      return {
        uid: String(e.id),
        start: e.meet_at ? Number(e.meet_at) : start,
        end: e.ends_at ? Number(e.ends_at) : start + (e.type === 'tournament' ? 8 : 2) * 3600e3,
        summary:
          `${e.short_name} ${EVENT_TYPE_LABELS[e.type as keyof typeof EVENT_TYPE_LABELS] ?? ''}: ${label}`.replace(
            /\s+/g,
            ' ',
          ),
        location: e.location_name as string | null,
        description: `${meet}${e.notes ?? ''}\nhttps://phaseplay.app/events/${e.id}`.trim(),
        url: e.location_url as string | null,
        cancelled: e.cancelled_at !== null,
        updated: Number(e.updated_at),
        sequence: Number(e.version),
      };
    }),
  );
}

const calendarPath = (token: string): TeamCalendar => ({ path: `/cal/${token}.ics` });

export function calendarRoutes(app: Hono<AppEnv>) {
  route(app, 'cal.feed', async (c) => {
    const token = (c.req.param('token') ?? '').replace(/\.ics$/, '');
    if (token.length < 16 || token.length > 64) return c.text('Not found', 404);
    const since = Date.now() - PAST_MS;
    const db = c.var.db;
    // The team calendar (one link per team), or an older per-person link.
    const [team, legacy] = await db.batch([
      db
        .prepare(
          `${EVENT_SQL} WHERE t.calendar_token = ? AND t.deleted_at IS NULL ORDER BY e.starts_at LIMIT 500`,
        )
        .bind(since, token),
      db
        .prepare(
          `SELECT ct.user_id, ct.team_id, ct.scope FROM calendar_tokens ct JOIN users u ON u.id = ct.user_id
           WHERE ct.token_hash = ? AND ct.revoked_at IS NULL AND u.deleted_at IS NULL`,
        )
        .bind(await sha256Base64Url(token)),
    ]);
    let rows = (team?.results ?? []) as EventRow[];
    let name: string | null = null;
    if (rows.length) name = String(rows[0]!.team_name);
    else {
      const t = await db
        .prepare('SELECT name FROM teams WHERE calendar_token = ? AND deleted_at IS NULL')
        .bind(token)
        .first<{ name: string }>();
      if (t) name = t.name;
    }
    const feed = legacy?.results[0] as
      { user_id: string; team_id: string | null; scope: string } | undefined;
    if (name === null && feed) {
      // Only teams the user is still an active member of; staff-only team feeds re-check the role.
      const res = await db
        .prepare(
          `${EVENT_SQL.replace('FROM teams t', 'FROM memberships m JOIN teams t ON t.id = m.team_id AND t.deleted_at IS NULL')}
           WHERE m.user_id = ? AND m.status = 'active' AND (? IS NULL OR m.team_id = ?)
             AND (? != 'team' OR m.role != 'player')
           ORDER BY e.starts_at LIMIT 500`,
        )
        .bind(since, feed.user_id, feed.team_id, feed.team_id, feed.scope)
        .all<EventRow>();
      rows = res.results;
      name = feed.team_id && rows[0] ? String(rows[0].team_name) : 'Phaseplay';
    }
    if (name === null) return c.text('Not found', 404);
    return c.body(ics(name, rows), 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      // Short: schedules change, and calendar apps poll on their own timetable anyway.
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline; filename="phaseplay.ics"',
    });
  });

  route(app, 'teams.calendar.get', async (c) => {
    const me = c.var.member;
    // Made on first use; a concurrent first request keeps whichever token landed first.
    const row = await c.var.db
      .prepare(
        `UPDATE teams SET calendar_token = coalesce(calendar_token, ?) WHERE id = ? RETURNING calendar_token`,
      )
      .bind(randomToken(16), me.teamId)
      .first<{ calendar_token: string }>();
    return c.json(calendarPath(row!.calendar_token));
  });

  route(app, 'teams.calendar.reset', async (c) => {
    const me = c.var.member;
    const db = c.var.db;
    const token = randomToken(16);
    await db.batch([
      db.prepare('UPDATE teams SET calendar_token = ? WHERE id = ?').bind(token, me.teamId),
      auditStmt(db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'calendar.reset',
        targetType: 'team',
        targetId: me.teamId,
      }),
    ]);
    return c.json(calendarPath(token));
  });
}
