import type { Play } from '@phaseplay/shared';
import { describe, expect, it } from 'vitest';
import {
  BALL_HOLD_OFFSET,
  frameTimes,
  overviewScene,
  resolvedPositions,
  sample,
  totalDuration,
} from '../src/sample';

const base = (over: Partial<Play> = {}): Play => ({
  v: 1,
  id: 'p1',
  mode: 'play',
  title: 'Test',
  format: '15s',
  view: 'full',
  entities: [
    { id: 'a', kind: 'attack', number: 9 },
    { id: 'b', kind: 'attack', number: 10 },
    { id: 'z', kind: 'zone', size: { w: 5, h: 5 } },
    { id: 'ball', kind: 'ball' },
  ],
  frames: [
    {
      id: 'f0',
      durationMs: 0,
      pos: { a: { x: 10, y: 50 }, b: { x: 20, y: 55 }, z: { x: 30, y: 30 } },
      moves: {},
      ball: { holder: 'a' },
      caption: 'Start',
    },
    {
      id: 'f1',
      durationMs: 1000,
      pos: { a: { x: 10, y: 40 } },
      moves: { a: { kind: 'run', ease: 'linear' } },
      caption: 'Run',
    },
    {
      id: 'f2',
      durationMs: 2000,
      pos: { b: { x: 30, y: 45 } },
      moves: {
        b: { kind: 'run', ease: 'linear', delayMs: 1000 },
        ball: { kind: 'pass', delayMs: 1000 },
      },
      ball: { holder: 'b' },
      caption: 'Pass',
    },
  ],
  ...over,
});

describe('timing', () => {
  it('frameTimes and totalDuration', () => {
    const p = base();
    expect(frameTimes(p)).toEqual([0, 1000, 3000]);
    expect(totalDuration(p)).toBe(3000);
  });

  it('frame boundaries hit the frame end positions exactly', () => {
    const p = base();
    const at = (t: number, id: string) => sample(p, t).entities.find((e) => e.id === id)!.pos;
    expect(at(0, 'a')).toEqual({ x: 10, y: 50 });
    expect(at(1000, 'a')).toEqual({ x: 10, y: 40 });
    expect(at(3000, 'b')).toEqual({ x: 30, y: 45 });
    expect(sample(p, 1000).frameIndex).toBe(1);
    expect(sample(p, 1001).frameIndex).toBe(2);
    expect(sample(p, 0).caption).toBe('Start');
    expect(sample(p, 2000).caption).toBe('Pass');
  });

  it('interpolates linearly, carries missing positions and clamps', () => {
    const p = base();
    const s = sample(p, 500);
    expect(s.entities.find((e) => e.id === 'a')!.pos.y).toBeCloseTo(45);
    expect(s.entities.find((e) => e.id === 'a')!.moving).toBe(true);
    expect(s.entities.find((e) => e.id === 'b')!.pos).toEqual({ x: 20, y: 55 });
    expect(s.segmentT).toBeCloseTo(0.5);
    // carried: 'a' has no position in f2
    expect(sample(p, 2500).entities.find((e) => e.id === 'a')!.pos).toEqual({ x: 10, y: 40 });
    expect(sample(p, -50).t).toBe(0);
    expect(sample(p, 99999).t).toBe(3000);
  });

  it('honours delayMs', () => {
    const p = base();
    // f2 starts at 1000; b is delayed by 1000 ms → still at start until 2000.
    expect(sample(p, 1900).entities.find((e) => e.id === 'b')!.pos).toEqual({ x: 20, y: 55 });
    const mid = sample(p, 2500).entities.find((e) => e.id === 'b')!.pos;
    expect(mid.x).toBeCloseTo(25);
    expect(mid.y).toBeCloseTo(50);
  });

  it('applies easing', () => {
    const p = base();
    p.frames[1]!.moves.a = { kind: 'run', ease: 'inOut' };
    const y = sample(p, 250).entities.find((e) => e.id === 'a')!.pos.y;
    // inOut(0.25) = 0.125 → 50 - 1.25
    expect(y).toBeCloseTo(48.75);
    p.frames[1]!.moves.a = { kind: 'run', ease: 'out' };
    const y2 = sample({ ...p }, 250).entities.find((e) => e.id === 'a')!.pos.y;
    expect(50 - y2).toBeGreaterThan(2.5);
  });

  it('follows Bézier control points', () => {
    const p = base();
    p.frames[1]!.moves.a = { kind: 'run', ease: 'linear', ctrl: [{ x: 20, y: 45 }] };
    const mid = sample(p, 500).entities.find((e) => e.id === 'a')!;
    expect(mid.pos.x).toBeGreaterThan(14);
    expect(mid.heading).toBeDefined();
  });

  it('wraps time for looping plays', () => {
    const p = base({ loop: true });
    expect(sample(p, 3500).t).toBe(500);
    expect(sample(p, 3000).t).toBe(3000);
    expect(sample(p, 6500)).toEqual(sample(p, 500));
    expect(sample(p, -500).t).toBe(2500);
  });

  it('single-frame plays are static', () => {
    const p = base();
    p.frames = [p.frames[0]!];
    expect(totalDuration(p)).toBe(0);
    expect(sample(p, 1234).frameIndex).toBe(0);
  });

  it('orders entities for drawing with zones first and excludes the primary ball', () => {
    const ids = sample(base(), 0).entities.map((e) => e.id);
    expect(ids).toEqual(['z', 'a', 'b']);
  });
});

