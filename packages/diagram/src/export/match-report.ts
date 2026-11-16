/**
 * Match report image (square 1080×1080 or story 1080×1920): score, scorers with minutes, cards,
 * a score-progression step chart and the penalty count, in team colours.
 */
import { initials } from '@phaseplay/shared';
import { type Ctx2D, canvasToBlob, context2d, defaultCanvasFactory, ellipsise } from '../canvas';
import { textOn } from '../themes';
import { drawBrandMark, drawCrest, fillRound, font } from './common';
import {
  type ImageRenderOptions,
  type SheetTeam,
  paintTeamBackground,
  shortPlayerName,
  teamColours,
} from './sheet';

export type MatchReportInput = {
  template: 'square' | 'story';
  team: SheetTeam;
  opponent: string;
  score: { us: number; them: number };
  /** e.g. "Win", "Loss", "Draw" or "Bonus-point win". */
  result: string;
  scorers: { minute: number; name: string; type: string; team: 'us' | 'them' }[];
  cards: { minute: number; name: string; colour: 'yellow' | 'red' | string; team: 'us' | 'them' }[];
  progression: { minute: number; us: number; them: number }[];
  penalties: { for: number; against: number };
  /** Preformatted date. */
  date: string;
};

type Colours = ReturnType<typeof teamColours>;
type Rect = { x: number; y: number; w: number; h: number };

const THEM_LINE = 'rgba(255,255,255,0.6)';

/** Step chart of both scores over time, one shared y-axis, direct labels plus a legend. */
export function drawProgression(
  ctx: Ctx2D,
  r: Rect,
  input: MatchReportInput,
  c: Colours,
  k: number,
): void {
  const pts = [...input.progression].sort((a, b) => a.minute - b.minute);
  if (!pts.length || (pts[0] as { minute: number }).minute > 0)
    pts.unshift({ minute: 0, us: 0, them: 0 });
  const lastMin = Math.max(...pts.map((p) => p.minute), ...input.scorers.map((s) => s.minute), 1);
  const maxMin =
    lastMin <= 20
      ? Math.max(14, Math.ceil(lastMin / 2) * 2)
      : Math.max(80, Math.ceil(lastMin / 10) * 10);
  const top = Math.max(
    5,
    input.score.us,
    input.score.them,
    ...pts.map((p) => Math.max(p.us, p.them)),
  );
  const maxScore = Math.ceil(top / 10) * 10;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(800, 24 * k);
  ctx.fillStyle = c.muted;
  ctx.fillText('SCORE PROGRESSION', r.x, r.y + 22 * k);
  // Legend (identity never by colour alone: the opponent line is also dashed).
  const legend = (x: number, label: string, colour: string, dashed: boolean) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 4 * k;
    ctx.setLineDash(dashed ? [8 * k, 6 * k] : []);
    ctx.beginPath();
    ctx.moveTo(x, r.y + 14 * k);
    ctx.lineTo(x + 34 * k, r.y + 14 * k);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = font(600, 22 * k);
    ctx.fillStyle = c.ink;
    const t = ellipsise(ctx, label, 170 * k);
    ctx.fillText(t, x + 44 * k, r.y + 22 * k);
    return x + 44 * k + ctx.measureText(t).width + 28 * k;
  };
  const lx = legend(r.x + r.w * 0.42, input.team.shortName || input.team.name, c.ring, false);
  legend(lx, input.opponent, THEM_LINE, true);

  const plot = {
    x: r.x + 44 * k,
    y: r.y + 52 * k,
    w: r.w - 44 * k - 110 * k,
    h: r.h - 52 * k - 34 * k,
  };
  const X = (m: number) => plot.x + (Math.min(m, maxMin) / maxMin) * plot.w;
  const Y = (s: number) => plot.y + plot.h - (s / maxScore) * plot.h;
  // Recessive grid and axes.
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = Math.max(1, 1.5 * k);
  ctx.font = font(500, 20 * k);
  ctx.fillStyle = c.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const s of [0, maxScore / 2, maxScore]) {
    ctx.beginPath();
    ctx.moveTo(plot.x, Y(s));
    ctx.lineTo(plot.x + plot.w, Y(s));
    ctx.stroke();
    ctx.fillText(String(s), plot.x - 10 * k, Y(s));
  }
  ctx.setLineDash([6 * k, 6 * k]);
  ctx.beginPath();
  ctx.moveTo(X(maxMin / 2), plot.y);
  ctx.lineTo(X(maxMin / 2), plot.y + plot.h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText("0'", X(0), plot.y + plot.h + 8 * k);
  ctx.fillText('HT', X(maxMin / 2), plot.y + plot.h + 8 * k);
  ctx.fillText(`${maxMin}'`, X(maxMin), plot.y + plot.h + 8 * k);

  const endMin = Math.max(lastMin, (pts[pts.length - 1] as { minute: number }).minute);
  const series = (key: 'us' | 'them', colour: string, dashed: boolean) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = (dashed ? 4 : 5) * k;
    ctx.lineJoin = 'round';
    ctx.setLineDash(dashed ? [10 * k, 7 * k] : []);
    ctx.beginPath();
    let prev = (pts[0] as { us: number; them: number })[key];
    ctx.moveTo(X(0), Y(prev));
    for (const p of pts) {
      ctx.lineTo(X(p.minute), Y(prev));
      ctx.lineTo(X(p.minute), Y(p[key]));
      prev = p[key];
    }
    ctx.lineTo(X(endMin), Y(prev));
    ctx.stroke();
    ctx.setLineDash([]);
    return prev;
  };
  const usEnd = series('us', c.ring, false);
  const themEnd = series('them', THEM_LINE, true);
  // Direct end labels in ink, nudged apart when close.
  let yu = Y(usEnd);
  let yt = Y(themEnd);
  const minGap = 28 * k;
  if (Math.abs(yu - yt) < minGap) {
    const mid = (yu + yt) / 2;
    const up = usEnd >= themEnd ? -1 : 1;
    yu = mid + (up * minGap) / 2;
    yt = mid - (up * minGap) / 2;
  }
  ctx.font = font(800, 24 * k);
  ctx.fillStyle = c.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `${initials(input.team.shortName || input.team.name)} ${usEnd}`,
    X(endMin) + 12 * k,
    yu,
  );
  ctx.fillText(`${initials(input.opponent)} ${themEnd}`, X(endMin) + 12 * k, yt);
}

