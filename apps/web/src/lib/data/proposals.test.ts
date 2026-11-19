import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  tbdStartsAt,
  zonedToUtc,
  type Member,
  type SyncResponse,
  type TeamEvent,
} from '@phaseplay/shared';
import { mergeSync } from './app.svelte';
import {
  events,
  kitAtRisk,
  needMyAnswer,
  past,
  proposalView,
  proposals,
  toReconfirm,
  upcoming,
} from './selectors';

const DAY = 86400e3;
const now = Date.now();
const ev = (id: string, extra: Partial<TeamEvent> = {}): TeamEvent => ({
  id,
  teamId: 't1',
  seasonId: null,
  type: 'match',
  format: '15s',
  title: 'Friendly',
  startsAt: now + 5 * DAY,
  meetAt: null,
  endsAt: null,
  locationName: null,
  locationUrl: null,
  opponent: 'Harlequins',
  notes: null,
  rsvpDeadline: null,
  recurrenceId: null,
  cancelledAt: null,
  settings: null,
  timeTbd: false,
  status: 'confirmed',
  answerBy: null,
  target: 3,
  checkPositions: true,
  version: 1,
  updatedAt: 1,
  deletedAt: null,
  ...extra,
});
const member = (id: string, positions: number[]): Member => ({
  id,
  teamId: 't1',
  userId: id,
  displayName: id,
  role: 'player',
  jersey: null,
  positions,
  status: 'active',
  roleIds: [],
  joinedAt: 0,
  updatedAt: 0,
});
const opt = (id: string, eventId: string, startsAt: number) => ({
  id,
  eventId,
  teamId: 't1',
  startsAt,
  meetAt: null,
  endsAt: null,
  updatedAt: 1,
  deletedAt: null,
});
const ans = (optionId: string, memberId: string, answer: 'in' | 'cant') => ({
  optionId,
  eventId: 'p1',
  memberId,
  teamId: 't1',
  answer,
  updatedAt: 1,
});

function snap(visibility: 'counts' | 'games' = 'counts') {
  const res = {
    cursor: 10,
    full: true,
    team: {
      id: 't1',
      defaultFormat: '15s',
      timezone: 'Europe/London',
      rsvpVisibility: visibility,
      proposalTargets: { '15s': 20, '7s': 10 },
    },
    me: member('m1', [2]),
    members: [member('m1', [2]), member('m2', [1]), member('m3', [3])],
    roles: [],
    seasons: [],
    events: [ev('c1'), ev('p1', { status: 'proposed' }), ev('d1', { status: 'dropped' })],
    rsvps: [
      {
        eventId: 'c1',
        memberId: 'm1',
        teamId: 't1',
        status: 'yes',
        note: null,
        attended: null,
        reconfirm: true,
        updatedAt: 1,
      },
    ],
    rsvpCounts: {},
    options: [opt('o1', 'p1', now + 5 * DAY), opt('o2', 'p1', now + 12 * DAY)],
    answers: [ans('o1', 'm2', 'in'), ans('o1', 'm3', 'in'), ans('o2', 'm2', 'in')],
    answerCounts: { o1: { in: 2, cant: 0 }, o2: { in: 1, cant: 0 } },
    sheets: [],
    plays: [],
    drills: [],
    plans: [],
    items: [
      {
        id: 'i1',
        teamId: 't1',
        kind: 'balls',
        name: 'Balls',
        tag: null,
        quantity: 1,
        condition: 'good',
        status: 'with_someone',
        holderMemberId: 'm2',
        home: null,
        notes: null,
        matchDay: false,
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      },
    ],
    handoffs: [],
  } as unknown as SyncResponse;
  return mergeSync(null, res);
}

describe('proposals on the device', () => {
  it('the schedule (and everything built on it) is confirmed events only', () => {
    const s = snap();
    expect(events(s).map((e) => e.id)).toEqual(['c1']);
    expect(upcoming(s).map((e) => e.id)).toEqual(['c1']);
    expect(proposals(s).map((e) => e.id)).toEqual(['p1']);
    expect(kitAtRisk(s, now + 4 * DAY).map((r) => r.eventId)).toEqual(['c1']);
  });

  it('asks me until every date has my answer; reconfirms show separately', () => {
    const s = snap();
    expect(needMyAnswer(s).map((e) => e.id)).toEqual(['p1']);
    expect(toReconfirm(s).map((e) => e.id)).toEqual(['c1']);
  });

  it('staff see names, cover and the best date; players see counts only', () => {
    const s = snap();
    const staff = proposalView(s, s.rows.events.p1!, true);
    expect(staff.kind).toBe('poll');
    expect(staff.options[0]!.inPeople.map((m) => m.id)).toEqual(['m2', 'm3']);
    // Two props, no hooker in: short.
    expect(staff.options[0]!.cover?.short).toBe('No hooker');
    expect(staff.best).toBe('o1');
    const player = proposalView(s, s.rows.events.p1!, false);
    expect(player.names).toBe(false);
    expect(player.options[0]!.inPeople).toEqual([]);
    expect(player.options[0]!.counts).toEqual({ in: 2, cant: 0 });
    expect(player.options[0]!.cover).toBeNull();
    // "Names for games": players see names for proposed games too.
    expect(proposalView(snap('games'), s.rows.events.p1!, false).names).toBe(true);
  });
});

describe('time TBD on the device', () => {
  const tz = 'Europe/London';
  const date = '2026-11-21';
  it('stays upcoming all day, then past; sorts after the timed events of its day', () => {
    const s = snap();
    const add = (e: TeamEvent) => (s.rows.events[e.id] = e);
    add(ev('tbd', { type: 'social', startsAt: tbdStartsAt(date, tz), timeTbd: true }));
    add(ev('eve', { type: 'social', startsAt: zonedToUtc(date, '19:30', tz) }));
    add(ev('am', { startsAt: zonedToUtc(date, '10:00', tz) }));
    const at = (t: string, d = date) => zonedToUtc(d, t, tz);
    const ids = (list: TeamEvent[]) => list.map((e) => e.id).filter((x) => x !== 'c1');
    expect(ids(upcoming(s, at('09:00')))).toEqual(['am', 'eve', 'tbd']);
    // Long after noon, the TBD social is still on today.
    expect(ids(upcoming(s, at('23:30')))).toEqual(['tbd']);
    expect(ids(past(s, at('23:30')))).toEqual(['eve', 'am']);
    expect(ids(past(s, at('00:00', '2026-11-22')))).toEqual(['tbd', 'eve', 'am']);
  });
});