describe('ball', () => {
  it('follows the holder at an offset', () => {
    const p = base();
    const s = sample(p, 500);
    const a = s.entities.find((e) => e.id === 'a')!.pos;
    expect(s.ball!.holder).toBe('a');
    expect(s.ball!.pos.x).toBeCloseTo(a.x + BALL_HOLD_OFFSET.x);
    expect(s.ball!.pos.y).toBeCloseTo(a.y + BALL_HOLD_OFFSET.y);
    expect(s.ball!.height).toBe(0);
    expect(s.ball!.id).toBe('ball');
  });

  it('a pass travels an arc from passer to receiver over the move timing', () => {
    const p = base();
    const before = sample(p, 1999).ball!;
    expect(before.holder).toBe('a');
    const mid = sample(p, 2500).ball!;
    expect(mid.flight).toBe('pass');
    expect(mid.holder).toBeUndefined();
    expect(mid.height).toBeGreaterThan(0);
    const end = sample(p, 3000).ball!;
    expect(end.holder).toBe('b');
    expect(end.pos.x).toBeCloseTo(30 + BALL_HOLD_OFFSET.x);
    // A pass trail is part of the segment.
    expect(sample(p, 2500).trails.some((t) => t.style === 'pass')).toBe(true);
  });

  it('implicit holder change becomes a pass ending at the frame end', () => {
    const p = base();
    delete p.frames[2]!.moves.ball;
    const end = sample(p, 3000).ball!;
    expect(end.holder).toBe('b');
    const early = sample(p, 1100).ball!;
    expect(early.holder).toBe('a');
  });

  it('a kick is parabolic in height and lands at the target', () => {
    const p = base();
    p.frames[2] = {
      id: 'f2',
      durationMs: 2000,
      pos: {},
      moves: { ball: { kind: 'kick' } },
      ball: { at: { x: 40, y: 10 } },
    };
    const hs = [0.25, 0.5, 0.75].map((f) => sample(p, 1000 + 2000 * f).ball!.height);
    expect(hs[1]).toBeGreaterThan(hs[0]!);
    expect(hs[1]).toBeGreaterThan(hs[2]!);
    expect(hs[0]).toBeCloseTo(hs[2]!, 6);
    const end = sample(p, 3000).ball!;
    expect(end.pos).toEqual({ x: 40, y: 10 });
    expect(end.height).toBe(0);
    expect(sample(p, 2000).ball!.flight).toBe('kick');
  });

  it('no ball when the play has none', () => {
    const p = base();
    p.entities = p.entities.filter((e) => e.kind !== 'ball');
    p.frames.forEach((f) => delete f.ball);
    expect(sample(p, 100).ball).toBeNull();
  });
});

describe('helpers', () => {
  it('resolvedPositions carries forward', () => {
    expect(resolvedPositions(base(), 2)).toMatchObject({
      a: { x: 10, y: 40 },
      b: { x: 30, y: 45 },
    });
  });
  it('overviewScene overlays all trails', () => {
    const s = overviewScene(base());
    expect(s.trails.length).toBeGreaterThanOrEqual(3);
    expect(s.t).toBe(0);
  });
  it('reuses an out scene', () => {
    const p = base();
    const s = sample(p, 0);
    const again = sample(p, 500, s);
    expect(again).toBe(s);
    expect(again.entities.find((e) => e.id === 'a')!.pos.y).toBeCloseTo(45);
  });
});
