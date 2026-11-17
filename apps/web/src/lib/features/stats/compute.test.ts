import { describe, expect, it } from 'vitest';
import type { Member, Rsvp, StatsFeed, Team, TeamEvent } from '@phaseplay/shared';
import type { TeamSnapshot as Snap } from '#lib/data/types';
import { computeStats } from './compute';

const NOW = Date.UTC(2026, 10, 17, 12);
const DAY = 86400e3;
const member = (id: string, role: Member['role'] = 'player'): Member => ({
  id,
  teamId: 't1',
  userId: id,
  displayName: id.toUpperCase(),
  role,
  jersey: null,
  positions: [],
  status: 'active',
  roleIds: [],
  joinedAt: 0,
  updatedAt: 0,
});
const event = (id: string, type: TeamEvent['type'], startsAt: number): TeamEvent => ({
  id,
  teamId: 't1',
  seasonId: null,
  type,
  format: null,
  title: id,
  startsAt,
  meetAt: null,
  endsAt: null,
  locationName: null,
  locationUrl: null,
  opponent: 'Rivals',
  notes: null,
  rsvpDeadline: null,
  recurrenceId: null,
  cancelledAt: null,
  settings: null,
  version: 1,
  updatedAt: 0,
  deletedAt: null,
});
const rsvp = (eventId: string, memberId: string, attended: boolean | null): Rsvp => ({
  eventId,
  memberId,
  teamId: 't1',
  status: 'yes',
  note: null,
  attended,
  updatedAt: 0,
});

function snap(me: string): Snap {
  const members = Object.fromEntries(['a', 'b', 'c'].map((id) => [id, member(id)]));
  const evs = [event('p1', 'training', NOW - 3 * DAY), event('g1', 'match', NOW - 2 * DAY)];
  const rsvps = [rsvp('p1', 'a', true), rsvp('p1', 'b', false), rsvp('p1', 'c', true)];
  return {
    teamId: 't1',
    cursor: 0,
    syncedAt: 0,
    team: { id: 't1', timezone: 'Europe/London', defaultFormat: '15s' } as Team,
    me: members[me]!,
    rows: {
      members,
      seasons: {},
      events: Object.fromEntries(evs.map((e) => [e.id, e])),
      // A player's device only syncs their own reply.
      rsvps: Object.fromEntries(
        rsvps
          .filter((r) => me === 'a' || r.memberId === me)
          .map((r) => [`${r.eventId}:${r.memberId}`, r]),
      ),
      counts: {},
      sheets: {},
      plays: {},
      drills: {},
      plans: {},
    },
  };
}

const feed: StatsFeed = {
  from: 0,
  to: NOW,
  marks: [{ eventId: 'p1', memberId: 'b', status: 'yes', attended: false }],
  turnout: [
    { eventId: 'p1', taken: true, present: 2, yes: 3 },
    { eventId: 'g1', taken: false, present: 0, yes: 0 },
  ],
  matches: {},
  truncated: false,
};

describe('computeStats visibility', () => {
  it('staff see every player and work turnout out from complete marks', () => {
    const v = computeStats(snap('a'), { win: null, now: NOW, feed: null, local: {}, canAll: true });
    expect(v.attendance.lines.map((l) => l.memberId).sort()).toEqual(['a', 'b', 'c']);
    expect(v.attendance.practices.avgPresent).toBe(2);
    expect(v.practicesHeld).toBe(1);
    // The game had no register, so it counts from RSVPs.
    expect(v.fromRsvp).toBe(1);
  });

  it('a player sees only their own line, with team turnout from the feed', () => {
    const v = computeStats(snap('b'), { win: null, now: NOW, feed, local: {}, canAll: false });
    expect(v.attendance.lines.map((l) => l.memberId)).toEqual(['b']);
    expect(v.attendance.lines[0]!.practices).toEqual({ attended: 0, held: 1, fromRsvp: 0 });
    expect(v.attendance.practices.avgPresent).toBe(2);
  });

  it("a player never gets others' marks even if the feed or snapshot carries them", () => {
    const leaky = {
      ...feed,
      marks: [
        ...feed.marks,
        { eventId: 'p1', memberId: 'c', status: 'yes' as const, attended: true },
      ],
    };
    const v = computeStats(snap('a'), {
      win: null,
      now: NOW,
      feed: leaky,
      local: {},
      canAll: false,
    });
    expect(v.attendance.lines.map((l) => l.memberId)).toEqual(['a']);
  });

  it('offline without a feed, team averages for players are unknown', () => {
    const v = computeStats(snap('b'), {
      win: null,
      now: NOW,
      feed: null,
      local: {},
      canAll: false,
    });
    expect(v.attendance.practices.avgPresent).toBeNull();
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0]!.recorded).toBe(false);
  });

  it('minutes are for everyone, players included', () => {
    const s = snap('b');
    s.rows.sheets = {
      sh: {
        id: 'sh',
        eventId: 'g1',
        teamId: 't1',
        format: '15s',
        replacements: 8,
        slots: { '1': 'a', '2': 'b', '3': 'c' },
        captainId: null,
        viceId: null,
        status: 'published',
        version: 1,
        publishedAt: 1,
        updatedAt: 1,
      },
    };
    const log = [
      {
        id: 'e1',
        seq: 0,
        gameMs: 0,
        wallAt: NOW - 2 * DAY,
        payload: { kind: 'period_start' as const, period: 1 },
      },
      {
        id: 'e2',
        seq: 1,
        gameMs: 40 * 60e3,
        wallAt: NOW - 2 * DAY + 40 * 60e3,
        payload: { kind: 'period_end' as const, period: 1 },
      },
    ];
    const v = computeStats(s, {
      win: null,
      now: NOW,
      feed: { ...feed, matches: { g1: log } },
      local: {},
      canAll: false,
    });
    expect(v.tallies.minutes.map((m) => m.memberId).sort()).toEqual(['a', 'b', 'c']);
    expect(v.attendance.lines.map((l) => l.memberId)).toEqual(['b']);
  });

  it("a capped feed: games whose logs didn't load aren't counted as unrecorded", () => {
    const capped = { ...feed, truncated: true };
    const v = computeStats(snap('a'), {
      win: null,
      now: NOW,
      feed: capped,
      local: {},
      canAll: true,
    });
    expect([...v.missing]).toEqual(['g1']);
    expect(v.tallies.results.unrecorded).toBe(0);
    // Once fetched one by one (here: nothing recorded), it's known again.
    const filled = computeStats(snap('a'), {
      win: null,
      now: NOW,
      feed: capped,
      extra: { g1: [] },
      local: {},
      canAll: true,
    });
    expect(filled.missing.size).toBe(0);
    expect(filled.tallies.results.unrecorded).toBe(1);
  });

  it('staff turnout only counts people who play', () => {
    const s = snap('a');
    s.rows.members.c = { ...s.rows.members.c!, role: 'coach' };
    const v = computeStats(s, { win: null, now: NOW, feed: null, local: {}, canAll: true });
    expect(v.attendance.practices.avgPresent).toBe(1);
  });
});
