/**
 * Canvas 2D renderer for one Scene. Shared by the editor, the viewer and every exporter.
 * Allocation-light: no per-frame arrays or closures, and no save/restore per entity.
 */
import type { Arrow, Entity } from '@phaseplay/shared';
import { type CanvasLike, type Ctx2D, roundRectPath } from './canvas';
import { type Background, drawPitch } from './pitch';
import type { Scene, SceneBall, SceneEntity, Trail, TrailStyle } from './sample';
import { FONT, type Theme, attackColours, textOn } from './themes';
import { TOKEN_RADIUS_M, type Transform } from './viewport';

export type DrawOptions = {
  theme: Theme;
  transform: Transform;
  /** Team accent (hex) for attackers. */
  accent: string;
  /** Squad member to emphasise ("highlight me"): ring on their token, bold trail. */
  highlightMemberId?: string;
  /** Ghost paths for the current segment (default true). */
  showTrails?: boolean;
  /**
   * Pre-rendered background from getPitchLayer(), drawn at (0,0). Omit to draw the background
   * on every call (slow path, fine for exports); pass null to draw no background at all.
   */
  pitchLayer?: CanvasLike | CanvasImageSource | null;
  /** Background for the slow path (defaults to a full pitch). */
  background?: Background;
  /** Override the token radius in device pixels. */
  tokenRadiusPx?: number;
};

/** Token radius in px: true size (TOKEN_RADIUS_M) but never smaller than ~1.8% of the short side. */
export function tokenRadiusPx(t: Transform, override?: number): number {
  if (override) return override;
  return Math.max(TOKEN_RADIUS_M * t.scale, 0.018 * Math.min(t.width, t.height), 4);
}

const TAU = Math.PI * 2;
const DASH_NONE: number[] = [];
const DASH_PASS = [0, 0];
const DASH_KICK = [0, 0];
let fontR = -1;
let fontNum = '';
let fontSmall = '';
let fontLabel = '';

function setFonts(r: number): void {
  if (r === fontR) return;
  fontR = r;
  fontNum = `700 ${Math.round(r * 1.02)}px ${FONT}`;
  fontSmall = `700 ${Math.max(8, Math.round(r * 0.62))}px ${FONT}`;
  fontLabel = `600 ${Math.max(9, Math.round(r * 0.85))}px ${FONT}`;
}

/** Draw one scene: background, zones, trails, arrows, equipment, tokens, ball, highlight. */
export function draw(ctx: Ctx2D, scene: Scene, o: DrawOptions): void {
  const t = o.transform;
  const th = o.theme;
  if (o.pitchLayer) ctx.drawImage(o.pitchLayer as CanvasImageSource, 0, 0);
  else if (o.pitchLayer === undefined) drawPitch(ctx, t, th, o.background);

  const r = tokenRadiusPx(t, o.tokenRadiusPx);
  setFonts(r);
  DASH_PASS[0] = r * 0.7;
  DASH_PASS[1] = r * 0.45;
  DASH_KICK[0] = 0.01;
  DASH_KICK[1] = r * 0.42;

  const ents = scene.entities;
  let highlightId: string | undefined;
  if (o.highlightMemberId)
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i] as SceneEntity;
      if (e.entity.memberId === o.highlightMemberId) highlightId = e.id;
    }

  ctx.globalAlpha = 1;
  ctx.setLineDash(DASH_NONE);
  ctx.lineJoin = 'round';

  let k = 0;
  for (; k < ents.length && (ents[k] as SceneEntity).kind === 'zone'; k++)
    drawZone(ctx, t, th, ents[k] as SceneEntity, r);

  if (o.showTrails !== false) {
    const trails = scene.trails;
    for (let i = 0; i < trails.length; i++) {
      const tr = trails[i] as Trail;
      const hi = highlightId !== undefined && tr.id === highlightId;
      const alpha = highlightId === undefined ? th.trailAlpha : hi ? 1 : th.trailAlpha * 0.4;
      drawTrail(ctx, t, th, tr, r, alpha, hi ? 1.9 : 1, hi ? th.highlight : undefined);
    }
  }
  const arrows = scene.arrows;
  for (let i = 0; i < arrows.length; i++) drawArrow(ctx, t, th, arrows[i] as Arrow, r);

  const attack = attackColours(o.accent);
  for (; k < ents.length; k++)
    drawEntity(ctx, t, th, ents[k] as SceneEntity, r, attack.fill, attack.text);
  // Role tags (e.g. lineout J / L) as small badges, after all tokens so neighbours can't cover them.
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i] as SceneEntity;
    if (e.entity.text && (e.kind === 'attack' || e.kind === 'defence' || e.kind === 'player'))
      drawRoleTag(ctx, t, th, e, r);
  }

  if (scene.ball) drawBall(ctx, t, th, scene.ball, r);

  if (highlightId !== undefined)
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i] as SceneEntity;
      if (e.id !== highlightId) continue;
      const x = t.sx(e.pos.x, e.pos.y);
      const y = t.sy(e.pos.x, e.pos.y);
      ctx.strokeStyle = th.highlight;
      ctx.lineWidth = Math.max(2, r * 0.28);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.55, 0, TAU);
      ctx.stroke();
    }
  ctx.globalAlpha = 1;
}

