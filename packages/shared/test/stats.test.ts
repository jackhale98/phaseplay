import { describe, expect, it } from 'vitest';
import {
  attendanceStats,
  currentSeason,
  heldEvents,
  matchLine,
  pct,
  penaltyTrend,
  planLoad,
  seasonTallies,
  seasonWindow,
  trainingLoad,
  turnoutFromMarks,
  uuidv7,
  weekOf,
  zonedToUtc,
  type AttendanceMark,
  type DrillFacts,
  type MatchEvent,
  type MatchPayload,
  type PlanData,
  type TeamEvent,
  type TeamSheet,
} from '../src';

const TZ = 'Europe/London';
const T0 = zonedToUtc('2026-10-03', '14:30', TZ);
const MIN = 60e3;

const event = (over: Partial<TeamEvent> & Pick<TeamEvent, 'id' | 'type' | 'startsAt'>) =>
  ({
    teamId: 't',
    seasonId: null,
    format: null,
    title: 'x',
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
    ...over,
  }) as TeamEvent;

describe('season window', () => {
  const seasons = [
    { id: 'a', startsOn: '2025-09-01', endsOn: '2026-05-31', deletedAt: null },
    { id: 'b', startsOn: '2026-09-01', endsOn: '2027-05-31', deletedAt: null },
    { id: 'c', startsOn: '2027-09-01', endsOn: '2028-05-31', deletedAt: null },
  ];
  it('defaults to the season running today, else the last one started', () => {
    expect(currentSeason(seasons, '2026-11-17')?.id).toBe('b');
    expect(currentSeason(seasons, '2026-07-01')?.id).toBe('a');
    expect(currentSeason(seasons, '2024-01-01')?.id).toBe('a');
    expect(currentSeason([], '2026-01-01')).toBeNull();
  });
  it('covers whole days in the team timezone, end date included', () => {
    const w = seasonWindow({ startsOn: '2026-09-01', endsOn: '2027-05-31' }, TZ);
    expect(w.from).toBe(zonedToUtc('2026-09-01', '00:00', TZ));
    expect(w.to).toBe(zonedToUtc('2027-06-01', '00:00', TZ));
  });
  it('held events are past practices and games only, not cancelled or deleted', () => {
    const evs = [
      event({ id: '1', type: 'training', startsAt: T0 }),
      event({ id: '2', type: 'match', startsAt: T0 + 1 }),
      event({ id: '3', type: 'social', startsAt: T0 + 2 }),
      event({ id: '4', type: 'training', startsAt: T0 + 3, cancelledAt: T0 }),
      event({ id: '5', type: 'training', startsAt: T0 + 4, deletedAt: T0 }),
      event({ id: '6', type: 'training', startsAt: T0 + 86400e3 }),
    ];
    const now = T0 + 5 * 3600e3;
    expect(heldEvents(evs, null, now).map((e) => e.id)).toEqual(['1', '2']);
    expect(heldEvents(evs, { from: T0 + 1, to: T0 + 10 }, now).map((e) => e.id)).toEqual(['2']);
  });
});

