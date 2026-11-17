/**
 * PNG exports: a single frame, a storyboard grid of all frames, and the printable drill card.
 * Everything draws through the shared draw() so exports match the viewer exactly.
 */
import { EQUIPMENT_LABELS, type EquipmentItem, type Play } from '@phaseplay/shared';
import {
  type CanvasFactory,
  type Ctx2D,
  canvasToBlob,
  context2d,
  defaultCanvasFactory,
  wrapText,
} from '../canvas';
import { draw } from '../draw';
import { getPitchLayer } from '../pitch';
import { frameTimes, overviewScene, sample, type Scene } from '../sample';
import { type Theme, type ThemeName, attackColours, resolveTheme } from '../themes';
import { makeTransform, type Transform } from '../viewport';
import {
  type ExportSize,
  type Monogram,
  drawBrandMark,
  drawCrest,
  fillRound,
  font,
  parseSize,
} from './common';
import { frameForRect } from './framing';

export type PlayImageOptions = {
  play: Play;
  /** A frame index, or 'storyboard' for a grid of every frame. */
  frameIndex: number | 'storyboard';
  size: ExportSize;
  /** Pixel multiplier (default 2 → e.g. 2160×2160 for 1080×1080). */
  scale?: number;
  theme?: Theme | ThemeName;
  accent: string;
  title?: string;
  monogram?: Monogram;
  /** Show frame captions (default true). */
  captions?: boolean;
  highlightMemberId?: string;
  showTrails?: boolean;
  /** Canvas factory (defaults to OffscreenCanvas / DOM canvas). */
  factory?: CanvasFactory;
};

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Draw a scene into a rectangle, framed (framing.ts) so everything over the whole animation is in
 * view at the rect's aspect ratio. Every frame of a play gets the same framing.
 */
export function drawSceneInRect(
  ctx: Ctx2D,
  play: Play,
  scene: Scene,
  rect: Rect,
  theme: Theme,
  accent: string,
  extra: {
    highlightMemberId?: string;
    showTrails?: boolean;
    padding?: number;
    layerFactory?: CanvasFactory;
  } = {},
): Transform {
  const pad = extra.padding ?? 0;
  const { viewport, orientation } = frameForRect(play, rect.w - 2 * pad, rect.h - 2 * pad);
  const t = makeTransform({
    viewport,
    width: rect.w,
    height: rect.h,
    originX: rect.x,
    originY: rect.y,
    orientation,
    padding: pad,
  });
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  const pitchLayer = extra.layerFactory
    ? getPitchLayer(t, theme, play.background, extra.layerFactory)
    : undefined;
  draw(ctx, scene, {
    theme,
    transform: t,
    accent,
    background: play.background,
    pitchLayer,
    highlightMemberId: extra.highlightMemberId,
    showTrails: extra.showTrails ?? true,
  });
  ctx.restore();
  return t;
}

/** Header with optional monogram crest and title; returns its height. */
function drawHeader(
  ctx: Ctx2D,
  W: number,
  u: number,
  theme: Theme,
  title: string | undefined,
  sub: string | undefined,
  monogram?: Monogram,
): number {
  if (!title && !monogram) return 0;
  const h = 132 * u;
  const pad = 40 * u;
  let x = pad;
  if (monogram) {
    drawCrest(ctx, pad + 42 * u, h / 2 + 6 * u, 84 * u, monogram);
    x += 104 * u;
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.ink;
  ctx.font = font(750, 46 * u);
  const [line] = wrapText(ctx, title ?? '', W - x - pad, 1);
  ctx.fillText(line ?? '', x, sub ? h / 2 + 4 * u : h / 2 + 18 * u);
  if (sub) {
    ctx.font = font(500, 26 * u);
    ctx.fillStyle = theme.muted;
    ctx.fillText(sub, x, h / 2 + 42 * u);
  }
  return h;
}

/** Paint a play image (single frame or storyboard) into a W×H context. */
export function paintPlayImage(ctx: Ctx2D, W: number, H: number, o: PlayImageOptions): void {
  if (o.frameIndex === 'storyboard') return paintPlayAt(ctx, W, H, o, 0);
  const fi = Math.max(0, Math.min(o.play.frames.length - 1, o.frameIndex));
  paintPlayAt(ctx, W, H, o, frameTimes(o.play)[fi] ?? 0);
}

/** Reusable state for painting many frames (video): a scene to sample into, cached pitch layers. */
export type PaintCache = { scene?: Scene; layerFactory?: CanvasFactory };

/**
 * Paint the play at time `tMs` with the same chrome as the PNG export (title, caption band,
 * brand mark). Storyboard mode ignores `tMs`.
 */
export function paintPlayAt(
  ctx: Ctx2D,
  W: number,
  H: number,
  o: PlayImageOptions,
  tMs: number,
  cache?: PaintCache,
): void {
  const theme = resolveTheme(o.theme);
  const u = Math.min(W, H) / 1080;
  const captions = o.captions !== false;
  const { play } = o;
  ctx.fillStyle = theme.paper;
  ctx.fillRect(0, 0, W, H);
  const times = frameTimes(play);
  const storyboard = o.frameIndex === 'storyboard';
  const scene = storyboard ? null : sample(play, tMs, cache?.scene);
  if (cache && scene) cache.scene = scene;
  const fi = scene ? scene.frameIndex : 0;
  const sub = storyboard
    ? `${play.frames.length} frames`
    : play.frames.length > 1
      ? `Frame ${fi + 1} of ${play.frames.length}`
      : undefined;
  const headH = drawHeader(
    ctx,
    W,
    u,
    theme,
    o.title,
    o.title || o.monogram ? sub : undefined,
    o.monogram,
  );
  const pad = 32 * u;
  const footH = 52 * u;
  const area: Rect = {
    x: pad,
    y: headH + (headH ? 0 : pad),
    w: W - 2 * pad,
    h: H - headH - (headH ? 0 : pad) - footH,
  };

  if (!storyboard) {
    const caption = captions ? play.frames[fi]?.caption : undefined;
    let capH = 0;
    if (caption) {
      ctx.font = font(600, 34 * u);
      const lines = wrapText(ctx, caption, area.w - 40 * u, 3);
      capH = lines.length * 46 * u + 36 * u;
      const y0 = area.y + area.h - capH;
      fillRound(
        ctx,
        area.x,
        y0,
        area.w,
        capH - 12 * u,
        18 * u,
        theme.name === 'print' ? '#f3f4f6' : 'rgba(255,255,255,0.08)',
      );
      ctx.fillStyle = theme.ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, area.x + 20 * u, y0 + 12 * u + 23 * u + i * 46 * u));
    }
    drawSceneInRect(ctx, play, scene as Scene, { ...area, h: area.h - capH }, theme, o.accent, {
      ...o,
      layerFactory: cache?.layerFactory,
    });
  } else {
    drawStoryboard(ctx, play, times, area, u, theme, o, captions);
  }
  drawBrandMark(ctx, W, H, theme.ink, u);
}

