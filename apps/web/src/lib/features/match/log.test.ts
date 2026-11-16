import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_POINTS,
  SCORE_TYPES,
  clockAt,
  effectiveLog,
  formatClock,
  matchConfig,
  pointsFor,
  reduceMatch,
  type MatchEvent,
  type MatchPayload,
} from '@phaseplay/shared';
import { createEvent, lastUndoable, mergeLogs, openTemporarySubs, parseClock } from './log';
import { dayMinutes, reduceDay, splitGames } from './day';

const T0 = 1_750_000_000_000;
const cfg15 = matchConfig('15s', null);

function builder() {
  const log: MatchEvent[] = [];
  return {
    log,
    add(payload: MatchPayload, wallAt: number, gameMs = 0) {
      const e = createEvent(log, payload, gameMs, wallAt);
      log.push(e);
      return e;
    },
  };
}

describe('mergeLogs', () => {
  it('is a union by id, idempotent and order-independent', () => {
    const b = builder();
    const a1 = b.add({ kind: 'period_start', period: 1 }, T0);
    const a2 = b.add({ kind: 'score', team: 'us', type: 'try' }, T0 + 1000, 1000);
    const a3 = b.add({ kind: 'tally', tally: 'scrum_won' }, T0 + 2000, 2000);
    const x = mergeLogs([a1, a2], [a2, a3]);
    expect(x.map((e) => e.id)).toEqual([a1.id, a2.id, a3.id]);
    expect(mergeLogs(x, x)).toEqual(x);
    expect(mergeLogs([a3, a2], [a1])).toEqual(x);
  });
});

describe('undo and corrections', () => {
  it('undo targets the latest entry still in effect, skipping corrections', () => {
    const b = builder();
    b.add({ kind: 'period_start', period: 1 }, T0);
    const t = b.add({ kind: 'score', team: 'us', type: 'try' }, T0 + 1000, 1000);
    const c = b.add({ kind: 'score', team: 'us', type: 'conversion' }, T0 + 2000, 2000);
    expect(lastUndoable(b.log)?.id).toBe(c.id);
    b.add({ kind: 'void', supersedesId: c.id }, T0 + 3000, 2000);
    expect(lastUndoable(b.log)?.id).toBe(t.id);
    b.add({ kind: 'edit', supersedesId: t.id, gameMs: 500 }, T0 + 4000, 500);
    expect(lastUndoable(b.log)?.id).toBe(t.id);
    expect(reduceMatch(b.log, cfg15, T0 + 5000).score.us).toBe(5);
  });

  it('tracks open temporary replacements until sub_return', () => {
    const b = builder();
    const s = b.add({ kind: 'sub', team: 'us', offId: 'a', onId: 'b', type: 'temporary' }, T0);
    expect(openTemporarySubs(b.log, ['b']).map((e) => e.id)).toEqual([s.id]);
    b.add({ kind: 'sub_return', subId: s.id }, T0 + 1);
    expect(openTemporarySubs(b.log, ['a'])).toEqual([]);
  });

  it('parses clock text', () => {
    expect(parseClock('23:14')).toBe((23 * 60 + 14) * 1000);
    expect(parseClock('5')).toBe(300_000);
    expect(parseClock('5:7')).toBeNull();
    expect(parseClock('abc')).toBeNull();
  });
});

describe('clocks from timestamps', () => {
  it('drifts by less than a second over 40 minutes of irregular renders', () => {
    const b = builder();
    b.add({ kind: 'period_start', period: 1 }, T0);
    // Renders at irregular times (timer throttled, screen locked for 25 minutes).
    let t = T0;
    const renders: number[] = [];
    while (t < T0 + 40 * 60e3) {
      t += t > T0 + 10 * 60e3 && t < T0 + 35 * 60e3 ? 25 * 60e3 : 250 + Math.random() * 700;
      renders.push(Math.min(t, T0 + 40 * 60e3));
    }
    for (const r of renders) {
      const shown = clockAt(effectiveLog(b.log), cfg15, r).gameMs;
      expect(Math.abs(shown - (r - T0))).toBeLessThan(1000);
    }
    expect(formatClock(clockAt(b.log, cfg15, T0 + 40 * 60e3).gameMs)).toBe('40:00');
  });

  it('pauses sin-bin countdowns during time off', () => {
    const b = builder();
    b.add({ kind: 'period_start', period: 1 }, T0);
    b.add({ kind: 'card', team: 'them', colour: 'yellow' }, T0 + 60e3, 60e3);
    const at = (ms: number) => reduceMatch(b.log, cfg15, T0 + ms).sinBins[0]!.remainingMs;
    expect(at(4 * 60e3)).toBe(7 * 60e3);
    b.add({ kind: 'time_off', reason: 'referee' }, T0 + 4 * 60e3);
    expect(at(6 * 60e3)).toBe(7 * 60e3);
    b.add({ kind: 'time_on' }, T0 + 6 * 60e3);
    expect(at(7 * 60e3)).toBe(6 * 60e3);
    expect(reduceMatch(b.log, cfg15, T0 + 7 * 60e3).onField).toEqual({ us: 15, them: 14 });
  });
});

