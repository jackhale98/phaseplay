/**
 * Pure editor commands over an immutable Play (docs/diagrams.md §Editing model). Each returns a new
 * Play (or the same object when nothing changed, so History ignores no-ops).
 */
import type { Entity, Frame, Move, Play, Vec2 } from '@phaseplay/shared';
import type { Scene } from '@phaseplay/diagram/sample';
import { resolvedBall, resolvedPositions } from '@phaseplay/diagram/sample';
import { addFrame, nextEntityId, type PresetResult } from '@phaseplay/diagram/presets';
import { addPlayers } from '@phaseplay/diagram/drill-templates';
import { drillArea, inRotatedRect, playBounds } from '@phaseplay/diagram/viewport';

export type AddKind = Entity['kind'];

const PREFIX: Partial<Record<AddKind, string>> = {
  attack: 'a',
  defence: 'd',
  player: 'p',
  cone: 'c',
  marker: 'm',
  pole: 'po',
  gate: 'g',
  shield: 'sh',
  bag: 'bg',
  tube: 'tu',
  ladder: 'la',
  hurdle: 'hu',
  scrum_machine: 'sm',
  zone: 'z',
  label: 't',
  coach: 'co',
};
const PEOPLE = new Set<AddKind>(['attack', 'defence', 'player', 'coach']);
export const isPerson = (k: AddKind) => PEOPLE.has(k);

/** Default sizes (m) for entities that have one. */
export const DEFAULT_SIZE: Partial<Record<AddKind, { w: number; h: number; rot?: number }>> = {
  zone: { w: 10, h: 5 },
  gate: { w: 2, h: 0.6 },
  ladder: { w: 1, h: 4 },
  scrum_machine: { w: 3, h: 1.5 },
};

const round = (n: number, step: number) => Math.round(n / step) * step;
const clean = (p: Vec2): Vec2 => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) });

function withFrame(play: Play, fi: number, fn: (f: Frame) => Frame): Play {
  const f = play.frames[fi];
  if (!f) return play;
  const next = fn(f);
  if (next === f) return play;
  const frames = play.frames.slice();
  frames[fi] = next;
  return { ...play, frames };
}

/** Keep a point inside the play's bounds. */
export function clampToBounds(play: Play, p: Vec2): Vec2 {
  const b = playBounds(play);
  return {
    x: Math.min(b.x + b.w, Math.max(b.x, p.x)),
    y: Math.min(b.y + b.h, Math.max(b.y, p.y)),
  };
}

const PITCH_X = [0, 5, 15, 35, 55, 65, 70];
/** Try lines, dead-ball lines, 5 m dashes, 22s, 10 m lines and halfway. */
const PITCH_Y = [-10, 0, 5, 22, 40, 50, 60, 78, 95, 100, 110];

/**
 * Snap a point: drills to whole metres; plays to half metres, pulled onto nearby pitch lines
 * (touchlines, 5 m/15 m channels, try, 22, 10 m and halfway) within 0.75 m.
 */
export function snapPoint(play: Pick<Play, 'background'>, p: Vec2): Vec2 {
  if (drillArea(play)) return { x: round(p.x, 1), y: round(p.y, 1) };
  const near = (v: number, lines: number[]) => {
    let best = round(v, 0.5);
    let d = 0.75;
    for (const l of lines)
      if (Math.abs(l - v) < d) {
        d = Math.abs(l - v);
        best = l;
      }
    return best;
  };
  return { x: near(p.x, PITCH_X), y: near(p.y, PITCH_Y) };
}

/** Set one entity's end position in a frame. */
export function setPos(play: Play, fi: number, id: string, p: Vec2): Play {
  return withFrame(play, fi, (f) => ({ ...f, pos: { ...f.pos, [id]: clean(p) } }));
}

/** Move several entities by their own targets in one step (multi-select drag, nudge). */
export function setPositions(play: Play, fi: number, targets: Record<string, Vec2>): Play {
  const ids = Object.keys(targets);
  if (!ids.length) return play;
  return withFrame(play, fi, (f) => {
    const pos = { ...f.pos };
    for (const id of ids) pos[id] = clean(targets[id] as Vec2);
    const ball = play.entities.find((e) => e.kind === 'ball');
    // Dragging a loose ball moves its resting point.
    if (ball && targets[ball.id] && f.ball && !f.ball.holder)
      return { ...f, pos, ball: { at: clean(targets[ball.id] as Vec2) } };
    return { ...f, pos };
  });
}

