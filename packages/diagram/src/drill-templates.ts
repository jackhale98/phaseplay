/**
 * Drill templates (docs/diagrams.md §Drill mode): editable starting points that each return a
 * looping drill-mode Play on a grass area, with one caption per frame as the step-by-step
 * instructions. Drill coordinates run 0..w across and 0..h along; "forward" is towards y = 0.
 */
import type { Entity, EntityKind, Frame, Move, Play, Vec2 } from '@phaseplay/shared';
import type { EaseName } from './geometry';
import { BALL_HOLD_OFFSET } from './sample';
import type { Group } from './themes';

export type PlayersOptions = {
  /** Spacing between players (m), default 1.5. */
  spacing?: number;
  /** Id prefix, default `p{group}` (e.g. `pA`); ids are `{prefix}{startIndex + i}`. */
  prefix?: string;
  startIndex?: number;
  /** Line direction (unit vector), default across (+x). */
  dir?: Vec2;
  /** Columns for the grid layout (default ceil(sqrt(n))). */
  cols?: number;
  kind?: 'player' | 'attack' | 'defence';
};

/**
 * "Add N players": a line (starting at `at`, along `dir`) or a grid (centred on `at`) of neutral
 * drill players in a bib group.
 */
export function addPlayers(
  n: number,
  layout: 'line' | 'grid',
  at: Vec2,
  group?: Group,
  opts: PlayersOptions = {},
): { entities: Entity[]; pos: Record<string, Vec2> } {
  const spacing = opts.spacing ?? 1.5;
  const prefix = opts.prefix ?? `p${group ?? ''}`;
  const start = opts.startIndex ?? 1;
  const dir = opts.dir ?? { x: 1, y: 0 };
  const cols = Math.max(1, opts.cols ?? Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);
  const entities: Entity[] = [];
  const pos: Record<string, Vec2> = {};
  for (let i = 0; i < n; i++) {
    const id = `${prefix}${start + i}`;
    const e: Entity = { id, kind: opts.kind ?? 'player' };
    if (group) e.group = group;
    entities.push(e);
    if (layout === 'line')
      pos[id] = { x: at.x + dir.x * spacing * i, y: at.y + dir.y * spacing * i };
    else {
      const c = i % cols;
      const r = Math.floor(i / cols);
      pos[id] = {
        x: at.x + (c - (cols - 1) / 2) * spacing,
        y: at.y + (r - (rows - 1) / 2) * spacing,
      };
    }
  }
  return { entities, pos };
}

type MoveSpec = { to?: Vec2; kind?: Move['kind']; ctrl?: Vec2[]; delay?: number; ease?: EaseName };

/** Small builder that tracks current positions while frames are appended. */
class DrillBuilder {
  entities: Entity[] = [];
  frames: Frame[] = [];
  private cur: Record<string, Vec2> = {};
  constructor(
    readonly w: number,
    readonly h: number,
  ) {}

  put(kind: EntityKind, id: string, p: Vec2, extra: Partial<Entity> = {}): this {
    this.entities.push({ id, kind, ...extra });
    this.cur[id] = p;
    return this;
  }
  people(res: { entities: Entity[]; pos: Record<string, Vec2> }): this {
    this.entities.push(...res.entities);
    Object.assign(this.cur, res.pos);
    return this;
  }
  at(id: string): Vec2 {
    return this.cur[id] as Vec2;
  }
  start(caption: string, ball?: Frame['ball']): this {
    const f: Frame = { id: 'f0', durationMs: 0, pos: { ...this.cur }, moves: {}, caption };
    if (ball) f.ball = ball;
    this.frames.push(f);
    return this;
  }
  step(
    caption: string,
    durationMs: number,
    moves: Record<string, Vec2 | MoveSpec>,
    ball?: Frame['ball'],
  ): this {
    const pos: Record<string, Vec2> = {};
    const mv: Record<string, Move> = {};
    for (const [id, spec] of Object.entries(moves)) {
      const s: MoveSpec = 'x' in spec ? { to: spec } : spec;
      if (s.to) {
        pos[id] = s.to;
        this.cur[id] = s.to;
      }
      const m: Move = { kind: s.kind ?? 'run' };
      if (s.ctrl) m.ctrl = s.ctrl;
      if (s.delay) m.delayMs = s.delay;
      if (s.ease) m.ease = s.ease;
      mv[id] = m;
    }
    const f: Frame = { id: `f${this.frames.length}`, durationMs, pos, moves: mv, caption };
    if (ball) f.ball = ball;
    this.frames.push(f);
    return this;
  }
  build(id: string, title: string, gridM?: number): Play {
    const background: NonNullable<Play['background']> = { kind: 'grass', w: this.w, h: this.h };
    if (gridM) background.gridM = gridM;
    return {
      v: 1,
      id,
      mode: 'drill',
      title,
      format: 'any',
      view: 'custom',
      background,
      entities: this.entities,
      frames: this.frames,
      loop: true,
    };
  }
}
const ball = (b: DrillBuilder, holder: string) => b.put('ball', 'ball', { ...b.at(holder) });

/** Where a held ball sits next to `p` (matches the renderer's carried-ball offset). */
const inHand = (p: Vec2): Vec2 => ({
  x: p.x + BALL_HOLD_OFFSET.x,
  y: p.y + BALL_HOLD_OFFSET.y,
});

/** Neutral bib-group players at fixed spots, ids `p{group}{n}`. */
const bibs = (g: Group, spots: Vec2[]) => ({
  entities: spots.map((_, i) => ({ id: `p${g}${i + 1}`, kind: 'player', group: g }) as Entity),
  pos: Object.fromEntries(spots.map((p, i) => [`p${g}${i + 1}`, p])),
});

/**
 * 10 m square with a cone and a queue (groups A–D) at each corner. Pairs run up opposite sides
 * passing across, the receiver always a metre deeper, so every pass goes sideways or back.
 */