describe('score property', () => {
  const scoreArb = fc.record({
    team: fc.constantFrom('us' as const, 'them' as const),
    type: fc.constantFrom(...SCORE_TYPES),
    gameMs: fc.integer({ min: 0, max: 80 * 60e3 }),
    dt: fc.integer({ min: 1, max: 120_000 }),
    replica: fc.constantFrom('a', 'b', 'both'),
    voided: fc.boolean(),
    retype: fc.option(fc.constantFrom(...SCORE_TYPES), { nil: undefined }),
  });

  it('the score always equals the sum of the effective scoring events, however replicas merge', () => {
    fc.assert(
      fc.property(fc.array(scoreArb, { maxLength: 40 }), (specs) => {
        const b = builder();
        const a: MatchEvent[] = [];
        const c: MatchEvent[] = [];
        let wall = T0;
        b.add({ kind: 'period_start', period: 1 }, wall);
        a.push(b.log[0]!);
        c.push(b.log[0]!);
        for (const s of specs) {
          wall += s.dt;
          const e = b.add({ kind: 'score', team: s.team, type: s.type }, wall, s.gameMs);
          const extra: MatchEvent[] = [];
          if (s.retype)
            extra.push(
              b.add(
                { kind: 'edit', supersedesId: e.id, patch: { type: s.retype } },
                (wall += 1),
                s.gameMs,
              ),
            );
          if (s.voided)
            extra.push(b.add({ kind: 'void', supersedesId: e.id }, (wall += 1), s.gameMs));
          for (const x of [e, ...extra]) {
            if (s.replica !== 'b') a.push(x);
            if (s.replica !== 'a') c.push(x);
          }
        }
        const merged = mergeLogs(a, c);
        const reversed = mergeLogs(c, a);
        const st = reduceMatch(merged, cfg15, wall + 1);
        const expected = { us: 0, them: 0 };
        for (const e of effectiveLog(merged))
          if (e.payload.kind === 'score')
            expected[e.payload.team] += pointsFor(e.payload.type, DEFAULT_POINTS);
        expect(st.score).toEqual(expected);
        expect(reduceMatch(reversed, cfg15, wall + 1).score).toEqual(expected);
        // Independent check straight from the specs.
        const fromSpecs = { us: 0, them: 0 };
        for (const s of specs)
          if (!s.voided) fromSpecs[s.team] += pointsFor(s.retype ?? s.type, DEFAULT_POINTS);
        expect(st.score).toEqual(fromSpecs);
        const last = st.progression.at(-1);
        if (last) expect({ us: last.us, them: last.them }).toEqual(st.score);
      }),
      { numRuns: 300 },
    );
  });
});

describe('tournament day', () => {
  it('splits a tournament log into games by kick-off and sums minutes across the day', () => {
    const cfg7 = matchConfig('7s', null, {
      starters: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
      bench: ['b1'],
    });
    const half = cfg7.halfMs;
    const b = builder();
    b.add({ kind: 'period_start', period: 1 }, T0);
    b.add({ kind: 'score', team: 'us', type: 'try' }, T0 + 60e3, 60e3);
    b.add(
      { kind: 'sub', team: 'us', offId: 'p1', onId: 'b1', type: 'tactical' },
      T0 + 3 * 60e3,
      3 * 60e3,
    );
    b.add({ kind: 'period_end', period: 1 }, T0 + half);
    b.add({ kind: 'period_start', period: 2 }, T0 + half + 2 * 60e3);
    b.add({ kind: 'period_end', period: 2 }, T0 + 2 * half + 2 * 60e3);
    const g2 = T0 + 3 * 3600e3;
    b.add({ kind: 'period_start', period: 3 }, g2);
    b.add({ kind: 'score', team: 'them', type: 'try' }, g2 + 60e3, 2 * half + 60e3);
    const sliced = splitGames(b.log);
    expect(sliced).toHaveLength(2);
    const day = reduceDay(b.log, cfg7, g2 + 5 * 60e3);
    expect(day[0]!.state.score).toEqual({ us: 5, them: 0 });
    expect(day[1]!.state.score).toEqual({ us: 0, them: 5 });
    // Lineup resets to the sheet for game 2: p1 starts again.
    expect(day[1]!.state.playing).toContain('p1');
    const mins = dayMinutes(day);
    expect(mins.get('p1')!.perGame).toEqual([3 * 60e3, 5 * 60e3]);
    expect(mins.get('p2')!.total).toBe(2 * half + 5 * 60e3);
    expect(mins.get('b1')!.perGame[0]).toBe(2 * half - 3 * 60e3);
  });
});