describe('attendanceStats', () => {
  const p1 = event({ id: 'p1', type: 'training', startsAt: T0 });
  const p2 = event({ id: 'p2', type: 'training', startsAt: T0 + 2 * 86400e3 });
  const g1 = event({ id: 'g1', type: 'match', startsAt: T0 + 4 * 86400e3 });
  const members = [
    { id: 'a', joinedAt: 0 },
    { id: 'b', joinedAt: 0 },
    { id: 'late', joinedAt: T0 + 3 * 86400e3 },
  ];
  // p1 and g1 had attendance taken; p2 didn't, so its RSVPs stand in.
  const marks: AttendanceMark[] = [
    { eventId: 'p1', memberId: 'a', status: 'yes', attended: true },
    { eventId: 'p1', memberId: 'b', status: 'yes', attended: false },
    { eventId: 'p2', memberId: 'a', status: 'yes', attended: null },
    { eventId: 'p2', memberId: 'b', status: 'no', attended: null },
    { eventId: 'g1', memberId: 'a', status: 'maybe', attended: true },
    { eventId: 'g1', memberId: 'b', status: 'yes', attended: false },
    { eventId: 'g1', memberId: 'late', status: 'yes', attended: true },
  ];
  const all = attendanceStats({
    events: [p1, p2, g1],
    members,
    marks,
    turnout: turnoutFromMarks(marks),
  });
  const line = (id: string) => all.lines.find((l) => l.memberId === id)!;

  it('counts attendance where taken and RSVP yes where not', () => {
    expect(line('a').practices).toEqual({ attended: 2, held: 2, fromRsvp: 1 });
    expect(line('a').games).toEqual({ attended: 1, held: 1, fromRsvp: 0 });
    expect(line('b').practices).toEqual({ attended: 0, held: 2, fromRsvp: 1 });
    // "yes" doesn't count once attendance is taken.
    expect(line('b').games).toEqual({ attended: 0, held: 1, fromRsvp: 0 });
    expect(pct(line('a').total)).toBe(100);
    expect(pct(line('b').total)).toBe(0);
  });

  it('only counts events after someone joined, unless they have a mark', () => {
    expect(line('late').practices.held).toBe(0);
    expect(line('late').games).toEqual({ attended: 1, held: 1, fromRsvp: 0 });
    expect(pct({ attended: 0, held: 0 })).toBeNull();
  });

  it('team turnout: held, taken and average present', () => {
    expect(all.practices).toEqual({ held: 2, taken: 1, avgPresent: 1 });
    expect(all.games).toEqual({ held: 1, taken: 1, avgPresent: 2 });
  });

  it('a player sees only their line, with taken flags and turnout from the server', () => {
    const mine = marks.filter((m) => m.memberId === 'b');
    const turnout = turnoutFromMarks(marks);
    const s = attendanceStats({
      events: [p1, p2, g1],
      members: [members[1]!],
      marks: mine,
      turnout,
    });
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]!.total).toEqual({ attended: 0, held: 3, fromRsvp: 1 });
    expect(s.games.avgPresent).toBe(2);
    // Without server counts, team averages are unknown rather than wrong.
    const offline = attendanceStats({
      events: [p1],
      members: [members[1]!],
      marks: mine,
      turnout: null,
    });
    expect(offline.practices.avgPresent).toBeNull();
  });
});

/* ------------------------------- Match logs ------------------------------- */

let seq = 0;
const ev = (min: number, payload: MatchPayload, wallExtra = 0, id = uuidv7()): MatchEvent => ({
  id,
  seq: seq++,
  wallAt: T0 + min * MIN + wallExtra,
  gameMs: min * MIN,
  payload,
});
const ids = Array.from({ length: 23 }, () => uuidv7());
const slots = Object.fromEntries(ids.map((id, i) => [String(i + 1), id]));
const sheet: Pick<TeamSheet, 'format' | 'slots' | 'status' | 'publishedAt'> = {
  format: '15s',
  slots,
  status: 'published',
  publishedAt: T0 - 86400e3,
};
const game = event({ id: 'm1', type: 'match', startsAt: T0, opponent: 'Rivals', format: '15s' });

function fullMatch(): MatchEvent[] {
  const yc = ev(20, { kind: 'card', team: 'us', colour: 'yellow', playerId: ids[3] });
  return [
    ev(0, { kind: 'period_start', period: 1 }),
    ev(5, { kind: 'score', team: 'us', type: 'try', playerId: ids[13] }),
    ev(6, { kind: 'score', team: 'us', type: 'conversion', playerId: ids[9] }),
    ev(12, { kind: 'penalty', side: 'against', offence: 'offside' }),
    ev(15, { kind: 'score', team: 'them', type: 'penalty_goal' }),
    yc,
    ev(30, { kind: 'card_return', cardId: yc.id }),
    ev(33, { kind: 'penalty', side: 'against', offence: 'ruck' }),
    ev(40, { kind: 'period_end', period: 1 }),
    ev(40, { kind: 'period_start', period: 2 }, 15 * MIN),
    ev(50, { kind: 'sub', team: 'us', offId: ids[0]!, onId: ids[15]!, type: 'tactical' }, 15 * MIN),
    ev(55, { kind: 'penalty', side: 'against', offence: 'offside' }, 15 * MIN),
    ev(60, { kind: 'score', team: 'us', type: 'penalty_goal', playerId: ids[9] }, 15 * MIN),
    ev(70, { kind: 'score', team: 'us', type: 'drop_goal', playerId: ids[9] }, 15 * MIN),
    ev(75, { kind: 'card', team: 'them', colour: 'red' }, 15 * MIN),
    ev(80, { kind: 'period_end', period: 2 }, 15 * MIN),
  ];
}