export function squareGrid(id = 'drill-square'): Play {
  const b = new DrillBuilder(10, 10);
  const d = Math.SQRT1_2;
  const corners: [Group, Vec2, Vec2][] = [
    ['A', { x: 0, y: 10 }, { x: -d, y: d }],
    ['B', { x: 0, y: 0 }, { x: -d, y: -d }],
    ['C', { x: 10, y: 0 }, { x: d, y: -d }],
    ['D', { x: 10, y: 10 }, { x: d, y: d }],
  ];
  corners.forEach(([g, c, out], i) => {
    b.put('cone', `cone${i + 1}`, c);
    b.people(
      addPlayers(3, 'line', { x: c.x + out.x, y: c.y + out.y }, g, {
        dir: out,
        spacing: 1.4,
      }),
    );
  });
  ball(b, 'pA1');
  b.start(
    '10 m square (8 m for U12), a queue of three at each corner. A and D face up the square, B and C face down. Ball with A1.',
    { holder: 'pA1' },
  );
  b.step(
    'A1 and D1 run up the sides together; A1 passes across to D1. The receiver stays a metre deeper, so the pass goes sideways or back.',
    1600,
    {
      pA1: { to: { x: 0, y: 5.5 }, kind: 'carry' },
      pD1: { x: 10, y: 6.5 },
      ball: { kind: 'pass', delay: 1250 },
    },
    { holder: 'pD1' },
  );
  b.step(
    'D1 passes back across to A1, who is now the deeper player.',
    1400,
    {
      pD1: { to: { x: 10, y: 1.5 }, kind: 'carry' },
      pA1: { x: 0, y: 2.5 },
      ball: { kind: 'pass', delay: 1050 },
    },
    { holder: 'pA1' },
  );
  b.step(
    'A1 gives the ball to B1. A1 joins the B queue and D1 joins the C queue.',
    1400,
    {
      pA1: { to: { x: -3.5, y: -3.5 }, ctrl: [{ x: 0.6, y: 0.2 }] },
      pD1: { to: { x: 13.5, y: -3.5 }, ctrl: [{ x: 10.2, y: -1.5 }] },
      ball: { kind: 'pass', delay: 350 },
    },
    { holder: 'pB1' },
  );
  b.step(
    'B1 and C1 run down the square, passing across. Keep it going; switch hands each lap.',
    1600,
    {
      pB1: { to: { x: 0, y: 4.5 }, kind: 'carry' },
      pC1: { x: 10, y: 3.5 },
      ball: { kind: 'pass', delay: 1250 },
    },
    { holder: 'pC1' },
  );
  return b.build(id, 'Square grid — pairs passing across');
}

/** Three 5 m channels; a staggered line of three passes along as it advances. */
export function channels(id = 'drill-channels'): Play {
  const b = new DrillBuilder(15, 28);
  [2.5, 7.5, 12.5].forEach((x, i) =>
    b.put('zone', `ch${i + 1}`, { x, y: 14 }, { size: { w: 5, h: 28 }, text: `Channel ${i + 1}` }),
  );
  b.people(
    bibs('A', [
      { x: 2.5, y: 19 },
      { x: 7.5, y: 20.5 },
      { x: 12.5, y: 22 },
    ]),
  );
  b.people(
    bibs('B', [
      { x: 2.5, y: 24.5 },
      { x: 7.5, y: 26 },
      { x: 12.5, y: 27.5 },
    ]),
  );
  ball(b, 'pA1');
  b.start('Three 5 m channels, 28 m long. Line A staggered on the start, B waiting behind.', {
    holder: 'pA1',
  });
  b.step(
    'Run straight in your channel. A1 passes to A2, who is 1.5 m deeper.',
    1600,
    {
      pA1: { to: { x: 2.5, y: 12 }, kind: 'carry' },
      pA2: { x: 7.5, y: 13.5 },
      pA3: { x: 12.5, y: 15 },
      ball: { kind: 'pass', delay: 1250 },
    },
    { holder: 'pA2' },
  );
  b.step(
    'A2 passes to A3. Hold your depth: each receiver is behind the passer.',
    1600,
    {
      pA1: { x: 2.5, y: 6 },
      pA2: { to: { x: 7.5, y: 6.5 }, kind: 'carry' },
      pA3: { x: 12.5, y: 8 },
      ball: { kind: 'pass', delay: 1250 },
    },
    { holder: 'pA3' },
  );
  b.step('A3 finishes over the line. A jog back down the outside; B go next.', 1600, {
    pA1: { x: 2.5, y: 0.5 },
    pA2: { x: 7.5, y: 0.5 },
    pA3: { to: { x: 12.5, y: 0.5 }, kind: 'carry' },
  });
  return b.build(id, 'Channels — pass along the line');
}

/** Triangle of cones 8–10 m apart: step onto the ball, pass and follow around the triangle. */
export function trianglePassing(id = 'drill-triangle'): Play {
  const b = new DrillBuilder(12, 12);
  const pts: Vec2[] = [
    { x: 6, y: 2 },
    { x: 11, y: 10 },
    { x: 1, y: 10 },
  ];
  const groups: Group[] = ['A', 'B', 'C'];
  pts.forEach((p, i) => {
    b.put('cone', `cone${i + 1}`, p);
    b.people(
      addPlayers(2, 'line', { x: p.x, y: p.y + (i === 0 ? -0.9 : 0.9) }, groups[i], {
        dir: { x: 0, y: i === 0 ? -1 : 1 },
        spacing: 1.1,
      }),
    );
  });
  ball(b, 'pA1');
  b.start(
    'Three cones 8–10 m apart (5–6 m for U12), two players at each. Ball starts at the top.',
    { holder: 'pA1' },
  );
  b.step(
    'B1 steps onto the ball, hands up. A1 passes to B1 and follows the pass.',
    1500,
    {
      pA1: { to: { x: 11, y: 13.2 }, delay: 300 },
      pB1: { x: 10.6, y: 9.3 },
      ball: { kind: 'pass', delay: 500 },
    },
    { holder: 'pB1' },
  );
  b.step(
    'C1 steps onto the ball. B1 passes to C1 and follows the pass.',
    1500,
    {
      pB1: { to: { x: 1, y: 13.2 }, delay: 300 },
      pC1: { x: 1.4, y: 9.3 },
      ball: { kind: 'pass', delay: 500 },
    },
    { holder: 'pC1' },
  );
  b.step(
    'C1 passes to A2 and follows. Switch direction after two minutes.',
    1500,
    {
      pC1: { to: { x: 6, y: -1.4 }, delay: 300 },
      ball: { kind: 'pass', delay: 300 },
    },
    { holder: 'pA2' },
  );
  return b.build(id, 'Triangle passing');
}

