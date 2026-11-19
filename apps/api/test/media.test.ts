/**
 * Uploaded images (picture plays, drill photos): magic bytes, caps, quota, metadata stripping,
 * permissions, visibility, tenancy, the query budget, soft delete and purge.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  MEDIA_MAX_BYTES,
  MEDIA_PER_PLAY,
  MEDIA_TEAM_QUOTA,
  sniffImage,
  uuidv7,
} from '@phaseplay/shared';
import { app, call, fixtureTeam, playBody, ORIGIN, type Res } from './helpers';
import { stripJpeg, stripPng, stripWebp } from '../src/lib/image';
import { nightly } from '../src/cron';

const enc = new TextEncoder();
const bytes = (...parts: (number[] | Uint8Array | string)[]) => {
  const arrs = parts.map((p) =>
    typeof p === 'string' ? enc.encode(p) : p instanceof Uint8Array ? p : Uint8Array.from(p),
  );
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const chunk = (type: string, data: Uint8Array | number[] = []) =>
  bytes(be32(data.length), type, data instanceof Uint8Array ? data : data, [0, 0, 0, 0]);

/** A structurally valid PNG (the server never decodes, so CRCs and pixels can be fake). */
function png(w = 40, h = 30, extra: Uint8Array[] = [], idat = 16) {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', [...be32(w), ...be32(h), 8, 6, 0, 0, 0]),
    ...extra,
    chunk('IDAT', new Uint8Array(idat)),
    chunk('IEND'),
  );
}
/** A JPEG with an EXIF (GPS) APP1 segment and a comment. */
function jpegWithExif(w = 64, h = 48) {
  const exif = bytes('Exif\0\0', 'GPSLatitude=51.5074;GPSLongitude=-0.1278');
  const com = bytes('secret comment');
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, ...be16(16)],
    'JFIF\0',
    [1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xe1, ...be16(exif.length + 2)],
    exif,
    [0xff, 0xfe, ...be16(com.length + 2)],
    com,
    [0xff, 0xc0, ...be16(17), 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
    [0xff, 0xda, ...be16(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0],
    [0x12, 0x34, 0x56],
    [0xff, 0xd9],
  );
}
/** A VP8X WebP with EXIF and XMP chunks. */
function webpWithExif(w = 100, h = 80) {
  const vp8x = [0x0c, 0, 0, 0, ...le32(w - 1).slice(0, 3), ...le32(h - 1).slice(0, 3)];
  const body = bytes(
    'VP8X',
    le32(10),
    vp8x,
    'VP8L',
    le32(6),
    [0x2f, 0, 0, 0, 0, 0],
    'EXIF',
    le32(8),
    'GPSDATA!',
    'XMP ',
    le32(4),
    '<x/>',
  );
  return bytes('RIFF', le32(body.length + 4), 'WEBP', body);
}

async function upload(
  cookie: string,
  path: string,
  file: Uint8Array,
  opts: { id?: string; caption?: string; type?: string; name?: string; thumb?: Uint8Array } = {},
): Promise<Res & { id: string }> {
  const id = opts.id ?? uuidv7();
  const form = new FormData();
  form.set('id', id);
  if (opts.caption) form.set('caption', opts.caption);
  form.set('file', new File([file], opts.name ?? 'page.png', { type: opts.type ?? 'image/png' }));
  if (opts.thumb) form.set('thumb', new File([opts.thumb], 't.png', { type: 'image/png' }));
  const res = await app.request(
    `http://localhost:8787${path}`,
    { method: 'POST', headers: { cookie, origin: ORIGIN }, body: form },
    { ...env, ASSETS: { fetch: async () => new Response('shell') } },
  );
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return {
    id,
    status: res.status,
    body,
    headers: res.headers,
    queries: Number(res.headers.get('x-pp-queries') ?? 0),
  };
}

async function get(cookie: string, path: string) {
  const res = await app.request(
    `http://localhost:8787${path}`,
    { headers: { cookie } },
    { ...env, ASSETS: { fetch: async () => new Response('shell') } },
  );
  return {
    status: res.status,
    bytes: new Uint8Array(await res.arrayBuffer()),
    headers: res.headers,
    queries: Number(res.headers.get('x-pp-queries') ?? 0),
  };
}

