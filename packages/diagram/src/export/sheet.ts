/**
 * Team-sheet images for the team chat: story 1080×1920, square 1080×1080, landscape 1920×1080.
 * Team colours, a monogram crest, starters in formation on a mini pitch, and the bench.
 */
import { contrast, fillAccent, initials } from '@phaseplay/shared';
import {
  type CanvasFactory,
  type Ctx2D,
  canvasToBlob,
  context2d,
  defaultCanvasFactory,
  ellipsise,
  wrapText,
} from '../canvas';
import { type Monogram, drawBrandMark, drawCrest, fillRound, font, mix } from './common';

export type SheetTemplate = 'story' | 'square' | 'landscape';
export type SheetTeam = {
  name: string;
  shortName: string;
  primary: string;
  secondary: string;
  /** The team's uploaded emblem, drawn instead of the initials crest. */
  crest?: Monogram['image'];
};

export type TeamSheetInput = {
  template: SheetTemplate;
  team: SheetTeam;
  opponent?: string;
  /** Preformatted kickoff, e.g. "Sat 14 Mar · 15:00". */
  kickoff: string;
  venue?: string;
  format: '15s' | '7s';
  starters: { n: number; name: string; captain?: boolean; vice?: boolean }[];
  bench: { n: number; name: string }[];
};

export type ImageRenderOptions = { factory?: CanvasFactory; scale?: number };

export const SHEET_SIZES: Record<SheetTemplate, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
  landscape: { w: 1920, h: 1080 },
};

/** Normalised (0..1) formation spots on a half-pitch panel, front row at the top. */
export const FORMATIONS: Record<'15s' | '7s', Record<number, [number, number]>> = {
  '15s': {
    1: [0.28, 0.11],
    2: [0.5, 0.11],
    3: [0.72, 0.11],
    4: [0.38, 0.245],
    5: [0.62, 0.245],
    6: [0.15, 0.3],
    7: [0.85, 0.3],
    8: [0.5, 0.405],
    9: [0.34, 0.52],
    10: [0.64, 0.58],
    12: [0.38, 0.7],
    13: [0.62, 0.76],
    11: [0.12, 0.77],
    14: [0.88, 0.77],
    15: [0.5, 0.89],
  },
  '7s': {
    1: [0.24, 0.18],
    2: [0.5, 0.18],
    3: [0.76, 0.18],
    4: [0.5, 0.4],
    5: [0.3, 0.6],
    6: [0.6, 0.7],
    7: [0.85, 0.82],
  },
};

/** Background and ink derived from team colours, with AA contrast guaranteed. */
export function teamColours(team: Pick<SheetTeam, 'primary' | 'secondary' | 'crest'>) {
  const hex = (c: string, d: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : d);
  const primary = hex(team.primary, '#1d4ed8');
  const secondary = hex(team.secondary, '#facc15');
  let t = 0.2;
  let top = mix(primary, '#05070a', t);
  while (contrast(top, '#ffffff') < 4.5 && t < 0.95) top = mix(primary, '#05070a', (t += 0.05));
  let bottom = mix(primary, '#05070a', Math.min(0.92, t + 0.35));
  if (contrast(bottom, '#ffffff') < 7) bottom = mix(primary, '#05070a', 0.85);
  const token = fillAccent(primary);
  // Ring/highlight colour: secondary unless it vanishes against the token or background.
  const ring =
    contrast(secondary, token.bg) >= 1.8 && contrast(secondary, bottom) >= 1.8
      ? secondary
      : '#ffffff';
  const crest: Monogram = {
    text: '',
    image: team.crest ?? null,
    bg: token.bg,
    fg: contrast(secondary, token.bg) >= 3 ? secondary : token.fg,
  };
  /** Accent for small text on the background: the ring colour only when it reads (AA). */
  const accentText = contrast(ring, bottom) >= 4.5 && contrast(ring, top) >= 4.5 ? ring : '#ffffff';
  return {
    primary,
    secondary,
    top,
    bottom,
    ink: '#ffffff',
    muted: 'rgba(255,255,255,0.74)',
    token,
    ring,
    accentText,
    crest,
  };
}

/** Paint the team-colour gradient background with a diagonal secondary-colour sash. */
export function paintTeamBackground(
  ctx: Ctx2D,
  W: number,
  H: number,
  c: ReturnType<typeof teamColours>,
): void {
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, c.top);
  g.addColorStop(1, c.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const u = Math.min(W, H) / 1080;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = c.ring;
  ctx.beginPath();
  ctx.moveTo(W - 300 * u, 0);
  ctx.lineTo(W - 230 * u, 0);
  ctx.lineTo(W, 230 * u);
  ctx.lineTo(W, 300 * u);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(W - 200 * u, 0);
  ctx.lineTo(W - 180 * u, 0);
  ctx.lineTo(W, 180 * u);
  ctx.lineTo(W, 200 * u);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** "Jane Smith" → "J. Smith" for tight labels. */
export function shortPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  return `${(parts[0] as string)[0]}. ${parts.slice(1).join(' ')}`;
}

