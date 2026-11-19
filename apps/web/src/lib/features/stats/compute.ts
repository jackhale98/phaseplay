/**
 * Season stats from the synced snapshot (offline-first), topped up by the stats feed when online.
 * Every number comes from the pure functions in packages/shared/stats.ts; this file only picks the
 * rows and applies who-sees-what (docs/architecture.md §Season stats).
 */
import {
  attendanceStats,
  heldEvents,
  isGame,
  playsForTeam,
  matchLine,
  penaltyTrend,
  seasonTallies,
  trainingLoad,
  turnoutFromMarks,
  type AttendanceMark,
  type AttendanceStats,
  type Format,
  type LoadWeek,
  type MatchEvent,
  type MatchLine,
  type PenaltyTrend,
  type SeasonTallies,
  type StatsFeed,
  type StatsWindow,
  type TeamEvent,
} from '@phaseplay/shared';
import { events, players, sheetFor } from '#lib/data/selectors';
import type { TeamSnapshot } from '#lib/data/types';
import { mergeLogs } from '#lib/features/match/log';

export type StatsView = {
  /** Everyone's attendance (availability.view); otherwise only my own line. Minutes are for all. */
  canAll: boolean;
  held: TeamEvent[];
  practicesHeld: number;
  attendance: AttendanceStats;
  /** Held game events, newest first. */
  lines: MatchLine[];
  /**
   * Games whose logs couldn't be loaded (the feed hit its row cap and fetching them one by one
   * failed). They're left out of results, minutes and scorers rather than counted as unrecorded.
   */
  missing: Set<string>;
  tallies: SeasonTallies;
  penalties: PenaltyTrend;
  load: LoadWeek[];
  /** Recorded game events per format (a tournament day counts once). */
  formats: Record<Format, number>;
  /** Held practices or games with no attendance taken (counted from RSVP "yes"). */
  fromRsvp: number;
};

export function computeStats(
  s: TeamSnapshot,
  o: {
    win: StatsWindow | null;
    now: number;
    feed: StatsFeed | null;
    /** Logs fetched one by one after a capped feed (an empty array means nothing recorded). */
    extra?: Record<string, MatchEvent[]>;
    /** Match logs on this device (match mode's local copies), by event id. */
    local: Record<string, MatchEvent[]>;
    canAll: boolean;
  },
): StatsView {
  const held = heldEvents(events(s), o.win, o.now, s.team.timezone);
  const heldIds = new Set(held.map((e) => e.id));
  const me = s.me.id;
  const mine = (memberId: string) => o.canAll || memberId === me;

  // Marks: the feed has the full history; the snapshot is fresher (and holds queued edits).
  const marks = new Map<string, AttendanceMark>();
  for (const m of o.feed?.marks ?? [])
    if (heldIds.has(m.eventId) && mine(m.memberId)) marks.set(`${m.eventId}:${m.memberId}`, m);
  for (const r of Object.values(s.rows.rsvps))
    if (heldIds.has(r.eventId) && mine(r.memberId))
      marks.set(`${r.eventId}:${r.memberId}`, {
        eventId: r.eventId,
        memberId: r.memberId,
        status: r.status,
        attended: r.attended,
      });
  const markList = [...marks.values()];
  const plays = (id: string) => {
    const m = s.rows.members[id];
    return !!m && m.status !== 'removed' && playsForTeam(m);
  };
  const turnout = o.canAll ? turnoutFromMarks(markList, plays) : (o.feed?.turnout ?? null);
  const roster = o.canAll ? players(s) : [s.rows.members[me] ?? s.me];
  const attendance = attendanceStats({
    events: held,
    members: roster.map((m) => ({ id: m.id, joinedAt: m.joinedAt })),
    marks: markList,
    turnout,
  });

  const games = held.filter((e) => isGame(e.type));
  const extra = o.extra ?? {};
  const missing = new Set(
    o.feed?.truncated
      ? games
          .filter((e) => !o.feed!.matches[e.id] && !extra[e.id] && !o.local[e.id])
          .map((e) => e.id)
      : [],
  );
  const lines = games
    .map((e) =>
      matchLine({
        event: e,
        sheet: sheetFor(s, e.id),
        log: mergeLogs(o.feed?.matches[e.id] ?? extra[e.id] ?? [], o.local[e.id] ?? []),
        defaultFormat: s.team.defaultFormat,
      }),
    )
    .reverse();
  // Minutes are for the whole team, like each match summary; attendance stays private above.
  const tallies = seasonTallies(lines.filter((l) => !missing.has(l.eventId)));

  const formats: Record<Format, number> = { '15s': 0, '7s': 0 };
  for (const l of lines) if (l.recorded) formats[l.format] += 1;

  return {
    canAll: o.canAll,
    held,
    missing,
    practicesHeld: held.length - games.length,
    attendance,
    lines,
    tallies,
    penalties: penaltyTrend(lines),
    load: trainingLoad({
      events: held,
      plans: Object.values(s.rows.plans),
      drills: s.rows.drills,
      tz: s.team.timezone,
    }),
    formats,
    fromRsvp:
      attendance.practices.held -
      attendance.practices.taken +
      attendance.games.held -
      attendance.games.taken,
  };
}

/** Minutes, rounded, with the rugby prime: 1234567 ms → "21'". */
export const mins = (ms: number) => `${Math.round(ms / 60e3)}'`;
