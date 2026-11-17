/**
 * Starting formations (docs/diagrams.md §Editor — Presets) and play construction helpers.
 *
 * Ids are deterministic: attackers `a{number}`, defenders `d{number}`, the ball `ball`. Attack runs
 * towards the y = 0 try line (see viewport.ts), so "behind" the attack is larger y.
 */
import type { Entity, Frame, Play, Vec2, View } from '@phaseplay/shared';
import { resolvedPositions } from './sample';
import { LINEOUT_Y, SCRUM_MARK } from './viewport';

export type PresetResult = {
  entities: Entity[];
  pos: Record<string, Vec2>;
  ball?: { holder?: string; at?: Vec2 };
  view: View;
  format: '15s' | '7s';
};

export type PresetId =
  | 'lineout4'
  | 'lineout5'
  | 'lineout6'
  | 'lineout7'
  | 'scrum15'
  | 'scrum7'
  | 'kickoffReceive15'
  | 'restartReceive7'
  | 'backlineFlat'
  | 'backlineDeep'
  | 'pods1331'
  | 'pods242'
  | 'defensiveLine15'
  | 'defensiveLine7';

/** [shirt number, x, y, role tag?] */
type Spot = [number, number, number, string?];

class Builder {
  entities: Entity[] = [];
  pos: Record<string, Vec2> = {};
  add(kind: 'attack' | 'defence', spots: Spot[]): this {
    for (const [n, x, y, role] of spots) {
      const id = `${kind === 'attack' ? 'a' : 'd'}${n}`;
      const e: Entity = { id, kind, number: n };
      if (role) e.text = role;
      this.entities.push(e);
      this.pos[id] = { x, y };
    }
    return this;
  }
  ball(holder: string, view: View, format: '15s' | '7s'): PresetResult {
    this.entities.push({ id: 'ball', kind: 'ball' });
    const h = this.pos[holder] as Vec2;
    this.pos.ball = { x: h.x, y: h.y };
    return { entities: this.entities, pos: this.pos, ball: { holder }, view, format };
  }
}

const LINEOUT_ORDER: Record<4 | 5 | 6 | 7, [number, string?][]> = {
  4: [[1, 'L'], [4, 'J'], [3, 'L'], [8]],
  5: [
    [1, 'L'],
    [4, 'J'],
    [3, 'L'],
    [5, 'J'],
    [6, 'L'],
  ],
  6: [[1, 'L'], [4, 'J'], [3, 'L'], [5, 'J'], [6, 'L'], [8]],
  7: [
    [1, 'L'],
    [4, 'J'],
    [3, 'L'],
    [5, 'J'],
    [6, 'L'],
    [8, 'J'],
    [7, 'L'],
  ],
};

/**
 * An attacking lineout of `n` players on the left touchline (line of touch y = LINEOUT_Y), with
 * jumpers (J) and lifters (L) tagged, hooker throwing, 9 receiving and the backs set. Players not
 * in the lineout stand 10 m+ back (Law 18). Optionally a mirrored defending lineout.
 */
export function lineout(n: 4 | 5 | 6 | 7, opts: { defence?: boolean } = {}): PresetResult {
  const L = LINEOUT_Y;
  const order = LINEOUT_ORDER[n];
  // Seven players fit inside the 5 m and 15 m lines at 1.3 m steps.
  const step = n === 7 ? 1.3 : 1.5;
  const b = new Builder();
  const inLine = new Set(order.map(([num]) => num));
  const spots: Spot[] = order.map(([num, role], i) => [num, 6 + i * step, L + 0.5, role]);
  const mid = 6 + ((n - 1) * step) / 2;
  spots.push([2, -0.8, L], [9, mid + 1, L + 3]);
  // Forwards not in the line wait as a midfield pod, at least 10 m from the line of touch.
  [1, 3, 4, 5, 6, 7, 8]
    .filter((k) => !inLine.has(k))
    .forEach((k, i) => spots.push([k, 22 + i * 3, L + 11]));
  spots.push(
    [10, 18.5, L + 11.5],
    [12, 27, L + 14],
    [13, 34, L + 16],
    [11, 10, L + 20],
    [14, 46, L + 18],
    [15, 38, L + 25],
  );
  b.add('attack', spots);
  if (opts.defence) {
    const d: Spot[] = order.map(([num, role], i) => [num, 6 + i * step, L - 0.5, role]);
    d.push([2, 2.5, L - 2.5], [9, mid + 1, L - 2.5]);
    [1, 3, 4, 5, 6, 7, 8]
      .filter((k) => !inLine.has(k))
      .forEach((k, i) => d.push([k, 24 + i * 2.5, L - 11]));
    // The defending team faces +y, so its left wing (11) is at high x.
    d.push(
      [10, 20, L - 11],
      [12, 28, L - 11],
      [13, 36, L - 11],
      [14, 8, L - 20],
      [11, 50, L - 12],
      [15, 40, L - 24],
    );
    b.add('defence', d);
  }
  return b.ball('a2', 'lineout', '15s');
}