function drawScorers(
  ctx: Ctx2D,
  r: Rect,
  list: MatchReportInput['scorers'],
  c: Colours,
  k: number,
  align: 'left' | 'right',
): void {
  const rowH = 38 * k;
  const rows = [...list].sort((a, b) => a.minute - b.minute);
  const max = Math.floor(r.h / rowH);
  const shown = rows.length > max ? rows.slice(0, max - 1) : rows;
  ctx.textBaseline = 'middle';
  shown.forEach((s, i) => {
    const y = r.y + i * rowH + rowH / 2;
    const minute = `${s.minute}'`;
    ctx.font = font(800, 24 * k);
    ctx.textAlign = align;
    const x0 = align === 'left' ? r.x : r.x + r.w;
    ctx.fillStyle = c.ink;
    ctx.fillText(minute, x0, y);
    const off = 64 * k;
    ctx.font = font(600, 24 * k);
    const type = s.type.toUpperCase();
    ctx.font = font(700, 18 * k);
    const typeW = ctx.measureText(type).width + 16 * k;
    ctx.font = font(600, 24 * k);
    const name = ellipsise(ctx, shortPlayerName(s.name), r.w - off - typeW - 12 * k);
    const nameW = ctx.measureText(name).width;
    const nx = align === 'left' ? x0 + off : x0 - off;
    ctx.fillText(name, nx, y);
    const px = align === 'left' ? nx + nameW + 10 * k : nx - nameW - 10 * k - typeW;
    fillRound(ctx, px, y - 13 * k, typeW, 26 * k, 13 * k, 'rgba(255,255,255,0.16)');
    ctx.font = font(700, 18 * k);
    ctx.fillStyle = c.ink;
    ctx.textAlign = 'center';
    ctx.fillText(type, px + typeW / 2, y + 1);
  });
  if (shown.length < rows.length) {
    ctx.font = font(600, 22 * k);
    ctx.fillStyle = c.muted;
    ctx.textAlign = align;
    ctx.fillText(
      `+${rows.length - shown.length} more`,
      align === 'left' ? r.x : r.x + r.w,
      r.y + shown.length * rowH + rowH / 2,
    );
  }
}

function drawCards(ctx: Ctx2D, r: Rect, input: MatchReportInput, c: Colours, k: number): void {
  if (!input.cards.length) return;
  let x = r.x;
  let y = r.y;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const card of [...input.cards].sort((a, b) => a.minute - b.minute)) {
    ctx.font = font(600, 22 * k);
    const label = `${card.minute}' ${shortPlayerName(card.name)}${card.team === 'them' ? ` (${initials(input.opponent)})` : ''}`;
    const w = 26 * k + ctx.measureText(label).width + 30 * k;
    if (x + w > r.x + r.w) {
      x = r.x;
      y += 40 * k;
      if (y > r.y + r.h) break;
    }
    const colour =
      card.colour === 'red' ? '#dc2626' : card.colour === 'yellow' ? '#facc15' : card.colour;
    fillRound(ctx, x, y - 14 * k, 20 * k, 28 * k, 3 * k, colour);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1.5 * k;
    ctx.strokeRect(x, y - 14 * k, 20 * k, 28 * k);
    ctx.fillStyle = c.ink;
    ctx.fillText(label, x + 28 * k, y);
    x += w;
  }
}

