import type { Hono } from 'hono';
import { isCoach, isStaff, type RsvpCounts, type SyncResponse } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { notFound } from '../lib/http';
import {
  DRILL_META_COLS,
  EVENT_COLS,
  MEMBER_COLS,
  PLAN_COLS,
  PLAY_META_COLS,
  SHEET_COLS,
  TEAM_COLS,
  drillMetaFromRow,
  eventFromRow,
  memberFromRow,
  planFromRow,
  playMetaFromRow,
  rsvpFromRow,
  seasonFromRow,
  sheetFromRow,
  teamFromRow,
} from '../db/rows';

/** `a, b AS c` → `json_object('a', a, 'c', b)` so one SQL statement can return every table. */
function jsonObject(cols: string): string {
  return (
    'json_object(' +
    cols
      .split(', ')
      .map((c) => {
        const [expr, alias] = c.split(' AS ');
        return `'${(alias ?? expr)!.trim()}', ${expr!.trim()}`;
      })
      .join(', ') +
    ')'
  );
}
const arr = (cols: string, from: string) =>
  `(SELECT json_group_array(${jsonObject(cols)}) FROM ${from})`;

/** Overlap window so rows committed concurrently with the previous sync are never missed. */
const OVERLAP_MS = 10_000;
/** First sync only fetches recent RSVP history to keep payloads small. */
const FULL_WINDOW_MS = 120 * 86400e3;

const SYNC_SQL = `SELECT
  (SELECT ${jsonObject(TEAM_COLS)} FROM teams WHERE id = ?1) AS team,
  ${arr(MEMBER_COLS, `memberships WHERE team_id = ?1 AND updated_at > ?2 AND (?3 = 1 OR status != 'pending') AND (?2 > 0 OR status != 'removed')`)} AS members,
  ${arr('id, team_id, name, starts_on, ends_on, updated_at, deleted_at', `seasons WHERE team_id = ?1 AND updated_at > ?2 AND (?2 > 0 OR deleted_at IS NULL)`)} AS seasons,
  ${arr(EVENT_COLS, `events WHERE team_id = ?1 AND updated_at > ?2 AND (?2 > 0 OR deleted_at IS NULL)`)} AS events,
  ${arr('event_id, member_id, team_id, status, note, attended, updated_at', `rsvps WHERE team_id = ?1 AND updated_at > max(?2, ?5) AND (?3 = 1 OR member_id = ?4)`)} AS rsvps,
  (SELECT json_group_array(json_object('event_id', event_id, 'yes', y, 'no', n, 'maybe', m)) FROM (
     SELECT event_id, sum(status = 'yes') AS y, sum(status = 'no') AS n, sum(status = 'maybe') AS m FROM rsvps
     WHERE team_id = ?1 AND event_id IN (SELECT event_id FROM rsvps WHERE team_id = ?1 AND updated_at > max(?2, ?5))
     GROUP BY event_id)) AS counts,
  ${arr(SHEET_COLS, `team_sheets WHERE team_id = ?1 AND updated_at > ?2 AND (?6 = 1 OR published IS NOT NULL)`)} AS sheets,
  ${arr(PLAY_META_COLS, `plays WHERE team_id = ?1 AND updated_at > ?2 AND (?2 > 0 OR deleted_at IS NULL) AND (?6 = 1 OR visibility = 'team' OR deleted_at IS NOT NULL OR ?2 > 0)`)} AS plays,
  ${arr(DRILL_META_COLS, `drills WHERE team_id = ?1 AND updated_at > ?2 AND (?2 > 0 OR deleted_at IS NULL) AND (?6 = 1 OR visibility = 'team' OR deleted_at IS NOT NULL OR ?2 > 0)`)} AS drills,
  ${arr(PLAN_COLS, `practice_plans WHERE team_id = ?1 AND updated_at > ?2 AND (?2 > 0 OR deleted_at IS NULL) AND (?6 = 1 OR visibility = 'team' OR deleted_at IS NOT NULL OR ?2 > 0)`)} AS plans`;

/**
 * A row a player can no longer see (made coach-only since their last sync) is sent as a bare
 * tombstone, so it disappears from their cache without leaking its contents.
 */
const hidden =
  (coach: boolean) =>
  <T extends { id: string; visibility: string; deletedAt: number | null; updatedAt: number }>(
    r: T,
  ): T =>
    coach || r.visibility === 'team' || r.deletedAt
      ? r
      : ({
          id: r.id,
          visibility: r.visibility,
          deletedAt: r.updatedAt,
          updatedAt: r.updatedAt,
        } as T);

export function syncRoutes(app: Hono<AppEnv>) {
  /** The main read path: one membership check + one statement returning every changed row. */
  route(app, 'teams.sync', async (c) => {
    const me = c.var.member;
    const t = Date.now();
    const sinceRaw = Number(c.req.query('since') ?? 0);
    let since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.max(1, sinceRaw - OVERLAP_MS) : 0;
    // A role change (e.g. coach → player) changes what you may see: start from a full sync.
    if (since && me.updatedAt > sinceRaw) since = 0;
    const staff = isStaff(me.role);
    const coach = isCoach(me.role);
    const row = await c.var.db
      .prepare(SYNC_SQL)
      .bind(me.teamId, since, staff ? 1 : 0, me.id, since ? 0 : t - FULL_WINDOW_MS, coach ? 1 : 0)
      .first<Record<string, string>>();
    if (!row?.team) throw notFound();
    const list = (k: string) => JSON.parse(row[k] ?? '[]') as Record<string, unknown>[];
    // Players never see other members' RSVP rows, only counts.
    const rsvpCounts: Record<string, RsvpCounts> = {};
    for (const r of list('counts'))
      rsvpCounts[r.event_id as string] = {
        yes: Number(r.yes ?? 0),
        no: Number(r.no ?? 0),
        maybe: Number(r.maybe ?? 0),
      };
    const res: SyncResponse = {
      cursor: t,
      full: since === 0,
      team: teamFromRow(JSON.parse(row.team)),
      me,
      members: list('members').map(memberFromRow),
      seasons: list('seasons').map(seasonFromRow),
      events: list('events').map(eventFromRow),
      rsvps: list('rsvps').map((r) => rsvpFromRow(r, staff || r.member_id === me.id)),
      rsvpCounts,
      sheets: list('sheets')
        .map((r) => sheetFromRow(r, !coach))
        .filter((s) => s !== null),
      plays: list('plays').map(playMetaFromRow).map(hidden(coach)),
      drills: list('drills').map(drillMetaFromRow).map(hidden(coach)),
      plans: list('plans').map(planFromRow).map(hidden(coach)),
    };
    return c.json(res);
  });
}