/**
 * Gates scattered in a 20 m square: pairs run through a gate side by side and pass while both are
 * between the cones (sideways or back), then find a new gate.
 */
export function gates(id = 'drill-gates'): Play {
  const b = new DrillBuilder(20, 20);
  const gs: [Vec2, number][] = [
    [{ x: 5, y: 5 }, 0],
    [{ x: 15, y: 5 }, 90],
    [{ x: 10, y: 10 }, -45],
    [{ x: 5, y: 15 }, 90],
    [{ x: 15, y: 15 }, 0],
  ];
  gs.forEach(([p, rot], i) => b.put('gate', `gate${i + 1}`, p, { size: { w: 3, h: 0.5, rot } }));
  b.people(addPlayers(2, 'line', { x: 4.2, y: 19 }, 'A', { spacing: 1.6 }));
  b.people(addPlayers(2, 'line', { x: 14.2, y: 19 }, 'B', { spacing: 1.6 }));
  ball(b, 'pA1');
  // Pair B's ball moves with B1 / B2 (only the first ball follows a holder by itself).
  b.put('ball', 'ball2', inHand(b.at('pB1')));
  b.start('Five gates (cone pairs 3 m wide) in a 20 m square. Work in pairs, a ball per pair.', {
    holder: 'pA1',
  });
  const B1a = { x: 14.2, y: 15.6 };
  const B2a = { x: 15.8, y: 16.3 };
  b.step('Pairs run to a gate side by side.', 1500, {
    pA1: { to: { x: 4.2, y: 5.6 }, kind: 'carry' },
    pA2: { x: 5.8, y: 6.3 },
    pB1: { to: B1a, kind: 'carry' },
    pB2: B2a,
    ball2: inHand(B1a),
  });
  b.step(
    'Pass while both are between the cones: sideways or back, never forward.',
    600,
    {
      pA1: { to: { x: 4.2, y: 4.6 }, kind: 'carry' },
      pA2: { x: 5.8, y: 5.3 },
      pB1: { x: 14.2, y: 14.6 },
      pB2: { x: 15.8, y: 15.3 },
      ball: { kind: 'pass', delay: 350 },
      ball2: { to: inHand({ x: 15.8, y: 15.3 }), kind: 'pass', delay: 80 },
    },
    { holder: 'pA2' },
  );
  const B2c = { x: 12.1, y: 11.2 };
  const B2ctrl = [
    { x: 15.8, y: 13 },
    { x: 13.6, y: 12.6 },
  ];
  b.step('Find a new gate, never the same one twice in a row.', 1800, {
    pA1: {
      to: { x: 12.2, y: 4.3 },
      ctrl: [
        { x: 4.2, y: 0.8 },
        { x: 8.5, y: 3.6 },
      ],
    },
    pA2: {
      to: { x: 12.8, y: 5.6 },
      kind: 'carry',
      ctrl: [
        { x: 5.8, y: 2.4 },
        { x: 9.5, y: 5.2 },
      ],
    },
    pB1: {
      to: { x: 11.2, y: 12.1 },
      ctrl: [
        { x: 14.2, y: 12.6 },
        { x: 12.6, y: 13.4 },
      ],
    },
    pB2: { to: B2c, kind: 'carry', ctrl: B2ctrl },
    ball2: { to: inHand(B2c), ctrl: B2ctrl.map(inHand) },
  });
  b.step(
    'Through the gate and pass again. Count your gates in 60 s.',
    600,
    {
      pA1: { x: 14.5, y: 4.3 },
      pA2: { to: { x: 15.6, y: 5.6 }, kind: 'carry' },
      pB1: { x: 9.8, y: 10.8 },
      pB2: { to: { x: 10.3, y: 9.3 }, kind: 'carry' },
      ball: { kind: 'pass', delay: 350 },
      ball2: { to: inHand({ x: 9.8, y: 10.8 }), kind: 'pass', delay: 80 },
    },
    { holder: 'pA1' },
  );
  return b.build(id, 'Gates — pass through the gates', 5);
}

/**
 * 5 m tackle box in World Rugby Tackle Ready stages (track, prepare, connect, accelerate,
 * finish): contact below the sternum, head to the side, wrap, drive, release, rotate queues.
 */
export function tackleBox(id = 'drill-tackle-box'): Play {
  const b = new DrillBuilder(10, 10);
  b.put('zone', 'box', { x: 5, y: 5 }, { size: { w: 5, h: 5 }, text: 'Tackle box' });
  [
    [2.5, 2.5],
    [7.5, 2.5],
    [7.5, 7.5],
    [2.5, 7.5],
  ].forEach(([x, y], i) => b.put('cone', `cone${i + 1}`, { x: x as number, y: y as number }));
  b.people(
    addPlayers(3, 'line', { x: 5, y: 9 }, undefined, {
      kind: 'attack',
      prefix: 'a',
      dir: { x: 0, y: 1 },
      spacing: 1.3,
    }),
  );
  b.people(
    addPlayers(3, 'line', { x: 5, y: 1 }, undefined, {
      kind: 'defence',
      prefix: 'd',
      dir: { x: 0, y: -1 },
      spacing: 1.3,
    }),
  );
  b.put('coach', 'coach', { x: 9.5, y: 5 });
  ball(b, 'a1');
  // The next carrier's ball, so the loop restarts cleanly.
  b.put('ball', 'ball2', inHand(b.at('a2')));
  b.start(
    '5 × 5 m box. Carriers with balls at one end, tacklers at the other, coach on the side. Progress: walk, then jog, then ¾ pace. Only go to full pace once technique is solid.',
    { holder: 'a1' },
  );
  b.step(
    'Track and prepare: tackler closes the space, then takes short steps. Head up, eyes open, back flat, hips low.',
    1200,
    {
      a1: { to: { x: 5, y: 6.6 }, kind: 'carry' },
      d1: { to: { x: 5.3, y: 4.6 }, delay: 300 },
    },
    { holder: 'a1' },
  );
  b.step(
    'Connect: shoulder contact BELOW THE STERNUM (hip and thigh). Head to the side of the carrier (cheek to cheek), arms wrap tight (ring of steel).',
    700,
    { d1: { x: 5.4, y: 5.5 }, a1: { to: { x: 5, y: 5.9 }, kind: 'carry' } },
    { holder: 'a1' },
  );
  b.step(
    'Accelerate and finish: leg drive, land on top. The carrier places the ball back at arm’s length.',
    900,
    {
      a1: { x: 4.6, y: 6.8 },
      d1: { x: 5.2, y: 6.2 },
      ball: { kind: 'carry', delay: 500 },
    },
    { at: { x: 4.6, y: 8 } },
  );
  b.step('Tackler releases and rolls away. Swap queues; the next carrier picks up a ball.', 1600, {
    d1: {
      to: { x: 5, y: 12.9 },
      ctrl: [
        { x: 7.4, y: 6.2 },
        { x: 7.6, y: 12.9 },
      ],
    },
    a1: {
      to: { x: 5, y: -2.9 },
      ctrl: [
        { x: 1.6, y: 6.5 },
        { x: 1.6, y: -2.9 },
      ],
      delay: 300,
    },
  });
  return b.build(id, 'Tackle box');
}

