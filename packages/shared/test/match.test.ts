import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type MatchEvent,
  type MatchPayload,
  clockAt,
  matchConfig,
  pointsFor,
  reduceMatch,
  uuidv7,
  DEFAULT_POINTS,
  SCORE_TYPES,
} from '../src';

let seq = 0;
const ev = (wallAt: number, payload: MatchPayload, gameMs = 0, id = uuidv7()): MatchEvent => ({
  id,
  seq: seq++,
  wallAt,
  gameMs,
  payload,
});

const T0 = 1_700_000_000_000;
const cfg = matchConfig('15s', null);

describe('clockAt', () => {
  it('runs from period start and stops during time off', () => {
    const log = [
      ev(T0, { kind: 'period_start', period: 1 }),
      ev(T0 + 60_000, { kind: 'time_off', reason: 'injury' }),
      ev(T0 + 90_000, { kind: 'time_on' }),
    ];
    const c = clockAt(log, cfg, T0 + 120_000);
    expect(c.gameMs).toBe(90_000);
    expect(c.realElapsedMs).toBe(120_000);
    expect(c.stoppages).toHaveLength(1);
    expect(c.stoppages[0]!.endWall).toBe(T0 + 90_000);
  });

  it('starts the second half at the half length', () => {
    const log = [
      ev(T0, { kind: 'period_start', period: 1 }),
      ev(T0 + 41 * 60e3, { kind: 'period_end', period: 1 }),
      ev(T0 + 55 * 60e3, { kind: 'period_start', period: 2 }),
    ];
    expect(clockAt(log, cfg, T0 + 50 * 60e3).gameMs).toBe(41 * 60e3);
    expect(clockAt(log, cfg, T0 + 56 * 60e3).gameMs).toBe(41 * 60e3);
    expect(clockAt(log, cfg, T0 + 56 * 60e3).period).toBe(2);
  });

  it('has no drift: clock is a function of timestamps only', () => {
    const log = [ev(T0, { kind: 'period_start', period: 1 })];
    expect(clockAt(log, cfg, T0 + 40 * 60e3).gameMs).toBe(40 * 60e3);
  });
});

describe('reduceMatch', () => {
  it('sin bin pauses during time off and returns on prompt', () => {
    const card = ev(T0 + 5 * 60e3, { kind: 'card', team: 'them', colour: 'yellow' }, 5 * 60e3);
    const log = [
      ev(T0, { kind: 'period_start', period: 1 }),
      card,
      ev(T0 + 6 * 60e3, { kind: 'time_off', reason: 'referee' }, 6 * 60e3),
      ev(T0 + 16 * 60e3, { kind: 'time_on' }, 6 * 60e3),
    ];
    // 10 real minutes of time off do not count against the 10-minute sin bin.
    const s = reduceMatch(log, cfg, T0 + 17 * 60e3);
    expect(s.clock.gameMs).toBe(7 * 60e3);
    expect(s.sinBins[0]!.remainingMs).toBe(8 * 60e3);
    expect(s.onField).toEqual({ us: 15, them: 14 });
    const later = reduceMatch(log, cfg, T0 + 40 * 60e3);
    expect(later.sinBins[0]!.remainingMs).toBe(0);
    expect(later.onField.them).toBe(14);
    const back = reduceMatch(
      [...log, ev(T0 + 30 * 60e3, { kind: 'card_return', cardId: card.id }, 20 * 60e3)],
      cfg,
      T0 + 40 * 60e3,
    );
    expect(back.onField.them).toBe(15);
  });

  it('applies voids and edits', () => {
    const t = ev(T0 + 1000, { kind: 'score', team: 'us', type: 'try' }, 1000);
    const c = ev(T0 + 2000, { kind: 'score', team: 'us', type: 'conversion' }, 2000);
    const log = [
      ev(T0, { kind: 'period_start', period: 1 }),
      t,
      c,
      ev(T0 + 3000, { kind: 'edit', supersedesId: c.id, patch: { type: 'conversion_miss' } }),
    ];
    expect(reduceMatch(log, cfg, T0 + 5000).score).toEqual({ us: 5, them: 0 });
    const voided = [...log, ev(T0 + 4000, { kind: 'void', supersedesId: t.id })];
    expect(reduceMatch(voided, cfg, T0 + 5000).score).toEqual({ us: 0, them: 0 });
  });

  it('tracks subs and minutes played', () => {
    const a = uuidv7();
    const b = uuidv7();
    const c15 = matchConfig('15s', null, { starters: [a], bench: [b] });
    const log = [
      ev(T0, { kind: 'period_start', period: 1 }),
      ev(
        T0 + 20 * 60e3,
        { kind: 'sub', team: 'us', offId: a, onId: b, type: 'tactical' },
        20 * 60e3,
      ),
    ];
    const s = reduceMatch(log, c15, T0 + 30 * 60e3);
    expect(s.minutesPlayed[a]).toBe(20 * 60e3);
    expect(s.minutesPlayed[b]).toBe(10 * 60e3);
    expect(s.playing).toEqual([b]);
    expect(s.replacementsUsed).toBe(1);
  });

  it('property: score always equals the sum of effective scoring events', () => {
    const scoreArb = fc.record({
      team: fc.constantFrom('us' as const, 'them' as const),
      type: fc.constantFrom(...SCORE_TYPES),
      voided: fc.boolean(),
      at: fc.integer({ min: 0, max: 80 * 60e3 }),
    });
    fc.assert(
      fc.property(fc.array(scoreArb, { maxLength: 40 }), (scores) => {
        const log: MatchEvent[] = [ev(T0, { kind: 'period_start', period: 1 })];
        const expected = { us: 0, them: 0 };
        for (const s of scores) {
          const e = ev(T0 + s.at, { kind: 'score', team: s.team, type: s.type }, s.at);
          log.push(e);
          if (s.voided) log.push(ev(T0 + s.at + 1, { kind: 'void', supersedesId: e.id }));
          else expected[s.team] += pointsFor(s.type, DEFAULT_POINTS);
        }
        // Order of arrival must not matter (sync is a union by id).
        const shuffled = [...log].reverse();
        expect(reduceMatch(shuffled, cfg, T0 + 90 * 60e3).score).toEqual(expected);
      }),
    );
  });
});
