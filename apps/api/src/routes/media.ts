/**
 * Uploaded images (picture-play pages, drill photos), stored in D1 next to team emblems.
 *
 * - Upload: multipart `file` (+ optional `thumb`), `id` (client UUIDv7, so retries are no-ops) and
 *   `caption`. The type comes from the bytes (WebP/JPEG/PNG only), never from the client; metadata
 *   is stripped again here; size, pixel and quota caps come from packages/shared/media.ts.
 * - Guards, all inside the INSERT: the owner exists (plays must be picture plays), the owner's and
 *   the team's image caps, the uploader's hourly rate, and the global byte budget (a running total
 *   in `app_meta`, kept in the same batch and recomputed nightly).
 * - Metadata (`media`) and bytes (`media_blobs`, one row per image and per thumbnail) are separate,
 *   so counting, listing and serving a thumbnail never read a full image. Deleting removes the
 *   bytes at once and leaves a small tombstone (purged nightly after 30 days).
 * - The owning row's `media` JSON is rebuilt in the same batch, so sync carries the ordered
 *   metadata (never bytes) and the owner's visibility rules apply for free.
 * - Serving checks the owner's visibility too: a coaches-only play's pages are 404 for players.
 */
import type { Context, Hono } from 'hono';
import * as v from 'valibot';
import {
  MEDIA_GLOBAL_BYTES,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PX,
  MEDIA_MAX_REQUEST,
  MEDIA_TEAM_LIMIT,
  MEDIA_THUMB_MAX_BYTES,
  MEDIA_THUMB_PX,
  MEDIA_UPLOADS_PER_HOUR,
  MediaSet,
  MediaUploadFields,
  can,
  mediaLimit,
  sniffImage,
  type MediaOwner,
  type MediaRef,
  type MediaType,
} from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, badRequest, body, notFound, now, parseJson } from '../lib/http';
import { stripMetadata } from '../lib/image';

const TABLE = { play: 'plays', drill: 'drills' } as const;
const PARAM = { play: 'playId', drill: 'drillId' } as const;
const HOUR = 3600e3;
/** Live, in the team; plays must be picture plays. `?2` team, `?4` owner id. */
const OWNER_OK = {
  play: `EXISTS (SELECT 1 FROM plays o WHERE o.id = ?4 AND o.team_id = ?2 AND o.deleted_at IS NULL AND o.kind = 'picture')`,
  drill: `EXISTS (SELECT 1 FROM drills o WHERE o.id = ?4 AND o.team_id = ?2 AND o.deleted_at IS NULL)`,
};
const TOTAL = `coalesce((SELECT CAST(value AS INTEGER) FROM app_meta WHERE key = 'media_bytes'), 0)`;

/**
 * Rebuild an owner's `media` JSON from its live images, in page order. Bumps `updated_at` (so
 * delta sync picks it up) but not `version`: images aren't part of the versioned content, so a
 * coach's pending edit of the title doesn't conflict with their own upload. With `inserted`, it
 * only runs when that upload's row was inserted by this request.
 */
export function refreshOwnerStmt(
  db: D1Database,
  owner: MediaOwner,
  ownerId: string,
  teamId: string,
  t: number,
  inserted?: { id: string; userId: string },
) {
  const guard = inserted
    ? 'AND EXISTS (SELECT 1 FROM media WHERE id = ?5 AND created_at = ?4 AND created_by = ?6)'
    : '';
  return db
    .prepare(
      `UPDATE ${TABLE[owner]} SET media = (
         SELECT json_group_array(json_object('id', id, 'type', type, 'width', width, 'height', height,
           'size', size, 'caption', caption, 'v', created_at))
         FROM (SELECT id, type, width, height, size, caption, created_at FROM media
               WHERE team_id = ?1 AND owner_type = ?2 AND owner_id = ?3
               AND deleted_at IS NULL ORDER BY position, created_at)),
       updated_at = ?4
       WHERE id = ?3 AND team_id = ?1 AND deleted_at IS NULL ${guard} RETURNING media`,
    )
    .bind(teamId, owner, ownerId, t, ...(inserted ? [inserted.id, inserted.userId] : []));
}

/**
 * Delete the live images matching `cond` (SQL over `media`, with `binds`). Tombstoning a row fires
 * `media_bytes_remove` (migration 0012), which deletes its bytes and subtracts them from the total.
 */
export function removeMediaStmt(db: D1Database, cond: string, binds: unknown[], t: number) {
  return db
    .prepare(`UPDATE media SET deleted_at = ?, updated_at = ? WHERE ${cond} AND deleted_at IS NULL`)
    .bind(t, t, ...binds);
}