/** A run (or carry) drawn as a stroke: new end position plus fitted control points. */
export function setRun(play: Play, fi: number, id: string, end: Vec2, ctrl: Vec2[]): Play {
  if (fi === 0) return setPos(play, 0, id, end);
  const holder = resolvedBall(play, fi)?.holder;
  const move: Move = { kind: holder === id ? 'carry' : 'run' };
  if (ctrl.length) move.ctrl = ctrl.map(clean);
  return withFrame(play, fi, (f) => ({
    ...f,
    pos: { ...f.pos, [id]: clean(end) },
    moves: { ...f.moves, [id]: move },
  }));
}

export function ballEntity(play: Play): Entity | undefined {
  return play.entities.find((e) => e.kind === 'ball');
}

/** Make sure a ball entity exists (presets have one; blank plays may not). */
function ensureBall(play: Play, at: Vec2): Play {
  if (ballEntity(play)) return play;
  const f0 = play.frames[0] as Frame;
  const frames = play.frames.slice();
  frames[0] = { ...f0, pos: { ...f0.pos, ball: clean(at) } };
  return { ...play, entities: [...play.entities, { id: 'ball', kind: 'ball' }], frames };
}

/** Pass (or kick) the ball to a player in frame `fi`. */
export function passTo(play: Play, fi: number, toId: string, kind: 'pass' | 'kick' = 'pass'): Play {
  if (fi === 0) return giveBall(play, 0, toId);
  let p = ensureBall(play, { x: 0, y: 0 });
  const ball = ballEntity(p) as Entity;
  p = withFrame(p, fi, (f) => {
    const pos = { ...f.pos };
    delete pos[ball.id];
    return { ...f, pos, ball: { holder: toId }, moves: { ...f.moves, [ball.id]: { kind } } };
  });
  return p;
}

/** Kick (or pass) the ball to a spot in frame `fi`. */
export function kickTo(play: Play, fi: number, at: Vec2, kind: 'pass' | 'kick' = 'kick'): Play {
  let p = ensureBall(play, at);
  const ball = ballEntity(p) as Entity;
  if (fi === 0)
    return withFrame(p, 0, (f) => ({
      ...f,
      pos: { ...f.pos, [ball.id]: clean(at) },
      ball: { at: clean(at) },
    }));
  p = withFrame(p, fi, (f) => ({
    ...f,
    pos: { ...f.pos, [ball.id]: clean(at) },
    ball: { at: clean(at) },
    moves: { ...f.moves, [ball.id]: { kind } },
  }));
  return p;
}

/** Put the ball in a player's hands at the end of frame `fi` without a flight move. */
export function giveBall(play: Play, fi: number, id: string): Play {
  const p = ensureBall(play, { x: 0, y: 0 });
  const ball = ballEntity(p) as Entity;
  return withFrame(p, fi, (f) => {
    const moves = { ...f.moves };
    delete moves[ball.id];
    return { ...f, ball: { holder: id }, moves };
  });
}

/** Next free shirt number for a side (1..99). */
export function nextNumber(play: Play, kind: 'attack' | 'defence' | 'player'): number {
  const used = new Set(play.entities.filter((e) => e.kind === kind).map((e) => e.number));
  let n = 1;
  while (used.has(n) && n < 99) n++;
  return n;
}