function dashFor(style: TrailStyle): number[] {
  return style === 'pass' ? DASH_PASS : style === 'kick' ? DASH_KICK : DASH_NONE;
}

function trailColour(th: Theme, style: TrailStyle): string {
  return style === 'pass' ? th.trail.pass : style === 'kick' ? th.trail.kick : th.trail.run;
}

function arrowHead(
  ctx: Ctx2D,
  x: number,
  y: number,
  fromX: number,
  fromY: number,
  size: number,
): void {
  const a = Math.atan2(y - fromY, x - fromX);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(a - 0.45), y - size * Math.sin(a - 0.45));
  ctx.lineTo(x - size * Math.cos(a + 0.45), y - size * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

function drawTrail(
  ctx: Ctx2D,
  t: Transform,
  th: Theme,
  tr: Trail,
  r: number,
  alpha: number,
  widthK: number,
  colour?: string,
): void {
  const pts = tr.points;
  const n = pts.length;
  if (n < 2) return;
  const c = colour ?? trailColour(th, tr.style);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = Math.max(1.5, r * 0.16) * widthK;
  ctx.lineCap = tr.style === 'kick' ? 'round' : 'butt';
  ctx.setLineDash(dashFor(tr.style));
  ctx.beginPath();
  const p0 = pts[0] as { x: number; y: number };
  ctx.moveTo(t.sx(p0.x, p0.y), t.sy(p0.x, p0.y));
  for (let i = 1; i < n; i++) {
    const p = pts[i] as { x: number; y: number };
    ctx.lineTo(t.sx(p.x, p.y), t.sy(p.x, p.y));
  }
  ctx.stroke();
  ctx.setLineDash(DASH_NONE);
  const a = pts[n - 2] as { x: number; y: number };
  const b = pts[n - 1] as { x: number; y: number };
  arrowHead(
    ctx,
    t.sx(b.x, b.y),
    t.sy(b.x, b.y),
    t.sx(a.x, a.y),
    t.sy(a.x, a.y),
    r * 0.75 * Math.sqrt(widthK),
  );
  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
}

function drawArrow(ctx: Ctx2D, t: Transform, th: Theme, a: Arrow, r: number): void {
  const c = trailColour(th, a.style);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.lineCap = a.style === 'kick' ? 'round' : 'butt';
  ctx.setLineDash(dashFor(a.style));
  const fx = t.sx(a.from.x, a.from.y);
  const fy = t.sy(a.from.x, a.from.y);
  const tx = t.sx(a.to.x, a.to.y);
  const ty = t.sy(a.to.x, a.to.y);
  const c0 = a.ctrl?.[0];
  const c1 = a.ctrl?.[1];
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  let lx = fx;
  let ly = fy;
  // The pitch→screen transform is affine, so control points map directly.
  if (c0 && c1) {
    ctx.bezierCurveTo(
      t.sx(c0.x, c0.y),
      t.sy(c0.x, c0.y),
      t.sx(c1.x, c1.y),
      t.sy(c1.x, c1.y),
      tx,
      ty,
    );
    lx = t.sx(c1.x, c1.y);
    ly = t.sy(c1.x, c1.y);
  } else if (c0) {
    ctx.quadraticCurveTo(t.sx(c0.x, c0.y), t.sy(c0.x, c0.y), tx, ty);
    lx = t.sx(c0.x, c0.y);
    ly = t.sy(c0.x, c0.y);
  } else ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.setLineDash(DASH_NONE);
  arrowHead(ctx, tx, ty, lx, ly, r * 0.8);
  ctx.lineCap = 'butt';
}

/** Trace a rectangle of w×h metres centred on (cx, cy), rotated `rot` degrees, in screen space. */
function rotRectPath(
  ctx: Ctx2D,
  t: Transform,
  cx: number,
  cy: number,
  w: number,
  h: number,
  rot: number,
): void {
  const a = (rot * Math.PI) / 180;
  const ux = Math.cos(a) * (w / 2);
  const uy = Math.sin(a) * (w / 2);
  const vx = -Math.sin(a) * (h / 2);
  const vy = Math.cos(a) * (h / 2);
  ctx.moveTo(t.sx(cx - ux - vx, cy - uy - vy), t.sy(cx - ux - vx, cy - uy - vy));
  ctx.lineTo(t.sx(cx + ux - vx, cy + uy - vy), t.sy(cx + ux - vx, cy + uy - vy));
  ctx.lineTo(t.sx(cx + ux + vx, cy + uy + vy), t.sy(cx + ux + vx, cy + uy + vy));
  ctx.lineTo(t.sx(cx - ux + vx, cy - uy + vy), t.sy(cx - ux + vx, cy - uy + vy));
  ctx.closePath();
}

function drawZone(ctx: Ctx2D, t: Transform, th: Theme, e: SceneEntity, r: number): void {
  const ent = e.entity;
  const w = ent.size?.w ?? 5;
  const h = ent.size?.h ?? 5;
  const rot = ent.size?.rot ?? 0;
  ctx.beginPath();
  rotRectPath(ctx, t, e.pos.x, e.pos.y, w, h, rot);
  if (ent.group) {
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = th.groups[ent.group];
  } else ctx.fillStyle = th.zone.fill;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ent.group ? th.groups[ent.group] : th.zone.stroke;
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  DASH_PASS[0] = r * 0.5;
  DASH_PASS[1] = r * 0.35;
  ctx.setLineDash(DASH_PASS);
  ctx.stroke();
  ctx.setLineDash(DASH_NONE);
  DASH_PASS[0] = r * 0.7;
  DASH_PASS[1] = r * 0.45;
  if (ent.text) {
    // Label just inside the edge nearest the top of the screen, shrunk to fit narrow zones.
    const cx = t.sx(e.pos.x, e.pos.y);
    const ax = t.sx(e.pos.x - w / 2, e.pos.y - h / 2);
    const bx = t.sx(e.pos.x + w / 2, e.pos.y + h / 2);
    const top = Math.min(
      t.sy(e.pos.x - w / 2, e.pos.y - h / 2),
      t.sy(e.pos.x + w / 2, e.pos.y + h / 2),
    );
    ctx.font = fontLabel;
    const tw = ctx.measureText(ent.text).width;
    const room = Math.abs(bx - ax) - r * 0.3;
    if (tw > room && room > 0)
      ctx.font = `600 ${Math.max(7, Math.floor((r * 0.85 * room) / tw))}px ${FONT}`;
    ctx.fillStyle = th.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(ent.text, cx, top + r * 0.35);
  }
}

function circle(ctx: Ctx2D, x: number, y: number, rad: number): void {
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, TAU);
}

