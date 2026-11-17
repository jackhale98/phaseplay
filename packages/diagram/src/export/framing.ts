/**
 * Export framing: which part of the pitch an image or video shows, and in which orientation.
 *
 * Exports frame the content, not the named view: every token, the ball (including its flight and
 * kick height), labels, zones and arrows over the whole animation, plus a comfortable margin,
 * fitted to the export's aspect ratio in the orientation that shows it largest. A play's own
 * `viewport` (or a drill's area) is kept, grown only when it would crop something.
 */
import type { Play, Vec2, Viewport } from '@phaseplay/shared';
import { bezierPoint } from '../geometry';
import { compile, sample, type Scene } from '../sample';
import { type Orientation, TOKEN_RADIUS_M, drillArea, playViewport } from '../viewport';

/** What an export shows: a viewport with the rect's aspect ratio, its orientation and scale. */
export type Framing = {
  viewport: Viewport;
  orientation: Orientation;
  /** px per metre */ scale: number;
};

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Everything drawn over the animation, grouped by how far it reaches beyond its point. */
export type ContentExtents = {
  /** Players, equipment and the held ball: drawn as tokens (radius r, role tags beside them). */
  tokens: Box | null;
  /** The ball in flight, and its highest point (m) — drawn larger and lifted up the screen. */
  ball: Box | null;
  ballHeight: number;
  /** Text labels: their centre and character count (width depends on the token size). */
  labels: { x: number; y: number; chars: number }[];
  /** Exact extents in metres: zones, sized equipment, arrows. */
  fixed: Box | null;
};

const STEPS_PER_FRAME = 16;
const cache = new WeakMap<object, ContentExtents>();

const grow = (b: Box | null, x0: number, y0: number, x1 = x0, y1 = y0): Box =>
  b
    ? {
        x0: Math.min(b.x0, x0),
        y0: Math.min(b.y0, y0),
        x1: Math.max(b.x1, x1),
        y1: Math.max(b.y1, y1),
      }
    : { x0, y0, x1, y1 };

const SIZED = new Set(['zone', 'ladder', 'scrum_machine', 'gate']);

function addScene(c: ContentExtents, s: Scene): void {
  for (const e of s.entities) {
    const { x, y } = e.pos;
    const size = e.entity.size;
    if (e.kind === 'label') {
      if (e.entity.text) c.labels.push({ x, y, chars: e.entity.text.length });
    } else if (e.kind === 'zone' || (SIZED.has(e.kind) && size)) {
      const w = size?.w ?? 5;
      const h = size?.h ?? (e.kind === 'gate' ? 0.6 : 5);
      const r = ((size?.rot ?? 0) * Math.PI) / 180;
      const hx = (Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * h) / 2;
      const hy = (Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * h) / 2;
      c.fixed = grow(c.fixed, x - hx, y - hy, x + hx, y + hy);
    } else c.tokens = grow(c.tokens, x, y);
  }
  const b = s.ball;
  if (b) {
    if (b.height > 0.01) {
      c.ball = grow(c.ball, b.pos.x, b.pos.y);
      c.ballHeight = Math.max(c.ballHeight, b.height);
    } else c.tokens = grow(c.tokens, b.pos.x, b.pos.y);
  }
}

/**
 * The union of everything drawn over the whole animation: each frame's start, every segment
 * sampled along its paths (passes, kicks and curved runs), and every frame's arrows.
 */
