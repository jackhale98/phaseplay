/** Shared helpers for image exporters: sizes, crest/monogram, brand mark, colour utilities. */
import { hexToRgb, rgbToHex } from '@phaseplay/shared';
import { type Ctx2D, roundRectPath } from '../canvas';
import { FONT } from '../themes';

export type ExportSize = '1080x1080' | '1920x1080' | '1080x1920';

/** Parse an export size to pixels. */
export function parseSize(size: ExportSize): { w: number; h: number } {
  const [w, h] = size.split('x').map(Number) as [number, number];
  return { w, h };
}

export const font = (weight: number, px: number): string => `${weight} ${Math.round(px)}px ${FONT}`;

/** Mix two hex colours (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Hex colour with alpha as an rgba() string. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export type Monogram = { text: string; bg: string; fg: string };

/** Trace a heraldic shield centred on (cx, cy), `size` tall. */
export function shieldPath(ctx: Ctx2D, cx: number, cy: number, size: number): void {
  const w = size * 0.84;
  const top = cy - size / 2;
  const x0 = cx - w / 2;
  ctx.moveTo(x0, top + size * 0.08);
  ctx.quadraticCurveTo(cx, top - size * 0.04, cx + w / 2, top + size * 0.08);
  ctx.lineTo(cx + w / 2, top + size * 0.48);
  ctx.bezierCurveTo(
    cx + w / 2,
    top + size * 0.78,
    cx + w * 0.18,
    top + size * 0.92,
    cx,
    top + size,
  );
  ctx.bezierCurveTo(
    cx - w * 0.18,
    top + size * 0.92,
    cx - w / 2,
    top + size * 0.78,
    x0,
    top + size * 0.48,
  );
  ctx.closePath();
}

/**
 * Draw a monogram crest: initials in a shield (or circle) with an inner keyline.
 * `size` is the crest height in px.
 */
export function drawCrest(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  size: number,
  m: Monogram,
  shape: 'shield' | 'circle' = 'shield',
): void {
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  else shieldPath(ctx, cx, cy, size);
  ctx.fillStyle = m.bg;
  ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.045);
  ctx.strokeStyle = m.fg;
  ctx.stroke();
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(cx, cy, size * 0.41, 0, Math.PI * 2);
  else shieldPath(ctx, cx, cy, size * 0.8);
  ctx.lineWidth = Math.max(1, size * 0.015);
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;
  const text = m.text.slice(0, 3).toUpperCase();
  const px = size * (text.length >= 3 ? 0.27 : text.length === 2 ? 0.34 : 0.44);
  ctx.font = font(800, px);
  ctx.fillStyle = m.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy - (shape === 'shield' ? size * 0.04 : 0));
}

/** The small "phaseplay.app" mark in the bottom-right corner. */
export function drawBrandMark(ctx: Ctx2D, w: number, h: number, colour: string, k = 1): void {
  const px = Math.max(10, 18 * k);
  ctx.font = font(600, px);
  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.7;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('phaseplay.app', w - px * 1.2, h - px * 1.0);
  ctx.globalAlpha = 1;
}

/** Filled rounded rectangle. */
export function fillRound(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): void {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Throw an AbortError if the signal is aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Export cancelled', 'AbortError');
}