describe('matchLine', () => {
  const line = matchLine({ event: game, sheet, log: fullMatch(), defaultFormat: '15s' });

  it('minutes come from the match reducer: subs and sin bins stop the clock for a player', () => {
    expect(line.recorded && line.hasSheet).toBe(true);
    expect(line.minutes[ids[1]!]).toBe(80 * MIN);
    expect(line.minutes[ids[0]!]).toBe(50 * MIN); // subbed off at 50'
    expect(line.minutes[ids[15]!]).toBe(30 * MIN); // on at 50'
    expect(line.minutes[ids[3]!]).toBe(70 * MIN); // 10 minutes in the bin
    expect(line.minutes[ids[16]!]).toBeUndefined(); // stayed on the bench
    expect(line.starters).toHaveLength(15);
  });

  it('tallies the score, scorers and cards', () => {
    expect(line.games).toEqual([{ us: 13, them: 3, result: 'W' }]);
    expect(line.players[ids[13]!]).toMatchObject({ tries: 1, points: 5 });
    expect(line.players[ids[9]!]).toMatchObject({
      conversions: 1,
      penaltyGoals: 1,
      dropGoals: 1,
      points: 8,
    });
    expect(line.players[ids[3]!]).toMatchObject({ yellow: 1, points: 0 });
    expect(line.cards).toEqual({ us: { yellow: 1, red: 0 }, them: { yellow: 0, red: 1 } });
    expect(line.penalties).toEqual({ for: 0, against: 3, byOffence: { offside: 2, ruck: 1 } });
  });

  it('honours corrections (a voided try is gone)', () => {
    const log = fullMatch();
    const tryEv = log[1]!;
    log.push(ev(81, { kind: 'void', supersedesId: tryEv.id }, 15 * MIN));
    const l = matchLine({ event: game, sheet, log, defaultFormat: '15s' });
    expect(l.games[0]).toEqual({ us: 8, them: 3, result: 'W' });
    expect(l.players[ids[13]!]).toBeUndefined();
  });

  it('a draft sheet or an empty log gives no minutes', () => {
    const draft = { ...sheet, status: 'draft' as const, publishedAt: null };
    expect(
      matchLine({ event: game, sheet: draft, log: fullMatch(), defaultFormat: '15s' }).minutes,
    ).toEqual({});
    const empty = matchLine({ event: game, sheet, log: [], defaultFormat: '15s' });
    expect(empty.recorded).toBe(false);
    expect(empty.games).toEqual([]);
  });

  it('an unfinished log stops counting at its last entry', () => {
    const log = fullMatch().slice(0, 4); // up to 12'
    const l = matchLine({ event: game, sheet, log, defaultFormat: '15s' });
    expect(l.minutes[ids[1]!]).toBe(12 * MIN);
  });

  it('a 7s tournament day counts every game and sums minutes', () => {
    const seven = ids.slice(0, 12);
    const tSheet = {
      ...sheet,
      format: '7s' as const,
      slots: Object.fromEntries(seven.map((id, i) => [String(i + 1), id])),
    };
    const day = event({ id: 't1', type: 'tournament', startsAt: T0, format: '7s' });
    const h = 7; // minutes per half
    const g2 = 60; // wall minutes later for game 2
    const log = [
      ev(0, { kind: 'period_start', period: 1 }),
      ev(3, { kind: 'score', team: 'us', type: 'try', playerId: seven[6] }),
      ev(h, { kind: 'period_end', period: 1 }),
      ev(h, { kind: 'period_start', period: 2 }, 2 * MIN),
      ev(2 * h, { kind: 'period_end', period: 2 }, 2 * MIN),
      // Game 2 runs periods 3–4, on the shared clock from 2 × 2 × half.
      ev(2 * h, { kind: 'period_start', period: 3 }, g2 * MIN),
      ev(2 * h + 4, { kind: 'score', team: 'them', type: 'try' }, g2 * MIN),
      ev(
        2 * h + 5,
        { kind: 'sub', team: 'us', offId: seven[0]!, onId: seven[7]!, type: 'tactical' },
        g2 * MIN,
      ),
      ev(3 * h, { kind: 'period_end', period: 3 }, g2 * MIN),
      ev(3 * h, { kind: 'period_start', period: 4 }, (g2 + 2) * MIN),
      ev(4 * h, { kind: 'period_end', period: 4 }, (g2 + 2) * MIN),
    ];
    const l = matchLine({ event: day, sheet: tSheet, log, defaultFormat: '15s' });
    expect(l.format).toBe('7s');
    expect(l.games).toEqual([
      { us: 5, them: 0, result: 'W' },
      { us: 0, them: 5, result: 'L' },
    ]);
    expect(l.minutes[seven[1]!]).toBe(4 * h * MIN);
    expect(l.minutes[seven[0]!]).toBe((2 * h + 5) * MIN);
    expect(l.minutes[seven[7]!]).toBe((2 * h - 5) * MIN);
  });
});

