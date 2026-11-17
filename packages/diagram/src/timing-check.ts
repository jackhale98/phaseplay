/**
 * Sanity checks on a play's timing, so a diagram reads like real rugby: nobody outruns their own
 * pass, and nobody moves faster than a person can. Used by tests over every template and demo play.
 */
import type { Play } from '@phaseplay/shared';
import { frameTimes, resolvedBall, sample } from './sample';

export type TimingIssue = {
  frame: number;
  id: string;
  problem: 'overtakes-pass' | 'too-fast';
  detail: string;
};

const PEOPLE = new Set(['player', 'attack', 'defence', 'coach']);
/** Average speed per frame, in m/s (diagrams run a little faster than life). */
export const MAX_AVG_SPEED = 8;

export function timingIssues(play: Play): TimingIssue[] {
  const out: TimingIssue[] = [];
  const times = frameTimes(play);
  const people = new Set(play.entities.filter((e) => PEOPLE.has(e.kind)).map((e) => e.id));
  const at = (t: number) => {
    const s = sample(play, t);
    return { s, pos: new Map(s.entities.map((e) => [e.id, { ...e.pos }])) };
  };
  for (let fi = 1; fi < play.frames.length; fi++) {
    const f = play.frames[fi]!;
    const t0 = times[fi - 1]!;
    const dur = f.durationMs;
    if (dur <= 0) continue;
    const STEPS = 30;
    const snaps = Array.from({ length: STEPS + 1 }, (_, k) => at(t0 + (dur * k) / STEPS));
    for (const id of Object.keys(f.moves)) {
      if (!people.has(id)) continue;
      let len = 0;
      for (let k = 1; k <= STEPS; k++) {
        const a = snaps[k - 1]!.pos.get(id);
        const b = snaps[k]!.pos.get(id);
        if (a && b) len += Math.hypot(b.x - a.x, b.y - a.y);
      }
      const avg = len / (dur / 1000);
      if (avg > MAX_AVG_SPEED)
        out.push({ frame: fi, id, problem: 'too-fast', detail: `${avg.toFixed(1)} m/s` });
    }
    // While a pass is in the air, the passer must not be clearly closer to the receiver than the ball.
    const prev = resolvedBall(play, fi - 1)?.holder;
    const next = resolvedBall(play, fi)?.holder;
    if (!prev || !next || prev === next) continue;
    for (const { s, pos } of snaps) {
      if (!s.ball?.flight) continue;
      const pa = pos.get(prev);
      const pb = pos.get(next);
      if (!pa || !pb) break;
      const ball = s.ball.pos;
      const passer = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const flying = Math.hypot(ball.x - pb.x, ball.y - pb.y);
      if (passer < flying - 1) {
        out.push({ frame: fi, id: prev, problem: 'overtakes-pass', detail: `${prev} → ${next}` });
        break;
      }
    }
  }
  return out;
}
