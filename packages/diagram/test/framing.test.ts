import type { Play, Vec2 } from '@phaseplay/shared';
import { describe, expect, it } from 'vitest';
import { tokenRadiusPx } from '../src/draw';
import { frameForRect } from '../src/export/framing';
import {
  lineout,
  newPlay,
  PRESETS,
  scrum15,
  type PresetId,
  type PresetResult,
} from '../src/presets';
import { sample, totalDuration } from '../src/sample';
import { LINEOUT_Y, makeTransform } from '../src/viewport';

/** Diagram rects (px) the exporters draw into: story, square, landscape, and a storyboard cell. */
const RECTS = {
  story: { w: 1016, h: 1560 },
  square: { w: 1016, h: 770 },
  landscape: { w: 1856, h: 770 },
  storyboardCell: { w: 480, h: 330 },
} as const;

const fromPreset = (id: string, r: PresetResult): Play =>
  newPlay({ id, title: id, mode: 'play', format: r.format, preset: r });

/** A lineout that throws to the tail, peels, and kicks deep: the action leaves the start shape. */
function lineoutPlay(): Play {
  const p = fromPreset('lo', lineout(7, { defence: true }));
  const L = LINEOUT_Y;
  p.frames.push(
    {
      id: 'f1',
      durationMs: 1000,
      pos: {},
      moves: { ball: { kind: 'pass', delayMs: 150 } },
      ball: { holder: 'a8' },
    },
    {
      id: 'f2',
      durationMs: 1200,
      pos: { a7: { x: 18, y: L - 4 }, a9: { x: 17, y: L + 1 } },
      moves: { a7: { kind: 'carry', ctrl: [{ x: 22, y: L + 2 }] }, ball: { kind: 'pass' } },
      ball: { holder: 'a7' },
    },
    {
      id: 'f3',
      durationMs: 1800,
      pos: { a14: { x: 60, y: L - 30 } },
      moves: { ball: { kind: 'kick' }, a14: { kind: 'run' } },
      ball: { at: { x: 55, y: L - 35 } },
      arrows: [{ from: { x: 18, y: L - 4 }, to: { x: 62, y: L - 36 }, style: 'kick' }],
    },
  );
  return p;
}

function scrumPlay(): Play {
  const p = fromPreset('sc', scrum15());
  p.frames.push({
    id: 'f1',
    durationMs: 1500,
    pos: { a9: { x: 40, y: 50 }, a11: { x: 2, y: 62 }, a15: { x: 58, y: 65 } },
    moves: { a11: { kind: 'run' }, a15: { kind: 'run', ctrl: [{ x: 66, y: 70 }] } },
  });
  return p;
}

const PLAYS: [string, Play][] = [
  ...(Object.keys(PRESETS) as PresetId[]).map((id): [string, Play] => [
    id,
    fromPreset(id, PRESETS[id].build()),
  ]),
  ...([4, 5, 6, 7] as const).map((n): [string, Play] => [
    `lineout${n}+defence`,
    fromPreset(`l${n}`, lineout(n, { defence: true })),
  ]),
  ['lineout with kick', lineoutPlay()],
  ['scrum with runs', scrumPlay()],
];

/** Everything drawn over the animation (entities, the ball in flight) at many sample times. */
function sampled(play: Play): { pos: Vec2; ball: boolean; height: number }[] {
  const out: { pos: Vec2; ball: boolean; height: number }[] = [];
  const total = totalDuration(play);
  for (let k = 0; k <= 97; k++) {
    const s = sample(play, (total * k) / 97);
    for (const e of s.entities) out.push({ pos: { ...e.pos }, ball: false, height: 0 });
    if (s.ball) out.push({ pos: { ...s.ball.pos }, ball: true, height: s.ball.height });
  }
  return out;
}

