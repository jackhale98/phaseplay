import { describe, expect, it } from 'vitest';
import {
  type PlanData,
  type RunEvent,
  planTotals,
  runState,
  runSteps,
  timeline,
  uuidv7,
} from '../src';

const plan: PlanData = {
  lanes: ['forwards', 'backs'],
  waterEveryMin: 22,
  slots: [
    {
      id: 's1',
      blocks: [{ id: 'b1', kind: 'drill', drillId: 'd-warm', durationMin: 15, lane: 'all' }],
    },
    {
      id: 's2',
      blocks: [
        { id: 'b2', kind: 'drill', drillId: 'd-scrum', durationMin: 20, lane: 'forwards' },
        { id: 'b3', kind: 'drill', drillId: 'd-strike', durationMin: 15, lane: 'backs' },
      ],
    },
    { id: 's3', blocks: [{ id: 'b4', kind: 'water', durationMin: 3, lane: 'all' }] },
    {
      id: 's4',
      blocks: [
        {
          id: 'b5',
          kind: 'drill',
          drillId: 'd-warm',
          durationMin: 1,
          lane: 'all',
          rotation: { groups: 3, stations: ['A', 'B', 'C'], intervalMin: 6 },
        },
      ],
    },
  ],
};
const drills = {
  'd-warm': { contactLevel: 'none' as const, intensity: 2, equipment: { cones: 12, balls: 4 } },
  'd-scrum': { contactLevel: 'full' as const, intensity: 5, equipment: { scrum_machine: 1 } },
  'd-strike': { contactLevel: 'touch' as const, intensity: 3, equipment: { cones: 8, balls: 2 } },
};

describe('practice timeline', () => {
  it('aligns lanes and reports fillers', () => {
    const t = timeline(plan);
    expect(t.map((s) => [s.startMin, s.endMin])).toEqual([
      [0, 15],
      [15, 35],
      [35, 38],
      [38, 56],
    ]);
    expect(t[1]!.fillers).toEqual({ backs: 5 });
  });

  it('totals contact, intensity, equipment and water suggestions', () => {
    const totals = planTotals(plan, drills);
    expect(totals.totalMin).toBe(56);
    expect(totals.contactMin).toBe(20);
    expect(totals.highIntensityMin).toBe(20);
    expect(totals.equipment).toEqual({ cones: 12, balls: 4, scrum_machine: 1 });
    // 35 minutes of work before the water break, which follows directly → no suggestion there.
    expect(totals.waterAfter).toEqual([]);
  });
});

describe('runState', () => {
  const steps = runSteps(plan);
  const T = 1_700_000_000_000;
  const e = (kind: RunEvent['kind'], at: number, payload: RunEvent['payload'] = {}): RunEvent => ({
    id: uuidv7(at),
    kind,
    at,
    payload,
  });

  it('expands rotations into steps', () => {
    expect(steps.map((s) => s.plannedMs / 60e3)).toEqual([15, 20, 3, 6, 6, 6]);
  });

  it('auto-advances from timestamps and stays exact over 90 minutes', () => {
    const s = runState(steps, [e('start', T, { auto: true })], T + 36 * 60e3);
    expect(s.index).toBe(2);
    expect(s.remainingMs).toBe(2 * 60e3);
    const done = runState(steps, [e('start', T, { auto: true })], T + 90 * 60e3);
    expect(done.status).toBe('ended');
    expect(done.actuals.reduce((a, x) => a + x.ms, 0)).toBe(56 * 60e3);
  });

  it('pause and +2 min shift the projected finish', () => {
    const evs = [
      e('start', T, { auto: false }),
      e('pause', T + 60e3),
      e('resume', T + 3 * 60e3),
      e('extend', T + 4 * 60e3, { ms: 120e3 }),
    ];
    const s = runState(steps, evs, T + 5 * 60e3);
    expect(s.status).toBe('running');
    expect(s.elapsedMs).toBe(3 * 60e3);
    expect(s.remainingMs).toBe(14 * 60e3);
    expect(s.projectedFinishAt).toBe(T + 5 * 60e3 + 14 * 60e3 + 41 * 60e3);
  });

  it('manual mode waits at zero; skip records skipped', () => {
    const evs = [e('start', T, { auto: false }), e('skip', T + 60e3)];
    const s = runState(steps, evs, T + 100 * 60e3);
    expect(s.index).toBe(1);
    expect(s.remainingMs).toBeLessThan(0);
    expect(s.actuals[0]).toEqual({ index: 0, ms: 60e3, skipped: true });
  });
});
