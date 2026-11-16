/**
 * Viewports (which part of the pitch is shown), pitch ↔ screen transforms for portrait and
 * landscape, and hit testing.
 *
 * Convention: the attacking side runs towards the y = 0 try line. Portrait draws y = -10 at the
 * top (attack runs up the screen); landscape rotates that 90° clockwise (attack runs right).
 */
import type { Play, View, Viewport, Vec2 } from '@phaseplay/shared';
import type { Scene } from './sample';

export type Orientation = 'portrait' | 'landscape';
export type Format = Play['format'];

/** The full playing area including in-goals. */
export const PITCH = { width: 70, minY: -10, maxY: 110 } as const;
export const PITCH_BOUNDS: Viewport = { x: 0, y: -10, w: 70, h: 120 };

/** Canonical set-piece locations used by presets and the matching views. */
export const LINEOUT_Y = 40;
export const SCRUM_MARK: Vec2 = { x: 35, y: 40 };

/** Viewport (pitch metres) for a named view. `custom` falls back to `full`. */
export function viewForPreset(view: View, _format: Format = '15s'): Viewport {
  switch (view) {
    case 'half':
      return { x: -2, y: -12, w: 74, h: 64 };
    case 'attack22':
      return { x: -2, y: -12, w: 74, h: 40 };
    case 'lineout':
      return { x: -4, y: LINEOUT_Y - 16, w: 44, h: 36 };
    case 'scrum':
      return { x: SCRUM_MARK.x - 22, y: SCRUM_MARK.y - 12, w: 44, h: 34 };
    case 'full':
    case 'custom':
    default:
      return { x: -2, y: -12, w: 74, h: 124 };
  }
}

/** Margin (m) shown around a drill's grass area so queues at the edges stay visible. */
export const DRILL_MARGIN = 4;

/** The drill area (w × h, origin 0,0) for grass/grid backgrounds, or null for pitch backgrounds. */
export function drillArea(play: Pick<Play, 'background'>): { w: number; h: number } | null {
  const bg = play.background;
  if (!bg || bg.kind === 'pitch') return null;
  return { w: bg.w ?? 20, h: bg.h ?? 20 };
}

/** The viewport a play should be shown at: explicit viewport, drill area + margin, or its view. */
export function playViewport(
  play: Pick<Play, 'viewport' | 'background' | 'view' | 'format'>,
): Viewport {
  if (play.viewport) return play.viewport;
  const area = drillArea(play);
  if (area)
    return {
      x: -DRILL_MARGIN,
      y: -DRILL_MARGIN,
      w: area.w + 2 * DRILL_MARGIN,
      h: area.h + 2 * DRILL_MARGIN,
    };
  return viewForPreset(play.view, play.format);
}

/** Bounds positions are expected to stay within (pitch, or drill viewport). */
export function playBounds(
  play: Pick<Play, 'viewport' | 'background' | 'view' | 'format'>,
): Viewport {
  return drillArea(play) || play.viewport ? playViewport(play) : PITCH_BOUNDS;
}

export interface Transform {
  readonly viewport: Viewport;
  readonly orientation: Orientation;
  /** Target rectangle in device pixels. */
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  /** Device pixels per metre. */
  readonly scale: number;
  /** Stable cache key (size, viewport, orientation). */
  readonly key: string;
  /** Screen x/y for a pitch point without allocating. */
  sx(x: number, y: number): number;
  sy(x: number, y: number): number;
  toScreen(p: Vec2, out?: Vec2): Vec2;
  toPitch(px: Vec2, out?: Vec2): Vec2;
}

export type TransformOptions = {
  viewport: Viewport;
  width: number;
  height: number;
  orientation: Orientation;
  /** Pixels kept free on every side. */
  padding?: number;
  /** Top-left of the target rectangle (for drawing into part of a canvas, e.g. storyboards). */
  originX?: number;
  originY?: number;
};