function drawStoryboard(
  ctx: Ctx2D,
  play: Play,
  times: number[],
  area: Rect,
  u: number,
  theme: Theme,
  o: PlayImageOptions,
  captions: boolean,
): void {
  const n = play.frames.length;
  const gap = 20 * u;
  const capH = captions && play.frames.some((f) => f.caption) ? 76 * u : 0;
  let best = { cols: 1, s: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (area.w - gap * (cols - 1)) / cols;
    const ch = (area.h - gap * (rows - 1)) / rows - capH;
    if (ch <= 0) continue;
    const s = frameForRect(play, cw, ch).scale;
    if (s > best.s) best = { cols, s };
  }
  const cols = best.cols;
  const rows = Math.ceil(n / cols);
  const cw = (area.w - gap * (cols - 1)) / cols;
  const ch = (area.h - gap * (rows - 1)) / rows;
  const accent = attackColours(o.accent);
  for (let i = 0; i < n; i++) {
    const cx = area.x + (i % cols) * (cw + gap);
    const cy = area.y + Math.floor(i / cols) * (ch + gap);
    const rect = { x: cx, y: cy, w: cw, h: ch - capH };
    drawSceneInRect(ctx, play, sample(play, times[i] ?? 0), rect, theme, o.accent, o);
    // Frame number badge.
    const br = Math.max(12 * u, Math.min(cw, ch) * 0.06);
    ctx.beginPath();
    ctx.arc(cx + br * 1.4, cy + br * 1.4, br, 0, Math.PI * 2);
    ctx.fillStyle = accent.fill;
    ctx.fill();
    ctx.fillStyle = accent.text;
    ctx.font = font(800, br * 1.1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), cx + br * 1.4, cy + br * 1.4 + 0.5);
    const caption = captions ? play.frames[i]?.caption : undefined;
    if (caption && capH) {
      const px = Math.max(14 * u, Math.min(26 * u, cw * 0.05));
      ctx.font = font(600, px);
      ctx.fillStyle = theme.ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      wrapText(ctx, caption, cw - 8 * u, 2).forEach((l, k) =>
        ctx.fillText(l, cx + 4 * u, cy + ch - capH + 10 * u + k * px * 1.25),
      );
    }
  }
}

/** Render a frame or storyboard PNG at size × scale pixels. */
export async function renderPlayImage(o: PlayImageOptions): Promise<Blob> {
  const { w, h } = parseSize(o.size);
  const k = o.scale ?? 2;
  const W = Math.round(w * k);
  const H = Math.round(h * k);
  const canvas = (o.factory ?? defaultCanvasFactory)(W, H);
  paintPlayImage(context2d(canvas), W, H, o);
  return canvasToBlob(canvas, 'image/png');
}

// ---------------------------------------------------------------------------------------------
// Drill card

export type DrillCardOptions = {
  play: Play;
  title: string;
  setup: string;
  coachingPoints: string[];
  /** Counts by equipment key (shared EQUIPMENT keys get their labels). */
  equipment: Record<string, number>;
  /** Short facts shown under the title, e.g. ["15 min", "Shields", "8–16 players"]. */
  meta: string[];
  paper: 'a4' | 'letter';
  /** Pixel multiplier on a 150 dpi page (default 2 → 300 dpi). */
  scale?: number;
  theme?: Theme | ThemeName;
  accent?: string;
  factory?: CanvasFactory;
};