/** Tackle technique on tubes, progressing kneeling → crouch → walk → jog (Tackle Ready). */
export function tackleTubes(id = 'drill-tackle-tubes'): Play {
  const b = new DrillBuilder(10, 10);
  const xs = [2, 4.5, 7, 9.5];
  xs.forEach((x, i) => b.put('tube', `tube${i + 1}`, { x, y: 4 }));
  b.people(
    bibs(
      'A',
      xs.map((x) => ({ x, y: 8 })),
    ),
  );
  b.people(
    bibs(
      'B',
      xs.map((x) => ({ x, y: 9.6 })),
    ),
  );
  const all = (f: (x: number) => Vec2 | MoveSpec): Record<string, Vec2 | MoveSpec> =>
    Object.fromEntries(xs.map((x, i) => [`pA${i + 1}`, f(x)]));
  const tubes = (f: (x: number) => Vec2 | MoveSpec): Record<string, Vec2 | MoveSpec> =>
    Object.fromEntries(xs.map((x, i) => [`tube${i + 1}`, f(x)]));
  b.start(
    'Four tubes in a line, a tackler 4 m behind each, the next tacklers waiting. Progress: kneeling, crouch, walk, then jog.',
  );
  b.step(
    'Walk in with short steps. Eyes open, head up, back flat.',
    1200,
    all((x) => ({ x, y: 5 })),
  );
  b.step(
    'Connect: shoulder BELOW THE STERNUM (hip and thigh), head to the side (cheek to cheek), arms wrap tight (ring of steel).',
    700,
    all((x) => ({ x: x + 0.3, y: 4.6 })),
  );
  b.step('Leg drive: take the tube over and land on top.', 900, {
    ...all((x) => ({ x, y: 3.6 })),
    ...tubes((x) => ({ x, y: 3 })),
  });
  b.step('Roll away, reset the tube and join the back. Next tackler goes.', 1600, {
    ...all((x) => ({
      to: { x, y: 11.2 },
      ctrl: [
        { x: x + 1.2, y: 3.4 },
        { x: x + 1.2, y: 10.5 },
      ],
    })),
    ...tubes((x) => ({ to: { x, y: 4 }, delay: 600 })),
  });
  return b.build(id, 'Tackle technique on tubes');
}

/** 2v1 in a 10 m channel: fix the defender, pass sideways or back to the free player. */
export function overload2v1(id = 'drill-2v1'): Play {
  const b = new DrillBuilder(10, 22);
  b.put('zone', 'try', { x: 5, y: 1.5 }, { size: { w: 10, h: 3 }, text: 'Try zone' });
  b.put('attack', 'a1', { x: 3, y: 20 }, { number: 1 });
  b.put('attack', 'a2', { x: 7.5, y: 21 }, { number: 2 });
  b.put('defence', 'd1', { x: 5, y: 4 }, { number: 1 });
  b.people(addPlayers(2, 'line', { x: 3, y: 23.5 }, 'A', { spacing: 4.5 }));
  ball(b, 'a1');
  b.start(
    '10 m channel, 22 m long. Two attackers against one defender, who starts on the try-zone line about 15 m away.',
    { holder: 'a1' },
  );
  b.step(
    'Carrier runs straight at the defender’s inside shoulder to fix them. Support stays 3–4 m wide and 1–2 m deeper.',
    1600,
    {
      a1: { to: { x: 4, y: 12 }, kind: 'carry' },
      a2: { x: 7.5, y: 13.4 },
      d1: { x: 4.6, y: 9.6 },
    },
  );
  b.step(
    'Defender commits to the carrier. Pass just before contact, sideways or back, into the support runner’s hands.',
    900,
    {
      a1: { x: 4.2, y: 10.8 },
      a2: { x: 7.8, y: 11.8 },
      d1: { x: 4.5, y: 10.2 },
      ball: { kind: 'pass', delay: 600 },
    },
    { holder: 'a2' },
  );
  b.step('Support runner scores. The defender passes a new ball to the next pair.', 1400, {
    a2: { to: { x: 8, y: 1.5 }, kind: 'carry' },
    a1: { x: 5, y: 7 },
    d1: { x: 6.5, y: 7.5 },
  });
  return b.build(id, '2v1 overload');
}