/** Add an entity at `p` (in frame 0 so it exists from the start). Returns the play and the id. */
export function addEntity(
  play: Play,
  kind: AddKind,
  p: Vec2,
  extra: Partial<Entity> = {},
): { play: Play; id: string } {
  if (kind === 'ball') {
    const existing = ballEntity(play);
    if (existing) return { play: kickTo(play, 0, p), id: existing.id };
    const next = ensureBall(play, p);
    return { play: withFrame(next, 0, (f) => ({ ...f, ball: { at: clean(p) } })), id: 'ball' };
  }
  const e: Entity = { id: '', kind, ...extra };
  if ((kind === 'attack' || kind === 'defence') && e.number === undefined)
    e.number = nextNumber(play, kind);
  const pref = PREFIX[kind] ?? 'e';
  const want =
    (kind === 'attack' || kind === 'defence') && e.number !== undefined ? `${pref}${e.number}` : '';
  const used = new Set(play.entities.map((x) => x.id));
  e.id = want && !used.has(want) ? want : nextEntityId(play, pref);
  if (!e.size && DEFAULT_SIZE[kind])
    e.size = { ...(DEFAULT_SIZE[kind] as { w: number; h: number }) };
  const f0 = play.frames[0] as Frame;
  const frames = play.frames.slice();
  frames[0] = { ...f0, pos: { ...f0.pos, [e.id]: clean(p) } };
  return { play: { ...play, entities: [...play.entities, e], frames }, id: e.id };
}

/** Remove entities everywhere (positions, moves and ball holders). */
export function removeEntities(play: Play, ids: readonly string[]): Play {
  const gone = new Set(ids);
  if (!play.entities.some((e) => gone.has(e.id))) return play;
  const frames = play.frames.map((f) => {
    const pos = { ...f.pos };
    const moves = { ...f.moves };
    for (const id of gone) {
      delete pos[id];
      delete moves[id];
    }
    const next: Frame = { ...f, pos, moves };
    if (f.ball?.holder && gone.has(f.ball.holder)) {
      const at = resolvedBall(play, play.frames.indexOf(f));
      next.ball = at?.at ? { at: at.at } : {};
      if (!next.ball.at) delete next.ball;
    }
    return next;
  });
  return { ...play, entities: play.entities.filter((e) => !gone.has(e.id)), frames };
}

/** Duplicate an entity next to itself (all frames' positions offset by `offset`). */
export function duplicateEntity(
  play: Play,
  id: string,
  offset: Vec2 = { x: 1.5, y: 0 },
): { play: Play; id: string } {
  const src = play.entities.find((e) => e.id === id);
  if (!src || src.kind === 'ball') return { play, id };
  const copy: Entity = { ...src };
  delete copy.memberId;
  if (copy.kind === 'attack' || copy.kind === 'defence') copy.number = nextNumber(play, copy.kind);
  const pref = PREFIX[copy.kind] ?? 'e';
  const want =
    copy.number !== undefined && (copy.kind === 'attack' || copy.kind === 'defence')
      ? `${pref}${copy.number}`
      : '';
  copy.id = want && !play.entities.some((e) => e.id === want) ? want : nextEntityId(play, pref);
  const frames = play.frames.map((f) => {
    const p = f.pos[id];
    if (!p) return f;
    const moves = { ...f.moves };
    const m = f.moves[id];
    if (m)
      moves[copy.id] = {
        ...m,
        ctrl: m.ctrl?.map((c) => clean({ x: c.x + offset.x, y: c.y + offset.y })),
      };
    if (moves[copy.id] && !moves[copy.id]!.ctrl) delete moves[copy.id]!.ctrl;
    return {
      ...f,
      pos: { ...f.pos, [copy.id]: clean({ x: p.x + offset.x, y: p.y + offset.y }) },
      moves,
    };
  });
  const at = play.entities.indexOf(src) + 1;
  const entities = play.entities.slice();
  entities.splice(at, 0, copy);
  return { play: { ...play, entities, frames }, id: copy.id };
}

/** Patch an entity's fields (number, text, group, size, memberId). `undefined` removes a field. */
export function updateEntity(
  play: Play,
  id: string,
  patch: Partial<Omit<Entity, 'id' | 'kind'>>,
): Play {
  let changed = false;
  const entities = play.entities.map((e) => {
    if (e.id !== id) return e;
    const next: Entity = { ...e };
    for (const [k, v] of Object.entries(patch) as [keyof Entity, unknown][]) {
      if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) delete next[k];
      else (next as Record<string, unknown>)[k] = v;
    }
    changed = JSON.stringify(next) !== JSON.stringify(e);
    return next;
  });
  return changed ? { ...play, entities } : play;
}

const samePoint = (a: Vec2 | undefined, b: Vec2 | undefined) =>
  !!a && !!b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

