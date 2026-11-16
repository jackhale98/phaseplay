import type { Frame, Move, Play, Vec2 } from '@phaseplay/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { frameTimes, sample, totalDuration } from '../src/sample';

const vec = fc.record({
  x: fc.double({ min: 0, max: 70, noNaN: true }),
  y: fc.double({ min: -10, max: 110, noNaN: true }),
});
const move: fc.Arbitrary<Move> = fc.record(
  {
    kind: fc.constantFrom('run', 'carry', 'pass', 'kick'),
    ctrl: fc.array(vec, { maxLength: 2 }),
    ease: fc.constantFrom('linear', 'inOut', 'out'),
    delayMs: fc.integer({ min: 0, max: 1500 }),
  },
  { requiredKeys: ['kind'] },
);

const N = 4;
/** Override with FC_RUNS=5000 for a deeper local run. */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const RUNS = Number(env?.FC_RUNS ?? 250);
const ids = ['e0', 'e1', 'e2', 'e3'];

/** Random in-bounds plays with a ball passed between entities. */
const playArb: fc.Arbitrary<Play> = fc
  .record({
    frames: fc.array(
      fc.record({
        durationMs: fc.integer({ min: 200, max: 3000 }),
        pos: fc.array(fc.option(vec, { nil: undefined }), { minLength: N, maxLength: N }),
        moves: fc.array(fc.option(move, { nil: undefined }), {
          minLength: N + 1,
          maxLength: N + 1,
        }),
        holder: fc.option(fc.integer({ min: 0, max: N - 1 }), { nil: undefined }),
        ballAt: fc.option(vec, { nil: undefined }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    start: fc.array(vec, { minLength: N, maxLength: N }),
    loop: fc.boolean(),
  })
  .map(({ frames, start, loop }) => {
    const out: Frame[] = frames.map((f, i) => {
      const pos: Record<string, Vec2> = {};
      const moves: Record<string, Move> = {};
      ids.forEach((id, k) => {
        const p = i === 0 ? start[k] : f.pos[k];
        if (p) pos[id] = p;
        const m = f.moves[k];
        if (m && i > 0) moves[id] = m;
      });
      const bm = f.moves[N];
      if (bm && i > 0) moves.ball = bm;
      const frame: Frame = { id: `f${i}`, durationMs: i === 0 ? 0 : f.durationMs, pos, moves };
      if (f.holder !== undefined) frame.ball = { holder: ids[f.holder] };
      else if (f.ballAt) frame.ball = { at: f.ballAt };
      return frame;
    });
    return {
      v: 1,
      id: 'prop',
      mode: 'play',
      title: 'prop',
      format: '15s',
      view: 'full',
      entities: [
        ...ids.map((id) => ({ id, kind: 'attack' as const })),
        { id: 'ball', kind: 'ball' as const },
      ],
      frames: out,
      loop,
    } satisfies Play;
  });

const maxJump = (a: ReturnType<typeof sample>, b: ReturnType<typeof sample>) => {
  let m = 0;
  a.entities.forEach((e, i) => {
    const o = b.entities[i]!;
    m = Math.max(m, Math.hypot(e.pos.x - o.pos.x, e.pos.y - o.pos.y));
  });
  if (a.ball && b.ball)
    m = Math.max(m, Math.hypot(a.ball.pos.x - b.ball.pos.x, a.ball.pos.y - b.ball.pos.y));
  return m;
};

describe('sample() properties', () => {
  it('positions are continuous across frame boundaries', () => {
    fc.assert(
      fc.property(playArb, (play) => {
        const eps = 0.01; // ms
        for (const t of frameTimes(play).slice(1, -1)) {
          // ≤ 0.2 m in 0.02 ms: anything more is a jump, not motion.
          expect(maxJump(sample(play, t - eps), sample(play, t + eps))).toBeLessThan(0.2);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('positions stay inside pitch bounds for in-bounds inputs', () => {
    fc.assert(
      fc.property(playArb, fc.double({ min: 0, max: 1, noNaN: true }), (play, f) => {
        const s = sample(play, f * totalDuration(play));
        for (const e of s.entities) {
          expect(e.pos.x).toBeGreaterThanOrEqual(-1e-9);
          expect(e.pos.x).toBeLessThanOrEqual(70 + 1e-9);
          expect(e.pos.y).toBeGreaterThanOrEqual(-10 - 1e-9);
          expect(e.pos.y).toBeLessThanOrEqual(110 + 1e-9);
        }
        if (s.ball) {
          // The carried ball sits a hand's width off its carrier.
          expect(s.ball.pos.x).toBeGreaterThanOrEqual(-1);
          expect(s.ball.pos.x).toBeLessThanOrEqual(71);
          expect(s.ball.pos.y).toBeGreaterThanOrEqual(-11);
          expect(s.ball.pos.y).toBeLessThanOrEqual(111);
          expect(s.ball.height).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(playArb, fc.double({ min: -5000, max: 20000, noNaN: true }), (play, t) => {
        const a = sample(play, t);
        const copy = structuredClone(play);
        const b = sample(copy, t);
        expect(JSON.parse(JSON.stringify(b))).toEqual(JSON.parse(JSON.stringify(a)));
        expect(sample(play, t)).toEqual(a);
      }),
      { numRuns: RUNS },
    );
  });
});
