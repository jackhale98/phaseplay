/**
 * Uploaded team emblems: URLs, loading for canvas exports, and browser-side resizing before upload
 * (the API stores only small PNG/WebP/JPEG; SVGs are rasterised here and never uploaded as SVG).
 */
import { CREST_MAX_BYTES, CREST_PX, type CrestUpload } from '@phaseplay/shared';

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

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob | null>((res) => c.toBlob(res, type, q));

/** Fit the image in a CREST_PX square (transparent padding), encode, and base64 it for the API. */
export async function prepareCrest(file: File): Promise<CrestUpload> {
  const img = await decode(file).catch(() => {
    throw new Error("That file isn't an image we can read");
  });
  const w = img.naturalWidth || CREST_PX;
  const h = img.naturalHeight || CREST_PX;
  const scale = Math.min(CREST_PX / w, CREST_PX / h, 4);
  const c = document.createElement('canvas');
  c.width = c.height = CREST_PX;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  ctx.drawImage(img, (CREST_PX - dw) / 2, (CREST_PX - dh) / 2, dw, dh);
  // WebP keeps transparency and is small; Safari can't encode it and falls back to PNG.
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