describe('export framing', () => {
  for (const [name, play] of PLAYS)
    for (const [rectName, { w, h }] of Object.entries(RECTS))
      it(`${name}: every token and the ball stay in frame (${rectName})`, () => {
        const f = frameForRect(play, w, h);
        const t = makeTransform({
          viewport: f.viewport,
          width: w,
          height: h,
          orientation: f.orientation,
        });
        // The viewport has the rect's aspect, so it fills it exactly.
        expect(t.scale).toBeCloseTo(f.scale, 6);
        const r = tokenRadiusPx(t);
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const p of sampled(play)) {
          const sx = t.sx(p.pos.x, p.pos.y);
          const sy = t.sy(p.pos.x, p.pos.y);
          // Token, role tag and highlight ring; the ball lifts and grows with its height.
          const reach = p.ball ? r * (0.65 * 2.2 + p.height * 0.3) + r : r * 1.6;
          expect(sx - reach, `${name} x ${p.pos.x}`).toBeGreaterThanOrEqual(0);
          expect(sx + reach, `${name} x ${p.pos.x}`).toBeLessThanOrEqual(w);
          expect(sy - reach, `${name} y ${p.pos.y}`).toBeGreaterThanOrEqual(0);
          expect(sy + reach, `${name} y ${p.pos.y}`).toBeLessThanOrEqual(h);
          x0 = Math.min(x0, sx);
          x1 = Math.max(x1, sx);
          y0 = Math.min(y0, sy);
          y1 = Math.max(y1, sy);
        }
        // The action is large: it spans most of the frame in its limiting direction.
        expect(Math.max((x1 - x0) / w, (y1 - y0) / h)).toBeGreaterThan(0.6);
      });

  it('keeps the touchline and the 5 m / 15 m lines in view for lineouts', () => {
    for (const [name, play] of PLAYS) {
      if (play.view !== 'lineout') continue;
      for (const { w, h } of Object.values(RECTS)) {
        const { viewport: v } = frameForRect(play, w, h);
        expect(v.x, name).toBeLessThanOrEqual(-2);
        expect(v.x + v.w, name).toBeGreaterThanOrEqual(16);
      }
    }
  });

  it('keeps the right touchline for a lineout on the right', () => {
    const r = lineout(6);
    const pos = Object.fromEntries(
      Object.entries(r.pos).map(([id, p]) => [id, { x: 70 - p.x, y: p.y }]),
    );
    const play = fromPreset('r6', { ...r, pos });
    for (const { w, h } of Object.values(RECTS)) {
      const { viewport: v } = frameForRect(play, w, h);
      expect(v.x + v.w).toBeGreaterThanOrEqual(72);
      expect(v.x).toBeLessThanOrEqual(54);
    }
  });

  it('frames a lineout far tighter than the full pitch', () => {
    const play = fromPreset('l7', lineout(7));
    const f = frameForRect(play, RECTS.story.w, RECTS.story.h);
    // At least 1.5× the scale of the whole-width portrait view (≈ 13.7 px/m here).
    expect(f.scale).toBeGreaterThan(1.5 * (RECTS.story.w / 74));
  });

  it("keeps a play's own viewport when nothing would be cropped", () => {
    const play = fromPreset('l5', lineout(5));
    play.viewport = { x: -4, y: 24, w: 56, h: 46 };
    for (const { w, h } of Object.values(RECTS)) {
      const { viewport: v } = frameForRect(play, w, h);
      expect(v.x).toBeLessThanOrEqual(-4 + 1e-9);
      expect(v.y).toBeLessThanOrEqual(24 + 1e-9);
      expect(v.x + v.w).toBeGreaterThanOrEqual(52 - 1e-9);
      expect(v.y + v.h).toBeGreaterThanOrEqual(70 - 1e-9);
    }
  });

  it("grows a play's own viewport that would crop a token", () => {
    const play = fromPreset('l5', lineout(5, { defence: true }));
    play.viewport = { x: -4, y: 24, w: 44, h: 36 };
    const { viewport: v } = frameForRect(play, RECTS.square.w, RECTS.square.h);
    // The defending 11 stands at x = 50, the attacking 15 at y = LINEOUT_Y + 25.
    expect(v.x + v.w).toBeGreaterThan(50);
    expect(v.y + v.h).toBeGreaterThan(LINEOUT_Y + 25);
  });

  it('is the same for every frame of a play (stable video framing)', () => {
    const play = lineoutPlay();
    const a = frameForRect(play, 1856, 770);
    const b = frameForRect(play, 1856, 770);
    expect(b).toEqual(a);
  });
});
