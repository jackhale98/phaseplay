/**
 * Drill templates (docs/diagrams.md §Drill mode): editable starting points that each return a
 * looping drill-mode Play on a grass area, with one caption per frame as the step-by-step
 * instructions. Drill coordinates run 0..w across and 0..h along; "forward" is towards y = 0.
 */
import type { Entity, EntityKind, Frame, Move, Play, Vec2 } from '@phaseplay/shared';
import type { EaseName } from './geometry';
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

/** 10 m square with a cone and a queue (groups A–D) at each corner; pass and follow. */
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
      addPlayers(3, 'line', { x: c.x + out.x, y: c.y + out.y }, g, { dir: out, spacing: 1.4 }),
    );
  });
  ball(b, 'pA1');
  b.start('Set up a 10 m square: a cone and a queue of three at each corner. Ball starts with A.', {
    holder: 'pA1',
  });
  const back = (g: Group) => {
    const c = corners.find(([k]) => k === g) as [Group, Vec2, Vec2];
    return { x: c[1].x + c[2].x * 5.2, y: c[1].y + c[2].y * 5.2 };
  };
  b.step(
    'A1 runs to B, passes to B1 and follows the pass to the back of the B queue.',
    1800,
    { pA1: { to: back('B'), kind: 'carry' }, ball: { kind: 'pass', delay: 900 } },
    { holder: 'pB1' },
  );
  b.step(
    'B1 carries to C, passes to C1 and joins the C queue.',
    1800,
    { pB1: { to: back('C'), kind: 'carry' }, ball: { kind: 'pass', delay: 900 } },
    { holder: 'pC1' },
  );
  b.step(
    'C1 carries to D, passes to D1 and joins the D queue. Keep it going round.',
    1800,
    { pC1: { to: back('D'), kind: 'carry' }, ball: { kind: 'pass', delay: 900 } },
    { holder: 'pD1' },
  );
  return b.build(id, 'Square grid — pass and follow');
}

/** Three 5 m channels; a line of three passes along as it advances. */
export function channels(id = 'drill-channels'): Play {
  const b = new DrillBuilder(15, 20);
  [2.5, 7.5, 12.5].forEach((x, i) =>
    b.put('zone', `ch${i + 1}`, { x, y: 10 }, { size: { w: 5, h: 20 }, text: `Channel ${i + 1}` }),
  );
  b.people(addPlayers(3, 'line', { x: 2.5, y: 19 }, 'A', { spacing: 5 }));
  b.people(addPlayers(3, 'line', { x: 2.5, y: 22.5 }, 'B', { spacing: 5 }));
  ball(b, 'pA1');
  b.start('Three 5 m channels, 20 m long. Group A on the line, B waiting behind.', {
    holder: 'pA1',
  });
  b.step(
    'A advance in their channels; A1 passes to A2.',
    1600,
    {
      pA1: { x: 2.5, y: 12 },
      pA2: { x: 7.5, y: 12 },
      pA3: { x: 12.5, y: 12 },
      ball: { kind: 'pass', delay: 800 },
    },
    { holder: 'pA2' },
  );
  b.step(
    'A2 passes to A3, stay in your channel and keep depth.',
    1600,
    {
      pA1: { x: 2.5, y: 5 },
      pA2: { x: 7.5, y: 5 },
      pA3: { x: 12.5, y: 5 },
      ball: { kind: 'pass', delay: 800 },
    },
    { holder: 'pA3' },
  );
  b.step('A3 finishes over the line. A jog back down the outside; B go next.', 1600, {
    pA1: { x: 2.5, y: 0.5 },
    pA2: { x: 7.5, y: 0.5 },
    pA3: { x: 12.5, y: 0.5 },
  });
  return b.build(id, 'Channels — pass along the line');
}

/** Triangle of cones 8–10 m apart: pass and follow around the triangle. */
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
  b.start('Three cones in a triangle, two players at each. Ball starts at the top.', {
    holder: 'pA1',
  });
  b.step(
    'A1 passes to B1 and follows the pass.',
    1500,
    { pA1: { to: { x: 11, y: 12.2 } }, ball: { kind: 'pass', delay: 200 } },
    { holder: 'pB1' },
  );
  b.step(
    'B1 passes to C1 and follows the pass.',
    1500,
    { pB1: { to: { x: 1, y: 12.2 } }, ball: { kind: 'pass', delay: 200 } },
    { holder: 'pC1' },
  );
  b.step(
    'C1 passes to A2 and follows. Switch direction after two minutes.',
    1500,
    { pC1: { to: { x: 6, y: -0.2 } }, ball: { kind: 'pass', delay: 200 } },
    { holder: 'pA2' },
  );
  return b.build(id, 'Triangle passing');
}

