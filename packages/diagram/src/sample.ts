/**
 * Deterministic animation sampling: `sample(play, tMs)` turns a Play into a Scene (every entity's
 * position, the ball, trails, caption and arrows) at a point in time.
 *
 * Plays are treated as immutable. Per-play precomputation (end positions, arc-length tables, ball
 * flights, trails) is memoised in a WeakMap keyed by the Play object, so editing must produce a new
 * Play object (history.ts does). Call `invalidate(play)` if you ever mutate one in place.
 */
import type { Arrow, Entity, EntityKind, Move, Play, Vec2 } from '@phaseplay/shared';
import {
  type ArcTable,
  type EaseName,
  buildArcTable,
  clamp,
  dist,
  ease,
  headingAtFraction,
  pointAtFraction,
  sampleCurve,
} from './geometry';
import { playBounds } from './viewport';

export type TrailStyle = 'run' | 'pass' | 'kick';

export type SceneEntity = {
  id: string;
  kind: EntityKind;
  pos: Vec2;
  entity: Entity;
  /** Direction of travel in pitch radians (atan2(dy, dx)) while moving. */
  heading?: number;
  moving: boolean;
};

export type SceneBall = {
  /** Id of the ball entity, when the play has one. */
  id?: string;
  /** Ground position (m). */
  pos: Vec2;
  /** Height above the ground (m); drawn as scale plus a ground shadow. */
  height: number;
  holder?: string;
  /** Set while the ball is travelling on its own. */
  flight?: 'pass' | 'kick' | 'run';
};

export type Trail = { id: string; style: TrailStyle; points: readonly Vec2[] };

export type Scene = {
  t: number;
  /** The frame being animated into (0 only at the very start). */
  frameIndex: number;
  /** Progress 0..1 through the current segment. */
  segmentT: number;
  /** Entities in draw order (zones first, labels last); the primary ball is in `ball` instead. */
  entities: SceneEntity[];
  ball: SceneBall | null;
  /** Ghost paths for the current segment. */
  trails: readonly Trail[];
  caption?: string;
  arrows: readonly Arrow[];
};

/** Where a held ball sits relative to its carrier (m). */
export const BALL_HOLD_OFFSET: Readonly<Vec2> = { x: 0.65, y: 0.45 };
/** Easing used when a move doesn't specify one. */
export const DEFAULT_EASE: EaseName = 'inOut';

const PASS_SPEED = 14; // m/s for implicit passes
const KICK_SPEED = 22;

type Seg = { table: ArcTable; delay: number; active: number; ease: EaseName; still: boolean };
type BallState = { holder?: string; at: Vec2 | null };
type Flight = {
  table: ArcTable;
  start: number;
  end: number;
  ease: EaseName;
  kind: 'pass' | 'kick' | 'run';
  peak: number;
};
type BallSeg = { from: BallState; to: BallState; flight: Flight | null };

type Compiled = {
  times: number[];
  total: number;
  index: Map<string, number>;
  order: number[];
  ballIdx: number;
  hasBall: boolean;
  ends: Vec2[][];
  segs: Seg[][];
  trails: Trail[][];
  ballStates: BallState[];
  ballSegs: (BallSeg | null)[];
  allTrails: Trail[];
};

const LAYER: Record<EntityKind, number> = {
  zone: 0,
  ladder: 1,
  hurdle: 1,
  marker: 1,
  cone: 1,
  gate: 1,
  pole: 1,
  shield: 1,
  bag: 1,
  tube: 1,
  scrum_machine: 1,
  ball: 1,
  player: 2,
  attack: 2,
  defence: 2,
  coach: 2,
  label: 3,
};
const PEOPLE = new Set<EntityKind>(['attack', 'defence', 'player', 'coach']);

const cache = new WeakMap<Play, Compiled>();

/** Drop memoised data for a play that was mutated in place. */
export function invalidate(play: Play): void {
  cache.delete(play);
}

const EMPTY_ARROWS: readonly Arrow[] = [];
const EMPTY_TRAILS: readonly Trail[] = [];

