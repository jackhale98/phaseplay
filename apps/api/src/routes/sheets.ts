import type { Hono } from 'hono';
import { SheetPut } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, ifMatch, notFound, now, parseJson } from '../lib/http';
import { SHEET_COLS, sheetFromRow } from '../db/rows';
import { auditStmt } from '../lib/audit';
import { flushNotifications, notifyStmt } from '../lib/notify';
import { sheetPublished } from '../lib/push/messages';

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
      .bind(
        id,
        input.format,
        input.replacements,
        slots,
        input.captainId,
        input.viceId,
        me.userId,
        t,
        input.eventId,
        me.teamId,
        null,
        null,
        null,
        version,
      )
      .first()
      // Another coach already made this match's sheet under a different id (UNIQUE event_id):
      // fall through to the 409 below so the client adopts theirs.
      .catch((e: unknown) => {
        if (String(e).includes('UNIQUE')) return null;
        throw e;
      });
    if (row) return c.json({ sheet: sheetFromRow(row, false) });
    const current = await c.var.db
      .prepare(
        `SELECT ${SHEET_COLS} FROM team_sheets WHERE (id = ? OR event_id = ?) AND team_id = ?`,
      )
      .bind(id, input.eventId, me.teamId)
      .first();
    if (!current) throw notFound('Match not found');
    throw new HttpError(409, 'conflict', 'Someone else changed this team sheet', {
      latest: sheetFromRow(current, false),
    });
  });

  route(app, 'sheets.publish', async (c) => {
    const me = c.var.member;
    const id = c.req.param('sheetId')!;
    const t = now();
    // The snapshot is built in SQL from the row being published, so it can't race an edit.
    const [res] = await c.var.db.batch([
      c.var.db
        .prepare(
          `UPDATE team_sheets SET status = 'published',
             published = json_object('format', format, 'replacements', replacements, 'slots', json(slots),
               'captainId', captain_id, 'viceId', vice_id, 'publishedAt', ?1),
             published_at = ?1, version = version + 1, updated_at = ?1
           WHERE id = ?2 AND team_id = ?3
           RETURNING ${SHEET_COLS},
             (SELECT json_object('id', e.id, 'title', e.title, 'type', e.type, 'opponent', e.opponent,
                'short_name', (SELECT short_name FROM teams WHERE id = e.team_id))
              FROM events e WHERE e.id = team_sheets.event_id) AS event`,
        )
        .bind(t, id, me.teamId),
      c.var.db
        // Only record the version if the publish above won (same batch, same transaction).
        .prepare(
          `INSERT OR REPLACE INTO team_sheet_versions (sheet_id, version, snapshot, created_at)
           SELECT id, version, published, ?1 FROM team_sheets WHERE id = ?2 AND team_id = ?3 AND published_at = ?1`,
        )
        .bind(t, id, me.teamId),
    ]);
    const row = res?.results[0] as Record<string, unknown> | undefined;
    if (!row) throw notFound('Team sheet not found');
    const event = parseJson<Parameters<typeof sheetPublished>[1] | null>(
      row.event as string | null,
      null,
    );
    await c.var.db.batch([
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'sheet.published',
        targetType: 'sheet',
        targetId: id,
      }),
      ...(event
        ? [
            notifyStmt(
              c.var.db,
              me.teamId,
              { team: true },
              'sheets',
              sheetPublished(me.teamId, event),
              me.userId,
            ),
          ]
        : []),
    ]);
    if (event) flushNotifications(c);
    return c.json({ sheet: sheetFromRow(row, false) });
  });

  route(app, 'sheets.versions', async (c) => {
    const [sheet, rows] = await c.var.db.batch([
      c.var.db
        .prepare('SELECT id FROM team_sheets WHERE id = ? AND team_id = ?')
        .bind(c.req.param('sheetId'), c.var.member.teamId),
      c.var.db
        .prepare(
          `SELECT v.version, v.snapshot, v.created_at FROM team_sheet_versions v JOIN team_sheets s ON s.id = v.sheet_id
           WHERE v.sheet_id = ? AND s.team_id = ? ORDER BY v.version DESC LIMIT 10`,
        )
        .bind(c.req.param('sheetId'), c.var.member.teamId),
    ]);
    if (!sheet?.results.length) throw notFound('Team sheet not found');
    const results = rows!.results as { version: number; snapshot: string; created_at: number }[];
    return c.json({
      versions: results.map((r) => ({
        version: r.version,
        createdAt: r.created_at,
        ...JSON.parse(r.snapshot),
      })),
    });
  });
}