/** Gates scattered in a 20 m square: pairs pass through as many gates as they can. */
export function gates(id = 'drill-gates'): Play {
  const b = new DrillBuilder(20, 20);
  const gs: [Vec2, number][] = [
    [{ x: 5, y: 5 }, 0],
    [{ x: 15, y: 5 }, 90],
    [{ x: 10, y: 10 }, 45],
    [{ x: 5, y: 15 }, 90],
    [{ x: 15, y: 15 }, 0],
  ];
  gs.forEach(([p, rot], i) => b.put('gate', `gate${i + 1}`, p, { size: { w: 3, h: 0.5, rot } }));
  b.people(addPlayers(2, 'line', { x: 4, y: 19 }, 'A', { spacing: 2 }));
  b.people(addPlayers(2, 'line', { x: 14, y: 19 }, 'B', { spacing: 2 }));
  ball(b, 'pA1');
  b.start('Five gates (cone pairs 3 m wide) in a 20 m square. Work in pairs.', { holder: 'pA1' });
  b.step(
    'Pairs run through a gate; the pass must go through it.',
    1800,
    {
      pA1: { x: 4, y: 7 },
      pA2: { x: 6.5, y: 4.5 },
      pB1: { to: { x: 14, y: 6 }, ctrl: [{ x: 13, y: 12 }] },
      pB2: { x: 16.5, y: 6 },
      ball: { kind: 'pass', delay: 1000 },
    },
    { holder: 'pA2' },
  );
  b.step(
    'Find a new gate — no gate twice in a row. Count the gates in 60 s.',
    1800,
    {
      pA1: { x: 9, y: 11.5 },
      pA2: { x: 11, y: 9 },
      pB1: { x: 14, y: 16 },
      pB2: { x: 16, y: 14 },
      ball: { kind: 'pass', delay: 1000 },
    },
    { holder: 'pA1' },
  );
  return b.build(id, 'Gates — pass through the gates', 5);
}

/** 5 m tackle box: carrier into a tackler, ball presented, rotate queues. */
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
  b.start('5 m box. Carriers queue at one end, tacklers at the other. Coach on the side.', {
    holder: 'a1',
  });
  b.step(
    'Carrier runs in; tackler steps in, chest low, cheek to cheek.',
    1400,
    { a1: { x: 5, y: 5.8 }, d1: { to: { x: 5, y: 4.9 }, delay: 300 } },
    { holder: 'a1' },
  );
  b.step(
    'Both to ground: carrier presents the ball long, tackler rolls away.',
    1200,
    { a1: { x: 4.6, y: 5.8 }, d1: { x: 6.4, y: 4.6 } },
    { at: { x: 5, y: 7.2 } },
  );
  b.step('Swap: carrier joins the tackle line, tackler joins the carriers.', 1600, {
    a1: { to: { x: 3, y: -2 }, ctrl: [{ x: 1, y: 4 }] },
    d1: { to: { x: 7, y: 12.5 }, ctrl: [{ x: 9, y: 7 }] },
  });
  return b.build(id, 'Tackle box');
}

