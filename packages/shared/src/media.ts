/**
 * Uploaded images for the playbook: pages of a picture play and photos on a drill. Bytes live in
 * D1 (`media`, see docs/architecture.md §Uploaded images); the owning play/drill row carries the
 * ordered metadata (`media` JSON), so sync never sends bytes. The browser resizes and re-encodes
 * before upload (which also drops EXIF/GPS); the API checks magic bytes and strips metadata again.
 */
import * as v from 'valibot';
import { Id, text } from './common';

/** Raster types only: never SVG, GIF or anything sniffed from a name or a header. */
export const MEDIA_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export const MEDIA_OWNERS = ['play', 'drill'] as const;
export type MediaOwner = (typeof MEDIA_OWNERS)[number];

/** Hard cap per stored image (well under D1's 2 MB value limit). The browser aims for this. */
export const MEDIA_MAX_BYTES = 400 * 1024;
/** Longest side of a stored image. */
export const MEDIA_MAX_PX = 1600;
/** Card thumbnails: longest side and size cap (stored next to the image). */
export const MEDIA_THUMB_PX = 480;
export const MEDIA_THUMB_MAX_BYTES = 40 * 1024;
/** Images per team (live ones; a deleted image's bytes are removed at once). The owner may change it. */
export const MEDIA_TEAM_LIMIT = 150;
/**
 * All teams' image bytes together (images + thumbnails). D1 Free caps a database at 500 MB, so
 * pictures may use at most half of it; past this uploads are refused until it's raised or images
 * move to R2 (docs/runbook.md §Picture storage).
 */
export const MEDIA_GLOBAL_BYTES = 250 * 1024 * 1024;
/** Uploads per person per hour (counted from `media` rows, deleted ones included). */
export const MEDIA_UPLOADS_PER_HOUR = 60;
/** Pages per picture play and photos per drill. */
export const MEDIA_PER_PLAY = 20;
export const MEDIA_PER_DRILL = 6;
export const MEDIA_CAPTION_MAX = 140;
/** Whole upload request (image + thumbnail + form overhead). */
export const MEDIA_MAX_REQUEST = MEDIA_MAX_BYTES + MEDIA_THUMB_MAX_BYTES + 8 * 1024;

export const mediaLimit = (owner: MediaOwner) =>
  owner === 'play' ? MEDIA_PER_PLAY : MEDIA_PER_DRILL;

/** One image as the owning row carries it (no bytes). `v` versions the URL. */
export type MediaRef = {
  id: string;
  type: MediaType;
  width: number;
  height: number;
  size: number;
  caption: string | null;
  v: number;
};

/** Plays are drawn (animated diagram) or pictures (uploaded pages). */
export const PLAY_KINDS = ['diagram', 'picture'] as const;
export type PlayKind = (typeof PLAY_KINDS)[number];

/**
 * Change an owner's images with explicit operations, so two coaches editing at once never lose each
 * other's pages: `order` lists ids first-to-last (live images not listed keep their order after
 * them), `remove` deletes, `captions` sets captions by id (null clears).
 */
export const MediaSet = v.object({
  order: v.optional(v.pipe(v.array(Id), v.maxLength(MEDIA_PER_PLAY)), []),
  remove: v.optional(v.pipe(v.array(Id), v.maxLength(MEDIA_PER_PLAY)), []),
  captions: v.optional(
    v.pipe(
      v.record(Id, v.nullable(text(MEDIA_CAPTION_MAX))),
      v.check((r) => Object.keys(r).length <= MEDIA_PER_PLAY, 'Too many captions'),
    ),
    {},
  ),
});
export type MediaSet = v.InferOutput<typeof MediaSet>;

/** Fields of the multipart upload besides `file` and `thumb`. */
export const MediaUploadFields = v.object({
  id: Id,
  caption: v.optional(v.nullable(text(MEDIA_CAPTION_MAX)), null),
});

export const mediaUrl = (teamId: string, m: Pick<MediaRef, 'id' | 'v'>, thumb = false) =>
  `/api/v1/teams/${teamId}/media/${m.id}?v=${m.v}${thumb ? '&s=thumb' : ''}`;

/** Accessible name for a page: its caption, else "<title>, page n of m". */
export function mediaLabel(title: string, m: Pick<MediaRef, 'caption'>, i: number, n: number) {
  const where = n > 1 ? `, page ${i + 1} of ${n}` : '';
  return m.caption ? `${m.caption}${where ? ` (${title}${where})` : ''}` : `${title}${where}`;
}

export type SniffedImage = { type: MediaType; width: number; height: number };

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 65536 + u16be(b, i + 2);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const at = (b: Uint8Array, i: number, sig: number[]) => sig.every((x, j) => b[i + j] === x);

/**
 * What the bytes really are (by magic number and header), with pixel size; null for anything else
 * (SVG, HTML, GIF, HEIC, truncated files). Never trusts a file name or a Content-Type.
 */
export function sniffImage(b: Uint8Array): SniffedImage | null {
  if (b.length < 24) return null;
  // PNG: signature, then IHDR first.
  if (at(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && at(b, 12, [73, 72, 68, 82])) {
    return { type: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
  }
  // JPEG: SOI, then walk segments to the first SOFn.
  if (at(b, 0, [0xff, 0xd8, 0xff])) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1]!;
      if (m === 0xff) {
        i++;
        continue;
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16be(b, i + 2);
      if (len < 2) return null;
      const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
      if (sof) return { type: 'image/jpeg', width: u16be(b, i + 7), height: u16be(b, i + 5) };
      if (m === 0xda || m === 0xd9) return null;
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP, then VP8 / VP8L / VP8X.
  if (at(b, 0, [0x52, 0x49, 0x46, 0x46]) && at(b, 8, [0x57, 0x45, 0x42, 0x50]) && b.length >= 30) {
    const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (chunk === 'VP8 ' && at(b, 23, [0x9d, 0x01, 0x2a]))
      return {
        type: 'image/webp',
        width: (b[26]! | (b[27]! << 8)) & 0x3fff,
        height: (b[28]! | (b[29]! << 8)) & 0x3fff,
      };
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return {
        type: 'image/webp',
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === 'VP8X')
      return { type: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    return null;
  }
  return null;
}
