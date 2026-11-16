/**
 * Vector maths, Bézier curves, arc-length parameterisation, easing, stroke simplification and
 * curve fitting. Everything works in pitch metres and is allocation-light: functions that return a
 * point accept an optional `out` to write into.
 */
import type { Vec2 } from '@phaseplay/shared';

export type { Vec2 };

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Linear interpolation of two points. */
export function lerpVec(a: Vec2, b: Vec2, t: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}

/** Unit vector (or zero vector for zero length). */
export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** Distance from point `p` to segment `a`–`b`. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return dist(p, a);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// ---------------------------------------------------------------------------------------------
// Bézier curves. A curve is p0 → p1 with 0 (line), 1 (quadratic) or 2 (cubic) control points.

/** Evaluate a line/quadratic/cubic Bézier at parameter t ∈ [0, 1]. */
export function bezierPoint(
  p0: Vec2,
  ctrl: readonly Vec2[] | undefined,
  p1: Vec2,
  t: number,
  out: Vec2 = { x: 0, y: 0 },
): Vec2 {
  const c0 = ctrl?.[0];
  const c1 = ctrl?.[1];
  const u = 1 - t;
  if (!c0) return lerpVec(p0, p1, t, out);
  if (!c1) {
    const a = u * u;
    const b = 2 * u * t;
    const c = t * t;
    out.x = a * p0.x + b * c0.x + c * p1.x;
    out.y = a * p0.y + b * c0.y + c * p1.y;
    return out;
  }
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  out.x = a * p0.x + b * c0.x + c * c1.x + d * p1.x;
  out.y = a * p0.y + b * c0.y + c * c1.y + d * p1.y;
  return out;
}

/** First derivative (tangent, not normalised) of the Bézier at t. */
export function bezierDerivative(
  p0: Vec2,
  ctrl: readonly Vec2[] | undefined,
  p1: Vec2,
  t: number,
  out: Vec2 = { x: 0, y: 0 },
): Vec2 {
  const c0 = ctrl?.[0];
  const c1 = ctrl?.[1];
  const u = 1 - t;
  if (!c0) {
    out.x = p1.x - p0.x;
    out.y = p1.y - p0.y;
    return out;
  }
  if (!c1) {
    out.x = 2 * u * (c0.x - p0.x) + 2 * t * (p1.x - c0.x);
    out.y = 2 * u * (c0.y - p0.y) + 2 * t * (p1.y - c0.y);
    return out;
  }
  out.x = 3 * u * u * (c0.x - p0.x) + 6 * u * t * (c1.x - c0.x) + 3 * t * t * (p1.x - c1.x);
  out.y = 3 * u * u * (c0.y - p0.y) + 6 * u * t * (c1.y - c0.y) + 3 * t * t * (p1.y - c1.y);
  return out;
}

/** A curve with a cumulative arc-length table, for constant-speed travel along it. */
export type ArcTable = {
  readonly p0: Vec2;
  readonly ctrl: readonly Vec2[];
  readonly p1: Vec2;
  /** lengths[i] = arc length from t=0 to t=i/(n). Empty for straight lines. */
  readonly lengths: Float64Array;
  readonly total: number;
};

/** Build an arc-length table with `samples` chords (straight lines need none). */
export function buildArcTable(
  p0: Vec2,
  ctrl: readonly Vec2[] | undefined,
  p1: Vec2,
  samples = 48,
): ArcTable {
  const c = ctrl && ctrl.length ? ctrl.slice(0, 2) : [];
  if (!c.length) return { p0, ctrl: c, p1, lengths: new Float64Array(0), total: dist(p0, p1) };
  const lengths = new Float64Array(samples + 1);
  const prev = { x: p0.x, y: p0.y };
  const cur = { x: 0, y: 0 };
  let acc = 0;
  for (let i = 1; i <= samples; i++) {
    bezierPoint(p0, c, p1, i / samples, cur);
    acc += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    lengths[i] = acc;
    prev.x = cur.x;
    prev.y = cur.y;
  }
  return { p0, ctrl: c, p1, lengths, total: acc };
}

