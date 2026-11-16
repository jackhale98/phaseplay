/**
 * Plain-language descriptions of plays, frames and tokens (docs/design.md §Accessibility: every
 * play, drill and frame has a text description readable without the animation).
 */
import type { Entity, Play, Vec2 } from '@phaseplay/shared';
import { resolvedBall, resolvedPositions } from '@phaseplay/diagram/sample';
import { drillArea } from '@phaseplay/diagram/viewport';

export type Names = Record<string, string>;

const KIND_LABEL: Record<Entity['kind'], string> = {
  attack: 'Attacker',
  defence: 'Defender',
  player: 'Player',
  ball: 'Ball',
  cone: 'Cone',
  marker: 'Marker',
  pole: 'Pole',
  gate: 'Gate',
  shield: 'Tackle shield',
  bag: 'Tackle bag',
  tube: 'Tackle tube',
  ladder: 'Ladder',
  hurdle: 'Hurdle',
  scrum_machine: 'Scrum machine',
  zone: 'Zone',
  label: 'Label',
  coach: 'Coach',
};
const ROLE: Record<string, string> = { J: 'jumper', L: 'lifter' };

export const kindLabel = (k: Entity['kind']) => KIND_LABEL[k];

/** "Attacker 10", "Defender 4 (jumper)", "Player A3", "Zone “End zone”". */
export function entityLabel(e: Entity, names: Names = {}): string {
  let s = KIND_LABEL[e.kind];
  if (e.kind === 'player' && e.group) s += ` ${e.group}`;
  if (e.number !== undefined) s += e.kind === 'player' && e.group ? `${e.number}` : ` ${e.number}`;
  if (e.text) {
    if ((e.kind === 'attack' || e.kind === 'defence') && ROLE[e.text]) s += ` (${ROLE[e.text]})`;
    else if (e.kind === 'zone' || e.kind === 'label') s += ` “${e.text}”`;
  }
  const who = e.memberId ? names[e.memberId] : undefined;
  if (who) s += `, ${who}`;
  return s;
}

const r = (n: number) => Math.round(Math.abs(n));

/** Where a point is, in words: pitch metres from the left touchline and the try line. */
export function placeLabel(play: Pick<Play, 'background'>, p: Vec2): string {
  if (drillArea(play)) return `${r(p.x)} m across, ${r(p.y)} m down`;
  const fromTry = p.y < 0 ? `${r(p.y)} m into the in-goal` : `${r(p.y)} m out from the try line`;
  return `${r(p.x)} m in from the left touchline, ${fromTry}`;
}

/** Direction of travel in words. Attack runs towards y = 0, so "forward" is decreasing y. */
export function direction(d: Vec2): string {
  const fwd = -d.y;
  const side = d.x;
  const af = Math.abs(fwd);
  const as = Math.abs(side);
  const fw = fwd >= 0 ? 'forward' : 'back';
  const sd = side >= 0 ? 'right' : 'left';
  if (af > as * 2) return fw;
  if (as > af * 2) return `to the ${sd}`;
  return `${fw} and ${sd}`;
}

const MAX_MOVERS = 8;

/** One frame in words: the caption, who moves where, and where the ball goes. */
export function describeFrame(play: Play, index: number, names: Names = {}): string {
  const frame = play.frames[index];
  if (!frame) return '';
  const byId = new Map(play.entities.map((e) => [e.id, e]));
  const label = (id: string | undefined) => {
    const e = id ? byId.get(id) : undefined;
    return e ? entityLabel(e, names) : 'a player';
  };
  const parts: string[] = [];
  if (frame.caption) parts.push(frame.caption.trim().replace(/[.!]?$/, '.'));

  if (index === 0) {
    const counts = new Map<string, number>();
    for (const e of play.entities) {
      if (e.kind === 'ball') continue;
      const k = KIND_LABEL[e.kind].toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const list = [...counts].map(([k, n]) => `${n} ${n === 1 ? k : plural(k)}`);
    const ball = resolvedBall(play, 0);
    let s = list.length ? `Starting formation: ${joinList(list)}` : 'An empty pitch';
    if (ball?.holder) s += `. ${label(ball.holder)} has the ball`;
    parts.push(`${s}.`);
    return parts.join(' ');
  }

  const before = resolvedPositions(play, index - 1);
  const after = resolvedPositions(play, index);
  const ballBefore = resolvedBall(play, index - 1);
  const ballAfter = resolvedBall(play, index);
  const movers: string[] = [];
  for (const e of play.entities) {
    if (e.kind === 'ball') continue;
    const a = before[e.id];
    const b = after[e.id];
    if (!a || !b) continue;
    const d = { x: b.x - a.x, y: b.y - a.y };
    const m = Math.hypot(d.x, d.y);
    if (m < 0.5) continue;
    const carrying = ballAfter?.holder === e.id && ballBefore?.holder === e.id;
    const verb = frame.moves[e.id]?.kind === 'carry' || carrying ? 'carries' : 'runs';
    movers.push(`${entityLabel(e, names)} ${verb} ${r(m)} m ${direction(d)}`);
  }
  if (movers.length > MAX_MOVERS) {
    const rest = movers.length - MAX_MOVERS;
    movers.length = MAX_MOVERS;
    movers.push(`${rest} more move${rest === 1 ? 's' : ''}`);
  }
  if (movers.length) parts.push(`${movers.join('; ')}.`);

  const ballId = play.entities.find((e) => e.kind === 'ball')?.id;
  const ballMove = ballId ? frame.moves[ballId]?.kind : undefined;
  const from = ballBefore?.holder;
  if (ballAfter?.holder && ballAfter.holder !== from) {
    const verb = ballMove === 'kick' ? 'kicks' : 'passes';
    parts.push(
      from
        ? `${label(from)} ${verb} to ${label(ballAfter.holder)}.`
        : `${label(ballAfter.holder)} gathers the ball.`,
    );
  } else if (!ballAfter?.holder && ballAfter?.at && from) {
    const verb = ballMove === 'pass' ? 'passes' : 'kicks';
    parts.push(`${label(from)} ${verb} the ball into space, ${placeLabel(play, ballAfter.at)}.`);
  }
  if (parts.length === 0) parts.push('A pause: nobody moves.');
  return parts.join(' ');
}

/** Short summary of a whole play, used for the canvas's accessible name. */
export function describePlay(play: Play): string {
  const n = play.frames.length;
  return `${play.title || 'Untitled'}: ${n} frame${n === 1 ? '' : 's'}, ${play.entities.filter((e) => e.kind !== 'ball').length} tokens.`;
}

function plural(k: string): string {
  if (k === 'coach') return 'coaches';
  if (k.endsWith('s')) return k;
  return `${k}s`;
}

export function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
