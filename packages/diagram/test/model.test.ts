import { equipmentFromDiagram, Play, VIEWS } from '@phaseplay/shared';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { addPlayers, DRILL_TEMPLATES, EXTRA_DRILL_TEMPLATES } from '../src/drill-templates';
import { History } from '../src/history';
import { CURRENT_PLAY_VERSION, migratePlay, PlayMigrationError } from '../src/migrate';
import { addFrame, duplicateFrame, newPlay, PRESETS, type PresetId } from '../src/presets';
import { frameTimes, resolvedPositions, sample } from '../src/sample';
import {
  bestOrientation,
  hitTest,
  LINEOUT_Y,
  makeTransform,
  playViewport,
  viewForPreset,
} from '../src/viewport';

const ALL_TEMPLATES = { ...DRILL_TEMPLATES, ...EXTRA_DRILL_TEMPLATES };

describe('viewport transforms', () => {
  for (const orientation of ['portrait', 'landscape'] as const) {
    it(`round-trips in ${orientation}`, () => {
      for (const view of VIEWS) {
        const t = makeTransform({
          viewport: viewForPreset(view),
          width: 390,
          height: 844,
          orientation,
          padding: 12,
          originX: 5,
          originY: 7,
        });
        for (const p of [
          { x: 0, y: -10 },
          { x: 70, y: 110 },
          { x: 35.5, y: 22.25 },
          { x: 12, y: 78 },
        ]) {
          const q = t.toPitch(t.toScreen(p));
          expect(q.x).toBeCloseTo(p.x, 9);
          expect(q.y).toBeCloseTo(p.y, 9);
          expect(t.sx(p.x, p.y)).toBeCloseTo(t.toScreen(p).x, 9);
        }
      }
    });
  }

  it('portrait draws length down the screen, landscape across with attack to the right', () => {
    const vp = viewForPreset('full');
    const p = makeTransform({ viewport: vp, width: 400, height: 800, orientation: 'portrait' });
    expect(p.toScreen({ x: 35, y: 0 }).y).toBeLessThan(p.toScreen({ x: 35, y: 100 }).y);
    const l = makeTransform({ viewport: vp, width: 800, height: 400, orientation: 'landscape' });
    expect(l.toScreen({ x: 35, y: 0 }).x).toBeGreaterThan(l.toScreen({ x: 35, y: 100 }).x);
    expect(l.scale).toBeCloseTo(Math.min(800 / vp.h, 400 / vp.w));
    expect(bestOrientation(vp, 800, 400)).toBe('landscape');
    expect(bestOrientation(vp, 400, 800)).toBe('portrait');
  });

  it('drill viewports wrap the grass area with a margin', () => {
    const vp = playViewport({
      background: { kind: 'grass', w: 20, h: 30 },
      view: 'custom',
      format: 'any',
    });
    expect(vp).toEqual({ x: -4, y: -4, w: 28, h: 38 });
  });

  it('hitTest returns the top-most entity', () => {
    const play = newPlay({ id: 'x', title: 'x', mode: 'play', format: '15s', preset: 'scrum15' });
    const s = sample(play, 0);
    const a9 = resolvedPositions(play, 0).a9!;
    expect(hitTest(s, { x: a9.x + 0.3, y: a9.y }, 0.2)).toBe('ball');
    expect(hitTest(s, { x: 37, y: 59 }, 0.3)).toBe('a15');
    expect(hitTest(s, { x: 69, y: 100 }, 0.3)).toBeNull();
    const drill = DRILL_TEMPLATES.tackleBox.build();
    const ds = sample(drill, 0);
    expect(hitTest(ds, { x: 4, y: 4 }, 0.1)).toBe('box');
    expect(hitTest(ds, { x: 2.5, y: 2.5 }, 0.1)).toBe('cone1');
  });
});

describe('presets', () => {
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    it(`${id} builds a valid play`, () => {
      const play = newPlay({
        id: `p-${id}`,
        title: PRESETS[id].label,
        mode: 'play',
        format: '15s',
        preset: id,
      });
      expect(() => v.parse(Play, play)).not.toThrow();
      expect(play.entities.length).toBeGreaterThan(0);
      for (const e of play.entities) expect(play.frames[0]!.pos[e.id]).toBeDefined();
      expect(sample(play, 0).entities.length).toBe(play.entities.length - 1);
    });
  }

  it('lineouts carry jumpers and lifters', () => {
    const p = PRESETS.lineout7.build();
    const tags = p.entities.filter((e) => e.text);
    expect(tags.filter((e) => e.text === 'J')).toHaveLength(3);
    expect(tags.filter((e) => e.text === 'L')).toHaveLength(4);
    expect(PRESETS.lineout4.build().entities.filter((e) => e.text === 'J')).toHaveLength(1);
    expect(p.entities.filter((e) => e.kind === 'attack')).toHaveLength(15);
  });

  it('scrums have both packs', () => {
    expect(PRESETS.scrum15.build().entities.filter((e) => e.kind === 'defence')).toHaveLength(15);
    expect(PRESETS.scrum7.build().entities.filter((e) => e.kind === 'attack')).toHaveLength(7);
  });

  it('newPlay without preset, drill defaults', () => {
    const p = newPlay({ id: 'd', title: 'Drill', mode: 'drill', format: 'any' });
    expect(v.parse(Play, p)).toEqual(p);
    expect(p.loop).toBe(true);
    expect(p.background).toEqual({ kind: 'grass', w: 20, h: 20 });
  });

  it('addFrame copies previous end positions with empty moves', () => {
    const p0 = newPlay({
      id: 'x',
      title: 'x',
      mode: 'play',
      format: '15s',
      preset: 'backlineFlat',
    });
    const p1 = addFrame(p0, 0);
    expect(p1.frames).toHaveLength(2);
    expect(p1.frames[1]!.moves).toEqual({});
    expect(p1.frames[1]!.pos).toEqual(resolvedPositions(p0, 0));
    expect(p1.frames[1]!.id).not.toBe(p1.frames[0]!.id);
    const p2 = addFrame(p1, 0);
    expect(new Set(p2.frames.map((f) => f.id)).size).toBe(3);
    expect(v.parse(Play, p2)).toBeTruthy();
    expect(frameTimes(p2)).toEqual([0, 1500, 3000]);
    const p3 = duplicateFrame(p2, 1);
    expect(p3.frames).toHaveLength(4);
    expect(p0.frames).toHaveLength(1);
  });
});