/** Map an arc-length distance to the curve parameter t. */
export function paramAtDistance(table: ArcTable, d: number): number {
  const { lengths, total } = table;
  if (total <= 1e-12) return d > 0 ? 1 : 0;
  if (d <= 0) return 0;
  if (d >= total) return 1;
  const n = lengths.length - 1;
  if (n < 1) return d / total;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((lengths[mid] as number) < d) lo = mid;
    else hi = mid;
  }
  const a = lengths[lo] as number;
  const b = lengths[hi] as number;
  const f = b > a ? (d - a) / (b - a) : 0;
  return (lo + f) / n;
}

/** Point at arc-length distance `d` along the curve (constant speed). */
export function pointAtDistance(table: ArcTable, d: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  return bezierPoint(table.p0, table.ctrl, table.p1, paramAtDistance(table, d), out);
}

/** Point at fraction `u` ∈ [0,1] of the curve's arc length. */
export function pointAtFraction(table: ArcTable, u: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  return pointAtDistance(table, clamp(u, 0, 1) * table.total, out);
}

/** Tangent direction (radians, screen-independent pitch angle) at fraction `u` of arc length. */
export function headingAtFraction(table: ArcTable, u: number): number {
  const t = paramAtDistance(table, clamp(u, 0, 1) * table.total);
  const d = bezierDerivative(table.p0, table.ctrl, table.p1, t, scratch);
  return Math.atan2(d.y, d.x);
}
const scratch = { x: 0, y: 0 };

/** Sample the curve into `n + 1` evenly spaced (by arc length) points. */
export function sampleCurve(table: ArcTable, n = 16): Vec2[] {
  if (!table.ctrl.length) return [{ ...table.p0 }, { ...table.p1 }];
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) pts.push(pointAtFraction(table, i / n));
  return pts;
}

// ---------------------------------------------------------------------------------------------
// Easing

export type EaseName = 'linear' | 'inOut' | 'out';

/** Easing functions mapping [0,1] → [0,1] monotonically, with no overshoot. */
export const EASINGS: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2),
  out: (t) => 1 - (1 - t) * (1 - t) * (1 - t),
};

/** Apply a named easing to a clamped t. */
export function ease(name: EaseName | undefined, t: number): number {
  return EASINGS[name ?? 'linear'](clamp(t, 0, 1));
}

// ---------------------------------------------------------------------------------------------
// Stroke simplification and fitting

/** Ramer–Douglas–Peucker polyline simplification. Keeps the first and last points. */
export function rdp(points: readonly Vec2[], epsilon: number): Vec2[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    const a = points[s] as Vec2;
    const b = points[e] as Vec2;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(points[i] as Vec2, a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx > 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Chord-length parameters for a polyline, normalised to [0,1]. */
function chordParams(points: readonly Vec2[]): number[] {
  const ts = [0];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += dist(points[i - 1] as Vec2, points[i] as Vec2);
    ts.push(acc);
  }
  return ts.map((t) => (acc > 0 ? t / acc : 0));
}

function maxError(points: readonly Vec2[], ctrl: Vec2[]): number {
  const p0 = points[0] as Vec2;
  const p1 = points[points.length - 1] as Vec2;
  const table = buildArcTable(p0, ctrl, p1, 64);
  const poly = sampleCurve(table, 64);
  let worst = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 1; i < poly.length; i++)
      best = Math.min(best, distToSegment(p, poly[i - 1] as Vec2, poly[i] as Vec2));
    worst = Math.max(worst, best);
  }
  return worst;
}

/** Least-squares quadratic control point with fixed endpoints. */
function fitQuadratic(points: readonly Vec2[], ts: number[]): Vec2 {
  const p0 = points[0] as Vec2;
  const p2 = points[points.length - 1] as Vec2;
  let num = { x: 0, y: 0 };
  let den = 0;
  points.forEach((p, i) => {
    const t = ts[i] as number;
    const u = 1 - t;
    const b1 = 2 * u * t;
    const rx = p.x - u * u * p0.x - t * t * p2.x;
    const ry = p.y - u * u * p0.y - t * t * p2.y;
    num = { x: num.x + b1 * rx, y: num.y + b1 * ry };
    den += b1 * b1;
  });
  return den > 1e-12 ? { x: num.x / den, y: num.y / den } : lerpVec(p0, p2, 0.5);
}

