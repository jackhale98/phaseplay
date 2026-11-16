import { describe, expect, it } from 'vitest';
import type { Member, TeamEvent, TeamSheet } from '@phaseplay/shared';
import {
  assign,
  clear,
  copyFrom,
  droppedBy,
  emptyDraft,
  exportInput,
  nextEmpty,
  normalize,
  previousSheet,
  rankFor,
  setReplacements,
  swap,
  toggleCaptain,
  toggleVice,
  warningLines,
} from './model';

const m = (id: string, positions: number[], name = id): Member => ({
  id,
  teamId: 't',
  userId: null,
  displayName: name,
  role: 'player',
  jersey: null,
  positions,
  status: 'active',
  joinedAt: null,
  updatedAt: 0,
});

describe('sheet draft edits', () => {
  it('assigning someone already on the sheet moves them', () => {
    let d = assign(emptyDraft('15s'), 1, 'a');
    d = assign(d, 3, 'a');
    expect(d.slots).toEqual({ '3': 'a' });
  });

  it('swaps slots, including with an empty one', () => {
    let d = assign(assign(emptyDraft('15s'), 1, 'a'), 2, 'b');
    d = swap(d, 1, 2);
    expect(d.slots).toEqual({ '1': 'b', '2': 'a' });
    d = swap(d, 1, 16);
    expect(d.slots).toEqual({ '16': 'b', '2': 'a' });
  });

  it('clears captain and vice when they leave the sheet', () => {
    let d = assign(assign(emptyDraft('15s'), 9, 'a'), 10, 'b');
    d = toggleCaptain(d, 'a');
    d = toggleVice(d, 'b');
    expect([d.captainId, d.viceId]).toEqual(['a', 'b']);
    d = toggleVice(d, 'a');
    expect([d.captainId, d.viceId]).toEqual([null, 'a']);
    d = clear(d, 9);
    expect(d.viceId).toBeNull();
  });

  it('a smaller bench drops the extra replacements', () => {
    const d = assign(assign(emptyDraft('15s', 8), 23, 'x'), 16, 'y');
    expect(droppedBy(d, 5)).toEqual(['x']);
    expect(setReplacements(d, 5).slots).toEqual({ '16': 'y' });
    expect(setReplacements(d, 99).replacements).toBe(8);
  });

  it('finds the next empty slot, wrapping round', () => {
    const d = normalize({ ...emptyDraft('7s', 1), slots: { '1': 'a', '2': 'b', '8': 'c' } });
    expect(nextEmpty(d, 1)).toBe(3);
    expect(nextEmpty(d, 7)).toBe(3);
  });
});

describe('ranking', () => {
  it('orders by fit, then availability, with players already picked last', () => {
    const ms = [
      m('out', [1]),
      m('in', [1]),
      m('wing', [11]),
      m('hooker', [2, 1]),
      m('picked', [1]),
    ];
    const d = assign(emptyDraft('15s'), 5, 'picked');
    const avail = (id: string) => (id === 'out' ? 'no' : id === 'in' ? 'yes' : 'none');
    expect(rankFor(d, 1, ms, avail).map((c) => c.member.id)).toEqual([
      'in',
      'out',
      'hooker',
      'wing',
      'picked',
    ]);
    expect(rankFor(d, 1, ms, avail, 'WIN').map((c) => c.member.id)).toEqual(['wing']);
  });
});

describe('copy from previous match', () => {
  const ev = (id: string, startsAt: number) => ({ id, startsAt, deletedAt: null }) as TeamEvent;
  const sh = (id: string, eventId: string, publishedAt: number | null) =>
    ({
      id,
      eventId,
      format: '15s',
      publishedAt,
      replacements: 8,
      slots: {},
    }) as unknown as TeamSheet;

  it('picks the latest earlier published sheet in the same format', () => {
    const events = { a: ev('a', 1), b: ev('b', 2), c: ev('c', 3), d: ev('d', 4) };
    const sheets = [sh('1', 'a', 10), sh('2', 'b', 20), sh('3', 'c', null), sh('4', 'd', 30)];
    expect(previousSheet(sheets, events, events.d, '15s')?.id).toBe('2');
    expect(previousSheet(sheets, events, events.d, '7s')).toBeUndefined();
  });

  it('keeps only active players', () => {
    const { draft, dropped } = copyFrom(
      {
        replacements: 8,
        slots: { '1': 'a', '2': 'gone', '16': 'b' },
        captainId: 'gone',
        viceId: 'b',
      },
      '15s',
      new Set(['a', 'b']),
    );
    expect(draft.slots).toEqual({ '1': 'a', '16': 'b' });
    expect([draft.captainId, draft.viceId, dropped]).toEqual([null, 'b', 1]);
  });
});

describe('copy', () => {
  it('folds empty starters into one line and names people', () => {
    const lines = warningLines(
      [
        { kind: 'empty', slot: 4 },
        { kind: 'empty', slot: 5 },
        { kind: 'unavailable', memberId: 'a', slot: 1, status: 'maybe' },
        { kind: 'captain_missing' },
      ],
      '15s',
      (id) => id.toUpperCase(),
    );
    expect(lines.map((l) => l.text)).toEqual([
      '2 starting spots still empty: 4, 5',
      'A (1) is a maybe',
      'No captain picked yet',
    ]);
  });

  it('builds the export input with starters, bench and markers', () => {
    let d = assign(assign(emptyDraft('15s', 2), 1, 'a'), 16, 'b');
    d = toggleCaptain(d, 'a');
    const input = exportInput(d, (id) => `P ${id}`, {
      team: { name: 'T', shortName: 'T', primary: '#000000', secondary: '#ffffff' },
      kickoff: 'Sat',
    });
    expect(input.starters).toEqual([{ n: 1, name: 'P a', captain: true, vice: false }]);
    expect(input.bench).toEqual([{ n: 16, name: 'P b' }]);
  });
});
