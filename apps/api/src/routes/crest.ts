/**
 * Uploaded team emblems. The browser resizes to CREST_PX and sends PNG/WebP/JPEG as base64; we
 * check the bytes really are that format (never SVG, never sniffed) and keep them in D1. The image
 * URL carries `?v=<crestVersion>`, so responses are cacheable forever.
 */
import type { Hono } from 'hono';
import { CREST_MAX_BYTES, CrestUpload } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, badRequest, body, notFound, now } from '../lib/http';
import { auditStmt } from '../lib/audit';
import { TEAM_COLS, teamFromRow } from '../db/rows';

/** Does `b` start with the signature of `type`? */
export function matchesType(b: Uint8Array, type: string): boolean {
  const at = (i: number, sig: number[]) => sig.every((x, j) => b[i + j] === x);
  if (type === 'image/png') return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (type === 'image/jpeg') return at(0, [0xff, 0xd8, 0xff]);
  if (type === 'image/webp')
    return at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]);
  return false;
}

function decode(b64: string): Uint8Array {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    throw badRequest('That image could not be read');
  }
}

export function crestRoutes(app: Hono<AppEnv>) {
  route(app, 'teams.crest.get', async (c) => {
    const row = await c.var.db
      .prepare('SELECT type, data FROM team_crests WHERE team_id = ?')
      .bind(c.var.member.teamId)
      .first<{ type: string; data: ArrayBuffer | number[] }>();
    if (!row) throw notFound('No emblem');
    const bytes = Array.isArray(row.data) ? Uint8Array.from(row.data) : new Uint8Array(row.data);
    return new Response(bytes, {
      headers: {
        'content-type': row.type,
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cross-origin-resource-policy': 'same-origin',
      },
    });
  });

  route(app, 'teams.crest.put', async (c) => {
    const me = c.var.member;
    const input = await body(c, CrestUpload);
    const bytes = decode(input.data);
    if (bytes.length > CREST_MAX_BYTES)
      throw new HttpError(413, 'too_large', 'That image is too big; try a smaller one');
    if (!matchesType(bytes, input.type)) throw badRequest("That file isn't a PNG, WebP or JPEG");
    const t = now();
    const [, , team] = await c.var.db.batch([
      c.var.db
        .prepare(
          `INSERT INTO team_crests (team_id, type, data, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(team_id) DO UPDATE SET type = excluded.type, data = excluded.data, updated_at = excluded.updated_at`,
        )
        .bind(me.teamId, input.type, bytes, t),
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'team.crest_changed',
        targetType: 'team',
        targetId: me.teamId,
      }),
      c.var.db
        .prepare(
          `UPDATE teams SET crest_version = ?, updated_at = ? WHERE id = ? RETURNING ${TEAM_COLS}`,
        )
        .bind(t, t, me.teamId),
    ]);
    return c.json({ team: teamFromRow(team!.results[0] as Record<string, unknown>) });
  });

  route(app, 'teams.crest.delete', async (c) => {
    const me = c.var.member;
    const t = now();
    await c.var.db.batch([
      c.var.db.prepare('DELETE FROM team_crests WHERE team_id = ?').bind(me.teamId),
      c.var.db
        .prepare('UPDATE teams SET crest_version = NULL, updated_at = ? WHERE id = ?')
        .bind(t, me.teamId),
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'team.crest_removed',
        targetType: 'team',
        targetId: me.teamId,
      }),
    ]);
    return c.json({ ok: true });
  });
}