describe('drill templates', () => {
  for (const [id, t] of Object.entries(ALL_TEMPLATES)) {
    it(`${id} is a valid looping drill`, () => {
      const play = t.build();
      expect(() => v.parse(Play, play)).not.toThrow();
      expect(play.mode).toBe('drill');
      expect(play.loop).toBe(true);
      expect(play.background?.kind).toBe('grass');
      expect(play.frames.length).toBeGreaterThanOrEqual(2);
      for (const f of play.frames) expect(f.caption?.length).toBeGreaterThan(5);
      // Every referenced id exists.
      const ids = new Set(play.entities.map((e) => e.id));
      for (const f of play.frames) {
        for (const k of [...Object.keys(f.pos), ...Object.keys(f.moves)])
          expect(ids.has(k)).toBe(true);
        if (f.ball?.holder) expect(ids.has(f.ball.holder)).toBe(true);
      }
      expect(typeof equipmentFromDiagram(play)).toBe('object');
    });
  }

  it('addPlayers lays out lines and grids', () => {
    const line = addPlayers(3, 'line', { x: 1, y: 2 }, 'B');
    expect(line.entities.map((e) => e.id)).toEqual(['pB1', 'pB2', 'pB3']);
    expect(line.pos.pB3).toEqual({ x: 4, y: 2 });
    expect(line.entities[0]!.group).toBe('B');
    const grid = addPlayers(4, 'grid', { x: 10, y: 10 }, 'A', { spacing: 2 });
    expect(grid.pos.pA1).toEqual({ x: 9, y: 9 });
    expect(grid.pos.pA4).toEqual({ x: 11, y: 11 });
  });

  it('equipment derives from the square grid template', () => {
    expect(equipmentFromDiagram(DRILL_TEMPLATES.squareGrid.build())).toMatchObject({
      cones: 4,
      balls: 1,
      bibs: 12,
    });
  });
});

