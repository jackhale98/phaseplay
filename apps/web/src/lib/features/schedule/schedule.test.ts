import { describe, expect, it } from 'vitest';
import type { TeamEvent } from '@phaseplay/shared';
import {
  countByCategory,
  groupByWeek,
  matches,
  monthGrid,
  movedFrom,
  movedNote,
  notesBody,
  parseShow,
  shiftMonth,
  hhmm,
  nextWeekday,
  minutesBetween,
} from './schedule';

const ev = (p: Partial<TeamEvent>): TeamEvent => ({
  id: crypto.randomUUID(),
  teamId: 't',
  seasonId: null,
  type: 'training',
  format: null,
  title: 'Practice',
  startsAt: Date.UTC(2026, 10, 17, 19),
  meetAt: null,
  endsAt: null,
  locationName: null,
  locationUrl: null,
  opponent: null,
  notes: null,
  rsvpDeadline: null,
  recurrenceId: null,
  cancelledAt: null,
  settings: null,
  version: 1,
  updatedAt: 0,
  deletedAt: null,
  ...p,
});

describe('filtering', () => {
  const list = [
    ev({ type: 'match', title: 'Game', opponent: 'Old Albanians' }),
    ev({ type: 'tournament', title: 'Cheltenham 7s' }),
    ev({ type: 'training', locationName: 'Woollams' }),
    ev({ type: 'fundraiser', title: 'Quiz night' }),
  ];
  it('filters by category and search', () => {
    expect(list.filter((e) => matches(e, 'games', '')).length).toBe(2);
    expect(list.filter((e) => matches(e, 'events', '')).map((e) => e.title)).toEqual([
      'Quiz night',
    ]);
    expect(list.filter((e) => matches(e, 'all', 'albanians')).length).toBe(1);
    expect(list.filter((e) => matches(e, 'all', 'woollams')).length).toBe(1);
  });
  it('counts by category', () => {
    expect(countByCategory(list)).toEqual({ all: 4, games: 2, practices: 1, events: 1 });
    expect(countByCategory(list, 'quiz')).toEqual({ all: 1, games: 0, practices: 0, events: 1 });
  });
  it('parses the show param', () => {
    expect(parseShow('games')).toBe('games');
    expect(parseShow('nope')).toBe('all');
    expect(parseShow(null)).toBe('all');
  });
});

describe('grouping and calendar', () => {
  it('groups consecutive events by week label', () => {
    const now = Date.UTC(2026, 10, 16, 12); // Monday
    const g = groupByWeek(
      [
        ev({ startsAt: now + 86400e3 }),
        ev({ startsAt: now + 2 * 86400e3 }),
        ev({ startsAt: now + 8 * 86400e3 }),
      ],
      'Europe/London',
      now,
    );
    expect(g.map((x) => [x.label, x.events.length])).toEqual([
      ['This week', 2],
      ['Next week', 1],
    ]);
  });
  it('builds a Monday-first month grid', () => {
    const g = monthGrid('2026-11-01'); // Sunday
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-10-26');
    expect(g[6]).toBe('2026-11-01');
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
  });
  it('time helpers', () => {
    expect(hhmm(Date.UTC(2026, 6, 1, 18, 30), 'Europe/London')).toBe('19:30');
    expect(minutesBetween('19:00', '20:30')).toBe(90);
    expect(nextWeekday(6, 'UTC', Date.UTC(2026, 10, 16))).toBe('2026-11-21');
  });
});

describe('moved note', () => {
  it('prefixes and replaces the moved line', () => {
    const n = movedNote(Date.UTC(2026, 10, 21, 15), 'UTC', 'Bring boots');
    expect(movedFrom(n)).toMatch(/^Sat/);
    expect(notesBody(n)).toBe('Bring boots');
    const again = movedNote(Date.UTC(2026, 10, 22, 15), 'UTC', n);
    expect(again.match(/Moved from/g)).toHaveLength(1);
    expect(notesBody(again)).toBe('Bring boots');
    expect(movedFrom('Just notes')).toBeNull();
  });
});