describe('seasonTallies and penaltyTrend', () => {
  const won = matchLine({ event: game, sheet, log: fullMatch(), defaultFormat: '15s' });
  const lostLog = [
    ev(0, { kind: 'period_start', period: 1 }),
    ev(10, { kind: 'score', team: 'them', type: 'try' }),
    ev(20, { kind: 'penalty', side: 'against', offence: 'high_tackle' }),
    ev(21, { kind: 'penalty', side: 'against' }),
    ev(40, { kind: 'period_end', period: 1 }),
  ];
  const lost = matchLine({
    event: { ...game, id: 'm2', startsAt: T0 + 7 * 86400e3, opponent: 'Others' },
    sheet: null,
    log: lostLog,
    defaultFormat: '15s',
  });
  const drawn = matchLine({
    event: { ...game, id: 'm3', startsAt: T0 + 14 * 86400e3 },
    sheet,
    log: [ev(0, { kind: 'period_start', period: 1 }), ev(80, { kind: 'period_end', period: 2 })],
    defaultFormat: '15s',
  });
  const unrecorded = matchLine({
    event: { ...game, id: 'm4', startsAt: T0 + 21 * 86400e3 },
    sheet,
    log: [],
    defaultFormat: '15s',
  });
  const t = seasonTallies([won, lost, drawn, unrecorded]);

  it('results, points for and against', () => {
    expect(t.results).toEqual({
      played: 3,
      won: 1,
      drawn: 1,
      lost: 1,
      pointsFor: 13,
      pointsAgainst: 8,
      unrecorded: 1,
    });
    expect(t.minutesFrom).toBe(2);
  });

  it('season minutes, appearances and starts', () => {
    const sub = t.minutes.find((m) => m.memberId === ids[15])!;
    expect(sub).toMatchObject({ ms: 30 * MIN + 0, appearances: 1, starts: 0 });
    const lock = t.minutes.find((m) => m.memberId === ids[1])!;
    expect(lock.appearances).toBe(2);
    expect(lock.starts).toBe(2);
    expect(t.minutes[0]!.ms).toBeGreaterThanOrEqual(t.minutes.at(-1)!.ms);
  });

  it('scorers most points first, and card totals', () => {
    expect(t.scorers[0]).toMatchObject({ memberId: ids[9], points: 8 });
    expect(t.cards.us.yellow).toBe(1);
    expect(t.cards.them.red).toBe(1);
  });

  it('penalties conceded per match and top offences', () => {
    const p = penaltyTrend([drawn, lost, won, unrecorded]);
    expect(p.perMatch.map((m) => [m.eventId, m.against])).toEqual([
      ['m1', 3],
      ['m2', 2],
      ['m3', 0],
    ]);
    expect(p.top).toEqual([
      { offence: 'offside', count: 2 },
      { offence: 'high_tackle', count: 1 },
      { offence: 'other', count: 1 },
      { offence: 'ruck', count: 1 },
    ]);
    expect(p.against).toBe(5);
    expect(p.avgAgainst).toBe(1.7);
    expect(penaltyTrend([]).avgAgainst).toBeNull();
  });
});

/* ------------------------------ Training load ------------------------------ */