function strokeFill(ctx: Ctx2D, fill: string, stroke: string, lw: number): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

function tokenText(ctx: Ctx2D, text: string, x: number, y: number, colour: string): void {
  ctx.font = fontNum;
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

const NEUTRAL_PLAYER = '#e5e7eb';

function drawEntity(
  ctx: Ctx2D,
  t: Transform,
  th: Theme,
  e: SceneEntity,
  r: number,
  attackFill: string,
  attackText: string,
): void {
  const ent: Entity = e.entity;
  const x = t.sx(e.pos.x, e.pos.y);
  const y = t.sy(e.pos.x, e.pos.y);
  const m = t.scale;
  const lw = Math.max(1, r * 0.12);
  switch (e.kind) {
    case 'attack': {
      circle(ctx, x, y, r);
      strokeFill(ctx, attackFill, th.tokenStroke, lw);
      if (ent.number !== undefined) tokenText(ctx, String(ent.number), x, y, attackText);
      break;
    }
    case 'defence': {
      ctx.beginPath();
      roundRectPath(ctx, x - r * 0.92, y - r * 0.92, r * 1.84, r * 1.84, r * 0.38);
      strokeFill(ctx, th.defence.fill, th.tokenStroke, lw);
      if (ent.number !== undefined) tokenText(ctx, String(ent.number), x, y, th.defence.text);
      break;
    }
    case 'player': {
      const fill = ent.group ? th.groups[ent.group] : NEUTRAL_PLAYER;
      circle(ctx, x, y, r);
      strokeFill(ctx, fill, th.tokenStroke, lw);
      const label = ent.number !== undefined ? String(ent.number) : (ent.group ?? '');
      if (label) tokenText(ctx, label, x, y, textOn(fill));
      break;
    }
    case 'coach': {
      circle(ctx, x, y, r);
      strokeFill(ctx, th.coach.fill, th.coach.text, lw * 1.4);
      tokenText(ctx, 'C', x, y, th.coach.text);
      break;
    }
    case 'cone': {
      const s = Math.max(0.35 * m, r * 0.5);
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.9, y + s * 0.7);
      ctx.lineTo(x - s * 0.9, y + s * 0.7);
      ctx.closePath();
      strokeFill(ctx, th.equipment.cone, th.tokenStroke, Math.max(1, lw * 0.6));
      break;
    }
    case 'marker': {
      const s = Math.max(0.3 * m, r * 0.42);
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * 0.62, 0, 0, TAU);
      strokeFill(ctx, th.equipment.marker, th.tokenStroke, Math.max(1, lw * 0.5));
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.32, s * 0.2, 0, 0, TAU);
      ctx.fillStyle = th.shadow;
      ctx.fill();
      break;
    }
    case 'pole': {
      const pw = Math.max(0.14 * m, r * 0.2, 2);
      const ph = Math.max(1.8 * m, r * 2.4);
      ctx.beginPath();
      ctx.ellipse(x, y, pw * 1.6, pw * 0.8, 0, 0, TAU);
      ctx.fillStyle = th.shadow;
      ctx.fill();
      ctx.beginPath();
      roundRectPath(ctx, x - pw / 2, y - ph, pw, ph, pw / 2);
      strokeFill(ctx, th.equipment.pole, th.tokenStroke, Math.max(1, lw * 0.4));
      break;
    }
    case 'gate': {
      const w = ent.size?.w ?? 3;
      const a = ((ent.size?.rot ?? 0) * Math.PI) / 180;
      const dx = (Math.cos(a) * w) / 2;
      const dy = (Math.sin(a) * w) / 2;
      const ax = t.sx(e.pos.x - dx, e.pos.y - dy);
      const ay = t.sy(e.pos.x - dx, e.pos.y - dy);
      const bx = t.sx(e.pos.x + dx, e.pos.y + dy);
      const by = t.sy(e.pos.x + dx, e.pos.y + dy);
      ctx.strokeStyle = th.line;
      ctx.lineWidth = Math.max(1, lw * 0.6);
      ctx.globalAlpha = 0.7;
      DASH_KICK[1] = r * 0.3;
      ctx.setLineDash(DASH_KICK);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash(DASH_NONE);
      ctx.lineCap = 'butt';
      DASH_KICK[1] = r * 0.42;
      ctx.globalAlpha = 1;
      const s = Math.max(0.35 * m, r * 0.45);
      for (let i = 0; i < 2; i++) {
        const cx = i ? bx : ax;
        const cy = i ? by : ay;
        ctx.beginPath();
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx + s * 0.9, cy + s * 0.7);
        ctx.lineTo(cx - s * 0.9, cy + s * 0.7);
        ctx.closePath();
        strokeFill(ctx, th.equipment.cone, th.tokenStroke, Math.max(1, lw * 0.6));
      }
      break;
    }
    case 'shield': {
      const w = Math.max(1.0 * m, r * 1.5);
      const h = Math.max(0.6 * m, r * 0.9);
      ctx.beginPath();
      roundRectPath(ctx, x - w / 2, y - h / 2, w, h, h * 0.3);
      strokeFill(ctx, th.equipment.shield, th.tokenStroke, Math.max(1, lw * 0.6));
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, h * 0.12);
      ctx.beginPath();
      ctx.moveTo(x - w * 0.25, y);
      ctx.lineTo(x + w * 0.25, y);
      ctx.stroke();
      break;
    }
    case 'bag': {
      const w = Math.max(0.55 * m, r * 0.85);
      const h = Math.max(1.3 * m, r * 1.9);
      ctx.beginPath();
      roundRectPath(ctx, x - w / 2, y - h / 2, w, h, w / 2);
      strokeFill(
        ctx,
        th.equipment.bag,
        th.tokenStroke === th.equipment.bag ? '#ffffff' : th.tokenStroke,
        Math.max(1, lw * 0.6),
      );
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = Math.max(1, w * 0.08);
      ctx.beginPath();
      ctx.moveTo(x - w * 0.3, y - h * 0.18);
      ctx.lineTo(x + w * 0.3, y - h * 0.18);
      ctx.moveTo(x - w * 0.3, y + h * 0.18);
      ctx.lineTo(x + w * 0.3, y + h * 0.18);
      ctx.stroke();
      break;
    }
    case 'tube': {
      const s = Math.max(0.5 * m, r * 0.7);
      ctx.strokeStyle = th.equipment.tube;
      ctx.lineWidth = s * 0.5;
      circle(ctx, x, y, s * 0.75);
      ctx.stroke();
      ctx.strokeStyle = th.tokenStroke;
      ctx.lineWidth = Math.max(1, lw * 0.4);
      circle(ctx, x, y, s);
      ctx.stroke();
      break;
    }
    case 'ladder': {
      const w = ent.size?.w ?? 0.8;
      const h = ent.size?.h ?? 4.5;
      const rot = ent.size?.rot ?? 0;
      ctx.strokeStyle = th.equipment.ladder;
      ctx.lineWidth = Math.max(1.5, r * 0.14);
      ctx.beginPath();
      rotRectPath(ctx, t, e.pos.x, e.pos.y, w, h, rot);
      // Rungs every 0.5 m across the short side.
      const a = (rot * Math.PI) / 180;
      const ux = Math.cos(a) * (w / 2);
      const uy = Math.sin(a) * (w / 2);
      const vx = -Math.sin(a);
      const vy = Math.cos(a);
      const rungs = Math.max(1, Math.round(h / 0.5));
      for (let i = 1; i < rungs; i++) {
        const d = -h / 2 + (i * h) / rungs;
        const px = e.pos.x + vx * d;
        const py = e.pos.y + vy * d;
        ctx.moveTo(t.sx(px - ux, py - uy), t.sy(px - ux, py - uy));
        ctx.lineTo(t.sx(px + ux, py + uy), t.sy(px + ux, py + uy));
      }
      ctx.stroke();
      break;
    }
    case 'hurdle': {
      const w = Math.max((ent.size?.w ?? 1) * m, r * 1.4);
      const foot = Math.max(0.25 * m, r * 0.35);
      ctx.strokeStyle = th.tokenStroke;
      ctx.lineWidth = Math.max(3, r * 0.34);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y);
      ctx.lineTo(x + w / 2, y);
      ctx.stroke();
      ctx.strokeStyle = th.equipment.hurdle;
      ctx.lineWidth = Math.max(2, r * 0.2);
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y);
      ctx.lineTo(x + w / 2, y);
      ctx.moveTo(x - w / 2, y - foot);
      ctx.lineTo(x - w / 2, y + foot);
      ctx.moveTo(x + w / 2, y - foot);
      ctx.lineTo(x + w / 2, y + foot);
      ctx.stroke();
      ctx.lineCap = 'butt';
      break;
    }
    case 'scrum_machine': {
      const w = ent.size?.w ?? 3;
      const h = ent.size?.h ?? 1.6;
      const rot = ent.size?.rot ?? 0;
      ctx.beginPath();
      rotRectPath(ctx, t, e.pos.x, e.pos.y, w, h, rot);
      strokeFill(ctx, th.equipment.scrumMachine, th.tokenStroke, Math.max(1, lw * 0.6));
      // Three pads along the front (−y) edge.
      const a = (rot * Math.PI) / 180;
      ctx.fillStyle = '#e2e8f0';
      for (let i = 0; i < 3; i++) {
        const lx = -w / 2 + (w * (i + 0.5)) / 3;
        const ly = -h / 2 + h * 0.2;
        const px = e.pos.x + lx * Math.cos(a) - ly * Math.sin(a);
        const py = e.pos.y + lx * Math.sin(a) + ly * Math.cos(a);
        ctx.beginPath();
        rotRectPath(ctx, t, px, py, w / 4, h * 0.3, rot);
        ctx.fill();
      }
      break;
    }
    case 'label': {
      if (!ent.text) break;
      ctx.font = fontLabel;
      const tw = ctx.measureText(ent.text).width;
      const ph = r * 1.3;
      ctx.beginPath();
      roundRectPath(ctx, x - tw / 2 - r * 0.4, y - ph / 2, tw + r * 0.8, ph, ph / 2);
      ctx.fillStyle = th.label.bg;
      ctx.fill();
      ctx.fillStyle = th.label.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ent.text, x, y + 0.5);
      break;
    }
    case 'ball': {
      drawBallShape(ctx, th, x, y, Math.max(0.42 * m, r * 0.5), 0);
      break;
    }
    case 'zone':
      break;
  }
}