/** 2v1 in a 10 m channel: draw the defender, pass to the free player. */
export function overload2v1(id = 'drill-2v1'): Play {
  const b = new DrillBuilder(10, 22);
  b.put('zone', 'try', { x: 5, y: 1.5 }, { size: { w: 10, h: 3 }, text: 'Try zone' });
  b.put('attack', 'a1', { x: 3, y: 20 }, { number: 1 });
  b.put('attack', 'a2', { x: 7.5, y: 20 }, { number: 2 });
  b.put('defence', 'd1', { x: 5, y: 5 }, { number: 1 });
  b.people(addPlayers(2, 'line', { x: 3, y: 23 }, 'A', { spacing: 4.5 }));
  ball(b, 'a1');
  b.start('10 m channel, 22 m long. Two attackers against one defender.', { holder: 'a1' });
  b.step('Carrier attacks the defender’s inside shoulder; support holds width.', 1600, {
    a1: { x: 4, y: 11 },
    a2: { x: 8, y: 12 },
    d1: { x: 4.5, y: 9.5 },
  });
  b.step(
    'Defender commits — pass to the free player.',
    1000,
    { a1: { x: 3.8, y: 10.6 }, a2: { x: 8, y: 9 }, ball: { kind: 'pass', delay: 200 } },
    { holder: 'a2' },
  );
  b.step('Support scores in the try zone. Next pair go.', 1400, {
    a2: { x: 8, y: 1.5 },
    a1: { x: 5, y: 5 },
    d1: { x: 6.5, y: 6 },
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
  b.start('15 m channel. Three attackers against two defenders.', { holder: 'a1' });
  b.step('Attack goes forward together; defenders come up.', 1500, {
    a1: { x: 4, y: 12 },
    a2: { x: 8, y: 13 },
    a3: { x: 12.5, y: 14 },
    d1: { x: 5, y: 10 },
    d2: { x: 10, y: 10 },
  });
  b.step(
    'A1 fixes D1 and passes to A2.',
    1000,
    {
      a1: { x: 4.5, y: 11.2 },
      a2: { x: 8.5, y: 11 },
      a3: { x: 12.5, y: 12 },
      d1: { x: 4.8, y: 9.8 },
      d2: { x: 9.5, y: 8.5 },
      ball: { kind: 'pass', delay: 300 },
    },
    { holder: 'a2' },
  );
  b.step(
    'A2 draws D2 and passes to A3 on the outside.',
    1000,
    {
      a2: { x: 9, y: 9.6 },
      a3: { x: 13, y: 9.5 },
      d2: { x: 9.4, y: 8.2 },
      ball: { kind: 'pass', delay: 300 },
    },
    { holder: 'a3' },
  );
  b.step('A3 scores. Rotate: attackers become defenders.', 1400, { a3: { x: 13, y: 1.5 } });
  return b.build(id, '3v2 overload');
}

/** Three ruck-clearing lanes: hit the bag over the ball, drive it beyond, reset. */
export function ruckLanes(id = 'drill-ruck-lanes'): Play {
  const b = new DrillBuilder(15, 12);
  [2.5, 7.5, 12.5].forEach((x, i) => {
    b.put('zone', `lane${i + 1}`, { x, y: 6 }, { size: { w: 5, h: 12 }, text: `Lane ${i + 1}` });
    b.put('bag', `bag${i + 1}`, { x, y: 3.5 });
    b.put('ball', `ball${i + 1}`, { x, y: 5 });
  });
  b.people(addPlayers(3, 'line', { x: 2.5, y: 11 }, 'A', { spacing: 5 }));
  b.people(addPlayers(3, 'line', { x: 2.5, y: 13.5 }, 'B', { spacing: 5 }));
  b.start('Three lanes. A tackle bag over a ball in each lane; clearers queue at the far end.');
  b.step('Clearers sprint in, low body height, eyes on the bag.', 1300, {
    pA1: { x: 2.5, y: 5.6 },
    pA2: { x: 7.5, y: 5.6 },
    pA3: { x: 12.5, y: 5.6 },
  });
  b.step('Drive the bag 2 m beyond the ball; stay on your feet.', 1100, {
    pA1: { x: 2.5, y: 3.2 },
    pA2: { x: 7.5, y: 3.2 },
    pA3: { x: 12.5, y: 3.2 },
    bag1: { x: 2.5, y: 1.2 },
    bag2: { x: 7.5, y: 1.2 },
    bag3: { x: 12.5, y: 1.2 },
  });
  b.step('Reset the bag; clearer jogs back round the outside. B go next.', 1600, {
    pA1: { to: { x: 0.5, y: 13.5 }, ctrl: [{ x: -0.5, y: 6 }] },
    pA2: { to: { x: 5.5, y: 13.5 }, ctrl: [{ x: 5.2, y: 6 }] },
    pA3: { to: { x: 14.5, y: 13.5 }, ctrl: [{ x: 15.5, y: 6 }] },
    bag1: { x: 2.5, y: 3.5 },
    bag2: { x: 7.5, y: 3.5 },
    bag3: { x: 12.5, y: 3.5 },
  });
  return b.build(id, 'Ruck clearing lanes');
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
  b.start('Lines at 0, 5, 10 and 15 m. Everyone starts on the 0 m line.');
  b.step('Sprint to the 5 m line and touch it.', 1000, to(13.5));
  b.step('Back to the start line.', 1000, to(19.5));
  b.step('Sprint to 10 m and touch.', 1400, to(8.5));
  b.step('Back to the start.', 1400, to(19.5));
  b.step('Sprint to 15 m and touch.', 1800, to(3.5));
  b.step('Back to the start. Rest 30 s, repeat ×4.', 1800, to(19.5));
  return b.build(id, 'Conditioning shuttle');
}

/** Touch/tag game area with try zones at both ends. */
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
  b.start('25 × 35 m with 3 m try zones. A attack up the pitch, B defend.', { holder: 'pA3' });
  b.step(
    'A move the ball wide; B line comes up together.',
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
    'Touch made: play the ball on the mark; defence retreats 5 m.',
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
      pA5: { x: 18, y: 21 },
      pB4: { x: 17.5, y: 14 },
      ball: { kind: 'carry' },
    },
    { holder: 'pA5' },
  );
  return b.build(id, 'Touch / tag game');
}

/** Every drill template by id. */
export const DRILL_TEMPLATES = {
  squareGrid: { label: 'Square grid (4 corners)', build: squareGrid },
  channels: { label: 'Channels', build: channels },
  trianglePassing: { label: 'Triangle passing', build: trianglePassing },
  gates: { label: 'Gates', build: gates },
  tackleBox: { label: 'Tackle box', build: tackleBox },
  overload2v1: { label: '2v1 overload', build: overload2v1 },
  overload3v2: { label: '3v2 overload', build: overload3v2 },
  ruckLanes: { label: 'Ruck-clearing lanes', build: ruckLanes },
  conditioningShuttle: { label: 'Conditioning shuttle', build: conditioningShuttle },
  touchGame: { label: 'Touch / tag game', build: touchGame },
} as const satisfies Record<string, { label: string; build: (id?: string) => Play }>;
export type DrillTemplateId = keyof typeof DRILL_TEMPLATES;
