import { describe, expect, it } from 'vitest';
import { runSteps, type DrillMeta, type PlanData, type RunEvent } from '@phaseplay/shared';
import {
  addSlot,
  copyPlanData,
  emptyPlan,
  insertWater,
  laneFor,
  lastPlanBefore,
  makeBlock,
  moveSlot,
  overview,
  removeBlock,
  rotationRounds,
  setLaneBlock,
  setLanes,
  splitSlot,
  updateBlock,
} from './model';
import {
  crossed,
  dueAdvances,
  formatClock,
  laneStatus,
  mergeEvents,
  runView,
  summary,
  transitionId,
} from './runner';

const drill = (id: string, o: Partial<DrillMeta>): DrillMeta =>
  ({
    id,
    title: id,
    contactLevel: 'none',
    intensity: 2,
    equipment: {},
    defaultDurationMin: 10,
    ...o,
  }) as DrillMeta;

const DRILLS: Record<string, DrillMeta> = {
  warm: drill('warm', { equipment: { cones: 8 }, defaultDurationMin: 10 }),
  pass: drill('pass', { equipment: { cones: 8, balls: 2 }, intensity: 3 }),
  ruck: drill('ruck', {
    contactLevel: 'shields',
    intensity: 4,
    equipment: { tackle_shields: 4, balls: 3 },
  }),
  threev2: drill('threev2', {
    contactLevel: 'touch',
    intensity: 4,
    equipment: { cones: 4, balls: 2 },
  }),
  line: drill('line', { contactLevel: 'touch', intensity: 3, equipment: { cones: 6, balls: 1 } }),
  touch: drill('touch', {
    contactLevel: 'touch',
    intensity: 3,
    equipment: { cones: 8, balls: 1, bibs: 15 },
  }),
};

/** The acceptance session: 6 drills, 2 water breaks, a forwards/backs split, 90 minutes. */
function ninetyMinutes(): PlanData {
  let p = setLanes(emptyPlan(), ['forwards', 'backs']);
  const add = (id: string, min: number, lane = 'all') =>
    (p = addSlot(p, { ...makeBlock('drill', lane, DRILLS[id]), durationMin: min }));
  add('warm', 10);
  add('pass', 10);
  p = insertWater(p, p.slots.length - 1);
  add('ruck', 20, 'forwards');
  p = setLaneBlock(p, p.slots.at(-1)!.id, {
    ...makeBlock('drill', 'backs', DRILLS.threev2),
    durationMin: 20,
  });
  p = insertWater(p, p.slots.length - 1);
  add('line', 19);
  add('touch', 25);
  return p;
}

const plannedEvent = (min: number) => ({ startsAt: 1_000_000, endsAt: 1_000_000 + min * 60e3 });