/** Paint the match report into a W×H context. */
export function paintMatchReport(ctx: Ctx2D, W: number, H: number, input: MatchReportInput): void {
  const c = teamColours(input.team);
  const k = W / 1080;
  const story = input.template === 'story';
  paintTeamBackground(ctx, W, H, c);
  const m = 60 * k;
  const L = story
    ? {
        label: 110,
        crestY: 330,
        crest: 220,
        score: 600,
        scorePx: 190,
        names: 470,
        lists: 760,
        listH: 470,
        cards: 1290,
        chart: 1400,
        chartH: 340,
        pens: 1810,
      }
    : {
        label: 70,
        crestY: 230,
        crest: 150,
        score: 250,
        scorePx: 140,
        names: 345,
        lists: 420,
        listH: 250,
        cards: 700,
        chart: 760,
        chartH: 230,
        pens: 1032,
      };

  // Header: FULL TIME + result pill, date on the right.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(800, 28 * k);
  ctx.fillStyle = c.muted;
  ctx.fillText('FULL TIME', m, L.label * k);
  const ftW = ctx.measureText('FULL TIME').width;
  ctx.font = font(800, 26 * k);
  const res = input.result.toUpperCase();
  const rw = ctx.measureText(res).width + 32 * k;
  fillRound(ctx, m + ftW + 20 * k, L.label * k - 20 * k, rw, 40 * k, 20 * k, c.ring);
  ctx.fillStyle = textOn(c.ring);
  ctx.fillText(res, m + ftW + 36 * k, L.label * k + 1);
  ctx.textAlign = 'right';
  ctx.font = font(600, 26 * k);
  ctx.fillStyle = c.muted;
  ctx.fillText(input.date, W - m - 250 * k, L.label * k);

  // Scoreboard.
  const crestX = [W * 0.2, W * 0.8];
  drawCrest(ctx, crestX[0] as number, L.crestY * k, L.crest * k, {
    ...c.crest,
    text: initials(input.team.shortName || input.team.name, 3),
  });
  drawCrest(
    ctx,
    crestX[1] as number,
    L.crestY * k,
    L.crest * k,
    { text: initials(input.opponent, 3), bg: '#e5e7eb', fg: '#111827' },
    'circle',
  );
  ctx.font = font(700, 30 * k);
  ctx.fillStyle = c.ink;
  ctx.textAlign = 'center';
  ctx.fillText(ellipsise(ctx, input.team.name, W * 0.36), crestX[0] as number, L.names * k);
  ctx.fillText(ellipsise(ctx, input.opponent, W * 0.36), crestX[1] as number, L.names * k);
  ctx.font = font(900, L.scorePx * k);
  ctx.fillText(`${input.score.us}–${input.score.them}`, W / 2, (story ? L.score : L.crestY) * k);

  // Scorers, us on the left, them on the right.
  const half = (W - 2 * m - 40 * k) / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(W / 2 - 1 * k, L.lists * k, 2 * k, L.listH * k);
  drawScorers(
    ctx,
    { x: m, y: L.lists * k, w: half, h: L.listH * k },
    input.scorers.filter((s) => s.team === 'us'),
    c,
    k,
    'left',
  );
  drawScorers(
    ctx,
    { x: W - m - half, y: L.lists * k, w: half, h: L.listH * k },
    input.scorers.filter((s) => s.team === 'them'),
    c,
    k,
    'right',
  );
  drawCards(ctx, { x: m, y: L.cards * k, w: W - 2 * m, h: 80 * k }, input, c, k);
  drawProgression(ctx, { x: m, y: L.chart * k, w: W - 2 * m, h: L.chartH * k }, input, c, k);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(800, 24 * k);
  ctx.fillStyle = c.muted;
  ctx.fillText('PENALTIES', m, L.pens * k);
  const pw = ctx.measureText('PENALTIES').width;
  ctx.font = font(700, 26 * k);
  ctx.fillStyle = c.ink;
  ctx.fillText(
    `${input.penalties.for} for  ·  ${input.penalties.against} against`,
    m + pw + 18 * k,
    L.pens * k,
  );
  drawBrandMark(ctx, W, H, c.ink, k);
}

/** Render the match report PNG (1080×1080 or 1080×1920, × scale; default scale 1). */
export async function renderMatchReport(
  input: MatchReportInput,
  opts: ImageRenderOptions = {},
): Promise<Blob> {
  const k = opts.scale ?? 1;
  const W = Math.round(1080 * k);
  const H = Math.round((input.template === 'story' ? 1920 : 1080) * k);
  const canvas = (opts.factory ?? defaultCanvasFactory)(W, H);
  paintMatchReport(context2d(canvas), W, H, input);
  return canvasToBlob(canvas, 'image/png');
}
