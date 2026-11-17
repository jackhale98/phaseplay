/**
 * Uploaded team emblems: URLs, loading for canvas exports, and browser-side preparation before
 * upload (the API stores only small PNG/WebP/JPEG; SVGs are rasterised here, never uploaded as SVG).
 * Preparation can remove a plain background so the emblem sits well on light and dark themes.
 */
import { CREST_MAX_BYTES, CREST_PX, type CrestUpload } from '@phaseplay/shared';
import { opaqueBounds, removeBackground, type BgResult } from './crest-bg';

type CrestTeam = { id: string; crestVersion?: number | null };

export const crestUrl = (team: CrestTeam | null | undefined): string | null =>
  team?.crestVersion ? `/api/v1/teams/${team.id}/crest?v=${team.crestVersion}` : null;

const bitmaps = new Map<string, Promise<ImageBitmap | null>>();
/** Decoded emblem for canvas exports, or null (exports then draw the monogram). */
export function loadCrest(team: CrestTeam | null | undefined): Promise<ImageBitmap | null> {
  const url = crestUrl(team);
  if (!url || typeof createImageBitmap === 'undefined') return Promise.resolve(null);
  let p = bitmaps.get(url);
  if (!p) {
    p = fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? createImageBitmap(b) : null))
      .catch(() => null);
    bitmaps.set(url, p);
  }
  return p;
}

async function decode(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Working size for background removal: big enough for clean edges, small enough to be quick. */
const WORK_PX = 512;

/** Decode a chosen file into a working canvas (longest side ≤ 512 px). */
export async function loadCrestSource(file: File): Promise<HTMLCanvasElement> {
  const img = await decode(file).catch(() => {
    throw new Error("That file isn't an image we can read");
  });
  const w = img.naturalWidth || WORK_PX;
  const h = img.naturalHeight || WORK_PX;
  const k = Math.min(1, WORK_PX / Math.max(w, h));
  const c = canvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * The emblem as it will be stored: optionally without its background, trimmed to its edges and
 * centred in a CREST_PX square with a little breathing room.
 */
export function buildCrest(
  source: HTMLCanvasElement,
  removeBg: boolean,
): { canvas: HTMLCanvasElement; bg: BgResult } {
  const work = canvas(source.width, source.height);
  const wctx = work.getContext('2d', { willReadFrequently: true })!;
  wctx.drawImage(source, 0, 0);
  const img = wctx.getImageData(0, 0, work.width, work.height);
  // Always detect, so the UI can say what it found; only apply when asked.
  const probe = removeBackground(img.data.slice(), work.width, work.height);
  let bg: BgResult = probe;
  if (removeBg && probe.status === 'removed') {
    bg = removeBackground(img.data, work.width, work.height);
    wctx.putImageData(img, 0, 0);
  }
  const box =
    bg.status === 'removed' || probe.status === 'transparent'
      ? (opaqueBounds(
          wctx.getImageData(0, 0, work.width, work.height).data,
          work.width,
          work.height,
        ) ?? { x: 0, y: 0, w: work.width, h: work.height })
      : { x: 0, y: 0, w: work.width, h: work.height };
  const out = canvas(CREST_PX, CREST_PX);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const pad = Math.round(CREST_PX * 0.04);
  const k = Math.min((CREST_PX - pad * 2) / box.w, (CREST_PX - pad * 2) / box.h, 4);
  const dw = box.w * k;
  const dh = box.h * k;
  ctx.drawImage(work, box.x, box.y, box.w, box.h, (CREST_PX - dw) / 2, (CREST_PX - dh) / 2, dw, dh);
  return { canvas: out, bg: removeBg ? bg : probe };
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob | null>((res) => c.toBlob(res, type, q));

/** PNG object URL of a canvas, for previews. Revoke it when done. */
export async function previewUrl(c: HTMLCanvasElement): Promise<string> {
  const b = await toBlob(c, 'image/png');
  return b ? URL.createObjectURL(b) : '';
}

/** Encode for upload: WebP keeps transparency and is small; Safari falls back to PNG. */
export async function encodeCrest(c: HTMLCanvasElement): Promise<CrestUpload> {
  let blob = await toBlob(c, 'image/webp', 0.9);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(c, 'image/png');
  if (!blob) throw new Error('Could not process that image');
  if (blob.size > CREST_MAX_BYTES) throw new Error('That image is too detailed; try a simpler one');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { type: blob.type as CrestUpload['type'], data: btoa(bin) };
}