/** 3v2 in a 15 m channel: fix the first defender, move it past the second. */
export function overload3v2(id = 'drill-3v2'): Play {
  const b = new DrillBuilder(15, 22);
  b.put('zone', 'try', { x: 7.5, y: 1.5 }, { size: { w: 15, h: 3 }, text: 'Try zone' });
  b.put('attack', 'a1', { x: 3, y: 20 }, { number: 1 });
  b.put('attack', 'a2', { x: 7.5, y: 20.5 }, { number: 2 });
  b.put('attack', 'a3', { x: 12, y: 21 }, { number: 3 });
  b.put('defence', 'd1', { x: 5, y: 5 }, { number: 1 });
  b.put('defence', 'd2', { x: 10, y: 5 }, { number: 2 });
  ball(b, 'a1');
  b.start(
    '15 m channel, 22 m long. Three attackers against two defenders, who start on the try-zone line.',
    { holder: 'a1' },
  );
  b.step('Attack goes forward together, each receiver deeper; defenders come up.', 1500, {
    a1: { to: { x: 4, y: 12 }, kind: 'carry' },
    a2: { x: 8, y: 13.5 },
    a3: { x: 12, y: 15 },
    d1: { x: 5, y: 10 },
    d2: { x: 10, y: 10 },
  });
  b.step(
    'A1 fixes D1 and passes to A2.',
    1000,
    {
      a1: { x: 4.5, y: 11 },
      a2: { x: 8.5, y: 12 },
      a3: { x: 12.5, y: 13.2 },
      d1: { x: 4.8, y: 10.2 },
      d2: { x: 9.4, y: 9.2 },
      ball: { kind: 'pass', delay: 650 },
    },
    { holder: 'a2' },
  );
  b.step(
    'A2 draws D2 and passes to A3 on the outside.',
    1000,
    {
      a2: { x: 9, y: 10.4 },
      a3: { x: 13, y: 11.6 },
      d2: { x: 9.3, y: 9.8 },
      ball: { kind: 'pass', delay: 650 },
    },
    { holder: 'a3' },
  );
  b.step('A3 scores. Rotate: attackers become defenders.', 1400, {
    a3: { to: { x: 13, y: 1.5 }, kind: 'carry' },
    d1: { x: 5.6, y: 9.6 },
    d2: { x: 10.4, y: 8.8 },
  });
  return b.build(id, '3v2 overload');
}

const LANES = [2.5, 7.5, 12.5];
type Moves = Record<string, Vec2 | MoveSpec>;
const perLane = (f: (x: number, i: number) => Moves): Moves =>
  Object.assign({}, ...LANES.map((x, i) => f(x, i + 1)));

/**
 * Three ruck-clearing lanes: a tackled "player" (bag) with the ball placed back and a shield
 * holder over it; the clearer enters through the gate and drives the holder beyond the ball.
 */
export function ruckLanes(id = 'drill-ruck-lanes'): Play {
  const b = new DrillBuilder(15, 14);
  LANES.forEach((x, i) => {
    b.put('zone', `lane${i + 1}`, { x, y: 7 }, { size: { w: 5, h: 14 }, text: `Lane ${i + 1}` });
    b.put('bag', `bag${i + 1}`, { x, y: 5.6 });
    b.put('ball', `ball${i + 1}`, { x, y: 6.6 });
  });
  LANES.forEach((x, i) => {
    b.put('defence', `h${i + 1}`, { x, y: 4.4 }, { group: 'B' });
    b.put('shield', `shield${i + 1}`, { x, y: 4.9 });
  });
  b.people(addPlayers(3, 'line', { x: 2.5, y: 11 }, 'A', { spacing: 5 }));
  b.people(addPlayers(3, 'line', { x: 2.5, y: 13.5 }, 'B', { spacing: 5 }));
  b.start(
    'Three 5 m lanes. Tackled “player” (bag) with the ball placed back; a shield holder stands over it. Clearers start 5 m back.',
  );
  b.step(
    'Accelerate in, then shorten your steps. Enter straight through the gate, from behind the ball.',
    1100,
    perLane((x, i) => ({ [`pA${i}`]: { x, y: 7.4 } })),
  );
  b.step(
    'Shoulder on the shield, arms bind, hips low, shoulders above hips. Drive the holder 1–2 m beyond the ball and stay on your feet.',
    1000,
    perLane((x, i) => ({
      [`pA${i}`]: { x, y: 3.6 },
      [`h${i}`]: { x, y: 2.4 },
      [`shield${i}`]: { x, y: 2.9 },
    })),
  );
  b.step(
    'Reset. Rotate clearer to holder, holder to queue. B go next.',
    1600,
    perLane((x, i) => ({
      [`pA${i}`]: {
        to: { x: x + 1.4, y: 13.5 },
        ctrl: [
          { x: x + 2.1, y: 3.6 },
          { x: x + 2.1, y: 12 },
        ],
      },
      [`h${i}`]: { x, y: 4.4 },
      [`shield${i}`]: { x, y: 4.9 },
    })),
  );
  return b.build(id, 'Ruck clearing lanes');
}

/**
 * Jackal vs clear-out in three lanes: the jackal arrives first and gets hands on the ball; the
 * clearer drives them off through the gate; the 9 clears the ball.
 */
export function jackalClearOut(id = 'drill-jackal'): Play {
  const b = new DrillBuilder(15, 12);
  LANES.forEach((x, i) => {
    b.put('zone', `lane${i + 1}`, { x, y: 6 }, { size: { w: 5, h: 12 }, text: `Lane ${i + 1}` });
    b.put('bag', `bag${i + 1}`, { x, y: 6 });
    b.put('ball', `ball${i + 1}`, { x, y: 6.9 });
  });
  LANES.forEach((x, i) => {
    b.put('defence', `j${i + 1}`, { x, y: 2.5 });
    b.put('attack', `c${i + 1}`, { x, y: 11.5 });
    b.put('attack', `s${i + 1}`, { x: x - 1.5, y: 13 }, { group: 'A', number: 9 });
  });
  b.start(
    'Tackle has happened: ball placed back behind the bag (the tackled player). Jackal on the defending side, clearer 5 m back, 9 behind.',
  );
  b.step(
    'Jackal arrives first through their own gate: feet behind the tackled player, hips low, hands straight on the ball, lift.',
    900,
    perLane((x, i) => ({ [`j${i}`]: { x, y: 5 } })),
  );
  b.step(
    'Clearer accelerates, then shortens steps. Enter straight through the gate from behind the ball.',
    1100,
    perLane((x, i) => ({ [`c${i}`]: { x, y: 7.6 } })),
  );
  b.step(
    'Shoulder into the jackal’s chest/ribs (below the neck), bind with both arms, drive up and through 1–2 m. No neck roll, no crocodile roll.',
    900,
    perLane((x, i) => ({ [`c${i}`]: { x, y: 4 }, [`j${i}`]: { x, y: 2.6 } })),
  );
  b.step(
    'Ruck won: the 9 arrives at the ball.',
    1000,
    perLane((x, i) => ({
      [`s${i}`]: { x: x - 0.4, y: 7.6 },
      [`ball${i}`]: { to: inHand({ x: x - 0.4, y: 7.6 }), delay: 700 },
    })),
  );
  b.step(
    '9 clears the ball. Rotate: jackal → bag, clearer → jackal, 9 → clearer.',
    800,
    perLane((x, i) => ({
      [`ball${i}`]: { to: { x: x - 1.8, y: 10.4 }, kind: 'pass', delay: 100 },
    })),
  );
  return b.build(id, 'Jackal vs clear-out');
}