export function contentExtents(play: Play): ContentExtents {
  const compiled = compile(play);
  const hit = cache.get(compiled);
  if (hit) return hit;
  const c: ContentExtents = { tokens: null, ball: null, ballHeight: 0, labels: [], fixed: null };
  const labelSeen = new Set<string>();
  const times = compiled.times;
  let scene: Scene | undefined;
  const at = (t: number) => {
    scene = sample(play, t, scene);
    const n = c.labels.length;
    addScene(c, scene);
    // Keep one entry per label position (labels rarely move; this bounds the list).
    const kept = c.labels.slice(0, n);
    for (const l of c.labels.slice(n)) {
      const k = `${l.x.toFixed(1)},${l.y.toFixed(1)},${l.chars}`;
      if (!labelSeen.has(k)) {
        labelSeen.add(k);
        kept.push(l);
      }
    }
    c.labels = kept;
  };
  at(0);
  for (let i = 1; i < times.length; i++) {
    const t0 = times[i - 1] as number;
    const t1 = times[i] as number;
    for (let k = 1; k <= STEPS_PER_FRAME; k++) at(t0 + ((t1 - t0) * k) / STEPS_PER_FRAME);
  }
  const p: Vec2 = { x: 0, y: 0 };
  for (const f of play.frames)
    for (const a of f.arrows ?? [])
      for (let k = 0; k <= STEPS_PER_FRAME; k++) {
        bezierPoint(a.from, a.ctrl, a.to, k / STEPS_PER_FRAME, p);
        c.fixed = grow(c.fixed, p.x, p.y);
      }
  cache.set(compiled, c);
  return c;
}

/** Same as draw.ts tokenRadiusPx for a target rect of w × h px at `scale` px/m. */
const tokenPx = (scale: number, w: number, h: number) =>
  Math.max(TOKEN_RADIUS_M * scale, 0.018 * Math.min(w, h), 4);

/** Breathing room (m) kept between the outermost drawn pixel and the frame edge. */
export const FRAME_MARGIN_M = 2;
/** The smallest area (m) an export zooms to, so a lone token isn't blown up. */
export const MIN_FRAME_M = 22;
/** Content within this distance (m) of a touchline or try line pulls that line into view. */
export const LINE_SNAP_M = 8;

/** Content bounds at a given scale: drawn extents (px converted to m) plus the margin. */
function boundsAt(c: ContentExtents, scale: number, r: number): Box | null {
  const px = (k: number) => (k * r) / scale;
  const m = FRAME_MARGIN_M;
  let b: Box | null = null;
  const add = (box: Box | null, pad: number) => {
    if (box) b = grow(b, box.x0 - pad, box.y0 - pad, box.x1 + pad, box.y1 + pad);
  };
  // A token's role tag and the highlight ring reach ~1.6 r from its centre.
  add(c.tokens, Math.max(TOKEN_RADIUS_M, px(1.6)) + m);
  if (c.ball) {
    const rb = Math.max(0.42 * scale, r * 0.5);
    const k = 1 + Math.min(1.2, c.ballHeight / 10);
    add(c.ball, (rb * 1.3 * k + c.ballHeight * rb * 0.6) / scale + m);
  }
  for (const l of c.labels) {
    // fontLabel is 0.85 r; an average glyph is ~0.6 em; the pill adds 0.4 r a side.
    const half = px(0.85 * 0.6 * l.chars * 0.5 + 0.4);
    b = grow(b, l.x - half - m, l.y - px(0.65) - m, l.x + half + m, l.y + px(0.65) + m);
  }
  add(c.fixed, m * 0.5);
  return b;
}

/** How much larger (×) the other orientation must show the content to be picked. */
export const ORIENTATION_BIAS = 1.15;

const PITCH_LIMIT: Box = { x0: -6, y0: -12, x1: 76, y1: 112 };

/** Pull nearby touchlines / try lines (and a lineout's 15 m line) into the frame for context. */
function withContext(b: Box, play: Pick<Play, 'view'>): Box {
  const out = { ...b };
  if (play.view === 'lineout') {
    // The touchline nearer the content is the lineout's: show it and the 5 m–15 m channel.
    if (out.x0 <= 70 - out.x1) out.x1 = Math.max(out.x1, 17);
    else out.x0 = Math.min(out.x0, 53);
  }
  if (out.x0 < LINE_SNAP_M) out.x0 = Math.min(out.x0, -3);
  if (out.x1 > 70 - LINE_SNAP_M) out.x1 = Math.max(out.x1, 73);
  if (out.y0 < LINE_SNAP_M && out.y0 > -10) out.y0 = Math.min(out.y0, -3);
  if (out.y1 > 100 - LINE_SNAP_M && out.y1 < 110) out.y1 = Math.max(out.y1, 103);
  return out;
}