/** Fit a player name into maxW: full name, then shortened, shrinking font down to minPx. */
function fitName(
  ctx: Ctx2D,
  name: string,
  maxW: number,
  maxPx: number,
  minPx: number,
): { text: string; px: number } {
  for (const text of [name, shortPlayerName(name)]) {
    for (let px = maxPx; px >= minPx; px -= 1) {
      ctx.font = font(700, px);
      if (ctx.measureText(text).width <= maxW) return { text, px };
    }
  }
  ctx.font = font(700, minPx);
  return { text: ellipsise(ctx, shortPlayerName(name), maxW), px: minPx };
}

type Rect = { x: number; y: number; w: number; h: number };

/** A stylised half pitch with starters in formation. */
function drawFormation(
  ctx: Ctx2D,
  r: Rect,
  input: TeamSheetInput,
  c: ReturnType<typeof teamColours>,
): void {
  fillRound(ctx, r.x, r.y, r.w, r.h, r.w * 0.03, 'rgba(255,255,255,0.07)');
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(2, r.w * 0.003);
  const line = (fy: number, dashed = false) => {
    ctx.setLineDash(dashed ? [r.w * 0.015, r.w * 0.015] : []);
    ctx.beginPath();
    ctx.moveTo(r.x + r.w * 0.03, r.y + r.h * fy);
    ctx.lineTo(r.x + r.w * 0.97, r.y + r.h * fy);
    ctx.stroke();
  };
  line(0.03);
  line(0.2, true);
  line(0.6);
  line(0.95);
  ctx.setLineDash([]);
  // Posts on the try line.
  ctx.lineWidth = Math.max(3, r.w * 0.006);
  ctx.beginPath();
  ctx.moveTo(r.x + r.w * 0.46, r.y + r.h * 0.95);
  ctx.lineTo(r.x + r.w * 0.54, r.y + r.h * 0.95);
  ctx.stroke();

  const spots = FORMATIONS[input.format];
  const free = Object.keys(spots)
    .map(Number)
    .filter((n) => !input.starters.some((s) => s.n === n));
  const tokenR = r.w * 0.045;
  const labelW = r.w * 0.2;
  const sorted = [...input.starters].sort((a, b) => a.n - b.n);
  for (const s of sorted) {
    const spot = spots[s.n] ?? spots[free.shift() ?? -1];
    if (!spot) continue;
    const x = r.x + r.w * spot[0];
    const y = r.y + r.h * spot[1];
    ctx.beginPath();
    ctx.arc(x, y, tokenR + tokenR * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = c.ring;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, tokenR, 0, Math.PI * 2);
    ctx.fillStyle = c.token.bg;
    ctx.fill();
    ctx.fillStyle = c.token.fg;
    ctx.font = font(800, tokenR * 0.95);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(s.n), x, y + 1);
    if (s.captain || s.vice) {
      const br = tokenR * (s.vice ? 0.5 : 0.44);
      const bx = x + tokenR * 0.85;
      const by = y - tokenR * 0.85;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.fillStyle = '#0b0f0c';
      ctx.font = font(800, br * (s.vice ? 0.95 : 1.2));
      ctx.fillText(s.vice ? 'VC' : 'C', bx, by + 1);
    }
    const { text, px } = fitName(
      ctx,
      s.name,
      labelW,
      Math.round(tokenR * 0.62),
      Math.max(10, Math.round(tokenR * 0.42)),
    );
    const tw = ctx.measureText(text).width;
    const ly = y + tokenR * 1.3;
    fillRound(
      ctx,
      x - tw / 2 - px * 0.45,
      ly,
      tw + px * 0.9,
      px * 1.5,
      px * 0.75,
      'rgba(0,0,0,0.42)',
    );
    ctx.fillStyle = c.ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, ly + px * 0.78);
  }
}

function drawBench(
  ctx: Ctx2D,
  r: Rect,
  bench: TeamSheetInput['bench'],
  cols: number,
  rowH: number,
  c: ReturnType<typeof teamColours>,
): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = c.muted;
  ctx.font = font(800, rowH * 0.56);
  ctx.fillText('REPLACEMENTS', r.x, r.y + rowH * 0.6);
  ctx.fillStyle = c.ring;
  ctx.fillRect(r.x, r.y + rowH * 0.85, rowH * 1.6, Math.max(3, rowH * 0.08));
  const perCol = Math.ceil(bench.length / cols);
  const colW = r.w / cols;
  bench.forEach((b, i) => {
    const x = r.x + Math.floor(i / perCol) * colW;
    const y = r.y + rowH * 1.4 + (i % perCol) * rowH;
    if (y + rowH > r.y + r.h + 1) return;
    ctx.font = font(800, rowH * 0.56);
    ctx.fillStyle = c.accentText;
    ctx.fillText(String(b.n), x, y + rowH * 0.62);
    ctx.font = font(600, rowH * 0.56);
    ctx.fillStyle = c.ink;
    ctx.fillText(ellipsise(ctx, b.name, colW - rowH * 1.4), x + rowH * 1.05, y + rowH * 0.62);
  });
}