/**
 * 15s scrum at SCRUM_MARK: both packs bound (drawn about 1.4× life size so tokens stay readable),
 * 9 putting in on the loosehead side, backs 5 m+ behind the hindmost feet (Law 19).
 */
export function scrum15(): PresetResult {
  const { x: X, y: Y } = SCRUM_MARK;
  const pack: [number, number, number][] = [
    [1, -1.4, 0.7],
    [2, 0, 0.7],
    [3, 1.4, 0.7],
    [4, -0.7, 2.2],
    [5, 0.7, 2.2],
    [6, -2.2, 1.9],
    [7, 2.2, 1.9],
    [8, 0, 3.6],
  ];
  return new Builder()
    .add('attack', [
      ...pack.map(([n, dx, dy]): Spot => [n, X + dx, Y + dy]),
      [9, X - 2.8, Y + 0.2],
      [10, X - 8, Y + 9.5],
      [12, X - 14, Y + 11],
      [13, X - 20, Y + 12.5],
      [11, X - 27, Y + 14],
      [14, X + 20, Y + 11],
      [15, X + 2, Y + 19],
    ])
    .add('defence', [
      ...pack.map(([n, dx, dy]): Spot => [n, X - dx, Y - dy]),
      [9, X - 3.4, Y - 1],
      [10, X - 8, Y - 9.5],
      [12, X - 14, Y - 10],
      [13, X - 20, Y - 10.5],
      [14, X - 27, Y - 12],
      [11, X + 22, Y - 12],
      [15, X, Y - 22],
    ])
    .ball('a9', 'scrum', '15s');
}

/** 7s three-player scrum: 1–3 bound, 4 (scrum-half) putting in, 5–7 in the backline. */
export function scrum7(): PresetResult {
  const { x: X, y: Y } = SCRUM_MARK;
  return new Builder()
    .add('attack', [
      [1, X - 1.4, Y + 0.7],
      [2, X, Y + 0.7],
      [3, X + 1.4, Y + 0.7],
      [4, X - 2.8, Y + 0.2, 'SH'],
      [5, X - 8, Y + 7, 'FH'],
      [6, X - 17, Y + 9, 'C'],
      [7, X - 27, Y + 11, 'W'],
    ])
    .add('defence', [
      [1, X + 1.4, Y - 0.7],
      [2, X, Y - 0.7],
      [3, X - 1.4, Y - 0.7],
      [4, X - 3.4, Y - 1, 'SH'],
      [5, X - 9, Y - 7, 'FH'],
      [6, X - 19, Y - 8, 'C'],
      [7, X - 4, Y - 15, 'SW'],
    ])
    .ball('a4', 'scrum', '7s');
}

/**
 * 15s kick-off: receiving pods in the 10–22 zone, backs deep; the kicking team behind the ball
 * on its own side of halfway (Law 12), with a gap for the kicker.
 */
export function kickoffReceive15(): PresetResult {
  const xs = [5, 10, 15, 20, 25, 30, 40, 45, 50, 55, 60, 65];
  const chase: Spot[] = [11, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14].map((n, i) => [
    n,
    xs[i] as number,
    47,
  ]);
  return new Builder()
    .add('attack', [
      [1, 12, 63, 'L'],
      [4, 14, 63, 'J'],
      [3, 16, 63, 'L'],
      [6, 54, 63, 'L'],
      [5, 56, 63, 'J'],
      [7, 58, 63, 'L'],
      [2, 30, 66],
      [8, 40, 66],
      [9, 35, 70],
      [10, 28, 74],
      [12, 22, 78],
      [13, 48, 78],
      [11, 10, 85],
      [14, 60, 85],
      [15, 35, 90],
    ])
    .add('defence', [...chase, [9, 35, 44], [10, 35, 49.5], [15, 35, 28]])
    .ball('d10', 'full', '15s');
}

/**
 * 7s restart receive (the scoring team kicks off): two lifted pods at 11 m, the scrum-half in the
 * pocket, a sweeper deep. Kickers behind the ball, loaded to the kick (left) side.
 */
