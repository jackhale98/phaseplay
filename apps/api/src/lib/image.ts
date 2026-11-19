/**
 * Defence in depth for uploaded images: the browser re-encodes (which drops EXIF/GPS), but a
 * modified client could skip that, so the server rebuilds each file keeping only what decoding
 * needs. These are cheap structural walks (no decoding). Anything that doesn't parse cleanly is
 * rejected (null).
 */
import type { MediaType } from '@phaseplay/shared';

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => u16be(b, i) * 65536 + u16be(b, i + 2);
const u32le = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16)) + b[i + 3]! * 16777216;
const ascii = (b: Uint8Array, i: number, n: number) =>
  String.fromCharCode(...b.subarray(i, Math.min(b.length, i + n)));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Marker segments kept before the first scan (everything else, APPn and COM included, goes). */
function keepJpegSegment(b: Uint8Array, m: number, i: number): boolean {
  if (m === 0xe0) return true; // APP0 JFIF
  if (m === 0xe2) return ascii(b, i + 4, 12) === 'ICC_PROFILE\0'; // colour profile, not MPF
  if (m === 0xee) return ascii(b, i + 4, 5) === 'Adobe'; // colour transform
  if (m >= 0xe1 && m <= 0xef) return false; // EXIF/XMP (GPS), MPF, IPTC, vendor blobs
  return m !== 0xfe; // COM
}

/**
 * JPEG: keep JFIF, an ICC profile, the Adobe colour marker and the codec segments; drop APP1
 * (EXIF/XMP, where GPS lives), MPF and other APPn, and comments. The image ends at the EOI that
 * closes its own scans, so anything after it (a second MPF image, appended HTML/script, a zip
 * polyglot) is cut off.
 */
export function stripJpeg(b: Uint8Array): Uint8Array | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  let scanning = false;
  while (i + 2 <= b.length) {
    if (scanning) {
      // Entropy-coded data: FF 00 is a stuffed byte, FF D0–D7 restart markers; any other
      // marker ends the scan.
      const start = i;
      while (
        i + 1 < b.length &&
        !(b[i] === 0xff && b[i + 1] !== 0x00 && (b[i + 1]! < 0xd0 || b[i + 1]! > 0xd7))
      )
        i++;
      if (i + 1 >= b.length) return null;
      parts.push(b.subarray(start, i));
      scanning = false;
      continue;
    }
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd9) {
      parts.push(b.subarray(i, i + 2));
      return concat(parts);
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) return null;
    if (i + 4 > b.length) return null;
    const len = u16be(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    // Between progressive scans only codec segments matter; drop any APPn/COM there too.
    if (keepJpegSegment(b, m, i)) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
    if (m === 0xda) scanning = true;
  }
  return null;
}

const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'pHYs',
  'acTL',
  'fcTL',
  'fdAT',
]);
/** PNG: keep only the chunks drawing needs (chunks are independent; CRCs stay valid). */
export function stripPng(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (PNG_KEEP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return concat(parts);
  }
  return null;
}

const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
/** WebP: keep only image chunks, clear the EXIF/XMP flags and fix the RIFF size. */
export function stripWebp(b: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [];
  let i = 12;
  const riffEnd = Math.min(b.length, 8 + u32le(b, 4));
  while (i + 8 <= riffEnd) {
    const type = ascii(b, i, 4);
    const len = u32le(b, i + 4);
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > b.length) return null;
    if (type === 'VP8X') {
      const chunk = b.slice(i, Math.min(end, b.length));
      chunk[8] = chunk[8]! & ~0x0c;
      parts.push(chunk);
    } else if (WEBP_KEEP.has(type)) parts.push(b.subarray(i, Math.min(end, b.length)));
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