/** Paint the header block (crest + title + details) into `r`; returns the bottom y. */
function drawSheetHeader(
  ctx: Ctx2D,
  r: Rect,
  input: TeamSheetInput,
  c: ReturnType<typeof teamColours>,
  crestSize: number,
  stacked: boolean,
  u: number,
): number {
  const crest: Monogram = {
    ...c.crest,
    text: initials(input.team.shortName || input.team.name, 3),
  };
  let tx = r.x;
  let ty = r.y;
  if (stacked) {
    drawCrest(ctx, r.x + crestSize * 0.45, r.y + crestSize / 2, crestSize, crest);
    ty = r.y + crestSize + 40 * u;
  } else {
    drawCrest(ctx, r.x + crestSize * 0.45, r.y + crestSize / 2, crestSize, crest);
    tx = r.x + crestSize + 32 * u;
  }
  const tw = r.x + r.w - tx;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = c.muted;
  ctx.font = font(700, 30 * u);
  ctx.fillText(ellipsise(ctx, input.team.name.toUpperCase(), tw), tx, ty + 34 * u);
  const title = input.opponent ? `Team to play ${input.opponent}` : 'Team sheet';
  const px = stacked ? 78 * u : 60 * u;
  ctx.font = font(850, px);
  ctx.fillStyle = c.ink;
  const lines = wrapText(ctx, title, tw, 2);
  lines.forEach((l, i) => ctx.fillText(l, tx, ty + 34 * u + px * 1.08 * (i + 1)));
  let y = ty + 34 * u + px * 1.08 * lines.length + 46 * u;
  ctx.font = font(600, 30 * u);
  ctx.fillStyle = c.ink;
  const details = [input.kickoff, input.venue, input.format].filter(Boolean).join('  ·  ');
  wrapText(ctx, details, tw, stacked ? 3 : 2).forEach((l, i) =>
    ctx.fillText(l, tx, y + i * 40 * u),
  );
  y += (stacked ? 3 : 1) * 40 * u;
  return Math.max(y, r.y + crestSize);
}

/** Paint a team sheet into a W×H context (W×H should match the template's aspect). */
export function paintTeamSheet(ctx: Ctx2D, W: number, H: number, input: TeamSheetInput): void {
  const c = teamColours(input.team);
  const u = Math.min(W, H) / 1080;
  paintTeamBackground(ctx, W, H, c);
  const benchCols = input.bench.length > 4 ? 2 : 1;
  if (input.template === 'story') {
    const k = W / 1080;
    const bottomHead = drawSheetHeader(
      ctx,
      { x: 70 * k, y: 80 * k, w: W - 330 * k, h: 300 * k },
      input,
      c,
      180 * k,
      false,
      k,
    );
    const benchH = 330 * k;
    const top = Math.max(bottomHead + 20 * k, 420 * k);
    drawFormation(
      ctx,
      { x: 60 * k, y: top, w: W - 120 * k, h: H - top - benchH - 70 * k },
      input,
      c,
    );
    drawBench(
      ctx,
      { x: 80 * k, y: H - benchH - 30 * k, w: W - 160 * k, h: benchH - 60 * k },
      input.bench,
      2,
      46 * k,
      c,
    );
  } else if (input.template === 'square') {
    const k = W / 1080;
    drawSheetHeader(
      ctx,
      { x: 50 * k, y: 44 * k, w: W - 300 * k, h: 170 * k },
      input,
      c,
      130 * k,
      false,
      k * 0.85,
    );
    drawFormation(ctx, { x: 40 * k, y: 250 * k, w: 600 * k, h: 790 * k }, input, c);
    drawBench(ctx, { x: 680 * k, y: 270 * k, w: 360 * k, h: 740 * k }, input.bench, 1, 46 * k, c);
  } else {
    const k = H / 1080;
    const bottomHead = drawSheetHeader(
      ctx,
      { x: 90 * k, y: 80 * k, w: 880 * k, h: 560 * k },
      input,
      c,
      190 * k,
      true,
      k,
    );
    drawBench(
      ctx,
      {
        x: 90 * k,
        y: Math.max(bottomHead + 30 * k, 700 * k),
        w: 880 * k,
        h: H - Math.max(bottomHead + 30 * k, 700 * k) - 70 * k,
      },
      input.bench,
      benchCols,
      46 * k,
      c,
    );
    drawFormation(ctx, { x: W - 860 * k, y: 50 * k, w: 790 * k, h: 980 * k }, input, c);
  }
  drawBrandMark(ctx, W, H, c.ink, u);
}

/** Render a team sheet PNG (template size × scale, default scale 1). */
export async function renderTeamSheet(
  input: TeamSheetInput,
  opts: ImageRenderOptions = {},
): Promise<Blob> {
  const size = SHEET_SIZES[input.template];
  const k = opts.scale ?? 1;
  const W = Math.round(size.w * k);
  const H = Math.round(size.h * k);
  const canvas = (opts.factory ?? defaultCanvasFactory)(W, H);
  paintTeamSheet(context2d(canvas), W, H, input);
  return canvasToBlob(canvas, 'image/png');
}
