/**
 * Uploaded images (picture-play pages, drill photos), stored in D1 next to team emblems.
 *
 * - Upload: multipart `file` (+ optional `thumb`), `id` (client UUIDv7, so retries are no-ops) and
 *   `caption`. The type comes from the bytes (WebP/JPEG/PNG only), never from the client; metadata
 *   is stripped again here; size, pixel and quota caps come from packages/shared/media.ts.
 * - The owning row's `media` JSON is rebuilt in the same batch, so sync carries the ordered
 *   metadata (never bytes) and the owner's visibility rules apply for free.
 * - Serving checks the owner's visibility too: a coaches-only play's pages are 404 for players.
 */
import type { Context, Hono } from 'hono';
import * as v from 'valibot';
import {
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PX,
  MEDIA_MAX_REQUEST,
  MEDIA_TEAM_QUOTA,
  MEDIA_THUMB_MAX_BYTES,
  MEDIA_THUMB_PX,
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
/** The owner row an upload may attach to (`o`): live, in the team; plays must be picture plays. */
const OWNER_OK = {
  play: `EXISTS (SELECT 1 FROM plays o WHERE o.id = ?4 AND o.team_id = ?2 AND o.deleted_at IS NULL AND o.kind = 'picture')`,
  drill: `EXISTS (SELECT 1 FROM drills o WHERE o.id = ?4 AND o.team_id = ?2 AND o.deleted_at IS NULL)`,
};
const PARAM = { play: 'playId', drill: 'drillId' } as const;

/**
 * Rebuild an owner's `media` JSON from its live images, in page order. Bumps `updated_at` (so
 * delta sync picks it up) but not `version`: images aren't part of the versioned content, so a
 * coach's pending edit of the title doesn't conflict with their own upload.
 */
export function refreshOwnerStmt(
  db: D1Database,
  owner: MediaOwner,
  ownerId: string,
  teamId: string,
  t: number,
) {
  return db
    .prepare(
      `UPDATE ${TABLE[owner]} SET media = (
         SELECT json_group_array(json_object('id', id, 'type', type, 'width', width, 'height', height,
           'size', size, 'caption', caption, 'v', created_at))
         FROM (SELECT * FROM media WHERE team_id = ?1 AND owner_type = ?2 AND owner_id = ?3
               AND deleted_at IS NULL ORDER BY position, created_at)),
       updated_at = ?4
       WHERE id = ?3 AND team_id = ?1 AND deleted_at IS NULL RETURNING media`,
    )
    .bind(teamId, owner, ownerId, t);
}

/** Soft-delete every image of an owner (the play/drill itself was deleted). */
export function deleteOwnerMediaStmt(
  db: D1Database,
  owner: MediaOwner,
  ownerId: string,
  teamId: string,
  t: number,
) {
  return db
    .prepare(
      `UPDATE media SET deleted_at = ?, updated_at = ? WHERE team_id = ? AND owner_type = ? AND owner_id = ? AND deleted_at IS NULL`,
    )
    .bind(t, t, teamId, owner, ownerId);
}

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

function addRoute(app: Hono<AppEnv>, owner: MediaOwner) {
  route(app, owner === 'play' ? 'plays.media.add' : 'drills.media.add', async (c) => {
    const me = c.var.member;
    const ownerId = c.req.param(PARAM[owner])!;
    const up = await readUpload(c);
    const t = now();
    const limit = mediaLimit(owner);
    const db = c.var.db;
    const [ins, ref] = await db.batch([
      db
        .prepare(
          `INSERT INTO media (id, team_id, owner_type, owner_id, position, caption, type, bytes, thumb_type, thumb,
             width, height, size, created_by, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4,
             coalesce((SELECT max(position) + 1 FROM media WHERE team_id = ?2 AND owner_type = ?3 AND owner_id = ?4 AND deleted_at IS NULL), 0),
             ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14
           WHERE ${OWNER_OK[owner]}
             AND (SELECT count(*) FROM media WHERE team_id = ?2 AND deleted_at IS NULL) < ?15
             AND (SELECT count(*) FROM media WHERE team_id = ?2 AND owner_type = ?3 AND owner_id = ?4 AND deleted_at IS NULL) < ?16
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          up.id,
          me.teamId,
          owner,
          ownerId,
          up.caption,
          up.file.type,
          up.file.bytes,
          up.thumb?.type ?? null,
          up.thumb?.bytes ?? null,
          up.file.width,
          up.file.height,
          up.file.bytes.length,
          me.userId,
          t,
          MEDIA_TEAM_QUOTA,
          limit,
        ),
      refreshOwnerStmt(db, owner, ownerId, me.teamId, t),
    ]);
    if (!ins!.meta.changes) {
      // Why not: a retry of an upload that already landed, a missing owner, or a full library.
      const why = await db
        .prepare(
          `SELECT (SELECT owner_id FROM media WHERE id = ?1 AND team_id = ?2 AND owner_type = ?3 AND deleted_at IS NULL) AS existing,
             (SELECT count(*) FROM media WHERE id = ?1) AS taken,
             ${OWNER_OK[owner]} AS owner_ok,
             (SELECT count(*) FROM media WHERE team_id = ?2 AND deleted_at IS NULL) AS n_team`,
        )
        .bind(up.id, me.teamId, owner, ownerId)
        .first<{ existing: string | null; taken: number; owner_ok: number; n_team: number }>();
      if (!why?.owner_ok) throw notFound(owner === 'play' ? 'Play not found' : 'Drill not found');
      if (why.existing === ownerId) {
        const list = refsOf(ref?.results[0] as { media?: string });
        return c.json({ media: list.find((m) => m.id === up.id) ?? null, list });
      }
      if (why.taken) throw new HttpError(409, 'conflict', 'Image id already used');
      if (why.n_team >= MEDIA_TEAM_QUOTA)
        throw new HttpError(
          409,
          'quota',
          `Your team's image library is full (${MEDIA_TEAM_QUOTA} images). Delete some old pictures or photos to make room.`,
          { limit: MEDIA_TEAM_QUOTA },
        );
      throw new HttpError(
        409,
        'quota',
        owner === 'play'
          ? `A picture play can have up to ${limit} pages.`
          : `A drill can have up to ${limit} photos.`,
        { limit },
      );
    }
    const list = refsOf(ref?.results[0] as { media?: string });
    return c.json({ media: list.find((m) => m.id === up.id) ?? null, list }, 201);
  });

  route(app, owner === 'play' ? 'plays.media.set' : 'drills.media.set', async (c) => {
    const me = c.var.member;
    const ownerId = c.req.param(PARAM[owner])!;
    const input = await body(c, MediaSet);
    if (input.pages.length > mediaLimit(owner))
      throw badRequest(`At most ${mediaLimit(owner)} images`);
    const pages = JSON.stringify(input.pages.map((p, i) => ({ id: p.id, caption: p.caption, i })));
    const t = now();
    const db = c.var.db;
    const scope = `team_id = ?2 AND owner_type = ?3 AND owner_id = ?4 AND deleted_at IS NULL`;
    const [, , ref] = await db.batch([
      db
        .prepare(
          `UPDATE media SET
             position = (SELECT json_extract(value, '$.i') FROM json_each(?1) WHERE json_extract(value, '$.id') = media.id),
             caption = (SELECT json_extract(value, '$.caption') FROM json_each(?1) WHERE json_extract(value, '$.id') = media.id),
             updated_at = ?5
           WHERE ${scope} AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))`,
        )
        .bind(pages, me.teamId, owner, ownerId, t),
      db
        .prepare(
          `UPDATE media SET deleted_at = ?5, updated_at = ?5
           WHERE ${scope} AND id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?1))
             AND EXISTS (SELECT 1 FROM ${TABLE[owner]} WHERE id = ?4 AND team_id = ?2 AND deleted_at IS NULL)`,
        )
        .bind(pages, me.teamId, owner, ownerId, t),
      refreshOwnerStmt(db, owner, ownerId, me.teamId, t),
    ]);
    const row = ref?.results[0] as { media?: string } | undefined;
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
    const thumb = c.req.query('s') === 'thumb';
    const cols = thumb
      ? 'coalesce(m.thumb_type, m.type) AS type, coalesce(m.thumb, m.bytes) AS data'
      : 'm.type AS type, m.bytes AS data';
    const row = await c.var.db
      .prepare(
        `SELECT ${cols} FROM media m WHERE m.id = ?1 AND m.team_id = ?2 AND m.deleted_at IS NULL AND (
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
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cross-origin-resource-policy': 'same-origin',
      },
    });
  });
}