export function restartReceive7(): PresetResult {
  return new Builder()
    .add('attack', [
      [2, 18, 61, 'J'],
      [1, 18, 62.6, 'L'],
      [3, 52, 61, 'J'],
      [6, 52, 62.6, 'L'],
      [4, 35, 66, 'SH'],
      [5, 35, 73],
      [7, 35, 85, 'SW'],
    ])
    .add('defence', [
      [7, 10, 47.5],
      [6, 16, 47.5],
      [3, 22, 47.5],
      [2, 28, 47.5],
      [1, 44, 47.5],
      [4, 56, 47.5],
      [5, 35, 49.5],
    ])
    .ball('d5', 'full', '7s');
}

/** A "Ruck" text marker so the 9 isn't standing alone. */
function ruckLabel(b: Builder, x: number, y: number): void {
  b.entities.push({ id: 'ruck', kind: 'label', text: 'Ruck' });
  b.pos.ruck = { x, y };
}

function backline(deep: boolean): PresetResult {
  const rx = 15;
  const ry = 40;
  const depth = deep ? 3 : 1;
  const first = deep ? 6 : 3;
  const order = [10, 12, 13, 15, 14];
  // The left wing (11) holds the short (blind) side, on the 5 m line.
  const spots: Spot[] = [
    [9, rx, ry + 0.8],
    [11, 6, ry + first + 2],
  ];
  order.forEach((n, i) => spots.push([n, rx + 6 + i * 7, ry + first + i * depth]));
  const b = new Builder().add('attack', spots);
  ruckLabel(b, rx, ry - 1);
  return b.ball('a9', 'half', '15s');
}

/** Backline off a left-side ruck, flat (≈1 m steps) — close to the gain line. */
export const backlineFlat = (): PresetResult => backline(false);
/** Backline off a left-side ruck, deep (≈3 m steps). */
export const backlineDeep = (): PresetResult => backline(true);

/** 1-3-3-1 forward pods across the field off a central ruck, backs behind. */
export function pods1331(): PresetResult {
  const b = new Builder().add('attack', [
    [9, 35, 41],
    [6, 8, 44],
    [1, 21, 45],
    [2, 24, 43.5],
    [3, 27, 45],
    [4, 43, 45],
    [8, 46, 43.5],
    [5, 49, 45],
    [7, 62, 44],
    [10, 30, 50],
    [12, 40, 51],
    [13, 52, 52],
    [11, 12, 52],
    [14, 60, 53],
    [15, 35, 60],
  ]);
  ruckLabel(b, 35, 39.5);
  return b.ball('a9', 'half', '15s');
}

/**
 * 2-4-2 forward pods: hooker and a back-rower on each edge (2 + 6, 7 + 8), the tight four in the
 * middle to one side of the ruck so the 9's pass lines stay open.
 */
export function pods242(): PresetResult {
  const b = new Builder().add('attack', [
    [9, 35, 41],
    [2, 9, 45],
    [6, 12, 45.8],
    [1, 38, 45.6],
    [4, 40.5, 44.8],
    [5, 43, 44.8],
    [3, 45.5, 45.6],
    [7, 58, 45],
    [8, 61, 45.8],
    [10, 33, 51],
    [12, 45, 52],
    [13, 52, 53],
    [11, 10, 56],
    [14, 60, 56],
    [15, 35, 62],
  ]);
  ruckLabel(b, 35, 39.5);
  return b.ball('a9', 'half', '15s');
}

function defensiveLine(spots: Spot[], format: '15s' | '7s'): PresetResult {
  const b = new Builder().add('defence', spots);
  ruckLabel(b, 35, 42.2);
  b.entities.push({ id: 'ball', kind: 'ball' });
  b.pos.ball = { x: 35, y: 40.5 };
  return {
    entities: b.entities,
    pos: b.pos,
    ball: { at: { x: 35, y: 40.5 } },
    view: 'half',
    format,
  };
}

/**
 * 15s defensive line: two guards tight on the ruck, wider spacing outwards, the 9 sweeping behind
 * the ruck and the 15 in the backfield. The defense faces +y, so its left wing (11) is at high x.
 */
export function defensiveLine15(): PresetResult {
  const line: [number, number][] = [
    [14, 6],
    [13, 12],
    [12, 18],
    [6, 23],
    [4, 27.5],
    [2, 31],
    [1, 33.5],
    [3, 36.5],
    [5, 40],
    [7, 44.5],
    [8, 50],
    [10, 56],
    [11, 63],
  ];
  const spots: Spot[] = line.map(([n, x]) => [n, x, 38]);
  spots.push([9, 35, 33], [15, 35, 18]);
  return defensiveLine(spots, '15s');
}

