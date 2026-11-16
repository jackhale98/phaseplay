/**
 * A canvas "stage" shared by the player, thumbnails and the editor: device-pixel sizing, the
 * pitch ↔ screen transform, the cached background layer, and one draw per call (no loop here —
 * callers run requestAnimationFrame only while playing or dragging).
 */
import type { Play, Vec2, Viewport } from '@phaseplay/shared';
import { sample, type Scene } from '@phaseplay/diagram/sample';
import { draw } from '@phaseplay/diagram/draw';
import { getPitchLayer } from '@phaseplay/diagram/pitch';
import { resolveTheme, type Theme, type ThemeName } from '@phaseplay/diagram/themes';
import {
  bestOrientation,
  makeTransform,
  playBounds,
  playViewport,
  type Orientation,
  type Transform,
} from '@phaseplay/diagram/viewport';

export type StageTheme = Theme | ThemeName;
export type PaintOptions = {
  highlightMemberId?: string;
  showTrails?: boolean;
  /** Skip the cached background layer (draw it directly) — used while zooming. */
  direct?: boolean;
};

export const DEFAULT_ACCENT = '#1f6f43';

export class Stage {
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  cssW = 0;
  cssH = 0;
  theme: Theme;
  accent: string;
  padding: number;
  /** Override the play's viewport (editor zoom/pan). */
  viewport: Viewport | null = null;
  /** Lock the orientation (editor), else pick the best for the box. */
  orientation: Orientation | null = null;
  scene: Scene | undefined;
  private t: Transform | null = null;
  private tKey = '';

  constructor(
    readonly canvas: HTMLCanvasElement,
    o: { theme?: StageTheme; accent?: string; padding?: number } = {},
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.theme = resolveTheme(o.theme ?? 'grass');
    this.accent = o.accent ?? DEFAULT_ACCENT;
    this.padding = o.padding ?? 8;
  }

  /** Resize to a CSS box. Returns true when the backing store changed. */
  resize(cssW: number, cssH: number): boolean {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    this.t = null;
    return true;
  }

  baseViewport(play: Play): Viewport {
    return fitViewport(play);
  }

  orientationFor(play: Play): Orientation {
    return (
      this.orientation ??
      bestOrientation(this.baseViewport(play), this.canvas.width, this.canvas.height)
    );
  }

  transform(play: Play): Transform {
    const vp = this.viewport ?? this.baseViewport(play);
    const o = this.orientationFor(play);
    const key = `${this.canvas.width}x${this.canvas.height}|${o}|${vp.x},${vp.y},${vp.w},${vp.h}|${this.padding}`;
    if (this.t && key === this.tKey) return this.t;
    this.tKey = key;
    this.t = makeTransform({
      viewport: vp,
      width: this.canvas.width,
      height: this.canvas.height,
      orientation: o,
      padding: this.padding * this.dpr,
    });
    return this.t;
  }

  /** Sample at `tMs` and draw. Returns the scene (reused between calls). */
  paint(play: Play, tMs: number, o: PaintOptions = {}): Scene {
    this.scene = sample(play, tMs, this.scene);
    this.paintScene(play, this.scene, o);
    return this.scene;
  }

  paintScene(play: Play, scene: Scene, o: PaintOptions = {}): void {
    if (!this.cssW) return;
    const t = this.transform(play);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.theme.surround ?? '#2f6b3a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const layer = o.direct ? undefined : getPitchLayer(t, this.theme, play.background);
    draw(ctx, scene, {
      theme: this.theme,
      transform: t,
      accent: this.accent,
      highlightMemberId: o.highlightMemberId,
      showTrails: o.showTrails ?? true,
      pitchLayer: layer,
      background: play.background,
    });
  }

  /** Client (CSS px) coordinates → pitch metres. */
  toPitch(play: Play, clientX: number, clientY: number): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return this.transform(play).toPitch({
      x: (clientX - r.left) * this.dpr,
      y: (clientY - r.top) * this.dpr,
    });
  }

  /** Pitch metres → CSS px relative to the canvas. */
  toCss(play: Play, p: Vec2): Vec2 {
    const s = this.transform(play).toScreen(p);
    return { x: s.x / this.dpr, y: s.y / this.dpr };
  }

  /** Metres per CSS pixel at the current zoom. */
  metresPerPx(play: Play): number {
    return this.dpr / this.transform(play).scale;
  }
}

export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The play's viewport, grown to include every token in every frame so nothing is off-screen. */
export function fitViewport(play: Play): Viewport {
  const base = playViewport(play);
  const bounds = playBounds(play);
  let x0 = base.x;
  let y0 = base.y;
  let x1 = base.x + base.w;
  let y1 = base.y + base.h;
  for (const f of play.frames)
    for (const p of Object.values(f.pos)) {
      x0 = Math.min(x0, p.x - 3);
      y0 = Math.min(y0, p.y - 3);
      x1 = Math.max(x1, p.x + 3);
      y1 = Math.max(y1, p.y + 3);
    }
  x0 = Math.max(x0, bounds.x);
  y0 = Math.max(y0, bounds.y);
  x1 = Math.min(x1, bounds.x + bounds.w);
  y1 = Math.min(y1, bounds.y + bounds.h);
  if (x0 === base.x && y0 === base.y && x1 === base.x + base.w && y1 === base.y + base.h)
    return base;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * A viewport framing everything that happens in the play (all frames' positions plus margin),
 * inside the play's own viewport — so thumbnails show the action, not an empty pitch.
 */
export function contentViewport(play: Play, margin = 6): Viewport {
  const base = playViewport(play);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const f of play.frames)
    for (const p of Object.values(f.pos)) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  if (!Number.isFinite(x0)) return base;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const w = Math.min(base.w, Math.max(24, x1 - x0 + 2 * margin));
  const h = Math.min(base.h, Math.max(18, y1 - y0 + 2 * margin));
  const x = Math.min(base.x + base.w - w, Math.max(base.x, cx - w / 2));
  const y = Math.min(base.y + base.h - h, Math.max(base.y, cy - h / 2));
  return { x, y, w, h };
}