/** Defensive line speed: five defenders go on the 9's pass, stay connected and arrive balanced. */
export function lineSpeed(id = 'drill-line-speed'): Play {
  const b = new DrillBuilder(30, 22);
  b.put('zone', 'zone', { x: 15, y: 1 }, { size: { w: 30, h: 2 }, text: 'Try zone' });
  b.put('cone', 'ruck', { x: 4, y: 10 });
  b.put('label', 'ruckLbl', { x: 1.4, y: 10 }, { text: 'Ruck' });
  b.put('attack', 'a9', { x: 4, y: 11 }, { number: 9 });
  const ax = [8, 13, 18, 23, 28];
  const ay = [14, 15, 16, 17, 18];
  ax.forEach((x, i) => b.put('attack', `a${i + 1}`, { x, y: ay[i] as number }, { number: i + 1 }));
  const dx = [5.5, 9.5, 14.5, 19.5, 24.5];
  dx.forEach((x, i) => b.put('defence', `d${i + 1}`, { x, y: 8.5 }, { number: i + 1 }));
  ball(b, 'a9');
  b.start(
    'Defense set on the offside line, tight to the ruck, wider outwards. Point and call your attacker.',
    { holder: 'a9' },
  );
  b.step(
    'Go on the 9’s pass, not before. Move up together, eyes on the inside attacker.',
    800,
    {
      ...Object.fromEntries(dx.map((x, i) => [`d${i + 1}`, { x: x + 0.5, y: 11 }])),
      ball: { kind: 'pass' },
    },
    { holder: 'a1' },
  );
  b.step(
    'Keep the line straight — nobody ahead, nobody behind (no dog-legs). Inside shoulder of your attacker.',
    800,
    {
      ...Object.fromEntries(ax.map((x, i) => [`a${i + 1}`, { x, y: (ay[i] as number) - 1 }])),
      d1: { x: 6.8, y: 12.2 },
      d2: { x: 10.5, y: 13 },
      d3: { x: 15.5, y: 13 },
      d4: { x: 20.5, y: 13 },
      d5: { x: 25.5, y: 13 },
      ball: { kind: 'pass', delay: 450 },
    },
    { holder: 'a2' },
  );
  b.step(
    'Short steps for the last 3 m, arrive balanced, two-hand touch (tackle below the sternum in live). Then fold and reset.',
    900,
    {
      a2: { x: 13, y: 13.7 },
      a3: { x: 18, y: 14.7 },
      a4: { x: 23, y: 15.7 },
      a5: { x: 28, y: 16.7 },
      d2: { x: 12.1, y: 12.5 },
      d3: { x: 17.1, y: 13.4 },
      d4: { x: 22.1, y: 14.4 },
      d5: { x: 26.8, y: 15 },
    },
    { holder: 'a2' },
  );
  return b.build(id, 'Defensive line speed');
}

/** RAMP warm-up in four lanes: raise, mobilise, activate, potentiate, change of direction. */
export function dynamicWarmup(id = 'drill-warmup'): Play {
  const b = new DrillBuilder(20, 20);
  for (const y of [20, 10, 0])
    for (const x of [0, 5, 10, 15, 20]) b.put('cone', `c${x}-${y}`, { x, y });
  const xs = [2.5, 7.5, 12.5, 17.5];
  b.people(
    bibs(
      'A',
      xs.map((x) => ({ x, y: 20.5 })),
    ),
  );
  b.people(
    bibs(
      'B',
      xs.map((x) => ({ x, y: 22.5 })),
    ),
  );
  const wave = (f: (x: number) => MoveSpec): Moves =>
    Object.fromEntries(xs.map((x, i) => [`pA${i + 1}`, f(x)]));
  b.start('Raise: jog out and back, then side-shuffle out, back-pedal home. Waves of four.');
  b.step(
    'Raise: jog to the far line.',
    2000,
    wave((x) => ({ to: { x, y: 0.5 }, ease: 'linear' })),
  );
  b.step(
    'Mobilise: walking lunge with a twist, leg swings, inchworm to halfway.',
    2000,
    wave((x) => ({ to: { x, y: 10.5 }, ease: 'linear' })),
  );
  b.step(
    'Activate (World Rugby Activate): single-leg balance, squats, lunges, Nordic hamstring in pairs — 2–3 min.',
    1500,
    {},
  );
  b.step(
    'Potentiate: build-ups 60%, 80%, 95% to the far line.',
    1600,
    wave((x) => ({ to: { x, y: 0.5 }, ease: 'out' })),
  );
  b.step(
    'Change of direction: plant and cut at each cone. Finish with a pass along the wave and two 90–100% sprints.',
    1600,
    wave((x) => ({
      to: { x, y: 20.5 },
      ctrl: [
        { x: x + 2, y: 7 },
        { x: x - 2, y: 14 },
      ],
    })),
  );
  return b.build(id, 'Dynamic warm-up (RAMP)');
}

