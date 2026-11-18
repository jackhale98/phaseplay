/**
 * Defence in depth for uploaded images: the browser re-encodes (which drops EXIF/GPS), but a
 * modified client could skip that, so the server removes metadata segments/chunks too. These are
 * cheap structural walks (no decoding). Anything that doesn't parse cleanly is rejected (null).
 */
import type { MediaType } from '@phaseplay/shared';

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 65536 + u16be(b, i + 2);
const u32le = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)) + b[i + 3]! * 16777216;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * JPEG: drop APP1 (EXIF/XMP, where GPS lives), APP3–APP13 and APP15 (IPTC, vendor blobs) and
 * comments. Keep APP0 (JFIF), APP2 (ICC colour profile) and APP14 (Adobe colour transform), which
 * affect how the picture decodes. Everything from the start of scan is copied as is.
 */
export function stripJpeg(b: Uint8Array): Uint8Array | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xda) {
      parts.push(b.subarray(i));
      return concat(parts);
    }
    if (m === 0xd9) return null;
    const len = u16be(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    const drop = m === 0xfe || (m >= 0xe1 && m <= 0xef && m !== 0xe2 && m !== 0xee);
    if (!drop) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
/** PNG: drop text, EXIF and time chunks (chunks are independent; CRCs stay valid). */
export function stripPng(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = u32be(b, i);
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (!PNG_DROP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return concat(parts);
  }
  return null;
}

/** WebP: drop EXIF and XMP chunks, clear their VP8X flags and fix the RIFF size. */
export function stripWebp(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [];
  let i = 12;
  const riffEnd = Math.min(b.length, 8 + u32le(b, 4));
  while (i + 8 <= riffEnd) {
    const type = String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
    const len = u32le(b, i + 4);
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > b.length) return null;
    if (type === 'VP8X') {
      const chunk = b.slice(i, Math.min(end, b.length));
      chunk[8] = chunk[8]! & ~0x0c;
      parts.push(chunk);
    } else if (type !== 'EXIF' && type !== 'XMP ')
      parts.push(b.subarray(i, Math.min(end, b.length)));
    i = end;
  }
  if (!parts.length) return null;
  const body = concat(parts);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  const size = body.length + 4;
  head[4] = size & 0xff;
  head[5] = (size >>> 8) & 0xff;
  head[6] = (size >>> 16) & 0xff;
  head[7] = (size >>> 24) & 0xff;
  return concat([head, body]);
}

export function stripMetadata(b: Uint8Array, type: MediaType): Uint8Array | null {
  if (type === 'image/jpeg') return stripJpeg(b);
  if (type === 'image/png') return stripPng(b);
  return stripWebp(b);
}
