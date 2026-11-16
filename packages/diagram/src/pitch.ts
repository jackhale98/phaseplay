/**
 * Pitch and drill-area backgrounds, plus a small cache of pre-rendered background layers so each
 * animation frame only draws entities and trails.
 */
import type { Play } from '@phaseplay/shared';
import { type CanvasFactory, type CanvasLike, type Ctx2D, defaultCanvasFactory } from './canvas';
import { FONT, type Theme } from './themes';
import { PITCH, type Transform } from './viewport';

export type Background = NonNullable<Play['background']>;

/** Pitch line positions (m). */
export const MARKINGS = {
  tryLines: [0, 100],
  deadBall: [-10, 110],
  solid: [22, 50, 78],
  tenMetre: [40, 60],
  fiveMetreDash: [5, 95],
  longDashed: [5, 15, 55, 65],
  posts: { centre: 35, halfWidth: 2.8 },
} as const;

function fillRect(ctx: Ctx2D, t: Transform, x0: number, y0: number, x1: number, y1: number): void {
  const ax = t.sx(x0, y0);
  const ay = t.sy(x0, y0);
  const bx = t.sx(x1, y1);
  const by = t.sy(x1, y1);
  ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
}

function strokeRect(
  ctx: Ctx2D,
  t: Transform,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const ax = t.sx(x0, y0);
  const ay = t.sy(x0, y0);
  const bx = t.sx(x1, y1);
  const by = t.sy(x1, y1);
  ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
}

function seg(ctx: Ctx2D, t: Transform, x0: number, y0: number, x1: number, y1: number): void {
  ctx.moveTo(t.sx(x0, y0), t.sy(x0, y0));
  ctx.lineTo(t.sx(x1, y1), t.sy(x1, y1));
}

/** Pixel line width for pitch markings at this scale. */
export function lineWidthFor(t: Transform): number {
  return Math.max(1, Math.min(6, 0.16 * t.scale));
}

/**
 * Draw the background into the transform's rectangle: full rugby pitch markings with goalposts,
 * or for drill backgrounds ('grass' / 'grid') plain grass sized w×h with edge dimension labels and
 * an optional metre grid. Clips to the rectangle.
 */
export function drawPitch(ctx: Ctx2D, t: Transform, theme: Theme, background?: Background): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(t.originX, t.originY, t.width, t.height);
  ctx.clip();
  ctx.fillStyle = theme.surround;
  ctx.fillRect(t.originX, t.originY, t.width, t.height);
  if (background && background.kind !== 'pitch') drawDrillArea(ctx, t, theme, background);
  else drawRugbyPitch(ctx, t, theme);
  ctx.restore();
}