/** 7s defensive line: two guards 2–3 m either side of the ruck, ~10 m gaps, a sweeper behind. */
export function defensiveLine7(): PresetResult {
  const line: [number, number][] = [
    [7, 12],
    [5, 22.5],
    [1, 32.5],
    [2, 37.5],
    [3, 47.5],
    [6, 58],
  ];
  const spots: Spot[] = line.map(([n, x]) => [n, x, 38]);
  spots.push([4, 35, 26, 'SW']);
  return defensiveLine(spots, '7s');
}
/** Every preset by id, with a label for the editor's picker. */
export const PRESETS: Record<PresetId, { label: string; build: () => PresetResult }> = {
  lineout4: { label: '4-player lineout', build: () => lineout(4) },
  lineout5: { label: '5-player lineout', build: () => lineout(5) },
  lineout6: { label: '6-player lineout', build: () => lineout(6) },
  lineout7: { label: '7-player lineout', build: () => lineout(7) },
  scrum15: { label: 'Scrum (15s)', build: scrum15 },
  scrum7: { label: 'Scrum (7s)', build: scrum7 },
  kickoffReceive15: { label: 'Kick-off receive (15s)', build: kickoffReceive15 },
  restartReceive7: { label: 'Restart receive (7s)', build: restartReceive7 },
  backlineFlat: { label: 'Backline — flat', build: backlineFlat },
  backlineDeep: { label: 'Backline — deep', build: backlineDeep },
  pods1331: { label: 'Pods 1-3-3-1', build: pods1331 },
  pods242: { label: 'Pods 2-4-2', build: pods242 },
  defensiveLine15: { label: 'Defensive line (15s)', build: defensiveLine15 },
  defensiveLine7: { label: 'Defensive line (7s)', build: defensiveLine7 },
};

export type NewPlayOptions = {
  id: string;
  title: string;
  mode: Play['mode'];
  format: Play['format'];
  view?: View;
  preset?: PresetId | PresetResult;
};

/** Default duration for new frames (ms). */
export const DEFAULT_FRAME_MS = 1500;

/**
 * A new valid Play. Plays start on the pitch at `view` (or the preset's view); drills default to a
 * looping 20×20 m grass area unless a preset is given.
 */
export function newPlay(o: NewPlayOptions): Play {
  const preset = typeof o.preset === 'string' ? PRESETS[o.preset].build() : o.preset;
  const frame: Frame = { id: 'f0', durationMs: 0, pos: preset?.pos ?? {}, moves: {} };
  if (preset?.ball) frame.ball = preset.ball;
  const play: Play = {
    v: 1,
    id: o.id,
    mode: o.mode,
    title: o.title.slice(0, 80),
    format: o.format,
    view: o.view ?? preset?.view ?? 'full',
    entities: preset?.entities ?? [],
    frames: [frame],
  };
  if (o.mode === 'drill') {
    play.loop = true;
    if (!preset) play.background = { kind: 'grass', w: 20, h: 20 };
  }
  return play;
}

/** A frame id not yet used in the play. */
export function nextFrameId(play: Play): string {
  const used = new Set(play.frames.map((f) => f.id));
  let n = play.frames.length;
  while (used.has(`f${n}`)) n++;
  return `f${n}`;
}

/** An entity id with `prefix` not yet used in the play. */
export function nextEntityId(play: Pick<Play, 'entities'>, prefix: string): string {
  const used = new Set(play.entities.map((e) => e.id));
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/**
 * Insert a new frame after `afterIndex`, copying that frame's resolved end positions with no
 * moves, so only what changes needs moving. Returns a new Play.
 */
export function addFrame(
  play: Play,
  afterIndex: number = play.frames.length - 1,
  durationMs = DEFAULT_FRAME_MS,
): Play {
  const at = Math.max(0, Math.min(afterIndex, play.frames.length - 1));
  const frame: Frame = {
    id: nextFrameId(play),
    durationMs,
    pos: resolvedPositions(play, at),
    moves: {},
  };
  const frames = play.frames.slice();
  frames.splice(at + 1, 0, frame);
  return { ...play, frames };
}

/** Duplicate frame `index` (positions, moves, ball, caption, arrows) right after itself. */
export function duplicateFrame(play: Play, index: number): Play {
  const src = play.frames[index];
  if (!src) return play;
  const copy: Frame = structuredClone(src);
  copy.id = nextFrameId(play);
  if (index === 0) copy.durationMs = DEFAULT_FRAME_MS;
  const frames = play.frames.slice();
  frames.splice(index + 1, 0, copy);
  return { ...play, frames };
}