/** Lineout pod on the left touchline: throw, lift and catch, then the maul option. */
export function lineoutPod(id = 'drill-lineout-pod'): Play {
  const b = new DrillBuilder(16, 12);
  b.put('label', 'touch', { x: 1.6, y: 0.8 }, { text: 'Touchline' });
  b.put('cone', 'c5', { x: 5, y: 6 });
  b.put('cone', 'c15', { x: 15, y: 6 });
  b.put('label', 'l5', { x: 5, y: 4.4 }, { text: '5 m' });
  b.put('label', 'l15', { x: 15, y: 4.4 }, { text: '15 m' });
  b.put('player', 'p2', { x: -0.4, y: 6 }, { group: 'A', number: 2 });
  b.put('player', 'pL1', { x: 5.8, y: 6.5 }, { group: 'A', text: 'L' });
  b.put('player', 'pJ', { x: 7.1, y: 6.5 }, { group: 'A', text: 'J' });
  b.put('player', 'pL2', { x: 8.4, y: 6.5 }, { group: 'A', text: 'L' });
  b.put('player', 'p9', { x: 9.4, y: 9 }, { group: 'A', number: 9 });
  ball(b, 'p2');
  const pod = (y: number): Moves => ({
    pL1: { x: 5.8, y },
    pJ: { x: 7.1, y },
    pL2: { x: 8.4, y },
  });
  b.start(
    'Hooker on the touchline. Pod 0.5 m off the line of touch, 6–8 m from touch; 9 two metres back. Call the code.',
    { holder: 'p2' },
  );
  b.step('Movement: the pod steps back to lose the opposition jumper…', 600, pod(7.3));
  b.step(
    '…then forward. Throw straight down the line of touch. Lifters lift: front lifter at the top of the shorts, back lifter at the thighs (Law 18).',
    900,
    { ...pod(6.5), ball: { kind: 'pass', delay: 350 } },
    { at: { x: 7.1, y: 6.2 } },
  );
  b.step(
    'Catch at full height with two hands (or tap off the top to the 9). Lifters hold the jumper and lower them safely, feet first.',
    800,
    { ball: { kind: 'carry' } },
    { holder: 'pJ' },
  );
  b.step(
    'Maul option: the jumper lands and turns to face their own team. Lifters bind on, ball to the back, hooker joins.',
    1200,
    {
      pJ: { x: 7.1, y: 7.4 },
      pL1: { x: 6.3, y: 7.9 },
      pL2: { x: 7.9, y: 7.9 },
      p2: { to: { x: 7.1, y: 8.9 }, ctrl: [{ x: 3, y: 9 }] },
      p9: { x: 9.8, y: 10.2 },
      ball: { kind: 'pass', delay: 700 },
    },
    { holder: 'p2' },
  );
  b.step('Drive low and together, infield and forward. 9 follows the ball.', 1400, {
    pJ: { x: 10.1, y: 5.4 },
    pL1: { x: 9.3, y: 5.9 },
    pL2: { x: 10.9, y: 5.9 },
    p2: { x: 10.1, y: 6.9 },
    p9: { x: 12.4, y: 8 },
  });
  return b.build(id, 'Lineout pod — throw, lift, catch');
}

/** Lineout throwing accuracy: the hooker throws to targets at the front, middle and back. */
export function lineoutThrowing(id = 'drill-lineout-throwing'): Play {
  const b = new DrillBuilder(16, 10);
  b.put('label', 'touch', { x: 1.6, y: 0.8 }, { text: 'Touchline' });
  b.put('cone', 'c5', { x: 5, y: 5 });
  b.put('cone', 'c15', { x: 15, y: 5 });
  const targets: [number, string][] = [
    [7, 'Front 7 m'],
    [10, 'Middle 10 m'],
    [13, 'Back 13 m'],
  ];
  targets.forEach(([x, t], i) => {
    b.put('pole', `pole${i + 1}`, { x, y: 5 });
    b.put('label', `t${i + 1}`, { x, y: i % 2 ? 7.2 : 3 }, { text: t });
  });
  b.put('player', 'p2', { x: -0.4, y: 5 }, { group: 'A', number: 2 });
  b.put('ball', 'ball', { x: 0.25, y: 5.45 });
  b.put('ball', 'ball2', { x: -1.2, y: 6.4 });
  b.put('ball', 'ball3', { x: -0.2, y: 6.6 });
  b.start(
    'Poles (or a held shield) at 7, 10 and 13 m from touch, at lifted-hands height (about 3.5 m). Cones on the 5 m and 15 m lines.',
  );
  b.step(
    'Front target: same routine every throw, straight down the line of touch.',
    900,
    { ball: { kind: 'pass', delay: 200 } },
    { at: { x: 7, y: 5 } },
  );
  b.step('Middle target: spiral, follow through to the target.', 1000, {
    ball2: { to: { x: 10, y: 5 }, kind: 'pass', delay: 200 },
  });
  b.step(
    'Back target. A throw that isn’t straight gives the other team a lineout or scrum.',
    1100,
    { ball3: { to: { x: 13, y: 5 }, kind: 'pass', delay: 200 } },
  );
  return b.build(id, 'Lineout throwing targets');
}

/** Box kick, chase and catch from a ruck near the left touchline. */
export function boxKickChase(id = 'drill-box-kick'): Play {
  const b = new DrillBuilder(30, 40);
  b.put('zone', 'zone', { x: 12, y: 12 }, { size: { w: 6, h: 6 }, text: 'Land here' });
  b.put('label', 'touch', { x: 2.6, y: 30 }, { text: 'Touchline' });
  b.put('cone', 'ruck', { x: 12, y: 36 });
  b.put('label', 'ruckLbl', { x: 15, y: 35.6 }, { text: 'Ruck' });
  b.put('attack', 'p9', { x: 12, y: 37.5 }, { number: 9 });
  b.put('attack', 'c1', { x: 3, y: 37.8 }, { text: 'W' });
  b.put('attack', 'c2', { x: 20, y: 37.8 });
  b.put('defence', 'r1', { x: 12, y: 8 });
  ball(b, 'p9');
  b.start(
    '9 behind the ruck. Wing chaser on the touch side, second chaser inside, both behind the kicker so they are onside. Receiver 25 m downfield.',
    { holder: 'p9' },
  );
  b.step(
    '9 box-kicks over the ruck: high (4+ s hang) to land in the zone, 10–15 m in from touch. Chasers go on the kick.',
    3000,
    {
      c1: { to: { x: 10.6, y: 14.4 }, delay: 250 },
      c2: { to: { x: 15.6, y: 16.2 }, delay: 250 },
      r1: { x: 12, y: 11.4 },
      ball: { kind: 'kick', delay: 200 },
    },
    { at: { x: 12, y: 12 } },
  );
  b.step(
    'Wing times the jump to compete for the ball. The receiver calls “Mine!”, gets side-on and catches above the head.',
    900,
    { c1: { x: 11.2, y: 13.3 }, ball: { kind: 'carry' } },
    { holder: 'r1' },
  );
  b.step(
    'Contest the ball, never the player in the air. If the receiver catches, the second chaser tackles once they land.',
    900,
    { c2: { x: 13.6, y: 13 } },
    { holder: 'r1' },
  );
  return b.build(id, 'Box kick — chase and catch');
}

