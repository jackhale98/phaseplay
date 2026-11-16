import { describe, expect, it } from 'vitest';
import { zonedToUtc } from '@phaseplay/shared';
import { parseTable } from './csv';
import {
  chunk,
  detectDateOrder,
  detectKind,
  inferType,
  mapRoster,
  mapSchedule,
  mappingComplete,
  parseDate,
  parseDuration,
  parsePositions,
  parseTime,
  rosterRows,
  scheduleRows,
} from './teamsnap';

const TZ = 'Europe/London';

describe('dates and times', () => {
  it('parses ISO, numeric and written dates', () => {
    expect(parseDate('2026-09-06', 'dmy')).toBe('2026-09-06');
    expect(parseDate('06/09/2026', 'dmy')).toBe('2026-09-06');
    expect(parseDate('09/06/2026', 'mdy')).toBe('2026-09-06');
    expect(parseDate('6/9/26', 'dmy')).toBe('2026-09-06');
    expect(parseDate('Sat, Sep 6, 2026', 'mdy')).toBe('2026-09-06');
    expect(parseDate('Saturday 6th September 2026', 'dmy')).toBe('2026-09-06');
    expect(parseDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseDate('soon', 'dmy')).toBeNull();
  });
  it('detects the date order from unambiguous values', () => {
    expect(detectDateOrder(['01/02/2026', '13/02/2026'], 'mdy')).toBe('dmy');
    expect(detectDateOrder(['01/02/2026', '02/13/2026'], 'dmy')).toBe('mdy');
    expect(detectDateOrder(['01/02/2026'], 'dmy')).toBe('dmy');
  });
  it('parses 12- and 24-hour times', () => {
    expect(parseTime('7:00 PM')).toBe('19:00');
    expect(parseTime('7pm')).toBe('19:00');
    expect(parseTime('12:15 AM')).toBe('00:15');
    expect(parseTime('19.30')).toBe('19:30');
    expect(parseTime('7:00:00 PM')).toBe('19:00');
    expect(parseTime('TBD')).toBeNull();
    expect(parseTime('7')).toBeNull();
  });
  it('parses durations', () => {
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('2 hours')).toBe(120);
    expect(parseDuration('')).toBeNull();
  });
});

describe('column mapping', () => {
  it('maps TeamSnap schedule headers case-insensitively', () => {
    const h = [
      'DATE',
      'Time',
      'Name',
      'Opponent Name',
      'Location Name',
      'Location Address',
      'Home or Away',
      'Arrival Time',
      'Notes',
    ];
    const m = mapSchedule(h);
    expect(m).toMatchObject({
      date: 0,
      time: 1,
      name: 2,
      opponent: 3,
      location: 4,
      address: 5,
      homeAway: 6,
      arrival: 7,
      notes: 8,
    });
    expect(detectKind(h)).toBe('schedule');
    expect(mappingComplete('schedule', m)).toBe(true);
  });
  it('maps roster headers', () => {
    const h = ['First Name', 'Last Name', 'Jersey Number', 'Position', 'Non-Player'];
    expect(mapRoster(h)).toMatchObject({ first: 0, last: 1, jersey: 2, position: 3, nonPlayer: 4 });
    expect(detectKind(h)).toBe('roster');
  });
  it('reports an incomplete mapping', () => {
    expect(mappingComplete('schedule', mapSchedule(['When', 'What']))).toBe(false);
  });
});

describe('schedule rows', () => {
  it('builds events with team-timezone times, meet and finish', () => {
    const t = parseTable(
      [
        'Date,Time,Name,Opponent,Location,Home or Away,Arrival Time,Duration',
        '09/12/2026,2:30 PM,,Old Albanians,Woollams,Away,1:15 PM,100',
        '09/08/2026,7:00 PM,Practice,,Club,,,',
        '09/20/2026,,Club BBQ,,,,,',
      ].join('\n'),
    );
    const rows = scheduleRows(t, mapSchedule(t.headers), TZ, 'mdy');
    const [game, practice, bbq] = rows.map((r) => (r.ok ? r.value : null));
    expect(game).toMatchObject({
      type: 'match',
      title: 'v Old Albanians',
      opponent: 'Old Albanians',
      startsAt: zonedToUtc('2026-09-12', '14:30', TZ),
      meetAt: zonedToUtc('2026-09-12', '13:15', TZ),
      endsAt: zonedToUtc('2026-09-12', '16:10', TZ),
      notes: 'Away',
    });
    expect(practice).toMatchObject({ type: 'training', title: 'Practice', opponent: null });
    expect(bbq).toMatchObject({
      type: 'social',
      title: 'Club BBQ',
      warning: 'No time given, set to 10:00',
    });
  });
  it('rejects rows without a readable date', () => {
    const t = parseTable('Date,Name\nnext week,Game');
    expect(scheduleRows(t, mapSchedule(t.headers), TZ, 'dmy')[0]).toMatchObject({
      ok: false,
      line: 2,
    });
  });
  it('infers types', () => {
    expect(inferType('Game', '', '')).toBe('match');
    expect(inferType('', 'Quiz night fundraiser', '')).toBe('fundraiser');
    expect(inferType('Event', 'AGM', '')).toBe('meeting');
    expect(inferType('', 'Cheltenham 7s', '')).toBe('tournament');
    expect(inferType('', 'Kit collection', '')).toBe('other');
  });
});

describe('roster rows', () => {
  it('joins names, reads jerseys and positions, skips non-players', () => {
    const t = parseTable(
      [
        'First Name,Last Name,Jersey Number,Position,Non-Player',
        'Jess,Taylor,#9,Scrum-half,',
        'Mo,Ali,3,"Prop, Hooker",No',
        'Pat,Lee,,,Yes',
        ',,,,',
      ].join('\n'),
    );
    const rows = rosterRows(t, mapRoster(t.headers));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      ok: true,
      value: { displayName: 'Jess Taylor', jersey: 9, positions: [9] },
    });
    expect(rows[1]).toMatchObject({
      ok: true,
      value: { displayName: 'Mo Ali', jersey: 3, positions: [1, 3, 2] },
    });
    expect(rows[2]).toMatchObject({ ok: false });
  });
  it('parses position words and numbers', () => {
    expect(parsePositions('10/12')).toEqual([10, 12]);
    expect(parsePositions('Number 8')).toEqual([8]);
    expect(parsePositions('Fullback')).toEqual([15]);
    expect(parsePositions('Inside Centre')).toEqual([12]);
    expect(parsePositions('Second row')).toEqual([4, 5]);
    expect(parsePositions('')).toEqual([]);
  });
});

it('chunks', () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});