describe('planner model', () => {
  it('builds the 90-minute split session', () => {
    const p = ninetyMinutes();
    expect(p.slots).toHaveLength(7);
    expect(p.slots[3]!.blocks.map((b) => b.lane)).toEqual(['forwards', 'backs']);
    const o = overview(p, DRILLS, plannedEvent(90));
    expect(o.totalMin).toBe(90);
    expect(o.overMin).toBe(0);
    // Ruck (shields) for 20 min is contact; touch doesn't count.
    expect(o.contactMin).toBe(20);
    // Intensity 4+: the 20-min split slot counts once.
    expect(o.highIntensityMin).toBe(20);
  });

  it('aggregates equipment: max per slot, summed across parallel lanes', () => {
    const o = overview(ninetyMinutes(), DRILLS, null);
    const eq = Object.fromEntries(o.equipment.map((e) => [e.key, e.count]));
    // Cones: max of 8 (warm/pass/touch) vs split slot 4 (3v2) → 8. Balls: split slot 3 + 2 = 5.
    expect(eq).toEqual({ balls: 5, cones: 8, tackle_shields: 4, bibs: 15 });
    // Checklist follows the shared EQUIPMENT order.
    expect(o.equipment.map((e) => e.key)).toEqual(['balls', 'cones', 'tackle_shields', 'bibs']);
  });

  it('flags an overrun against the event slot, and none without a finish time', () => {
    const p = ninetyMinutes();
    expect(overview(p, DRILLS, plannedEvent(75)).overMin).toBe(15);
    expect(overview(p, DRILLS, plannedEvent(120)).overMin).toBe(0);
    expect(overview(p, DRILLS, { startsAt: 0, endsAt: null }).slotMin).toBeNull();
    expect(overview(p, DRILLS, { startsAt: 0, endsAt: null }).overMin).toBe(0);
    const longer = updateBlock(p, p.slots[0]!.blocks[0]!.id, { durationMin: 13 });
    expect(overview(longer, DRILLS, plannedEvent(90)).overMin).toBe(3);
  });

  it('suggests water after ~22 min of work', () => {
    let p = emptyPlan();
    for (const id of ['warm', 'pass', 'line', 'touch'])
      p = addSlot(p, makeBlock('drill', 'all', DRILLS[id]));
    expect(overview(p, DRILLS).waterAfter).toEqual([2]);
    p = insertWater(p, 2);
    expect(overview(p, DRILLS).waterAfter).toEqual([]);
  });

  it('moves a block between lanes and back to everyone without losing anything', () => {
    let p = ninetyMinutes();
    const ruck = p.slots[3]!.blocks[0]!;
    p = updateBlock(p, ruck.id, { lane: 'backs' });
    expect(p.slots[3]!.blocks.map((b) => [b.drillId, b.lane])).toEqual([
      ['threev2', 'forwards'],
      ['ruck', 'backs'],
    ]);
    p = updateBlock(p, ruck.id, { lane: 'all' });
    expect(p.slots[3]!.blocks.map((b) => b.drillId)).toEqual(['threev2']);
    expect(p.slots[4]!.blocks[0]).toMatchObject({ drillId: 'ruck', lane: 'all' });
  });

  it('switching to one group turns parallel blocks into consecutive slots', () => {
    const p = setLanes(ninetyMinutes(), ['all']);
    expect(p.lanes).toEqual(['all']);
    expect(p.slots).toHaveLength(8);
    expect(p.slots.every((s) => s.blocks.length === 1 && s.blocks[0]!.lane === 'all')).toBe(true);
  });

  it('splits, reorders, removes and copies', () => {
    let p = ninetyMinutes();
    p = splitSlot(p, p.slots[0]!.id);
    expect(p.slots[0]!.blocks[0]!.lane).toBe('forwards');
    const first = p.slots[0]!.id;
    p = moveSlot(p, 0, 2);
    expect(p.slots[2]!.id).toBe(first);
    p = removeBlock(p, p.slots[2]!.blocks[0]!.id);
    expect(p.slots.find((s) => s.id === first)).toBeUndefined();
    const c = copyPlanData(p);
    expect(c.slots.map((s) => s.blocks.map((b) => b.drillId))).toEqual(
      p.slots.map((s) => s.blocks.map((b) => b.drillId)),
    );
    expect(c.slots[0]!.id).not.toBe(p.slots[0]!.id);
  });

  it('expands station rotations', () => {
    const b = {
      ...makeBlock('drill', 'all'),
      rotation: { groups: 3, stations: ['Tubes', 'Box', 'Jackal'], intervalMin: 6 },
    };
    const r = rotationRounds(b);
    expect(r.map((x) => x.startMin)).toEqual([0, 6, 12]);
    expect(r[1]!.groups.map((g) => g.station)).toEqual(['Box', 'Jackal', 'Tubes']);
    const p = addSlot(emptyPlan(), b);
    expect(runSteps(p).map((s) => s.plannedMs)).toEqual([360e3, 360e3, 360e3]);
  });

  it('puts players in forwards (1–8) or backs (9–15)', () => {
    const lanes = ['forwards', 'backs'];
    expect(laneFor(lanes, [3, 1])).toBe('forwards');
    expect(laneFor(lanes, [8])).toBe('forwards');
    expect(laneFor(lanes, [9])).toBe('backs');
    expect(laneFor(lanes, [15])).toBe('backs');
    expect(laneFor(lanes, [])).toBeNull();
    expect(laneFor(['all'], [9])).toBeNull();
  });

  it('finds last week’s plan', () => {
    const plans = {
      a: { id: 'a', eventId: 'e1', isTemplate: false, deletedAt: null },
      b: { id: 'b', eventId: 'e2', isTemplate: false, deletedAt: null },
      t: { id: 't', eventId: null, isTemplate: true, deletedAt: null },
    } as never;
    const events = { e1: { startsAt: 100 }, e2: { startsAt: 200 }, e3: { startsAt: 300 } } as never;
    expect(lastPlanBefore(plans, events, 300)?.id).toBe('b');
    expect(lastPlanBefore(plans, events, 150)?.id).toBe('a');
    expect(lastPlanBefore(plans, events, 50)).toBeUndefined();
  });
});