/** Does `id` do anything in frame `fi`: travel somewhere, or (the ball) get passed or kicked? */
export function hasMove(play: Play, fi: number, id: string): boolean {
  if (fi <= 0) return false;
  const f = play.frames[fi];
  if (!f) return false;
  if (f.moves[id]) return true;
  const isBall = ballEntity(play)?.id === id;
  if (isBall) return !!f.ball;
  return !samePoint(resolvedPositions(play, fi - 1)[id], resolvedPositions(play, fi)[id]);
}

/**
 * Undo `id`'s movement in frame `fi`: it stays where it was at the end of the previous frame.
 * Later frames that only carried the old end position along (no move of their own) follow, so
 * the token stays put until its next real move instead of jumping later.
 */
export function clearMove(play: Play, fi: number, id: string): Play {
  if (fi <= 0 || !play.frames[fi]) return play;
  const isBall = ballEntity(play)?.id === id;
  const prev = resolvedPositions(play, fi - 1)[id];
  const oldEnd = resolvedPositions(play, fi)[id];
  const frames = play.frames.slice();
  const f = frames[fi] as Frame;
  const moves = { ...f.moves };
  delete moves[id];
  const pos = { ...f.pos };
  if (prev) pos[id] = clean(prev);
  else delete pos[id];
  const next: Frame = { ...f, pos, moves };
  if (isBall) delete next.ball; // the ball stays with whoever had it
  frames[fi] = next;
  for (let j = fi + 1; j < frames.length; j++) {
    const g = frames[j] as Frame;
    if (g.moves[id] || (isBall && g.ball)) break;
    const at = g.pos[id];
    if (at === undefined) continue;
    if (!samePoint(at, oldEnd)) break;
    const gp = { ...g.pos };
    if (prev) gp[id] = clean(prev);
    else delete gp[id];
    frames[j] = { ...g, pos: gp };
  }
  return { ...play, frames };
}

/** Change how an entity travels into frame `fi` (kind/ease/delay); `null` clears the move. */
export function setMove(play: Play, fi: number, id: string, patch: Partial<Move> | null): Play {
  if (fi === 0) return play;
  return withFrame(play, fi, (f) => {
    const moves = { ...f.moves };
    if (patch === null) delete moves[id];
    else {
      const m: Move = { kind: 'run', ...f.moves[id], ...patch };
      if (!m.ctrl?.length) delete m.ctrl;
      if (!m.delayMs) delete m.delayMs;
      if (!m.ease) delete m.ease;
      moves[id] = m;
    }
    return { ...f, moves };
  });
}

export function setCaption(play: Play, fi: number, caption: string): Play {
  return withFrame(play, fi, (f) => {
    const c = caption.slice(0, 280);
    if ((f.caption ?? '') === c) return f;
    const next: Frame = { ...f, caption: c };
    if (!c) delete next.caption;
    return next;
  });
}

export function setDuration(play: Play, fi: number, ms: number): Play {
  if (fi === 0) return play;
  const d = Math.round(Math.min(30000, Math.max(200, ms)));
  return withFrame(play, fi, (f) => (f.durationMs === d ? f : { ...f, durationMs: d }));
}

/** Insert a frame after `fi` copying its end positions. */
export function insertFrame(play: Play, fi: number): Play {
  return addFrame(play, fi);
}

/** Delete a frame. The first frame can only go when another frame can take its place. */
export function deleteFrame(play: Play, fi: number): Play {
  if (play.frames.length <= 1 || !play.frames[fi]) return play;
  const frames = play.frames.slice();
  if (fi === 0) {
    // Fold frame 1's end positions into the new starting formation.
    const f1 = frames[1] as Frame;
    const f0 = frames[0] as Frame;
    frames[1] = {
      ...f1,
      durationMs: 0,
      moves: {},
      pos: { ...f0.pos, ...f1.pos },
      ball: f1.ball ?? f0.ball,
    };
    if (!frames[1].ball) delete frames[1].ball;
  }
  frames.splice(fi, 1);
  return { ...play, frames };
}

/** Swap a frame with its neighbour (not frame 0). */
export function moveFrame(play: Play, fi: number, dir: -1 | 1): Play {
  const to = fi + dir;
  if (fi < 1 || to < 1 || to >= play.frames.length) return play;
  const frames = play.frames.slice();
  [frames[fi], frames[to]] = [frames[to] as Frame, frames[fi] as Frame];
  return { ...play, frames };
}

