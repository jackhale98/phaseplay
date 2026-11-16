import type { Hono } from 'hono';
import { SheetPut } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, ifMatch, notFound, now, parseJson } from '../lib/http';
import { SHEET_COLS, sheetFromRow } from '../db/rows';
import { auditStmt } from '../lib/audit';

export function sheetRoutes(app: Hono<AppEnv>) {
  route(app, 'sheets.put', async (c) => {
    const me = c.var.member;
    const id = c.req.param('sheetId')!;
    const input = await body(c, SheetPut);
    const t = now();
    const version = ifMatch(c);
    const slots = JSON.stringify(input.slots);
    // Insert if new (event must be this team's match/tournament); otherwise a versioned update.
    const row = await c.var.db
      .prepare(
        `INSERT INTO team_sheets (id, event_id, team_id, format, replacements, slots, captain_id, vice_id, status, version, created_by, updated_at)
         SELECT ?, e.id, e.team_id, ?, ?, ?, ?, ?, 'draft', 1, ?, ?
         FROM events e WHERE e.id = ? AND e.team_id = ? AND e.deleted_at IS NULL AND e.type IN ('match', 'tournament')
         ON CONFLICT(id) DO UPDATE SET format = excluded.format, replacements = excluded.replacements, slots = excluded.slots,
           captain_id = excluded.captain_id, vice_id = excluded.vice_id, status = 'draft',
           version = team_sheets.version + 1, updated_at = excluded.updated_at
         WHERE team_sheets.team_id = excluded.team_id AND team_sheets.event_id = excluded.event_id
           AND (?14 IS NULL OR team_sheets.version = ?14)
         RETURNING ${SHEET_COLS}`,
      )
      .bind(id, input.format, input.replacements, slots, input.captainId, input.viceId, me.userId, t, input.eventId, me.teamId, null, null, null, version)
      .first();
    if (row) return c.json({ sheet: sheetFromRow(row, false) });
    const current = await c.var.db
      .prepare(`SELECT ${SHEET_COLS} FROM team_sheets WHERE (id = ? OR event_id = ?) AND team_id = ?`)
      .bind(id, input.eventId, me.teamId)
      .first();
    if (!current) throw notFound('Match not found');
    throw new HttpError(409, 'conflict', 'Someone else changed this team sheet', { latest: sheetFromRow(current, false) });
  });

  route(app, 'sheets.publish', async (c) => {
    const me = c.var.member;
    const id = c.req.param('sheetId')!;
    const cur = await c.var.db
      .prepare(`SELECT ${SHEET_COLS} FROM team_sheets WHERE id = ? AND team_id = ?`)
      .bind(id, me.teamId)
      .first<Record<string, unknown>>();
    if (!cur) throw notFound('Team sheet not found');
    const t = now();
    const snapshot = JSON.stringify({
      format: cur.format,
      replacements: cur.replacements,
      slots: parseJson(cur.slots as string, {}),
      captainId: cur.captain_id,
      viceId: cur.vice_id,
      publishedAt: t,
    });
    const nextVersion = (cur.version as number) + 1;
    const [res] = await c.var.db.batch([
      c.var.db
        .prepare(`UPDATE team_sheets SET status = 'published', published = ?, published_at = ?, version = ?, updated_at = ? WHERE id = ? AND team_id = ? AND version = ? RETURNING ${SHEET_COLS}`)
        .bind(snapshot, t, nextVersion, t, id, me.teamId, cur.version),
      c.var.db.prepare('INSERT OR REPLACE INTO team_sheet_versions (sheet_id, version, snapshot, created_at) VALUES (?, ?, ?, ?)').bind(id, nextVersion, snapshot, t),
      auditStmt(c.var.db, { teamId: me.teamId, actorId: me.userId, action: 'sheet.published', targetType: 'sheet', targetId: id }),
    ]);
    const row = res?.results[0] as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(409, 'conflict', 'The sheet changed while publishing. Try again.');
    return c.json({ sheet: sheetFromRow(row, false) });
  });

  route(app, 'sheets.versions', async (c) => {
    const [sheet, rows] = await c.var.db.batch([
      c.var.db.prepare('SELECT id FROM team_sheets WHERE id = ? AND team_id = ?').bind(c.req.param('sheetId'), c.var.member.teamId),
      c.var.db
        .prepare(
          `SELECT v.version, v.snapshot, v.created_at FROM team_sheet_versions v JOIN team_sheets s ON s.id = v.sheet_id
           WHERE v.sheet_id = ? AND s.team_id = ? ORDER BY v.version DESC LIMIT 10`,
        )
        .bind(c.req.param('sheetId'), c.var.member.teamId),
    ]);
    if (!sheet?.results.length) throw notFound('Team sheet not found');
    const results = rows!.results as { version: number; snapshot: string; created_at: number }[];
    return c.json({ versions: results.map((r) => ({ version: r.version, createdAt: r.created_at, ...JSON.parse(r.snapshot) })) });
  });
}