async function picturePlay(
  a: Awaited<ReturnType<typeof fixtureTeam>>,
  visibility: 'team' | 'coaches',
) {
  const id = uuidv7();
  const r = await call('POST', `/api/v1/teams/${a.teamId}/plays`, {
    cookie: a.coach.cookie,
    body: { ...playBody(id, visibility), kind: 'picture', title: 'Scanned lineout calls' },
  });
  expect(r.status).toBe(201);
  return id;
}

describe('image sniffing and metadata stripping', () => {
  it('recognises PNG, JPEG and WebP with their sizes, and nothing else', () => {
    expect(sniffImage(png(40, 30))).toEqual({ type: 'image/png', width: 40, height: 30 });
    expect(sniffImage(jpegWithExif(64, 48))).toEqual({
      type: 'image/jpeg',
      width: 64,
      height: 48,
    });
    expect(sniffImage(webpWithExif(100, 80))).toEqual({
      type: 'image/webp',
      width: 100,
      height: 80,
    });
    expect(sniffImage(enc.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(enc.encode('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImage(bytes('GIF89a', new Uint8Array(30)))).toBeNull();
  });

  it('drops EXIF/GPS and comments from JPEG but keeps the picture', () => {
    const src = jpegWithExif();
    const out = stripJpeg(src)!;
    const s = new TextDecoder('latin1').decode(out);
    expect(s).not.toContain('Exif');
    expect(s).not.toContain('GPS');
    expect(s).not.toContain('secret comment');
    expect(s).toContain('JFIF');
    expect(sniffImage(out)).toEqual(sniffImage(src));
    expect([...out.slice(-5)]).toEqual([0x12, 0x34, 0x56, 0xff, 0xd9]);
  });

  it('drops text and EXIF chunks from PNG and EXIF/XMP from WebP', () => {
    const p = stripPng(png(10, 10, [chunk('tEXt', [...enc.encode('GPS here')]), chunk('eXIf')]))!;
    expect(new TextDecoder('latin1').decode(p)).not.toMatch(/GPS|eXIf|tEXt/);
    expect(sniffImage(p)?.width).toBe(10);
    const w = stripWebp(webpWithExif())!;
    const ws = new TextDecoder('latin1').decode(w);
    expect(ws).not.toMatch(/GPSDATA|EXIF|XMP/);
    expect(w[20]! & 0x0c).toBe(0);
    expect(w[4]! | (w[5]! << 8)).toBe(w.length - 8);
    expect(sniffImage(w)).toEqual({ type: 'image/webp', width: 100, height: 80 });
  });

  it('rejects truncated files', () => {
    expect(stripJpeg(jpegWithExif().slice(0, 30))).toBeNull();
    expect(stripPng(png().slice(0, 40))).toBeNull();
  });
});

describe('uploads', () => {
  it('a coach builds a picture play; players see pages; sync carries metadata only', async () => {
    const a = await fixtureTeam();
    const playId = await picturePlay(a, 'team');
    const base = `/api/v1/teams/${a.teamId}/plays/${playId}/media`;
    const one = await upload(a.coach.cookie, base, png(1600, 1200), {
      caption: 'Front ball',
      thumb: png(480, 360),
    });
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect(one.queries).toBeLessThanOrEqual(6);
    expect(one.body.media).toMatchObject({
      id: one.id,
      type: 'image/png',
      width: 1600,
      height: 1200,
      caption: 'Front ball',
    });
    // Retrying the same upload is a no-op.
    const again = await upload(a.coach.cookie, base, png(1600, 1200), { id: one.id });
    expect(again.status).toBe(200);
    expect(again.body.list).toHaveLength(1);
    const two = await upload(a.coach.cookie, base, jpegWithExif(), { type: 'image/jpeg' });
    expect(two.status).toBe(201);
    expect(two.body.list.map((m: { id: string }) => m.id)).toEqual([one.id, two.id]);

    // Reorder, caption and remove in one call.
    const set = await call('PUT', base, {
      cookie: a.coach.cookie,
      body: { pages: [{ id: two.id, caption: 'Call sheet' }, { id: one.id }] },
    });
    expect(set.status).toBe(200);
    expect(set.queries).toBeLessThanOrEqual(6);
    expect(
      set.body.list.map((m: { id: string; caption: string | null }) => [m.id, m.caption]),
    ).toEqual([
      [two.id, 'Call sheet'],
      [one.id, null],
    ]);

    const sync = await call('GET', `/api/v1/teams/${a.teamId}/sync?since=0`, {
      cookie: a.player.cookie,
    });
    const row = sync.body.plays.find((p: { id: string }) => p.id === playId);
    expect(row.kind).toBe('picture');
    expect(row.media).toHaveLength(2);
    expect(JSON.stringify(row)).not.toMatch(/bytes|thumb/);

    const img = await get(a.player.cookie, `/api/v1/teams/${a.teamId}/media/${two.id}?v=1`);
    expect(img.status).toBe(200);
    expect(img.queries).toBeLessThanOrEqual(6);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');
    expect(img.headers.get('content-disposition')).toBe('inline');
    expect(img.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    // Stored without EXIF even though the client sent it.
    expect(new TextDecoder('latin1').decode(img.bytes)).not.toContain('GPS');

    const thumb = await get(a.player.cookie, `/api/v1/teams/${a.teamId}/media/${one.id}?s=thumb`);
    expect(sniffImage(thumb.bytes)?.width).toBe(480);
    const noThumb = await get(a.player.cookie, `/api/v1/teams/${a.teamId}/media/${two.id}?s=thumb`);
    expect(sniffImage(noThumb.bytes)?.type).toBe('image/jpeg');
  });

  it('rejects SVG, HTML and GIF disguised as images, oversize files and too many pixels', async () => {
    const a = await fixtureTeam();
    const playId = await picturePlay(a, 'team');
    const base = `/api/v1/teams/${a.teamId}/plays/${playId}/media`;
    const svg = enc.encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect((await upload(a.coach.cookie, base, svg, { name: 'x.png' })).status).toBe(415);
    const html = enc.encode('<!doctype html><html><script>alert(1)</script></html>');
    expect((await upload(a.coach.cookie, base, html, { type: 'image/jpeg' })).status).toBe(415);
    const gif = bytes('GIF89a', new Uint8Array(40));
    expect((await upload(a.coach.cookie, base, gif, { type: 'image/gif' })).status).toBe(415);
    const big = await upload(a.coach.cookie, base, png(100, 100, [], MEDIA_MAX_BYTES));
    expect(big.status).toBe(413);
    expect((await upload(a.coach.cookie, base, png(4000, 3000))).status).toBe(400);
    // A JSON body is not an upload.
    expect((await call('POST', base, { cookie: a.coach.cookie, body: {} })).status).toBe(415);
    // Diagram plays don't take pages.
    expect(
      (await upload(a.coach.cookie, `/api/v1/teams/${a.teamId}/plays/${a.playId}/media`, png()))
        .status,
    ).toBe(404);
  });

  it('players cannot upload; coaches-only pages are 404 to players; other teams get 404', async () => {
    const a = await fixtureTeam();
    const b = await fixtureTeam('Team B');
    const secret = await picturePlay(a, 'coaches');
    const base = `/api/v1/teams/${a.teamId}/plays/${secret}/media`;
    expect((await upload(a.player.cookie, base, png())).status).toBe(403);
    const up = await upload(a.coach.cookie, base, png());
    expect(up.status).toBe(201);
    const path = `/api/v1/teams/${a.teamId}/media/${up.id}`;
    expect((await get(a.coach.cookie, path)).status).toBe(200);
    expect((await get(a.player.cookie, path)).status).toBe(404);
    expect((await get(b.owner.cookie, path)).status).toBe(404);
    expect((await get(b.owner.cookie, `/api/v1/teams/${b.teamId}/media/${up.id}`)).status).toBe(
      404,
    );
    // Team B can't attach to team A's play through its own team id.
    expect(
      (await upload(b.owner.cookie, `/api/v1/teams/${b.teamId}/plays/${secret}/media`, png()))
        .status,
    ).toBe(404);
    // Sharing it with the team makes the pages visible.
    await call('PATCH', `/api/v1/teams/${a.teamId}/plays/${secret}`, {
      cookie: a.coach.cookie,
      body: { visibility: 'team' },
    });
    expect((await get(a.player.cookie, path)).status).toBe(200);
  });

  it('photo-only drills, and coaches-only drill photos stay with coaches', async () => {
    const a = await fixtureTeam();
    const drillId = uuidv7();
    const d = await call('POST', `/api/v1/teams/${a.teamId}/drills`, {
      cookie: a.coach.cookie,
      body: {
        id: drillId,
        title: 'Ruck clearing (whiteboard)',
        category: 'breakdown',
        contactLevel: 'shields',
        intensity: 3,
        playersMin: 6,
        playersMax: 12,
        area: { w: 10, h: 10 },
        defaultDurationMin: 10,
        visibility: 'coaches',
        diagram: null,
      },
    });
    expect(d.status).toBe(201);
    const up = await upload(
      a.coach.cookie,
      `/api/v1/teams/${a.teamId}/drills/${drillId}/media`,
      webpWithExif(),
      {
        type: 'image/webp',
      },
    );
    expect(up.status).toBe(201);
    expect(
      (await upload(a.player.cookie, `/api/v1/teams/${a.teamId}/drills/${drillId}/media`, png()))
        .status,
    ).toBe(403);
    const got = await call('GET', `/api/v1/teams/${a.teamId}/drills/${drillId}`, {
      cookie: a.coach.cookie,
    });
    expect(got.body.drill.hasDiagram).toBe(false);
    expect(got.body.drill.media).toHaveLength(1);
    const path = `/api/v1/teams/${a.teamId}/media/${up.id}`;
    expect((await get(a.player.cookie, path)).status).toBe(404);
    await call('PATCH', `/api/v1/teams/${a.teamId}/drills/${drillId}`, {
      cookie: a.coach.cookie,
      body: { visibility: 'team' },
    });
    const img = await get(a.player.cookie, path);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    expect(new TextDecoder('latin1').decode(img.bytes)).not.toContain('GPSDATA');
  });

  it('enforces the per-play cap and the team quota with a friendly 409', async () => {
    const a = await fixtureTeam();
    const playId = await picturePlay(a, 'team');
    const fill = (n: number, ownerId: string, ownerType = 'play') =>
      env.DB.batch(
        Array.from({ length: n }, (_, i) =>
          env.DB.prepare(
            `INSERT INTO media (id, team_id, owner_type, owner_id, position, type, bytes, width, height, size, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'image/png', ?, 1, 1, 1, 'x', 1, 1)`,
          ).bind(uuidv7(), a.teamId, ownerType, ownerId, i, png()),
        ),
      );
    await fill(MEDIA_PER_PLAY, playId);
    const full = await upload(
      a.coach.cookie,
      `/api/v1/teams/${a.teamId}/plays/${playId}/media`,
      png(),
    );
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('quota');
    expect(full.queries).toBeLessThanOrEqual(6);

    const other = await picturePlay(a, 'team');
    await fill(MEDIA_TEAM_QUOTA - MEDIA_PER_PLAY, a.drillId, 'drill');
    const over = await upload(
      a.coach.cookie,
      `/api/v1/teams/${a.teamId}/plays/${other}/media`,
      png(),
    );
    expect(over.status).toBe(409);
    expect(over.body.error.message).toMatch(/library is full/);
  });

  it('deleting a play or a page soft-deletes its images; the nightly job purges them', async () => {
    const a = await fixtureTeam();
    const playId = await picturePlay(a, 'team');
    const base = `/api/v1/teams/${a.teamId}/plays/${playId}/media`;
    const p1 = await upload(a.coach.cookie, base, png());
    const p2 = await upload(a.coach.cookie, base, png());
    await call('PUT', base, { cookie: a.coach.cookie, body: { pages: [{ id: p1.id }] } });
    expect((await get(a.coach.cookie, `/api/v1/teams/${a.teamId}/media/${p2.id}`)).status).toBe(
      404,
    );
    const del = await call('DELETE', `/api/v1/teams/${a.teamId}/plays/${playId}`, {
      cookie: a.coach.cookie,
    });
    expect(del.status).toBe(200);
    expect(del.queries).toBeLessThanOrEqual(6);
    expect((await get(a.coach.cookie, `/api/v1/teams/${a.teamId}/media/${p1.id}`)).status).toBe(
      404,
    );
    const live = await env.DB.prepare(
      'SELECT count(*) AS n FROM media WHERE owner_id = ? AND deleted_at IS NULL',
    )
      .bind(playId)
      .first<{ n: number }>();
    expect(live?.n).toBe(0);
    await env.DB.prepare('UPDATE media SET deleted_at = ? WHERE owner_id = ?')
      .bind(Date.now() - 31 * 86400e3, playId)
      .run();
    await nightly(env as never);
    const left = await env.DB.prepare('SELECT count(*) AS n FROM media WHERE owner_id = ?')
      .bind(playId)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