/** Build a uniform-scale, centred transform that fits the viewport into width × height. */
export function makeTransform(o: TransformOptions): Transform {
  const { viewport: vp, width, height, orientation } = o;
  const pad = o.padding ?? 0;
  const ox0 = o.originX ?? 0;
  const oy0 = o.originY ?? 0;
  const portrait = orientation === 'portrait';
  const cw = portrait ? vp.w : vp.h;
  const ch = portrait ? vp.h : vp.w;
  const s = Math.max(1e-6, Math.min((width - 2 * pad) / cw, (height - 2 * pad) / ch));
  const ox = ox0 + (width - cw * s) / 2;
  const oy = oy0 + (height - ch * s) / 2;
  const right = vp.y + vp.h;
  const sx = portrait
    ? (x: number) => ox + (x - vp.x) * s
    : (_x: number, y: number) => ox + (right - y) * s;
  const sy = portrait
    ? (_x: number, y: number) => oy + (y - vp.y) * s
    : (x: number) => oy + (x - vp.x) * s;
  return {
    viewport: vp,
    orientation,
    originX: ox0,
    originY: oy0,
    width,
    height,
    scale: s,
    key: `${width}x${height}@${ox0},${oy0}|${orientation}|${vp.x},${vp.y},${vp.w},${vp.h}|${pad}`,
    sx: sx as (x: number, y: number) => number,
    sy: sy as (x: number, y: number) => number,
    toScreen(p, out = { x: 0, y: 0 }) {
      const x = sx(p.x, p.y);
      out.y = sy(p.x, p.y);
      out.x = x;
      return out;
    },
    toPitch(px, out = { x: 0, y: 0 }) {
      const a = (px.x - ox) / s;
      const b = (px.y - oy) / s;
      if (portrait) {
        out.x = vp.x + a;
        out.y = vp.y + b;
      } else {
        out.x = vp.x + b;
        out.y = right - a;
      }
      return out;
    },
  };
}

/**
 * Pick the orientation for a width × height box: the one matching the box's shape, unless the
 * other shows the viewport at least 30% larger.
 */
export function bestOrientation(viewport: Viewport, width: number, height: number): Orientation {
  const p = Math.min(width / viewport.w, height / viewport.h);
  const l = Math.min(width / viewport.h, height / viewport.w);
  return height >= width
    ? l > p * 1.3
      ? 'landscape'
      : 'portrait'
    : p > l * 1.3
      ? 'portrait'
      : 'landscape';
}

/** Default token radius in metres (see draw.ts for the pixel minimum). */
export const TOKEN_RADIUS_M = 0.7;

/** Is `p` inside a (possibly rotated, degrees) rectangle of size w×h centred on `c`? */
export function inRotatedRect(
  p: Vec2,
  c: Vec2,
  w: number,
  h: number,
  rotDeg = 0,
  pad = 0,
): boolean {
  const r = (-rotDeg * Math.PI) / 180;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= w / 2 + pad && Math.abs(ly) <= h / 2 + pad;
}

/**
 * Top-most entity id under a pitch point (the ball first, then entities in reverse draw order),
 * or null. Zones are hit anywhere inside their rectangle; other entities within token radius +
 * tolerance.
 */
export function hitTest(scene: Scene, p: Vec2, toleranceM = 0.5): string | null {
  const ball = scene.ball;
  if (ball?.id && Math.hypot(ball.pos.x - p.x, ball.pos.y - p.y) <= 0.5 + toleranceM)
    return ball.id;
  for (let i = scene.entities.length - 1; i >= 0; i--) {
    const e = scene.entities[i];
    if (!e) continue;
    const size = e.entity.size;
    if (
      e.kind === 'zone' ||
      ((e.kind === 'ladder' || e.kind === 'scrum_machine' || e.kind === 'gate') && size)
    ) {
      const w = size?.w ?? 5;
      const h = size?.h ?? (e.kind === 'gate' ? 0.6 : 5);
      if (inRotatedRect(p, e.pos, w, h, size?.rot ?? 0, toleranceM)) return e.id;
      continue;
    }
    const r = e.kind === 'label' ? 1.5 : TOKEN_RADIUS_M;
    if (Math.hypot(e.pos.x - p.x, e.pos.y - p.y) <= r + toleranceM) return e.id;
  }
  return null;
}