/** Delete every image of an owner (the play/drill itself was deleted). */
export const deleteOwnerMediaStmt = (
  db: D1Database,
  owner: MediaOwner,
  ownerId: string,
  teamId: string,
  t: number,
) =>
  removeMediaStmt(
    db,
    'team_id = ? AND owner_type = ? AND owner_id = ?',
    [teamId, owner, ownerId],
    t,
  );

/** Nightly: purge old tombstones, any bytes left behind, and recompute the global total. */
export const mediaHousekeepingStmts = (db: D1Database, before: number) => [
  db.prepare('DELETE FROM media WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(before),
  db.prepare(
    'DELETE FROM media_blobs WHERE media_id NOT IN (SELECT id FROM media WHERE deleted_at IS NULL)',
  ),
  db
    .prepare(
      `UPDATE app_meta SET value = (SELECT coalesce(sum(size + thumb_size), 0) FROM media WHERE deleted_at IS NULL), updated_at = ? WHERE key = 'media_bytes'`,
    )
    .bind(Date.now()),
];

type Checked = { type: MediaType; width: number; height: number; bytes: Uint8Array };

async function checkImage(
  f: File | string | null,
  maxBytes: number,
  maxPx: number,
  what: string,
): Promise<Checked> {
  if (!f || typeof f === 'string') throw badRequest(`Missing ${what}`);
  if (f.size > maxBytes)
    throw new HttpError(413, 'too_large', 'That image is too big; try a smaller one');
  const raw = new Uint8Array(await f.arrayBuffer());
  const s = sniffImage(raw);
  if (!s) throw new HttpError(415, 'bad_request', "That file isn't a PNG, WebP or JPEG image");
  if (s.width < 1 || s.height < 1 || Math.max(s.width, s.height) > maxPx)
    throw badRequest(`Images can be at most ${maxPx} pixels on the longest side`);
  const bytes = stripMetadata(raw, s.type);
  if (!bytes) throw new HttpError(415, 'bad_request', "That image couldn't be read");
  return { ...s, bytes };
}

/** Read a body, refusing (413) as soon as it passes `max` bytes, whatever Content-Length said. */
async function readCapped(stream: ReadableStream<Uint8Array> | null, max: number) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      void reader.cancel();
      throw new HttpError(413, 'too_large', 'That image is too big; try a smaller one');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const ch of chunks) {
    out.set(ch, o);
    o += ch.length;
  }
  return out;
}

async function readUpload(c: Context<AppEnv>) {
  const ct = (c.req.header('content-type') ?? '').toLowerCase();
  if (!ct.startsWith('multipart/form-data'))
    throw new HttpError(415, 'bad_request', 'Expected multipart/form-data');
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > MEDIA_MAX_REQUEST)
    throw new HttpError(413, 'too_large', 'That image is too big; try a smaller one');
  const buf = await readCapped(c.req.raw.body, MEDIA_MAX_REQUEST);
  let form: FormData;
  try {
    form = await new Request('http://x/', {
      method: 'POST',
      headers: { 'content-type': c.req.header('content-type')! },
      body: buf,
    }).formData();
  } catch {
    throw badRequest('That upload could not be read');
  }
  const fields = v.safeParse(MediaUploadFields, {
    id: form.get('id'),
    caption: (form.get('caption') as string | null) || null,
  });
  if (!fields.success) throw badRequest(fields.issues[0]?.message ?? 'Invalid upload');
  const file = await checkImage(form.get('file'), MEDIA_MAX_BYTES, MEDIA_MAX_PX, 'image');
  const t = form.get('thumb');
  const thumb = t ? await checkImage(t, MEDIA_THUMB_MAX_BYTES, MEDIA_THUMB_PX, 'thumbnail') : null;
  return { ...fields.output, file, thumb };
}

const refsOf = (row: { media?: unknown } | undefined | null) =>
  parseJson(row?.media as string | null, [] as MediaRef[]);

type Why = {
  existing: string | null;
  taken: number;
  owner_ok: number;
  media: string | null;
  n_team: number;
  n_owner: number;
  n_recent: number;
  total: number;
};