/** Conditioning shuttle: 5–10–15 m out and back. */
export function conditioningShuttle(id = 'drill-shuttle'): Play {
  const b = new DrillBuilder(10, 20);
  [19, 14, 9, 4].forEach((y, i) => {
    b.put('cone', `cL${i}`, { x: 0.5, y });
    b.put('cone', `cR${i}`, { x: 9.5, y });
    if (i > 0) b.put('label', `lbl${i}`, { x: 12, y }, { text: `${i * 5} m` });
  });
  b.people(addPlayers(4, 'line', { x: 2, y: 19.5 }, 'A', { spacing: 2 }));
  const to = (y: number) =>
    Object.fromEntries(
      [1, 2, 3, 4].map((n) => [
        `pA${n}`,
        { to: { x: 2 + (n - 1) * 2, y }, ease: 'linear' as const },
      ]),
    );
  b.start(
    'Lines at 0, 5, 10 and 15 m. Everyone starts on the 0 m line. Touch each line with your hand; turn low.',
  );
  b.step('Sprint to the 5 m line and touch it.', 1000, to(13.5));
  b.step('Back to the start line.', 1000, to(19.5));
  b.step('Sprint to 10 m and touch.', 1400, to(8.5));
  b.step('Back to the start.', 1400, to(19.5));
  b.step('Sprint to 15 m and touch.', 1800, to(3.5));
  b.step('Back to the start. Rest about twice the work time, then repeat.', 1800, to(19.5));
  return b.build(id, 'Conditioning shuttle');
}

/** Touch / flag game area with try zones at both ends. */
export function touchGame(id = 'drill-touch'): Play {
  const b = new DrillBuilder(25, 35);
  b.put(
    'zone',
    'tz1',
    { x: 12.5, y: 1.5 },
    { size: { w: 25, h: 3 }, text: 'Try zone', group: 'B' },
  );
  b.put(
    'zone',
    'tz2',
    { x: 12.5, y: 33.5 },
    { size: { w: 25, h: 3 }, text: 'Try zone', group: 'A' },
  );
  for (const [x, y] of [
    [0, 0],
    [25, 0],
    [25, 35],
    [0, 35],
    [0, 3],
    [25, 3],
    [0, 32],
    [25, 32],
  ] as const)
    b.put('cone', `c${x}-${y}`, { x, y });
  b.people(addPlayers(5, 'line', { x: 4, y: 24 }, 'A', { spacing: 4.2 }));
  b.people(addPlayers(5, 'line', { x: 4, y: 15 }, 'B', { spacing: 4.2 }));
  b.put('coach', 'coach', { x: 27, y: 17.5 });
  ball(b, 'pA3');
  b.start('25 × 35 m with 3 m try zones. A attack up the pitch, B defend.', {
    holder: 'pA3',
  });
  b.step(
    'A move the ball wide, each receiver deeper; B line comes up together.',
    1600,
    {
      pA3: { x: 12.4, y: 21 },
      pA4: { x: 16.6, y: 22.5 },
      pA5: { x: 21, y: 23 },
      pB1: { x: 4, y: 18 },
      pB2: { x: 8.2, y: 18 },
      pB3: { x: 12.4, y: 18 },
      pB4: { x: 16.6, y: 18.5 },
      pB5: { x: 20.8, y: 18.5 },
      ball: { kind: 'pass', delay: 900 },
    },
    { holder: 'pA4' },
  );
  b.step(
    'Touch (or flag pull) made: play the ball on the mark; the defense retreats 5 m.',
    1400,
    {
      pA4: { x: 17.5, y: 19.5 },
      pB4: { x: 17.5, y: 18.4 },
      pB1: { x: 4, y: 14 },
      pB2: { x: 8.2, y: 14 },
      pB3: { x: 12.4, y: 14 },
      pB5: { x: 20.8, y: 14 },
    },
    { at: { x: 17.5, y: 20.2 } },
  );
  b.step(
    'Half picks up and attacks the space. Six touches then turnover.',
    1600,
    {
      pA4: { x: 16.5, y: 20.8 },
      pA5: { x: 18, y: 21 },
      pB4: { x: 17.5, y: 14 },
      ball: { kind: 'carry' },
    },
    { holder: 'pA5' },
  );
  return b.build(id, 'Touch / flag game');
}

/** Templates offered in the "New drill" picker, by id. */
export const DRILL_TEMPLATES = {
  squareGrid: { label: 'Square grid (4 corners)', build: squareGrid },
  channels: { label: 'Channels', build: channels },
  trianglePassing: { label: 'Triangle passing', build: trianglePassing },
  gates: { label: 'Gates', build: gates },
  tackleBox: { label: 'Tackle box', build: tackleBox },
  overload2v1: { label: '2v1 overload', build: overload2v1 },
  overload3v2: { label: '3v2 overload', build: overload3v2 },
  ruckLanes: { label: 'Ruck-clearing lanes', build: ruckLanes },
  conditioningShuttle: {
    label: 'Conditioning shuttle',
    build: conditioningShuttle,
  },
  touchGame: { label: 'Touch / flag game', build: touchGame },
} as const satisfies Record<string, { label: string; build: (id?: string) => Play }>;
export type DrillTemplateId = keyof typeof DRILL_TEMPLATES;

/**
 * Further templates behind the starter-pack diagrams. Not in the picker yet: it also needs a
 * category / contact / players hint per template in the web app's NewDrillSheet.
 */
export const EXTRA_DRILL_TEMPLATES = {
  dynamicWarmup: { label: 'Dynamic warm-up (RAMP)', build: dynamicWarmup },
  tackleTubes: { label: 'Tackle tubes', build: tackleTubes },
  jackalClearOut: { label: 'Jackal vs clear-out', build: jackalClearOut },
  lineSpeed: { label: 'Defensive line speed', build: lineSpeed },
  lineoutPod: { label: 'Lineout pod', build: lineoutPod },
  lineoutThrowing: {
    label: 'Lineout throwing targets',
    build: lineoutThrowing,
  },
  boxKickChase: { label: 'Box kick and chase', build: boxKickChase },
} as const satisfies Record<string, { label: string; build: (id?: string) => Play }>;