/** Least-squares cubic control points with fixed endpoints (Schneider-style 2×2 solve). */
function fitCubic(points: readonly Vec2[], ts: number[]): [Vec2, Vec2] {
  const p0 = points[0] as Vec2;
  const p3 = points[points.length - 1] as Vec2;
  let a11 = 0,
    a12 = 0,
    a22 = 0;
  let bx1 = 0,
    by1 = 0,
    bx2 = 0,
    by2 = 0;
  points.forEach((p, i) => {
    const t = ts[i] as number;
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const b3 = t * t * t;
    const rx = p.x - b0 * p0.x - b3 * p3.x;
    const ry = p.y - b0 * p0.y - b3 * p3.y;
    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;
    bx1 += b1 * rx;
    by1 += b1 * ry;
    bx2 += b2 * rx;
    by2 += b2 * ry;
  });
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return [lerpVec(p0, p3, 1 / 3), lerpVec(p0, p3, 2 / 3)];
  return [
    { x: (bx1 * a22 - bx2 * a12) / det, y: (by1 * a22 - by2 * a12) / det },
    { x: (a11 * bx2 - a12 * bx1) / det, y: (a11 * by2 - a12 * by1) / det },
  ];
}

/** Improve parameters by projecting each point onto the curve (one Newton step each). */
function reparam(points: readonly Vec2[], ts: number[], ctrl: Vec2[]): number[] {
  const p0 = points[0] as Vec2;
  const p1 = points[points.length - 1] as Vec2;
  const pt = { x: 0, y: 0 };
  const d1 = { x: 0, y: 0 };
  return ts.map((t, i) => {
    if (i === 0 || i === ts.length - 1) return t;
    const p = points[i] as Vec2;
    bezierPoint(p0, ctrl, p1, t, pt);
    bezierDerivative(p0, ctrl, p1, t, d1);
    const num = (pt.x - p.x) * d1.x + (pt.y - p.y) * d1.y;
    const den = d1.x * d1.x + d1.y * d1.y;
    return den > 1e-12 ? clamp(t - num / den, 0, 1) : t;
  });
}

/**
 * Fit a finger stroke to a Move.ctrl list (0–2 control points) between its first and last point.
 * Returns [] when the stroke is close to straight, one control point when a quadratic fits within
 * `tolerance` metres, otherwise two (cubic).
 */
export function fitBezier(points: readonly Vec2[], tolerance = 0.5): Vec2[] {
  if (points.length < 3) return [];
  const p0 = points[0] as Vec2;
  const p1 = points[points.length - 1] as Vec2;
  const chord = dist(p0, p1);
  let worst = 0;
  for (const p of points) worst = Math.max(worst, distToSegment(p, p0, p1));
  if (worst <= Math.max(tolerance * 0.5, chord * 0.02)) return [];
  let ts = chordParams(points);
  let q = fitQuadratic(points, ts);
  for (let k = 0; k < 4; k++) {
    ts = reparam(points, ts, [q]);
    q = fitQuadratic(points, ts);
  }
  if (maxError(points, [q]) <= tolerance) return [q];
  ts = chordParams(points);
  let c = fitCubic(points, ts);
  for (let k = 0; k < 6; k++) {
    ts = reparam(points, ts, c);
    c = fitCubic(points, ts);
  }
  return c;
}

/** Simplify a raw stroke (RDP) and fit it: the editor's "finger stroke → Move.ctrl" pipeline. */
export function strokeToCtrl(points: readonly Vec2[], epsilon = 0.25, tolerance = 0.5): Vec2[] {
  return fitBezier(points.length > 64 ? rdp(points, epsilon / 4) : points, tolerance);
}