function enforceMin(b: Box): Box {
  const out = { ...b };
  for (const [lo, hi] of [
    ['x0', 'x1'],
    ['y0', 'y1'],
  ] as const) {
    const d = out[hi] - out[lo];
    if (d < MIN_FRAME_M) {
      out[lo] -= (MIN_FRAME_M - d) / 2;
      out[hi] += (MIN_FRAME_M - d) / 2;
    }
  }
  return out;
}

/** Expand [lo, hi] to `len` around its centre, then slide it inside [min, max] where it fits. */
function fitSpan(lo: number, hi: number, len: number, min: number, max: number): number {
  let a = (lo + hi) / 2 - len / 2;
  if (len <= max - min) a = Math.min(max - len, Math.max(min, a));
  else a = (min + max) / 2 - len / 2;
  // Never slide content out: the span always covers [lo, hi].
  return Math.min(lo, Math.max(a, hi - len));
}

/**
 * Frame a play for a `width` × `height` px rect: the content over the whole animation plus a
 * margin, with context lines kept, at the rect's aspect ratio in the orientation that shows the
 * content largest. A play's own viewport or drill area is kept unless it would crop content.
 */
export function frameForRect(play: Play, width: number, height: number): Framing {
  const c = contentExtents(play);
  const base = play.viewport || drillArea(play) ? playViewport(play) : null;
  // Drill areas may sit anywhere; pitch plays slide within the pitch and a little surround.
  const limit: Box = drillArea(play)
    ? { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity }
    : PITCH_LIMIT;
  const W = Math.max(1, width);
  const H = Math.max(1, height);

  const boxFor = (scale: number): Box => {
    const r = tokenPx(scale, W, H);
    let b = boundsAt(c, scale, r);
    if (base) {
      const v = grow(null, base.x, base.y, base.x + base.w, base.y + base.h);
      b = b ? grow(v, b.x0, b.y0, b.x1, b.y1) : v;
      return b;
    }
    if (!b) {
      const v = playViewport(play);
      return { x0: v.x, y0: v.y, x1: v.x + v.w, y1: v.y + v.h };
    }
    return enforceMin(withContext(b, play));
  };
  const scaleOf = (b: Box, o: Orientation) => {
    const cw = o === 'portrait' ? b.x1 - b.x0 : b.y1 - b.y0;
    const ch = o === 'portrait' ? b.y1 - b.y0 : b.x1 - b.x0;
    return Math.min(W / cw, H / ch);
  };

  let best: { o: Orientation; b: Box; s: number } | null = null;
  const prefer: Orientation = H >= W ? 'portrait' : 'landscape';
  for (const o of [prefer, prefer === 'portrait' ? 'landscape' : 'portrait'] as Orientation[]) {
    // Pixel-sized parts (tokens, labels) depend on the scale: settle it in a few passes.
    // (scale → box → scale is increasing in the scale, so this converges monotonically.)
    let s = scaleOf(boxFor(30), o);
    for (let i = 0; i < 4; i++) s = scaleOf(boxFor(s), o);
    const b = boxFor(s);
    s = scaleOf(b, o);
    // Prefer the rect's own shape unless turning the pitch shows the action clearly larger.
    if (!best || s > best.s * ORIENTATION_BIAS) best = { o, b, s };
  }
  const { o, b, s } = best as { o: Orientation; b: Box; s: number };
  // Grow the short side to the rect's aspect, sliding within the pitch (and its surround).
  const vw = o === 'portrait' ? W / s : H / s;
  const vh = o === 'portrait' ? H / s : W / s;
  const x = fitSpan(b.x0, b.x1, vw, limit.x0, limit.x1);
  const y = fitSpan(b.y0, b.y1, vh, limit.y0, limit.y1);
  return { viewport: { x, y, w: vw, h: vh }, orientation: o, scale: s };
}