describe('runner view-model', () => {
  const T0 = 1_750_000_000_000;
  let n = 0;
  const id = () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
  const ev = (kind: RunEvent['kind'], at: number, payload: RunEvent['payload'] = {}): RunEvent => ({
    id: id(),
    kind,
    at,
    payload,
  });

  /** Simulate a device that ticks at the given times and appends due auto-advances. */
  function tickThrough(plan: PlanData, events: RunEvent[], times: number[]) {
    const steps = runSteps(plan);
    let log = [...events];
    for (const t of times) log = [...log, ...dueAdvances(steps, log, t)];
    return log;
  }

  it('shows the planned first block before starting', () => {
    const v = runView(ninetyMinutes(), [], T0);
    expect(v.state.status).toBe('idle');
    expect(v.clock).toBe('10:00');
    expect(v.plannedTotalMs).toBe(90 * 60e3);
  });

  it('16 minutes in: block 2 with 4:00 left', () => {
    const plan = ninetyMinutes();
    const log = tickThrough(plan, [ev('start', T0, { auto: false })], [T0 + 16 * 60e3]);
    const v = runView(plan, log, T0 + 16 * 60e3);
    expect(v.state.index).toBe(1);
    expect(v.clock).toBe('4:00');
    expect(v.next?.slot.blocks[0]?.kind).toBe('water');
  });

  it('stays exact over 90 minutes whether ticking every second or only after a locked screen', () => {
    const plan = ninetyMinutes();
    const start = [ev('start', T0, { auto: false })];
    const everySecond = Array.from({ length: 90 * 60 + 5 }, (_, i) => T0 + i * 1000 + 137);
    const ticking = tickThrough(plan, start, everySecond);
    // Screen locked the whole session: one tick at the end.
    const locked = tickThrough(plan, start, [T0 + 95 * 60e3]);
    for (const log of [ticking, locked]) {
      const s = runView(plan, log, T0 + 95 * 60e3).state;
      expect(s.status).toBe('ended');
      expect(s.actuals.map((a) => a.ms)).toEqual([10, 10, 3, 20, 3, 19, 25].map((m) => m * 60e3));
    }
    // Every advance is stamped on the exact minute boundary.
    const boundaries = [10, 20, 23, 43, 46, 65, 90].map((m) => T0 + m * 60e3);
    expect(ticking.filter((e) => e.kind === 'advance').map((e) => e.at)).toEqual(boundaries);
    expect(locked.filter((e) => e.kind === 'advance').map((e) => e.at)).toEqual(boundaries);
  });

  it('handles pause, +2 min and skip with a live projected finish', () => {
    const plan = ninetyMinutes();
    const m = 60e3;
    let log = [
      ev('start', T0, { auto: false }),
      ev('pause', T0 + 5 * m),
      ev('resume', T0 + 8 * m),
      ev('extend', T0 + 9 * m, { ms: 120e3 }),
    ];
    let v = runView(plan, log, T0 + 9 * m);
    // 6 min elapsed of 12.
    expect(v.clock).toBe('6:00');
    expect(v.projectedFinishAt).toBe(T0 + 9 * m + 6 * m + 80 * m);
    log = tickThrough(plan, log, [T0 + 15 * m]);
    expect(runView(plan, log, T0 + 15 * m).state.index).toBe(1);
    log = [...log, ev('skip', T0 + 16 * m, { index: 2 })];
    log = tickThrough(plan, log, [T0 + 25 * m]);
    v = runView(plan, log, T0 + 25 * m);
    // Block 2 (10 min) ended at 25, water skipped → split slot.
    expect(v.state.index).toBe(3);
    const sum = summary(v.steps, v.state);
    expect(sum.rows[0]).toMatchObject({ actualMs: 12 * m, skipped: false });
    expect(sum.rows[2]).toMatchObject({ skipped: true, actualMs: null });
  });

  it('manual mode runs over time instead of advancing', () => {
    const plan = ninetyMinutes();
    const v = runView(plan, [ev('start', T0, { auto: false })], T0 + 11 * 60e3);
    expect(v.state.index).toBe(0);
    expect(v.overtime).toBe(true);
    expect(v.clock).toBe('+1:00');
  });

  it('formats and detects milestones', () => {
    expect(formatClock(59_001)).toBe('1:00');
    expect(formatClock(59_000)).toBe('0:59');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-61_000)).toBe('+1:01');
    expect(
      crossed({ index: 0, remainingMs: 61e3 }, { index: 0, remainingMs: 59e3, running: true }),
    ).toBe('one-minute');
    expect(
      crossed({ index: 0, remainingMs: 500 }, { index: 0, remainingMs: -200, running: true }),
    ).toBe('end');
    // Woke up long after: no replayed chime.
    expect(
      crossed({ index: 0, remainingMs: 300e3 }, { index: 0, remainingMs: 20e3, running: true }),
    ).toBeNull();
    expect(
      crossed({ index: 0, remainingMs: 61e3 }, { index: 1, remainingMs: 59e3, running: true }),
    ).toBeNull();
  });
});