function drawRoleTag(ctx: Ctx2D, t: Transform, th: Theme, e: SceneEntity, r: number): void {
  const text = e.entity.text as string;
  const x = t.sx(e.pos.x, e.pos.y) + r * 0.78;
  const y = t.sy(e.pos.x, e.pos.y) + r * 0.78;
  ctx.font = fontSmall;
  const w = Math.max(r * 0.8, ctx.measureText(text).width + r * 0.36);
  const h = r * 0.8;
  ctx.beginPath();
  roundRectPath(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = th.label.bg;
  ctx.fill();
  ctx.fillStyle = th.label.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
}

function drawBallShape(
  ctx: Ctx2D,
  th: Theme,
  x: number,
  y: number,
  rb: number,
  height: number,
): void {
  if (height > 0.01) {
    ctx.beginPath();
    ctx.ellipse(x, y, rb * 1.1, rb * 0.6, 0, 0, TAU);
    ctx.fillStyle = th.shadow;
    ctx.fill();
  }
  const k = 1 + Math.min(1.2, height / 10);
  const lift = height * rb * 0.6;
  const bx = x;
  const by = y - lift;
  ctx.beginPath();
  ctx.ellipse(bx, by, rb * 1.3 * k, rb * 0.85 * k, -0.6, 0, TAU);
  ctx.fillStyle = th.ball;
  ctx.fill();
  ctx.strokeStyle = th.ballSeam;
  ctx.lineWidth = Math.max(1, rb * 0.22);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bx - Math.cos(-0.6) * rb * 0.7 * k, by - Math.sin(-0.6) * rb * 0.7 * k);
  ctx.lineTo(bx + Math.cos(-0.6) * rb * 0.7 * k, by + Math.sin(-0.6) * rb * 0.7 * k);
  ctx.lineWidth = Math.max(1, rb * 0.14);
  ctx.stroke();
}

function drawBall(ctx: Ctx2D, t: Transform, th: Theme, b: SceneBall, r: number): void {
  const x = t.sx(b.pos.x, b.pos.y);
  const y = t.sy(b.pos.x, b.pos.y);
  if (b.height <= 0.01) {
    // Grounded or carried: a soft contact shadow only.
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.12, r * 0.6, r * 0.32, 0, 0, TAU);
    ctx.fillStyle = th.shadow;
    ctx.fill();
  }
  drawBallShape(ctx, th, x, y, Math.max(0.42 * t.scale, r * 0.5), b.height);
}