function addRoute(app: Hono<AppEnv>, owner: MediaOwner) {
  route(app, owner === 'play' ? 'plays.media.add' : 'drills.media.add', async (c) => {
    const me = c.var.member;
    const ownerId = c.req.param(PARAM[owner])!;
    const up = await readUpload(c);
    const t = now();
    const limit = mediaLimit(owner);
    const db = c.var.db;
    const uid = c.var.user?.id ?? me.userId ?? '';
    const thumbBytes = up.thumb?.bytes.length ?? 0;
    const bytes = up.file.bytes.length + thumbBytes;
    // The global byte total is kept by the media_bytes_add trigger (migration 0012).
    // The row this request inserted (a retry of an earlier upload has another created_at).
    const mine =
      'EXISTS (SELECT 1 FROM media WHERE id = ?1 AND created_at = ?2 AND created_by = ?3)';
    const [ins, , ref] = await db.batch([
      db
        .prepare(
          `INSERT INTO media (id, team_id, owner_type, owner_id, position, caption, type,
             width, height, size, thumb_size, created_by, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4,
             coalesce((SELECT max(position) + 1 FROM media WHERE team_id = ?2 AND owner_type = ?3 AND owner_id = ?4 AND deleted_at IS NULL), 0),
             ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12
           WHERE ${OWNER_OK[owner]}
             AND (SELECT count(*) FROM media WHERE team_id = ?2 AND deleted_at IS NULL) < ?13
             AND (SELECT count(*) FROM media WHERE team_id = ?2 AND owner_type = ?3 AND owner_id = ?4 AND deleted_at IS NULL) < ?14
             AND (SELECT count(*) FROM media WHERE created_by = ?11 AND created_at > ?12 - ${HOUR}) < ?15
             AND ${TOTAL} + ?9 + ?10 <= ?16
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          up.id,
          me.teamId,
          owner,
          ownerId,
          up.caption,
          up.file.type,
          up.file.width,
          up.file.height,
          up.file.bytes.length,
          thumbBytes,
          uid,
          t,
          MEDIA_TEAM_LIMIT,
          limit,
          MEDIA_UPLOADS_PER_HOUR,
          MEDIA_GLOBAL_BYTES,
        ),
      db
        .prepare(
          `INSERT INTO media_blobs (media_id, kind, type, bytes)
           SELECT ?1, 'full', ?4, ?5 WHERE ${mine}
           UNION ALL SELECT ?1, 'thumb', ?6, ?7 WHERE ?7 IS NOT NULL AND ${mine}`,
        )
        .bind(
          up.id,
          t,
          uid,
          up.file.type,
          up.file.bytes,
          up.thumb?.type ?? null,
          up.thumb?.bytes ?? null,
        ),
      refreshOwnerStmt(db, owner, ownerId, me.teamId, t, { id: up.id, userId: uid }),
    ]);
    if (!ins!.meta.changes) {
      // Why not: a retry of an upload that already landed, a missing owner, a cap or the rate.
      // Ids are only looked up within the caller's team.
      const why = await db
        .prepare(
          `SELECT (SELECT owner_id FROM media WHERE id = ?1 AND team_id = ?2 AND owner_type = ?3 AND deleted_at IS NULL) AS existing,
             (SELECT count(*) FROM media WHERE id = ?1 AND team_id = ?2) AS taken,
             ${OWNER_OK[owner]} AS owner_ok,
             (SELECT media FROM ${TABLE[owner]} WHERE id = ?4 AND team_id = ?2) AS media,
             (SELECT count(*) FROM media WHERE team_id = ?2 AND deleted_at IS NULL) AS n_team,
             (SELECT count(*) FROM media WHERE team_id = ?2 AND owner_type = ?3 AND owner_id = ?4 AND deleted_at IS NULL) AS n_owner,
             (SELECT count(*) FROM media WHERE created_by = ?5 AND created_at > ?6) AS n_recent,
             ${TOTAL} AS total`,
        )
        .bind(up.id, me.teamId, owner, ownerId, uid, t - HOUR)
        .first<Why>();
      if (!why?.owner_ok) throw notFound(owner === 'play' ? 'Play not found' : 'Drill not found');
      if (why.existing === ownerId) {
        const list = refsOf(why);
        return c.json({ media: list.find((m) => m.id === up.id) ?? null, list });
      }
      if (why.taken) throw new HttpError(409, 'conflict', 'Image id already used');
      if (why.n_owner >= limit)
        throw new HttpError(
          409,
          'quota',
          owner === 'play'
            ? `A picture play can have up to ${limit} pages.`
            : `A drill can have up to ${limit} photos.`,
          { limit },
        );
      if (why.n_team >= MEDIA_TEAM_LIMIT)
        throw new HttpError(
          409,
          'quota',
          `Your team's picture library is full (${MEDIA_TEAM_LIMIT} images). Delete some old pictures or photos to make room.`,
          { limit: MEDIA_TEAM_LIMIT },
        );
      if (why.n_recent >= MEDIA_UPLOADS_PER_HOUR)
        throw new HttpError(
          429,
          'rate_limited',
          `That's a lot of pictures in one go (${MEDIA_UPLOADS_PER_HOUR} an hour). Try again a bit later.`,
        );
      if (why.total + bytes > MEDIA_GLOBAL_BYTES)
        throw new HttpError(
          507,
          'quota',
          'Picture storage is full. Tell the Phaseplay admin; nothing you already have is lost.',
        );
      throw new HttpError(409, 'conflict', "That picture couldn't be saved. Try again.");
    }
    const list = refsOf(ref?.results[0] as { media?: string });
    return c.json({ media: list.find((m) => m.id === up.id) ?? null, list }, 201);
  });

  route(app, owner === 'play' ? 'plays.media.set' : 'drills.media.set', async (c) => {
    const me = c.var.member;
    const ownerId = c.req.param(PARAM[owner])!;
    const input = await body(c, MediaSet);
    const t = now();
    const db = c.var.db;
    const res = await db.batch([
      removeMediaStmt(
        db,
        'team_id = ? AND owner_type = ? AND owner_id = ? AND id IN (SELECT value FROM json_each(?))',
        [me.teamId, owner, ownerId, JSON.stringify(input.remove)],
        t,
      ),
      // Listed ids take positions 0..n-1; live images not listed (e.g. another coach's new upload)
      // keep their order after them. Captions change only for the ids given.
      db
        .prepare(
          `UPDATE media SET
             position = coalesce((SELECT key FROM json_each(?1) WHERE value = media.id), json_array_length(?1) + position),
             caption = CASE WHEN id IN (SELECT key FROM json_each(?2))
               THEN (SELECT value FROM json_each(?2) WHERE key = media.id) ELSE caption END,
             updated_at = ?3
           WHERE team_id = ?4 AND owner_type = ?5 AND owner_id = ?6 AND deleted_at IS NULL
             AND (json_array_length(?1) > 0 OR id IN (SELECT key FROM json_each(?2)))`,
        )
        .bind(
          JSON.stringify(input.order),
          JSON.stringify(input.captions),
          t,
          me.teamId,
          owner,
          ownerId,
        ),
      refreshOwnerStmt(db, owner, ownerId, me.teamId, t),
    ]);
    const row = res[res.length - 1]?.results[0] as { media?: string } | undefined;
    if (!row) throw notFound(owner === 'play' ? 'Play not found' : 'Drill not found');
    return c.json({ list: refsOf(row) });
  });
}

export function mediaRoutes(app: Hono<AppEnv>) {
  addRoute(app, 'play');
  addRoute(app, 'drill');

  route(app, 'media.get', async (c) => {
    const me = c.var.member;
    const p = c.var.perms;
    // Only the requested blob row is read: a thumbnail request never touches the full image.
    const row = await c.var.db
      .prepare(
        `SELECT b.type AS type, b.bytes AS data FROM media m
         JOIN media_blobs b ON b.media_id = m.id
           AND b.kind = CASE WHEN ?5 = 1 AND m.thumb_size > 0 THEN 'thumb' ELSE 'full' END
         WHERE m.id = ?1 AND m.team_id = ?2 AND m.deleted_at IS NULL AND (
           (m.owner_type = 'play' AND EXISTS (SELECT 1 FROM plays o WHERE o.id = m.owner_id AND o.team_id = ?2
              AND o.deleted_at IS NULL AND (?3 = 1 OR o.visibility = 'team')))
           OR (m.owner_type = 'drill' AND EXISTS (SELECT 1 FROM drills o WHERE o.id = m.owner_id AND o.team_id = ?2
              AND o.deleted_at IS NULL AND (?4 = 1 OR o.visibility = 'team'))))`,
      )
      .bind(
        c.req.param('mediaId'),
        me.teamId,
        can(p, 'plays.view_private') ? 1 : 0,
        can(p, 'drills.view_private') ? 1 : 0,
        c.req.query('s') === 'thumb' ? 1 : 0,
      )
      .first<{ type: string; data: ArrayBuffer | number[] }>();
    if (!row) throw notFound('Image not found');
    const bytes = Array.isArray(row.data) ? Uint8Array.from(row.data) : new Uint8Array(row.data);
    // The stored type was sniffed at upload; re-check so a bad row can never serve as HTML.
    const type = sniffImage(bytes)?.type;
    if (!type) throw notFound('Image not found');
    return new Response(bytes, {
      headers: {
        'content-type': type,
        'content-disposition': 'inline',
        // A day: URLs carry the version; a shared device doesn't keep images for a year.
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cross-origin-resource-policy': 'same-origin',
      },
    });
  });
}
