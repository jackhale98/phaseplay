/**
 * Browser-side preparation of playbook images before upload (docs/architecture.md §Uploaded
 * images): decode (EXIF orientation applied), fit the longest side to MEDIA_MAX_PX, re-encode as
 * WebP (JPEG where the browser can't encode WebP, e.g. older Safari, mirroring encodeCrest), and
 * step quality, then size, down until it fits MEDIA_MAX_BYTES. Re-encoding from pixels drops
 * EXIF/GPS and every other metadata block. A small thumbnail is made from the same pixels.
 */
import {
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PX,
  MEDIA_THUMB_MAX_BYTES,
  MEDIA_THUMB_PX,
  sniffImage,
  type MediaType,
} from '@phaseplay/shared';

export type Prepared = {
  blob: Blob;
  type: MediaType;
  width: number;
  height: number;
  thumb: Blob | null;
};

export class PrepareError extends Error {}

/** Fit (w, h) inside a `max` square, never enlarging. */
export function fitSize(w: number, h: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/**
 * Encode attempts in order: quality first (cheap, invisible at 0.8 → 0.6), then smaller sizes, but
 * never below `minPx` on the longest side (a scanned page must stay readable).
 */
export function encodePlan(
  longest: number,
  max = MEDIA_MAX_PX,
  minPx = 900,
): { px: number; q: number }[] {
  const out: { px: number; q: number }[] = [];
  let px = Math.min(longest, max);
  const qs = [0.8, 0.7, 0.6];
  for (;;) {
    for (const q of qs) out.push({ px, q });
    if (px <= minPx) break;
    px = Math.max(minPx, Math.round(px * 0.8));
  }
  return out;
}

const HEIC = /\.(heic|heif)$/i;
export const isHeic = (f: File) => /image\/hei[cf]/i.test(f.type) || HEIC.test(f.name);

/** Friendly reason a file was turned away before decoding, or null if it's worth a try. */
export function precheck(f: File): string | null {
  if (/svg|gif/i.test(f.type) || /\.(svg|gif)$/i.test(f.name))
    return 'Use a photo or scan (JPEG, PNG, WebP or HEIC). SVGs and GIFs aren’t supported.';
  if (f.type && !f.type.startsWith('image/') && !isHeic(f))
    return 'That file isn’t a picture. Choose a JPEG, PNG or photo.';
  if (f.size > 25 * 1024 * 1024) return 'That file is very large. Try a smaller photo.';
  return null;
}

type Source = { image: CanvasImageSource; w: number; h: number; close: () => void };

/** Pixel size from the file's header (PNG/JPEG/WebP) without decoding it, or null. */
async function headerSize(file: File): Promise<{ w: number; h: number } | null> {
  try {
    const s = sniffImage(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()));
    return s ? { w: s.width, h: s.height } : null;
  } catch {
    return null;
  }
}

async function decode(file: File): Promise<Source> {
  // createImageBitmap applies EXIF orientation ('from-image' is the default) and is off-thread.
  // For big photos it decodes straight to about the stored size, so a 48 MP phone photo never
  // sits in memory at full resolution. Only the width is given, so the height follows the
  // picture's own (oriented) shape; paint() fits it exactly afterwards.
  if (typeof createImageBitmap !== 'undefined') {
    const dims = await headerSize(file);
    const big = dims && Math.max(dims.w, dims.h) > MEDIA_MAX_PX * 1.25;
    const tries: (ImageBitmapOptions | undefined)[] = big
      ? [
          {
            resizeWidth: Math.max(
              1,
              Math.round((dims.w * MEDIA_MAX_PX) / Math.max(dims.w, dims.h)),
            ),
            resizeQuality: 'high',
          },
          undefined,
        ]
      : [undefined];
    for (const opts of tries) {
      try {
        const bmp = await createImageBitmap(file, opts);
        return { image: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
      } catch {
        /* try without resizing, then <img>, which decodes a few more formats on some browsers */
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { image: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} };
  } catch {
    throw new PrepareError(
      isHeic(file)
        ? 'This browser can’t open HEIC photos. Save it as JPEG or PNG and try again (on iPhone: Settings › Camera › Formats › Most Compatible).'
        : 'That file isn’t a picture we can read. Try saving it as JPEG or PNG.',
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob | null>((res) => c.toBlob(res, type, q));

let webp: boolean | null = null;
/** Can this browser encode WebP? (Safari before 17 silently returns PNG.) */
async function canWebp(): Promise<boolean> {
  if (webp !== null) return webp;
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const b = await toBlob(c, 'image/webp', 0.8);
  return (webp = b?.type === 'image/webp');
}

/**
 * Draw the source at w×h. Big reductions go in halving steps (a single 8× shrink in one
 * drawImage looks grainy, and is what the <img> fallback gets for a huge photo).
 */
function paint(src: Source, w: number, h: number, flatten: boolean) {
  let img: CanvasImageSource = src.image;
  let cw = src.w;
  let ch = src.h;
  while (cw > w * 2 && ch > h * 2) {
    const step = document.createElement('canvas');
    step.width = Math.round(cw / 2);
    step.height = Math.round(ch / 2);
    const sctx = step.getContext('2d')!;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, step.width, step.height);
    img = step;
    cw = step.width;
    ch = step.height;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  // JPEG has no transparency: put transparent scans on white rather than black.
  if (flatten) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Prepare one picture for upload. `onProgress` gets 0..1; `signal` cancels between steps
 * (throws an AbortError).
 */
export async function prepareImage(
  file: File,
  opts: { signal?: AbortSignal; onProgress?: (f: number) => void } = {},
): Promise<Prepared> {
  const stop = () => {
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  };
  const why = precheck(file);
  if (why) throw new PrepareError(why);
  opts.onProgress?.(0.05);
  const src = await decode(file);
  try {
    stop();
    opts.onProgress?.(0.25);
    const type: MediaType = (await canWebp()) ? 'image/webp' : 'image/jpeg';
    const plan = encodePlan(Math.max(src.w, src.h));
    let blob: Blob | null = null;
    let size = fitSize(src.w, src.h, MEDIA_MAX_PX);
    let canvas: HTMLCanvasElement | null = null;
    let canvasPx = 0;
    for (const [i, step] of plan.entries()) {
      stop();
      if (!canvas || canvasPx !== step.px) {
        size = fitSize(src.w, src.h, step.px);
        canvas = paint(src, size.width, size.height, type === 'image/jpeg');
        canvasPx = step.px;
      }
      blob = await toBlob(canvas, type, step.q);
      opts.onProgress?.(0.25 + (0.6 * (i + 1)) / plan.length);
      if (blob && blob.size <= MEDIA_MAX_BYTES) break;
      blob = null;
      await tick();
    }
    if (!blob)
      throw new PrepareError(
        'That picture is too detailed to upload, even shrunk. Try cropping it or a simpler photo.',
      );
    stop();
    // Thumbnail for cards: small and light; skipped if it won't fit (cards fall back to the image).
    const t = fitSize(src.w, src.h, MEDIA_THUMB_PX);
    const tc = paint(src, t.width, t.height, type === 'image/jpeg');
    let thumb: Blob | null = null;
    for (const q of [0.7, 0.5]) {
      thumb = await toBlob(tc, type, q);
      if (thumb && thumb.size <= MEDIA_THUMB_MAX_BYTES) break;
      thumb = null;
    }
    opts.onProgress?.(1);
    return { blob, type, width: size.width, height: size.height, thumb };
  } finally {
    src.close();
  }
}
