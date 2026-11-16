/**
 * Minimal canvas abstractions so the renderer runs on the main thread (HTMLCanvasElement), in a
 * Web Worker (OffscreenCanvas) and in tests (a recording mock).
 */

/** Any 2D context the renderer can draw into. */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The subset of HTMLCanvasElement / OffscreenCanvas the renderer and exporters use. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d'): Ctx2D | null;
  convertToBlob?: (opts?: { type?: string; quality?: number }) => Promise<Blob>;
  toBlob?: (cb: (b: Blob | null) => void, type?: string, quality?: number) => void;
}

/** Creates a canvas of the given pixel size. */
export type CanvasFactory = (width: number, height: number) => CanvasLike;

/** OffscreenCanvas when available, otherwise a DOM canvas; throws where neither exists. */
export const defaultCanvasFactory: CanvasFactory = (width, height) => {
  if (typeof OffscreenCanvas !== 'undefined')
    return new OffscreenCanvas(width, height) as unknown as CanvasLike;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c as unknown as CanvasLike;
  }
  throw new Error('No canvas available: pass a canvas factory');
};

/** Get a 2D context or throw. */
export function context2d(canvas: CanvasLike): Ctx2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

/** Encode a canvas as a Blob (PNG by default) via convertToBlob or toBlob. */
export function canvasToBlob(
  canvas: CanvasLike,
  type = 'image/png',
  quality?: number,
): Promise<Blob> {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  const toBlob = canvas.toBlob;
  if (toBlob)
    return new Promise((resolve, reject) =>
      toBlob.call(
        canvas,
        (b) => (b ? resolve(b) : reject(new Error('Canvas encoding failed'))),
        type,
        quality,
      ),
    );
  return Promise.reject(new Error('Canvas cannot be encoded'));
}

/** Trace a rounded rectangle path (no reliance on ctx.roundRect for older Safari). */
export function roundRectPath(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Split text into at most `maxLines` lines that fit `maxWidth`, ellipsising the last. */
export function wrapText(ctx: Ctx2D, text: string, maxWidth: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsise(
      ctx,
      `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`,
      maxWidth,
    );
    return kept;
  }
  return lines.map((l) => ellipsise(ctx, l, maxWidth));
}

/** Truncate a single line with an ellipsis so it fits `maxWidth`. */
export function ellipsise(ctx: Ctx2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Largest font size ≤ `max` (px) at which `text` fits `maxWidth`, not below `min`. */
export function fitFontSize(
  ctx: Ctx2D,
  text: string,
  font: (px: number) => string,
  maxWidth: number,
  max: number,
  min: number,
): number {
  let px = max;
  ctx.font = font(px);
  const w = ctx.measureText(text).width;
  if (w > maxWidth && w > 0) px = Math.max(min, Math.floor((max * maxWidth) / w));
  ctx.font = font(px);
  return px;
}