const drills: Record<string, DrillFacts> = {
  warm: { contactLevel: 'none', intensity: 2, equipment: {} },
  ruck: { contactLevel: 'full', intensity: 4, equipment: {} },
  pass: { contactLevel: 'none', intensity: 4, equipment: {} },
  shields: { contactLevel: 'shields', intensity: 3, equipment: {} },
};
const D = (k: string) => k; // drill ids are plain keys here

const split: PlanData = {
  lanes: ['forwards', 'backs'],
  waterEveryMin: 22,
  slots: [
    {
      id: 's1',
      blocks: [{ id: 'b1', kind: 'drill', drillId: D('warm'), durationMin: 10, lane: 'all' }],
    },
    {
      id: 's2',
      blocks: [
        { id: 'b2', kind: 'drill', drillId: D('ruck'), durationMin: 15, lane: 'forwards' },
        { id: 'b3', kind: 'drill', drillId: D('pass'), durationMin: 12, lane: 'backs' },
      ],
    },
    {
      id: 's3',
      blocks: [
        {
          id: 'b4',
          kind: 'drill',
          drillId: D('shields'),
          durationMin: 1,
          lane: 'all',
          rotation: { groups: 2, stations: ['A', 'B'], intervalMin: 5 },
        },
      ],
    },
    { id: 's4', blocks: [{ id: 'b5', kind: 'water', durationMin: 3, lane: 'all' }] },
  ],
};
const single: PlanData = {
  lanes: ['all'],
  waterEveryMin: 22,
  slots: [
    {
      id: 's1',
      blocks: [{ id: 'b1', kind: 'drill', drillId: D('ruck'), durationMin: 20, lane: 'all' }],
    },
  ],
};

describe('training load', () => {
  it('split sessions count per group; the team figure is the busiest lane', () => {
    const l = planLoad(split, drills);
    expect(l.team).toEqual({ totalMin: 38, contactMin: 25, highIntensityMin: 15 });
    expect(l.groups.forwards).toEqual({ totalMin: 38, contactMin: 25, highIntensityMin: 15 });
    expect(l.groups.backs).toEqual({ totalMin: 38, contactMin: 10, highIntensityMin: 12 });
    expect(planLoad(single, drills).groups).toEqual({
      all: { totalMin: 20, contactMin: 20, highIntensityMin: 20 },
    });
  });

  it('weeks run Monday to Sunday in the team timezone', () => {
    // 2026-10-04 is a Sunday; 2026-10-05 a Monday.
    expect(weekOf(zonedToUtc('2026-10-04', '23:30', TZ), TZ)).toBe('2026-09-28');
    expect(weekOf(zonedToUtc('2026-10-05', '00:30', TZ), TZ)).toBe('2026-10-05');
  });

  it('sums held practices per week, fills quiet weeks, ignores templates', () => {
    const at = (d: string) => zonedToUtc(d, '19:00', TZ);
    const events = [
      event({ id: 'a', type: 'training', startsAt: at('2026-10-06') }),
      event({ id: 'b', type: 'training', startsAt: at('2026-10-08') }),
      event({ id: 'c', type: 'training', startsAt: at('2026-10-20') }),
      event({ id: 'g', type: 'match', startsAt: at('2026-10-10') }),
    ];
    const plans = [
      { eventId: 'a', data: split, isTemplate: false, deletedAt: null },
      { eventId: 'b', data: single, isTemplate: false, deletedAt: null },
      { eventId: 'c', data: single, isTemplate: true, deletedAt: null },
      { eventId: null, data: single, isTemplate: true, deletedAt: null },
    ];
    const weeks = trainingLoad({ events, plans, drills, tz: TZ });
    expect(weeks.map((w) => [w.week, w.sessions, w.planned])).toEqual([
      ['2026-10-05', 2, 2],
      ['2026-10-12', 0, 0],
      ['2026-10-19', 1, 0],
    ]);
    expect(weeks[0]).toMatchObject({ totalMin: 58, contactMin: 45, highIntensityMin: 35 });
    expect(weeks[0]!.groups).toEqual({
      forwards: { totalMin: 38, contactMin: 25, highIntensityMin: 15 },
      backs: { totalMin: 38, contactMin: 10, highIntensityMin: 12 },
      all: { totalMin: 20, contactMin: 20, highIntensityMin: 20 },
    });
    expect(trainingLoad({ events: [], plans, drills, tz: TZ })).toEqual([]);
  });
});