describe('shared live session (assistant coaches)', () => {
  const T0 = 1_760_000_000_000;
  const start: RunEvent = {
    id: '01990000-0000-7000-8000-000000000001',
    kind: 'start',
    at: T0,
    payload: { auto: false },
  };
  /** Forwards 20 min / backs 15 min in one split slot, then 10 min all together. */
  function forked(): PlanData {
    let p = setLanes(emptyPlan(), ['forwards', 'backs']);
    p = addSlot(p, { ...makeBlock('drill', 'forwards', DRILLS.ruck), durationMin: 20 });
    p = setLaneBlock(p, p.slots.at(-1)!.id, {
      ...makeBlock('drill', 'backs', DRILLS.threev2),
      durationMin: 15,
    });
    p = addSlot(p, { ...makeBlock('drill', 'all', DRILLS.touch), durationMin: 10 });
    return p;
  }

  it('gives each group its own countdown in a split slot', () => {
    const v = runView(forked(), [start], T0 + 16 * 60e3);
    const lanes = laneStatus(v);
    expect(lanes.map((l) => [l.lane, Math.round(l.remainingMs / 60e3), l.done])).toEqual([
      ['forwards', 4, false],
      ['backs', -1, true],
    ]);
    expect(v.clock).toBe('4:00');
  });

  it('+2 min extends every group', () => {
    const ext: RunEvent = {
      id: '01990000-0000-7000-8000-000000000002',
      kind: 'extend',
      at: T0 + 60e3,
      payload: { ms: 120e3 },
    };
    const lanes = laneStatus(runView(forked(), [start, ext], T0 + 16 * 60e3));
    expect(lanes.map((l) => Math.round(l.remainingMs / 60e3))).toEqual([6, 1]);
  });

  it("two coaches' phones moving on from the same block create one event", () => {
    const plan = forked();
    const steps = runView(plan, [start], T0).steps;
    // Both phones auto-advance independently, then their logs merge.
    const a = dueAdvances(steps, [start], T0 + 21 * 60e3);
    const b = dueAdvances(steps, [start], T0 + 22 * 60e3);
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    const merged = mergeEvents([start, ...a], [start, ...b]);
    expect(runView(plan, merged, T0 + 22 * 60e3).state.index).toBe(1);
    // Two coaches tapping Next on the same block also produce the same id.
    expect(transitionId([start], 'advance', 0)).toBe(transitionId([start], 'advance', 0));
    expect(transitionId([start], 'advance', 0)).not.toBe(transitionId([start], 'advance', 1));
    expect(transitionId([start], 'advance', 0)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
