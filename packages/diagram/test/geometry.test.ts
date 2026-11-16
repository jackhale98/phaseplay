import { describe, expect, it } from 'vitest';
import {
  bezierDerivative,
  bezierPoint,
  buildArcTable,
  dist,
  ease,
  EASINGS,
  fitBezier,
  pointAtDistance,
  pointAtFraction,
  rdp,
  sampleCurve,
  strokeToCtrl,
} from '../src/geometry';

describe('Bézier', () => {
  it('evaluates endpoints and midpoints', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 10, y: 0 };
    expect(bezierPoint(p0, [], p1, 0.5)).toEqual({ x: 5, y: 0 });
    expect(bezierPoint(p0, [{ x: 5, y: 10 }], p1, 0.5)).toEqual({ x: 5, y: 5 });
    const c = [
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ];
    expect(bezierPoint(p0, c, p1, 0)).toEqual(p0);
    expect(bezierPoint(p0, c, p1, 1)).toEqual(p1);
    expect(bezierPoint(p0, c, p1, 0.5)).toEqual({ x: 5, y: 7.5 });
  });

  it('derivative matches finite differences', () => {
    const p0 = { x: 1, y: 2 };
    const p1 = { x: 9, y: -3 };
    for (const ctrl of [
      [],
      [{ x: 4, y: 8 }],
      [
        { x: 0, y: 6 },
        { x: 12, y: 5 },
      ],
    ]) {
      for (const t of [0.1, 0.5, 0.9]) {
        const h = 1e-6;
        const a = bezierPoint(p0, ctrl, p1, t - h);
        const b = bezierPoint(p0, ctrl, p1, t + h);
        const d = bezierDerivative(p0, ctrl, p1, t);
        expect(d.x).toBeCloseTo((b.x - a.x) / (2 * h), 4);
        expect(d.y).toBeCloseTo((b.y - a.y) / (2 * h), 4);
      }
    }
  });

  it('arc length of a straight line and a quarter-ish circle', () => {
    expect(buildArcTable({ x: 0, y: 0 }, [], { x: 3, y: 4 }).total).toBe(5);
    // Cubic approximation of a quarter circle of radius 10 (k = 0.5523).
    const k = 0.5523 * 10;
    const t = buildArcTable(
      { x: 10, y: 0 },
      [
        { x: 10, y: k },
        { x: k, y: 10 },
      ],
      { x: 0, y: 10 },
      200,
    );
    expect(t.total).toBeCloseTo((Math.PI * 10) / 2, 1);
  });

  it('pointAtDistance moves at constant speed along a curve', () => {
    const table = buildArcTable(
      { x: 0, y: 0 },
      [
        { x: 0, y: 30 },
        { x: 30, y: 30 },
      ],
      { x: 30, y: 0 },
      96,
    );
    const n = 20;
    const pts = Array.from({ length: n + 1 }, (_, i) =>
      pointAtDistance(table, (i / n) * table.total),
    );
    const steps = pts.slice(1).map((p, i) => dist(p, pts[i]!));
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    for (const s of steps) expect(Math.abs(s - mean) / mean).toBeLessThan(0.03);
    expect(pointAtFraction(table, 1)).toEqual({ x: 30, y: 0 });
    expect(pointAtFraction(table, 0)).toEqual({ x: 0, y: 0 });
  });

  it('sampleCurve gives evenly spaced points', () => {
    const table = buildArcTable({ x: 0, y: 0 }, [{ x: 5, y: 10 }], { x: 10, y: 0 });
    expect(sampleCurve(table, 8)).toHaveLength(9);
    expect(sampleCurve(buildArcTable({ x: 0, y: 0 }, [], { x: 1, y: 1 }))).toHaveLength(2);
  });
});

describe('easing', () => {
  it('maps 0→0 and 1→1, monotonic, clamps', () => {
    for (const name of Object.keys(EASINGS) as (keyof typeof EASINGS)[]) {
      expect(ease(name, 0)).toBe(0);
      expect(ease(name, 1)).toBeCloseTo(1, 12);
      expect(ease(name, -1)).toBe(0);
      expect(ease(name, 2)).toBeCloseTo(1, 12);
      let prev = 0;
      for (let i = 1; i <= 50; i++) {
        const v = ease(name, i / 50);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
    expect(ease('inOut', 0.5)).toBeCloseTo(0.5);
    expect(ease('out', 0.5)).toBeGreaterThan(0.5);
  });
});

describe('RDP and fitBezier', () => {
  it('rdp removes collinear points and keeps corners', () => {
    const line = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0.01 * (i % 2) }));
    expect(rdp(line, 0.1)).toEqual([line[0], line[19]]);
    const corner = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ];
    expect(rdp(corner, 0.1)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('straight strokes fit to no control points', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({
      x: i,
      y: 2 * i + (i % 3 === 0 ? 0.05 : 0),
    }));
    expect(fitBezier(pts)).toEqual([]);
  });

  it('recovers a quadratic within tolerance', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 20, y: 0 };
    const c = [{ x: 10, y: 12 }];
    const pts = Array.from({ length: 40 }, (_, i) => bezierPoint(p0, c, p1, i / 39));
    const fit = fitBezier(pts);
    expect(fit).toHaveLength(1);
    expect(fit[0]!.x).toBeCloseTo(10, 0);
    expect(fit[0]!.y).toBeCloseTo(12, 0);
  });

  it('fits an S-curve with a cubic whose error is small', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 0, y: 30 };
    const c = [
      { x: 15, y: 10 },
      { x: -15, y: 20 },
    ];
    const pts = Array.from({ length: 60 }, (_, i) => bezierPoint(p0, c, p1, i / 59));
    const fit = strokeToCtrl(pts);
    expect(fit).toHaveLength(2);
    const table = buildArcTable(p0, fit, p1, 100);
    const poly = sampleCurve(table, 100);
    for (const p of pts) expect(Math.min(...poly.map((q) => dist(p, q)))).toBeLessThan(0.6);
  });
});