/** Page size in px at 150 dpi. */
export const PAPER_PX = { a4: { w: 1240, h: 1754 }, letter: { w: 1275, h: 1650 } } as const;

/**
 * Render a printable portrait drill card: title and meta, the drill diagram (start positions with
 * every step's paths), then setup + steps beside coaching points + equipment.
 */
export async function renderDrillCard(o: DrillCardOptions): Promise<Blob> {
  const k = o.scale ?? 2;
  const page = PAPER_PX[o.paper];
  const W = Math.round(page.w * k);
  const H = Math.round(page.h * k);
  const canvas = (o.factory ?? defaultCanvasFactory)(W, H);
  const ctx = context2d(canvas);
  const u = W / 1240;
  const ink = '#111827';
  const muted = '#4b5563';
  const accent = attackColours(o.accent ?? '#1d4ed8');
  const theme = resolveTheme(o.theme ?? 'print');
  const m = 72 * u;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ink;
  ctx.font = font(800, 54 * u);
  const [title] = wrapText(ctx, o.title, W - 2 * m, 1);
  ctx.fillText(title ?? '', m, m + 44 * u);
  let y = m + 60 * u;
  if (o.meta.length) {
    ctx.font = font(500, 26 * u);
    ctx.fillStyle = muted;
    const [metaLine] = wrapText(ctx, o.meta.join('  ·  '), W - 2 * m, 1);
    ctx.fillText(metaLine ?? '', m, y + 30 * u);
    y += 44 * u;
  }
  ctx.fillStyle = accent.fill;
  ctx.fillRect(m, y + 14 * u, 120 * u, 8 * u);
  y += 44 * u;

  const diagramH = H * 0.42;
  fillRound(ctx, m, y, W - 2 * m, diagramH, 20 * u, theme.surround);
  drawSceneInRect(
    ctx,
    o.play,
    overviewScene(o.play),
    { x: m, y, w: W - 2 * m, h: diagramH },
    theme,
    o.accent ?? '#1d4ed8',
    { padding: 16 * u },
  );
  y += diagramH + 48 * u;

  const colW = (W - 2 * m - 48 * u) / 2;
  const bottom = H - m - 30 * u;
  const heading = (text: string, x: number, yy: number) => {
    ctx.font = font(800, 30 * u);
    ctx.fillStyle = ink;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text.toUpperCase(), x, yy + 28 * u);
    return yy + 50 * u;
  };
  const para = (text: string, x: number, yy: number, w: number, bullet?: string) => {
    ctx.font = font(450, 25 * u);
    ctx.fillStyle = ink;
    const indent = bullet ? 34 * u : 0;
    const maxLines = Math.max(1, Math.floor((bottom - yy) / (35 * u)));
    const lines = wrapText(ctx, text, w - indent, Math.min(maxLines, 12));
    if (bullet && lines.length) {
      ctx.font = font(800, 25 * u);
      ctx.fillStyle = accent.fill;
      ctx.fillText(bullet, x, yy + 26 * u);
      ctx.font = font(450, 25 * u);
      ctx.fillStyle = ink;
    }
    lines.forEach((l, i) => ctx.fillText(l, x + indent, yy + 26 * u + i * 35 * u));
    return yy + lines.length * 35 * u + 12 * u;
  };

  // Left column: setup, then the step-by-step captions.
  let ly = y;
  const lx = m;
  if (o.setup) {
    ly = heading('Setup', lx, ly);
    ly = para(o.setup, lx, ly, colW) + 16 * u;
  }
  const steps = o.play.frames.map((f) => f.caption).filter((c): c is string => !!c);
  if (steps.length && ly < bottom - 80 * u) {
    ly = heading('Steps', lx, ly);
    for (let i = 0; i < steps.length && ly < bottom - 30 * u; i++)
      ly = para(steps[i] as string, lx, ly, colW, `${i + 1}.`);
  }

  // Right column: coaching points, then equipment.
  const rx = m + colW + 48 * u;
  let ry = y;
  if (o.coachingPoints.length) {
    ry = heading('Coaching points', rx, ry);
    for (const p of o.coachingPoints) {
      if (ry > bottom - 30 * u) break;
      ry = para(p, rx, ry, colW, '•');
    }
    ry += 16 * u;
  }
  const eq = Object.entries(o.equipment).filter(([, n]) => n > 0);
  if (eq.length && ry < bottom - 80 * u) {
    ry = heading('Equipment', rx, ry);
    for (const [key, n] of eq) {
      if (ry > bottom - 30 * u) break;
      const label = EQUIPMENT_LABELS[key as EquipmentItem] ?? key.replace(/_/g, ' ');
      ry = para(`${label} × ${n}`, rx, ry, colW, '•');
    }
  }
  drawBrandMark(ctx, W, H, ink, u);
  return canvasToBlob(canvas, 'image/png');
}