/** Replace the formation with a preset (one undoable command). */
export function applyPreset(play: Play, preset: PresetResult): Play {
  const f0: Frame = { id: 'f0', durationMs: 0, pos: structuredClone(preset.pos), moves: {} };
  if (preset.ball) f0.ball = structuredClone(preset.ball);
  const next: Play = {
    ...play,
    view: preset.view,
    entities: structuredClone(preset.entities),
    frames: [f0],
  };
  if (play.format === 'any') next.format = preset.format;
  if (next.mode === 'play') delete next.background;
  delete next.viewport;
  return next;
}

/** "Add N players" in a line or grid at `at`, in bib group `group`. */
export function addPlayersOp(
  play: Play,
  n: number,
  layout: 'line' | 'grid',
  at: Vec2,
  group?: 'A' | 'B' | 'C' | 'D',
  kind: 'player' | 'attack' | 'defence' = 'player',
): Play {
  const prefix = kind === 'player' ? `p${group ?? ''}` : kind === 'attack' ? 'a' : 'd';
  let start = 1;
  const used = new Set(play.entities.map((e) => e.id));
  while ([...Array(n).keys()].some((i) => used.has(`${prefix}${start + i}`))) start++;
  const { entities, pos } = addPlayers(Math.max(1, Math.min(40, n)), layout, at, group, {
    prefix,
    startIndex: start,
    kind,
  });
  if (kind !== 'player') entities.forEach((e, i) => (e.number = start + i));
  const f0 = play.frames[0] as Frame;
  const frames = play.frames.slice();
  const clamped: Record<string, Vec2> = {};
  for (const [id, p] of Object.entries(pos)) clamped[id] = clean(clampToBounds(play, p));
  frames[0] = { ...f0, pos: { ...f0.pos, ...clamped } };
  return { ...play, entities: [...play.entities, ...entities], frames };
}

/** Drill area size: updates the grass/grid background. */
export function setArea(play: Play, w: number, h: number): Play {
  const bg = play.background;
  if (!bg || bg.kind === 'pitch') return play;
  if (bg.w === w && bg.h === h) return play;
  return { ...play, background: { ...bg, w, h } };
}

/**
 * Pick the entity under a pitch point. Nearest wins, so a held ball doesn't steal taps from its
 * carrier; large shapes (zones, ladders, gates) are picked only when nothing else is close.
 */
export function pick(scene: Scene, p: Vec2, tolM: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  const consider = (id: string, c: Vec2, r: number, bias = 0) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y) - r + bias;
    if (d <= tolM && d < bestD) {
      bestD = d;
      best = id;
    }
  };
  for (const e of scene.entities) {
    const size = e.entity.size;
    if (
      e.kind === 'zone' ||
      ((e.kind === 'ladder' || e.kind === 'scrum_machine' || e.kind === 'gate') && size)
    )
      continue;
    consider(e.id, e.pos, e.kind === 'label' ? 1.2 : 0.7);
  }
  if (scene.ball?.id) consider(scene.ball.id, scene.ball.pos, 0.4, 0.3);
  if (best) return best;
  for (let i = scene.entities.length - 1; i >= 0; i--) {
    const e = scene.entities[i]!;
    const size = e.entity.size;
    if (
      e.kind !== 'zone' &&
      !((e.kind === 'ladder' || e.kind === 'scrum_machine' || e.kind === 'gate') && size)
    )
      continue;
    const w = size?.w ?? 5;
    const h = size?.h ?? (e.kind === 'gate' ? 0.6 : 5);
    if (inRotatedRect(p, e.pos, w, h, size?.rot ?? 0, Math.min(tolM, 0.6))) return e.id;
  }
  return null;
}

/** Ids of entities whose positions fall inside the pitch rectangle a–b. */
export function inRect(scene: Scene, a: Vec2, b: Vec2): string[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const ids = scene.entities
    .filter(
      (e) => e.kind !== 'zone' && e.pos.x >= x0 && e.pos.x <= x1 && e.pos.y >= y0 && e.pos.y <= y1,
    )
    .map((e) => e.id);
  return ids;
}