function trailStyle(kind: Move['kind'] | undefined): TrailStyle {
  return kind === 'pass' ? 'pass' : kind === 'kick' ? 'kick' : 'run';
}

/** Delays are capped at 90% of the frame so every move keeps a visible (continuous) motion. */
function clampDelay(delayMs: number | undefined, dur: number): number {
  return clamp(delayMs ?? 0, 0, dur * 0.9);
}

function compile(play: Play): Compiled {
  const hit = cache.get(play);
  if (hit) return hit;
  const { entities, frames } = play;
  const nE = entities.length;
  const bounds = playBounds(play);
  const centre = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };

  const times: number[] = [0];
  for (let i = 1; i < frames.length; i++)
    times.push((times[i - 1] as number) + Math.max(0, frames[i]?.durationMs ?? 0));
  const total = times[times.length - 1] ?? 0;

  const index = new Map<string, number>();
  entities.forEach((e, i) => index.set(e.id, i));
  const ballIdx = entities.findIndex((e) => e.kind === 'ball');
  const ballId = ballIdx >= 0 ? (entities[ballIdx] as Entity).id : undefined;
  const order = entities
    .map((e, i) => ({ i, l: LAYER[e.kind] }))
    .filter((o) => o.i !== ballIdx)
    .sort((a, b) => a.l - b.l || a.i - b.i)
    .map((o) => o.i);

  // End positions per frame, carrying the last known (or first known) position.
  const firstKnown = entities.map((e) => {
    for (const f of frames) if (f.pos[e.id]) return f.pos[e.id] as Vec2;
    return centre;
  });
  const ends: Vec2[][] = [];
  frames.forEach((f, fi) => {
    const row: Vec2[] = new Array(nE);
    for (let e = 0; e < nE; e++) {
      const id = (entities[e] as Entity).id;
      row[e] =
        f.pos[id] ?? (fi > 0 ? ((ends[fi - 1] as Vec2[])[e] as Vec2) : (firstKnown[e] as Vec2));
    }
    ends.push(row);
  });

  // Per-segment paths.
  const segs: Seg[][] = [];
  const trails: Trail[][] = [];
  frames.forEach((f, fi) => {
    const row: Seg[] = new Array(nE);
    const tr: Trail[] = [];
    const dur = Math.max(0, f.durationMs);
    for (let e = 0; e < nE; e++) {
      const ent = entities[e] as Entity;
      const p1 = (ends[fi] as Vec2[])[e] as Vec2;
      const p0 = fi > 0 ? ((ends[fi - 1] as Vec2[])[e] as Vec2) : p1;
      const move = fi > 0 ? f.moves[ent.id] : undefined;
      const ctrl = move?.ctrl ?? [];
      const still = fi === 0 || (dist(p0, p1) < 1e-9 && ctrl.length === 0);
      const delay = clampDelay(move?.delayMs, dur);
      const seg: Seg = {
        table: buildArcTable(p0, ctrl, p1),
        delay,
        active: dur - delay,
        ease: move?.ease ?? DEFAULT_EASE,
        still,
      };
      row[e] = seg;
      if (!still && e !== ballIdx && (move || PEOPLE.has(ent.kind)))
        tr.push({ id: ent.id, style: trailStyle(move?.kind), points: sampleCurve(seg.table, 16) });
    }
    segs.push(row);
    trails.push(tr);
  });

  const entityPosAt = (fi: number, e: number, tl: number, out: Vec2): Vec2 => {
    const seg = (segs[fi] as Seg[])[e] as Seg;
    if (seg.still) {
      out.x = seg.table.p1.x;
      out.y = seg.table.p1.y;
      return out;
    }
    const u = seg.active > 0 ? clamp((tl - seg.delay) / seg.active, 0, 1) : tl >= seg.delay ? 1 : 0;
    return pointAtFraction(seg.table, ease(seg.ease, u), out);
  };

  // Ball states per frame and flights per segment.
  const validHolder = (id: string | undefined) =>
    id && id !== ballId && index.has(id) ? id : undefined;
  const heldPos = (fi: number, holder: string): Vec2 => {
    const p = (ends[fi] as Vec2[])[index.get(holder) as number] as Vec2;
    return { x: p.x + BALL_HOLD_OFFSET.x, y: p.y + BALL_HOLD_OFFSET.y };
  };
  const stateEnd = (fi: number, s: BallState): Vec2 | null =>
    s.holder ? heldPos(fi, s.holder) : s.at;
  const hasBall =
    ballIdx >= 0 || frames.some((f) => !!(f.ball && (validHolder(f.ball.holder) || f.ball.at)));
  const ballStates: BallState[] = [];
  const ballSegs: (BallSeg | null)[] = [];
  if (hasBall) {
    frames.forEach((f, fi) => {
      const prev = fi > 0 ? (ballStates[fi - 1] as BallState) : null;
      const prevEnd = prev ? stateEnd(fi - 1, prev) : null;
      const holder = f.ball ? validHolder(f.ball.holder) : prev?.holder;
      const explicitPos = ballId !== undefined ? f.pos[ballId] : undefined;
      const at =
        f.ball?.at ??
        explicitPos ??
        prevEnd ??
        (ballIdx >= 0 ? ((ends[fi] as Vec2[])[ballIdx] as Vec2) : null);
      const state: BallState = holder ? { holder, at } : { at };
      ballStates.push(state);
      if (!prev) {
        ballSegs.push(null);
        return;
      }
      const dur = Math.max(0, f.durationMs);
      const move = ballId !== undefined ? f.moves[ballId] : undefined;
      const A = prev.holder;
      const B = state.holder;
      const explicit = move && (move.kind === 'pass' || move.kind === 'kick');
      const ground = move && (move.kind === 'run' || move.kind === 'carry');
      const p1 = stateEnd(fi, state);
      let flight: Flight | null = null;
      const followOnly = A && B && A === B && !explicit;
      const samePoint =
        !A && !B && (!prevEnd || !p1 || (dist(prevEnd, p1) < 1e-9 && !move?.ctrl?.length));
      if (!followOnly && !samePoint && p1) {
        let kind: Flight['kind'];
        if (explicit) kind = move.kind as 'pass' | 'kick';
        else if (ground || (!A && !B) || (!A && B)) kind = 'run';
        else if (A && B) kind = 'pass';
        else kind = prevEnd && p1 && dist(prevEnd, p1) > 15 ? 'kick' : 'pass';
        let start: number;
        if (move) start = clampDelay(move.delayMs, dur);
        else if (kind === 'run') start = 0;
        else {
          const d = prevEnd ? dist(prevEnd, p1) : 0;
          start =
            dur -
            clamp(
              (d / (kind === 'kick' ? KICK_SPEED : PASS_SPEED)) * 1000,
              Math.min(300, dur),
              dur,
            );
        }
        let p0: Vec2 | null = prevEnd;
        if (A) {
          const ap = entityPosAt(fi, index.get(A) as number, start, { x: 0, y: 0 });
          p0 = { x: ap.x + BALL_HOLD_OFFSET.x, y: ap.y + BALL_HOLD_OFFSET.y };
        }
        if (p0) {
          const d = dist(p0, p1);
          let ctrl = move?.ctrl ?? [];
          if (!ctrl.length && kind === 'pass' && d > 1) {
            // A slight lateral arc, kept inside the bounds so the convex hull stays in play.
            const mx = (p0.x + p1.x) / 2 - ((p1.y - p0.y) / d) * d * 0.12;
            const my = (p0.y + p1.y) / 2 + ((p1.x - p0.x) / d) * d * 0.12;
            ctrl = [
              {
                x: clamp(mx, bounds.x, bounds.x + bounds.w),
                y: clamp(my, bounds.y, bounds.y + bounds.h),
              },
            ];
          }
          const peak =
            kind === 'kick' ? clamp(d * 0.3, 2, 25) : kind === 'pass' ? Math.min(1.2, d * 0.06) : 0;
          flight = {
            table: buildArcTable(p0, ctrl, p1),
            start,
            end: dur,
            ease: move?.ease ?? (kind === 'run' ? DEFAULT_EASE : 'linear'),
            kind,
            peak,
          };
          if (d > 1e-6)
            (trails[fi] as Trail[]).push({
              id: ballId ?? 'ball',
              style: trailStyle(kind === 'run' ? 'run' : kind),
              points: sampleCurve(flight.table, 16),
            });
        }
      }
      ballSegs.push({ from: prev, to: state, flight });
    });
  }

  const compiled: Compiled = {
    times,
    total,
    index,
    order,
    ballIdx,
    hasBall,
    ends,
    segs,
    trails,
    ballStates,
    ballSegs,
    allTrails: trails.flat(),
  };
  // Expose the position evaluator to the sampler without re-creating closures per call.
  posEval.set(compiled, entityPosAt);
  cache.set(play, compiled);
  return compiled;
}
const posEval = new WeakMap<Compiled, (fi: number, e: number, tl: number, out: Vec2) => Vec2>();