function drawRugbyPitch(ctx: Ctx2D, t: Transform, theme: Theme): void {
  const W = PITCH.width;
  // Stripes every 10 m; in-goals in their own shade.
  for (let y = 0, k = 0; y < 100; y += 10, k++) {
    ctx.fillStyle = theme.stripes[k % 2] as string;
    fillRect(ctx, t, 0, y, W, y + 10);
  }
  ctx.fillStyle = theme.inGoal;
  fillRect(ctx, t, 0, -10, W, 0);
  fillRect(ctx, t, 0, 100, W, 110);

  const lw = lineWidthFor(t);
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = lw;
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  // Solid: touchlines, dead-ball lines, try lines, 22s and halfway.
  ctx.beginPath();
  seg(ctx, t, 0, -10, 0, 110);
  seg(ctx, t, W, -10, W, 110);
  for (const y of [...MARKINGS.deadBall, ...MARKINGS.tryLines, ...MARKINGS.solid])
    seg(ctx, t, 0, y, W, y);
  ctx.stroke();
  // Try lines and halfway slightly heavier.
  ctx.lineWidth = lw * 1.4;
  ctx.beginPath();
  for (const y of [0, 50, 100]) seg(ctx, t, 0, y, W, y);
  ctx.stroke();

  // Dashed: 10 m lines, 5 m & 15 m lines parallel to touch, 5 m lines from the try lines.
  const dash = Math.max(4, 1.6 * t.scale);
  ctx.lineWidth = lw;
  ctx.setLineDash([dash, dash]);
  ctx.beginPath();
  for (const y of MARKINGS.tenMetre) seg(ctx, t, 0, y, W, y);
  for (const x of MARKINGS.longDashed) seg(ctx, t, x, 5, x, 95);
  for (const y of MARKINGS.fiveMetreDash) seg(ctx, t, 5, y, W - 5, y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Short hash marks where the 5 m/15 m lines cross the 22s, halfway and 10 m lines.
  ctx.beginPath();
  for (const y of [22, 40, 50, 60, 78])
    for (const x of MARKINGS.longDashed) seg(ctx, t, x - 1, y, x + 1, y);
  ctx.stroke();

  // Goalposts: crossbar on each try line plus the two uprights.
  const { centre, halfWidth } = MARKINGS.posts;
  const pr = Math.max(1.5, 0.35 * t.scale);
  for (const y of MARKINGS.tryLines) {
    ctx.lineWidth = Math.max(2, lw * 2.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    seg(ctx, t, centre - halfWidth, y, centre + halfWidth, y);
    ctx.stroke();
    ctx.fillStyle = theme.line;
    ctx.beginPath();
    for (const x of [centre - halfWidth, centre + halfWidth]) {
      ctx.moveTo(t.sx(x, y) + pr, t.sy(x, y));
      ctx.arc(t.sx(x, y), t.sy(x, y), pr, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.lineCap = 'butt';
}

function drawDrillArea(ctx: Ctx2D, t: Transform, theme: Theme, bg: Background): void {
  const w = bg.w ?? 20;
  const h = bg.h ?? 20;
  const band = w > 30 || h > 30 ? 10 : 5;
  for (let y = 0, k = 0; y < h; y += band, k++) {
    ctx.fillStyle = theme.stripes[k % 2] as string;
    fillRect(ctx, t, 0, y, w, Math.min(h, y + band));
  }
  const gridM = bg.gridM ?? (bg.kind === 'grid' ? 5 : 0);
  const lw = lineWidthFor(t);
  if (gridM > 0) {
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = Math.max(1, lw * 0.6);
    ctx.beginPath();
    for (let x = gridM; x < w - 1e-6; x += gridM) seg(ctx, t, x, 0, x, h);
    for (let y = gridM; y < h - 1e-6; y += gridM) seg(ctx, t, 0, y, w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = lw;
  ctx.globalAlpha = 0.75;
  strokeRect(ctx, t, 0, 0, w, h);
  ctx.globalAlpha = 1;

  // Dimension labels outside the top (y = 0) and left (x = 0) edges.
  const px = Math.max(11, Math.min(t.width, t.height) * 0.03);
  ctx.font = `600 ${px}px ${FONT}`;
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const off = 1.6; // metres outside the edge
  ctx.fillText(`${fmtM(w)} m`, t.sx(w / 2, -off), t.sy(w / 2, -off));
  ctx.fillText(`${fmtM(h)} m`, t.sx(-off, h / 2), t.sy(-off, h / 2));
}

const fmtM = (m: number) => (Number.isInteger(m) ? String(m) : m.toFixed(1));

// ---------------------------------------------------------------------------------------------
// Layer cache

type Entry = { key: string; canvas: CanvasLike };
const layers: Entry[] = [];
const MAX_LAYERS = 6;

/** Cache key for a pre-rendered background. */
export function pitchLayerKey(t: Transform, theme: Theme, background?: Background): string {
  const b = background
    ? `${background.kind}:${background.w ?? ''}x${background.h ?? ''}:${background.gridM ?? ''}`
    : 'pitch';
  return `${t.key}|${theme.name}|${b}`;
}

/**
 * A pre-rendered background canvas for this transform (whose origin should be 0,0), theme and
 * background, cached by size + theme + orientation + viewport. Uses OffscreenCanvas when available;
 * pass `factory` elsewhere. Draw it with `ctx.drawImage(layer, 0, 0)` or via draw()'s `pitchLayer`.
 */
export function getPitchLayer(
  t: Transform,
  theme: Theme,
  background?: Background,
  factory: CanvasFactory = defaultCanvasFactory,
): CanvasLike {
  const key = pitchLayerKey(t, theme, background);
  const i = layers.findIndex((l) => l.key === key);
  if (i >= 0) {
    const [hit] = layers.splice(i, 1) as [Entry];
    layers.push(hit);
    return hit.canvas;
  }
  const canvas = factory(Math.ceil(t.originX + t.width), Math.ceil(t.originY + t.height));
  const ctx = canvas.getContext('2d');
  if (ctx) drawPitch(ctx, t, theme, background);
  layers.push({ key, canvas });
  if (layers.length > MAX_LAYERS) layers.shift();
  return canvas;
}

/** Empty the background layer cache (e.g. after a theme edit). */
export function clearPitchLayers(): void {
  layers.length = 0;
}
