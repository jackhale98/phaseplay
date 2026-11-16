import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { Play as PlaySchema, type Play } from '@phaseplay/shared';
import { newPlay, addFrame } from '@phaseplay/diagram/presets';
import { resolvedBall, sample } from '@phaseplay/diagram/sample';
import {
  addEntity,
  addPlayersOp,
  applyPreset,
  deleteFrame,
  duplicateEntity,
  inRect,
  kickTo,
  moveFrame,
  passTo,
  pick,
  removeEntities,
  setCaption,
  setDuration,
  setMove,
  setPositions,
  setRun,
  snapPoint,
  updateEntity,
} from './ops';
import { PRESETS } from '@phaseplay/diagram/presets';
import { describeFrame, entityLabel, direction, placeLabel } from './describe';

const valid = (p: Play) => expect(v.safeParse(PlaySchema, p).success).toBe(true);
const lineout = () =>
  newPlay({ id: 'p1', title: 'Lineout', mode: 'play', format: '15s', preset: 'lineout5' });

describe('editor ops', () => {
  it('builds a 4-frame lineout move that stays valid', () => {
    let p = lineout();
    p = addFrame(p, 0);
    p = setRun(p, 1, 'a4', { x: 10, y: 38 }, [{ x: 9, y: 39 }]);
    p = passTo(p, 1, 'a9');
    p = addFrame(p, 1);
    p = setRun(p, 2, 'a10', { x: 22, y: 44 }, []);
    p = passTo(p, 2, 'a10');
    p = addFrame(p, 2);
    p = setPositions(p, 3, { a12: { x: 30, y: 40 } });
    p = passTo(p, 3, 'a12');
    p = setCaption(p, 3, '12 hits the line');
    expect(p.frames).toHaveLength(4);
    valid(p);
    expect(resolvedBall(p, 3)?.holder).toBe('a12');
    expect(p.frames[1]!.moves.a4).toEqual({ kind: 'run', ctrl: [{ x: 9, y: 39 }] });
    expect(p.frames[1]!.moves.ball?.kind).toBe('pass');
  });

  it('marks a run by the ball carrier as a carry', () => {
    let p = addFrame(lineout(), 0);
    p = passTo(p, 1, 'a9');
    p = addFrame(p, 1);
    p = setRun(p, 2, 'a9', { x: 15, y: 40 }, []);
    expect(p.frames[2]!.moves.a9?.kind).toBe('carry');
  });

  it('adds numbered tokens with preset-style ids and a single ball', () => {
    let p = newPlay({ id: 'b', title: 'Blank', mode: 'play', format: '15s', view: 'half' });
    let r = addEntity(p, 'attack', { x: 10, y: 10 });
    expect(r.id).toBe('a1');
    p = r.play;
    r = addEntity(p, 'attack', { x: 12, y: 10 });
    expect(r.id).toBe('a2');
    p = r.play;
    r = addEntity(p, 'ball', { x: 1, y: 1 });
    p = r.play;
    r = addEntity(p, 'ball', { x: 2, y: 2 });
    p = r.play;
    expect(p.entities.filter((e) => e.kind === 'ball')).toHaveLength(1);
    r = addEntity(p, 'zone', { x: 20, y: 20 });
    expect(r.play.entities.at(-1)!.size).toEqual({ w: 10, h: 5 });
    valid(r.play);
  });

  it('kicks to a spot and removes entities everywhere', () => {
    let p = addFrame(lineout(), 0);
    p = kickTo(p, 1, { x: 40, y: 10 });
    expect(resolvedBall(p, 1)).toEqual({ at: { x: 40, y: 10 } });
    p = passTo(p, 1, 'a9');
    p = removeEntities(p, ['a9']);
    expect(p.entities.some((e) => e.id === 'a9')).toBe(false);
    expect(p.frames[1]!.ball?.holder).toBeUndefined();
    valid(p);
  });

  it('duplicates, updates and re-numbers', () => {
    const r = duplicateEntity(lineout(), 'a10');
    const copy = r.play.entities.find((e) => e.id === r.id)!;
    expect(copy.kind).toBe('attack');
    expect(copy.number).not.toBe(10);
    let p = updateEntity(r.play, r.id, { number: 22, memberId: undefined });
    expect(p.entities.find((e) => e.id === r.id)!.number).toBe(22);
    expect(updateEntity(p, r.id, { number: 22 })).toBe(p);
    p = updateEntity(p, r.id, { text: '' });
    expect('text' in p.entities.find((e) => e.id === r.id)!).toBe(false);
  });

  it('edits frames: move, duration, caption, delete and reorder', () => {
    let p = addFrame(addFrame(lineout(), 0), 1);
    p = setDuration(p, 1, 50);
    expect(p.frames[1]!.durationMs).toBe(200);
    expect(setDuration(p, 0, 999)).toBe(p);
    p = setMove(p, 1, 'a10', { delayMs: 300, ease: 'out' });
    expect(p.frames[1]!.moves.a10).toEqual({ kind: 'run', delayMs: 300, ease: 'out' });
    p = setCaption(p, 2, 'Go');
    const ids = p.frames.map((f) => f.id);
    p = moveFrame(p, 1, 1);
    expect(p.frames.map((f) => f.id)).toEqual([ids[0], ids[2], ids[1]]);
    p = deleteFrame(p, 0);
    expect(p.frames).toHaveLength(2);
    expect(p.frames[0]!.durationMs).toBe(0);
    valid(p);
  });

  it('applies a preset and adds drill players inside the area', () => {
    const d = newPlay({ id: 'd', title: 'Drill', mode: 'drill', format: 'any' });
    const p = addPlayersOp(d, 6, 'grid', { x: 10, y: 10 }, 'A');
    expect(p.entities.filter((e) => e.kind === 'player')).toHaveLength(6);
    const again = addPlayersOp(p, 2, 'line', { x: 0, y: 0 }, 'A');
    expect(new Set(again.entities.map((e) => e.id)).size).toBe(8);
    valid(again);
    const q = applyPreset(
      newPlay({ id: 'x', title: 'X', mode: 'play', format: 'any' }),
      PRESETS.scrum7.build(),
    );
    expect(q.view).toBe('scrum');
    expect(q.format).toBe('7s');
    valid(q);
  });

  it('snaps to pitch lines, or whole metres in drills', () => {
    expect(snapPoint({}, { x: 14.6, y: 21.7 })).toEqual({ x: 15, y: 22 });
    expect(snapPoint({}, { x: 30.3, y: 30.2 })).toEqual({ x: 30.5, y: 30 });
    expect(snapPoint({ background: { kind: 'grass', w: 20, h: 20 } }, { x: 3.4, y: 7.6 })).toEqual({
      x: 3,
      y: 8,
    });
  });

  it('picks the carrier over the ball it holds, and selects by marquee', () => {
    const p = lineout();
    const s = sample(p, 0);
    const hooker = s.entities.find((e) => e.id === 'a2')!;
    expect(pick(s, hooker.pos, 1)).toBe('a2');
    expect(pick(s, { x: 69, y: 0 }, 1)).toBeNull();
    const ids = inRect(s, { x: 5, y: 39 }, { x: 13, y: 42 });
    expect(ids).toContain('a4');
    expect(ids).not.toContain('a15');
  });
});