/** Total animation length in ms (sum of durations of frames[1..]). */
export function totalDuration(play: Play): number {
  return compile(play).total;
}

/**
 * Time (ms) at which each frame's end positions are reached. frames[0] is at 0 (it has no
 * duration); frame i animates over [times[i-1], times[i]]. Seek to times[i] to show frame i.
 */
export function frameTimes(play: Play): number[] {
  return compile(play).times.slice();
}

/** Normalise a time: wrap for looping plays, clamp otherwise. */
export function normaliseTime(play: Play, tMs: number): number {
  const total = compile(play).total;
  if (!(total > 0) || !Number.isFinite(tMs)) return 0;
  if (play.loop && (tMs > total || tMs < 0)) {
    const m = ((tMs % total) + total) % total;
    return m === 0 && tMs > 0 ? total : m;
  }
  return clamp(tMs, 0, total);
}

/** Find the segment (frame index) for a normalised time. */
function segmentAt(c: Compiled, t: number): number {
  if (t <= 0 || c.times.length < 2) return 0;
  let lo = 1;
  let hi = c.times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t <= (c.times[mid] as number)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Sample the play at `tMs`. Pure and deterministic. Pass a previously returned Scene as `out` to
 * reuse its objects (the 60 fps render loop should); otherwise a fresh Scene is returned.
 */
export function sample(play: Play, tMs: number, out?: Scene): Scene {
  const c = compile(play);
  const evalPos = posEval.get(c) as (fi: number, e: number, tl: number, out: Vec2) => Vec2;
  const t = normaliseTime(play, tMs);
  const fi = segmentAt(c, t);
  const frame = play.frames[fi];
  const start = fi > 0 ? (c.times[fi - 1] as number) : 0;
  const dur = fi > 0 ? (c.times[fi] as number) - start : 0;
  const tl = t - start;
  const scene: Scene = out ?? {
    t: 0,
    frameIndex: 0,
    segmentT: 0,
    entities: [],
    ball: null,
    trails: EMPTY_TRAILS,
    arrows: EMPTY_ARROWS,
  };
  scene.t = t;
  scene.frameIndex = fi;
  scene.segmentT = dur > 0 ? clamp(tl / dur, 0, 1) : 1;
  scene.caption = frame?.caption;
  scene.arrows = frame?.arrows ?? EMPTY_ARROWS;
  scene.trails = fi > 0 ? (c.trails[fi] as Trail[]) : EMPTY_TRAILS;

  const list = scene.entities;
  list.length = c.order.length;
  const segRow = c.segs[fi] as Seg[];
  for (let k = 0; k < c.order.length; k++) {
    const e = c.order[k] as number;
    const ent = play.entities[e] as Entity;
    let se = list[k];
    if (!se || se.entity !== ent) {
      se = { id: ent.id, kind: ent.kind, pos: { x: 0, y: 0 }, entity: ent, moving: false };
      list[k] = se;
    }
    evalPos(fi, e, tl, se.pos);
    const seg = segRow[e] as Seg;
    const u = seg.active > 0 ? (tl - seg.delay) / seg.active : 1;
    se.moving = !seg.still && u > 0 && u < 1;
    if (se.moving) se.heading = headingAtFraction(seg.table, ease(seg.ease, u));
    else delete se.heading;
  }

  scene.ball = c.hasBall ? sampleBall(play, c, fi, tl, evalPos, scene.ball) : null;
  return scene;
}

function sampleBall(
  play: Play,
  c: Compiled,
  fi: number,
  tl: number,
  evalPos: (fi: number, e: number, tl: number, out: Vec2) => Vec2,
  reuse: SceneBall | null,
): SceneBall | null {
  const ballId = c.ballIdx >= 0 ? (play.entities[c.ballIdx] as Entity).id : undefined;
  const b: SceneBall = reuse ?? { pos: { x: 0, y: 0 }, height: 0 };
  if (ballId) b.id = ballId;
  else delete b.id;
  b.height = 0;
  delete b.flight;
  delete b.holder;
  const follow = (holder: string, at: number) => {
    evalPos(fi, c.index.get(holder) as number, at, b.pos);
    b.pos.x += BALL_HOLD_OFFSET.x;
    b.pos.y += BALL_HOLD_OFFSET.y;
    b.holder = holder;
  };
  const place = (p: Vec2 | null) => {
    if (!p) return false;
    b.pos.x = p.x;
    b.pos.y = p.y;
    return true;
  };
  const seg = c.ballSegs[fi];
  if (!seg) {
    const s = c.ballStates[fi];
    if (!s) return null;
    if (s.holder) follow(s.holder, tl);
    else if (!place(s.at)) return null;
    return b;
  }
  const { from, to, flight } = seg;
  if (!flight) {
    const holder = from.holder ?? to.holder;
    if (holder && (from.holder === to.holder || !from.holder || !to.holder)) follow(holder, tl);
    else if (!place(to.at ?? from.at)) return null;
    return b;
  }
  if (tl < flight.start) {
    if (from.holder) follow(from.holder, tl);
    else place(flight.table.p0);
    return b;
  }
  if (tl >= flight.end) {
    if (to.holder) follow(to.holder, tl);
    else place(flight.table.p1);
    return b;
  }
  const span = flight.end - flight.start;
  const u = ease(flight.ease, span > 0 ? (tl - flight.start) / span : 1);
  pointAtFraction(flight.table, u, b.pos);
  b.height = 4 * flight.peak * u * (1 - u);
  b.flight = flight.kind;
  return b;
}

/**
 * The starting formation with every segment's trails and every frame's arrows overlaid — a single
 * "whole drill/play at a glance" picture for drill cards and thumbnails.
 */
export function overviewScene(play: Play): Scene {
  const c = compile(play);
  const s = sample(play, 0);
  s.trails = c.allTrails;
  s.arrows = play.frames.flatMap((f) => f.arrows ?? []);
  s.caption = undefined;
  return s;
}

/** Resolved end positions of every entity at a frame (carrying last known positions). */
export function resolvedPositions(play: Play, frameIndex: number): Record<string, Vec2> {
  const c = compile(play);
  const row = c.ends[clamp(frameIndex, 0, c.ends.length - 1)] ?? [];
  const out: Record<string, Vec2> = {};
  play.entities.forEach((e, i) => {
    const p = row[i];
    if (p) out[e.id] = { x: p.x, y: p.y };
  });
  return out;
}

/** Resolved ball state at the end of a frame, as a Frame.ball value. */
export function resolvedBall(
  play: Play,
  frameIndex: number,
): { holder?: string; at?: Vec2 } | undefined {
  const c = compile(play);
  const s = c.ballStates[clamp(frameIndex, 0, c.ballStates.length - 1)];
  if (!s) return undefined;
  if (s.holder) return { holder: s.holder };
  return s.at ? { at: { x: s.at.x, y: s.at.y } } : undefined;
}