describe('rugby accuracy', () => {
  /** Every primary-ball pass: where it leaves the passer's hands and where it is caught. */
  function passes(play: Play): { frame: number; from: { y: number }; to: { y: number } }[] {
    const times = frameTimes(play);
    const out: { frame: number; from: { y: number }; to: { y: number } }[] = [];
    for (let fi = 1; fi < play.frames.length; fi++) {
      const t0 = times[fi - 1]!;
      const t1 = times[fi]!;
      for (let k = 0; k <= 400; k++) {
        const s = sample(play, t0 + ((t1 - t0) * k) / 400);
        if (s.ball?.flight === 'pass') {
          out.push({
            frame: fi,
            from: { ...s.ball.pos },
            to: { ...sample(play, t1).ball!.pos },
          });
          break;
        }
      }
    }
    return out;
  }

  it('attack drills never pass forward (attack runs towards y = 0)', () => {
    for (const id of [
      'channels',
      'overload2v1',
      'overload3v2',
      'lineSpeed',
      'touchGame',
    ] as const) {
      const ps = passes(ALL_TEMPLATES[id].build());
      expect(ps.length, id).toBeGreaterThan(0);
      for (const p of ps)
        expect(p.to.y, `${id} f${p.frame}`).toBeGreaterThanOrEqual(p.from.y - 0.05);
    }
  });

  it('the square grid passes across the square, receiver deeper', () => {
    const ps = passes(DRILL_TEMPLATES.squareGrid.build());
    // f1 and f2 run towards y = 0, f4 runs towards y = 10 (f3 is the hand-on at the corner).
    for (const p of ps.filter((q) => q.frame === 1 || q.frame === 2))
      expect(p.to.y).toBeGreaterThanOrEqual(p.from.y);
    for (const p of ps.filter((q) => q.frame === 4)) expect(p.to.y).toBeLessThanOrEqual(p.from.y);
  });

  it('lineout players not in the line stand 10 m+ from the line of touch (Law 18)', () => {
    for (const n of [4, 5, 6, 7] as const) {
      const p = PRESETS[`lineout${n}`].build();
      for (const e of p.entities) {
        if (e.kind !== 'attack' || e.number === 2 || e.number === 9) continue;
        const dy = Math.abs(p.pos[e.id]!.y - LINEOUT_Y);
        if (dy > 0.5) expect(dy, `lineout${n} ${e.id}`).toBeGreaterThanOrEqual(10);
      }
      // Seven players fit between the 5 m and 15 m lines.
      const xs = p.entities.filter((e) => e.text).map((e) => p.pos[e.id]!.x);
      expect(Math.min(...xs)).toBeGreaterThan(5);
      expect(Math.max(...xs)).toBeLessThan(15);
    }
  });

  it('scrum backs stand 5 m+ behind their hindmost foot (Law 19)', () => {
    const p = PRESETS.scrum15.build();
    const y = (id: string) => p.pos[id]!.y;
    for (const n of [10, 11, 12, 13, 14, 15]) {
      expect(y(`a${n}`)).toBeGreaterThanOrEqual(y('a8') + 5);
      expect(y(`d${n}`)).toBeLessThanOrEqual(y('d8') - 5);
    }
    // Defending wings on their own sides: the defence faces +y, so its left (11) is at high x.
    expect(p.pos.d11!.x).toBeGreaterThan(p.pos.d14!.x);
    expect(p.pos.a11!.x).toBeLessThan(p.pos.a14!.x);
  });

  it('the kicking team starts behind the ball at kick-offs (Law 12)', () => {
    for (const id of ['kickoffReceive15', 'restartReceive7'] as const) {
      const p = PRESETS[id].build();
      const ball = p.pos.ball!.y;
      for (const e of p.entities.filter((q) => q.kind === 'defence'))
        expect(p.pos[e.id]!.y, `${id} ${e.id}`).toBeLessThanOrEqual(ball);
    }
  });

  it('the 7s defensive line has guards tight on the ruck', () => {
    const p = PRESETS.defensiveLine7.build();
    const xs = p.entities
      .filter((e) => e.kind === 'defence' && p.pos[e.id]!.y === 38)
      .map((e) => Math.abs(p.pos[e.id]!.x - 35));
    expect(xs.filter((d) => d <= 3)).toHaveLength(2);
  });
});
describe('history', () => {
  const p0 = newPlay({ id: 'h', title: 'h', mode: 'play', format: '15s' });
  const rename =
    (title: string) =>
    (p: Play): Play => ({ ...p, title });

  it('undo / redo', () => {
    const h = new History(p0);
    expect(h.canUndo).toBe(false);
    h.apply(rename('a'));
    h.apply({ label: 'Rename', run: rename('b') });
    expect(h.present.title).toBe('b');
    expect(h.undoLabel).toBe('Rename');
    expect(h.undo().title).toBe('a');
    expect(h.canRedo).toBe(true);
    expect(h.redo().title).toBe('b');
    h.undo();
    h.apply(rename('c'));
    expect(h.canRedo).toBe(false);
    h.undo();
    h.undo();
    expect(h.present).toBe(p0);
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBe(p0);
  });

  it('coalesces a drag into one command', () => {
    const changes: string[] = [];
    const h = new History(p0, { onChange: (p) => changes.push(p.title) });
    h.begin('Drag');
    for (let i = 0; i < 30; i++) h.apply(rename(`t${i}`));
    h.commit();
    expect(h.size).toBe(1);
    expect(h.undoLabel).toBe('Drag');
    expect(h.undo()).toBe(p0);
    expect(h.redo().title).toBe('t29');
    expect(changes).toHaveLength(32);
    h.begin();
    h.commit();
    expect(h.size).toBe(1);
    h.begin();
    h.apply(rename('zzz'));
    h.cancel();
    expect(h.present.title).toBe('t29');
  });

  it('ignores no-ops and caps its size', () => {
    const h = new History(p0, { cap: 5 });
    h.apply((p) => p);
    expect(h.canUndo).toBe(false);
    for (let i = 0; i < 20; i++) h.apply(rename(`n${i}`));
    expect(h.size).toBe(5);
    for (let i = 0; i < 10; i++) h.undo();
    expect(h.present.title).toBe('n14');
  });
});

describe('migrate', () => {
  it('v1 is identity (validated)', () => {
    const p = DRILL_TEMPLATES.gates.build();
    expect(migratePlay(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(CURRENT_PLAY_VERSION).toBe(1);
  });
  it('rejects garbage, missing and future versions', () => {
    expect(() => migratePlay(null)).toThrow(PlayMigrationError);
    expect(() => migratePlay([])).toThrow(PlayMigrationError);
    expect(() => migratePlay({ id: 'x' })).toThrow(/version/);
    expect(() =>
      migratePlay({ ...newPlay({ id: 'x', title: 'x', mode: 'play', format: '15s' }), v: 2 }),
    ).toThrow(/newer/);
    expect(() => migratePlay({ v: 1, id: 'x' })).toThrow(/Invalid/);
  });
});