describe('descriptions', () => {
  it('labels tokens and directions', () => {
    expect(entityLabel({ id: 'a4', kind: 'attack', number: 4, text: 'J' })).toBe(
      'Attacker 4 (jumper)',
    );
    expect(entityLabel({ id: 'pA1', kind: 'player', group: 'A', number: 1 })).toBe('Player A1');
    expect(
      entityLabel({ id: 'a9', kind: 'attack', number: 9, memberId: 'm1' }, { m1: 'Jess' }),
    ).toBe('Attacker 9, Jess');
    expect(direction({ x: 0, y: -5 })).toBe('forward');
    expect(direction({ x: 4, y: 0 })).toBe('to the right');
    expect(direction({ x: -3, y: 3 })).toBe('back and left');
    expect(placeLabel({}, { x: 15, y: 22 })).toBe(
      '15 m in from the left touchline, 22 m out from the try line',
    );
  });

  it('describes the formation, runs and passes', () => {
    let p = addFrame(lineout(), 0);
    p = setRun(p, 1, 'a10', { x: 20, y: 44 }, []);
    p = passTo(p, 1, 'a9');
    p = setCaption(p, 1, 'Throw to the front');
    expect(describeFrame(p, 0)).toMatch(
      /^Starting formation: 15 attackers\. Attacker 2 has the ball\.$/,
    );
    const d = describeFrame(p, 1);
    expect(d).toContain('Throw to the front.');
    expect(d).toContain('Attacker 10 runs 5 m forward');
    expect(d).toContain('Attacker 2 passes to Attacker 9.');
  });
});
