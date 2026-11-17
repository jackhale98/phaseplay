/**
 * Season stats (PLAN.md M7). Pure functions over the rows the web snapshot already holds (events,
 * RSVPs/attendance, published team sheets, practice plans, drills) plus match logs. Minutes and
 * scores come from the match reducer itself (`reduceMatch` / `reduceDay`), so the season view
 * always agrees with each match summary. No health data: nothing here reads stoppage reasons,
 * RSVP notes or anything else about a player's body.
 */
import type { Member, PracticePlan, Season, TeamEvent, TeamSheet } from './api';
import { eventCategory, type RsvpStatus } from './events';
import {
  effectiveLog,
  matchConfig,
  pointsFor,
  reduceMatch,
  type MatchEvent,
  type ScoreType,
} from './match';
import { reduceDay, sheetLineup } from './match-day';
import {
  ALL_LANE,
  blockMinutes,
  planTotals,
  slotMinutes,
  type DrillFacts,
  type PlanData,
} from './practice';
import type { Format } from './rugby';
import { addDays, dateInTz, weekdayOf, zonedToUtc } from './time';

/* --------------------------------- Window --------------------------------- */

/** Half-open time window [from, to) in ms. `null` means all time. */
export type StatsWindow = { from: number; to: number };

/** A season's dates as instants in the team's timezone (the end date is inclusive). */
export function seasonWindow(s: Pick<Season, 'startsOn' | 'endsOn'>, tz: string): StatsWindow {
  return {
    from: zonedToUtc(s.startsOn, '00:00', tz),
    to: zonedToUtc(addDays(s.endsOn, 1), '00:00', tz),
  };
}

/**
 * The season to show by default: the one running today (the latest-starting if they overlap),
 * else the most recent one that has started, else the next one.
 */
export function currentSeason<S extends Pick<Season, 'startsOn' | 'endsOn' | 'deletedAt'>>(
  seasons: S[],
  today: string,
): S | null {
  const live = seasons
    .filter((s) => !s.deletedAt)
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn));
  return (
    live.find((s) => s.startsOn <= today && today <= s.endsOn) ??
    live.find((s) => s.startsOn <= today) ??
    live.at(-1) ??
    null
  );
}

type EventLike = Pick<
  TeamEvent,
  'id' | 'type' | 'startsAt' | 'endsAt' | 'cancelledAt' | 'deletedAt'
>;
export const eventEnd = (e: Pick<TeamEvent, 'startsAt' | 'endsAt'>) =>
  e.endsAt ?? e.startsAt + 3 * 3600e3;

/** Practices and games that actually happened in the window: over, not cancelled, not deleted. */
export function heldEvents<E extends EventLike>(
  events: E[],
  win: StatsWindow | null,
  now: number,
): E[] {
  return events
    .filter(
      (e) =>
        !e.deletedAt &&
        !e.cancelledAt &&
        eventCategory(e.type) !== 'events' &&
        eventEnd(e) <= now &&
        (!win || (e.startsAt >= win.from && e.startsAt < win.to)),
    )
    .sort((a, b) => a.startsAt - b.startsAt);
}

/* ------------------------------- Attendance ------------------------------- */

/** One member's reply and attendance for one event (an RSVP row without the note). */
export type AttendanceMark = {
  eventId: string;
  memberId: string;
  status: RsvpStatus | null;
  attended: boolean | null;
};
/** Team-wide counts for one event, safe for every member to see. */
export type EventTurnout = { eventId: string; taken: boolean; present: number; yes: number };

export type AttendanceTally = { attended: number; held: number; fromRsvp: number };
export type AttendanceLine = {
  memberId: string;
  practices: AttendanceTally;
  games: AttendanceTally;
  total: AttendanceTally;
};
export type TeamTurnout = {
  held: number;
  /** Held events where attendance was taken (the rest fall back to RSVP "yes"). */
  taken: number;
  /** Average players there per event; null when the counts aren't known on this device. */
  avgPresent: number | null;
};
export type AttendanceStats = {
  practices: TeamTurnout;
  games: TeamTurnout;
  lines: AttendanceLine[];
};

/** Turnout from complete marks (staff devices). Players get turnout from the server instead. */
export function turnoutFromMarks(marks: AttendanceMark[]): EventTurnout[] {
  const by = new Map<string, EventTurnout>();
  for (const m of marks) {
    const t = by.get(m.eventId) ?? { eventId: m.eventId, taken: false, present: 0, yes: 0 };
    if (m.attended !== null) t.taken = true;
    if (m.attended === true) t.present += 1;
    if (m.status === 'yes') t.yes += 1;
    by.set(m.eventId, t);
  }
  return [...by.values()];
}

export const pct = (t: Pick<AttendanceTally, 'attended' | 'held'>): number | null =>
  t.held ? Math.round((t.attended / t.held) * 100) : null;

const blankTally = (): AttendanceTally => ({ attended: 0, held: 0, fromRsvp: 0 });

/**
 * Practices and games attended vs held, per member. Where attendance was taken, it counts; where
 * it wasn't, an RSVP "yes" counts instead (and is tallied in `fromRsvp` so the UI can say so).
 * An event counts towards a member once they've joined, or whenever they have a mark for it.
 */
export function attendanceStats(input: {
  events: Pick<TeamEvent, 'id' | 'type' | 'startsAt'>[];
  members: Pick<Member, 'id' | 'joinedAt'>[];
  marks: AttendanceMark[];
  /** Team-wide counts per event, or null when only some members' marks are known. */
  turnout: EventTurnout[] | null;
}): AttendanceStats {
  const marks = new Map(input.marks.map((m) => [`${m.eventId}:${m.memberId}`, m]));
  const turnout = new Map((input.turnout ?? []).map((t) => [t.eventId, t]));
  const takenFromMarks = new Set(
    input.marks.filter((m) => m.attended !== null).map((m) => m.eventId),
  );
  const taken = (id: string) => turnout.get(id)?.taken ?? takenFromMarks.has(id);
  const team = { practices: blankTeam(), games: blankTeam() };
  const sums = { practices: 0, games: 0 };
  for (const e of input.events) {
    const k = kindOf(e.type);
    team[k].held += 1;
    if (taken(e.id)) team[k].taken += 1;
    const t = turnout.get(e.id);
    sums[k] += t ? (t.taken ? t.present : t.yes) : 0;
  }
  for (const k of ['practices', 'games'] as const)
    team[k].avgPresent =
      input.turnout && team[k].held ? Math.round((sums[k] / team[k].held) * 10) / 10 : null;

  const lines = input.members.map((m) => {
    const line: AttendanceLine = {
      memberId: m.id,
      practices: blankTally(),
      games: blankTally(),
      total: blankTally(),
    };
    for (const e of input.events) {
      const mark = marks.get(`${e.id}:${m.id}`);
      if (!mark && m.joinedAt !== null && m.joinedAt > e.startsAt) continue;
      const fromAttendance = taken(e.id);
      const was = fromAttendance ? mark?.attended === true : mark?.status === 'yes';
      for (const t of [line[kindOf(e.type)], line.total]) {
        t.held += 1;
        if (was) t.attended += 1;
        if (!fromAttendance) t.fromRsvp += 1;
      }
    }
    return line;
  });
  return { ...team, lines };
}

const blankTeam = (): TeamTurnout => ({ held: 0, taken: 0, avgPresent: null });
const kindOf = (type: TeamEvent['type']) =>
  eventCategory(type) === 'games' ? ('games' as const) : ('practices' as const);

/* ---------------------------- Matches and minutes ---------------------------- */

export type MatchResult = 'W' | 'D' | 'L';
export type GameScore = { us: number; them: number; result: MatchResult };
export type PlayerTally = {
  tries: number;
  conversions: number;
  penaltyGoals: number;
  dropGoals: number;
  points: number;
  yellow: number;
  red: number;
};
export type CardCount = { yellow: number; red: number };

/** One game event (a match, or a whole tournament day) reduced for the season view. */
export type MatchLine = {
  eventId: string;
  startsAt: number;
  opponent: string | null;
  format: Format;
  tournament: boolean;
  /** The log has at least one kick-off. Unrecorded games count nowhere but the fixture list. */
  recorded: boolean;
  /** Minutes need a published team sheet (the lineup at kick-off). */
  hasSheet: boolean;
  /** One per match; one per recorded game of a tournament day. */
  games: GameScore[];
  /** member id → ms on the field (summed over a tournament's games). */
  minutes: Record<string, number>;
  /** Members named in the starting slots. */
  starters: string[];
  players: Record<string, PlayerTally>;
  cards: { us: CardCount; them: CardCount };
  penalties: { for: number; against: number; byOffence: Record<string, number> };
};

/** Kicks and tries credited to a player (a penalty try belongs to the team). */
const PLAYER_SCORE: Partial<
  Record<ScoreType, 'tries' | 'conversions' | 'penaltyGoals' | 'dropGoals'>
> = {
  try: 'tries',
  conversion: 'conversions',
  penalty_goal: 'penaltyGoals',
  drop_goal: 'dropGoals',
};

const resultOf = (us: number, them: number): MatchResult =>
  us > them ? 'W' : us < them ? 'L' : 'D';
const blankPlayer = (): PlayerTally => ({
  tries: 0,
  conversions: 0,
  penaltyGoals: 0,
  dropGoals: 0,
  points: 0,
  yellow: 0,
  red: 0,
});

/** Reduce one game event's log with the same reducer (and lineup) match mode uses. */
export function matchLine(input: {
  event: Pick<TeamEvent, 'id' | 'type' | 'startsAt' | 'opponent' | 'format' | 'settings'>;
  /** The event's team sheet; only a published one gives a lineup. */
  sheet: Pick<TeamSheet, 'format' | 'slots' | 'status' | 'publishedAt'> | null | undefined;
  log: MatchEvent[];
  defaultFormat: Format;
}): MatchLine {
  const { event, log } = input;
  const published =
    input.sheet && (input.sheet.status === 'published' || input.sheet.publishedAt !== null)
      ? input.sheet
      : null;
  const format = published?.format ?? event.format ?? input.defaultFormat;
  const lineup = sheetLineup(format, published?.slots);
  const cfg = matchConfig(format, event.settings ?? null, lineup);
  const eff = effectiveLog(log);
  const recorded = eff.some((e) => e.payload.kind === 'period_start');
  // Reduce at the last recorded moment, so an unfinished log never keeps a clock running.
  const at = log.reduce((m, e) => Math.max(m, e.wallAt), 0);
  const tournament = event.type === 'tournament';
  const whole = reduceMatch(log, cfg, at);
  const states = tournament ? reduceDay(log, cfg, at).map((g) => g.state) : [whole];

  const minutes: Record<string, number> = {};
  if (recorded && lineup.hasSheet)
    for (const s of states)
      for (const [id, ms] of Object.entries(s.minutesPlayed)) minutes[id] = (minutes[id] ?? 0) + ms;

  const players: Record<string, PlayerTally> = {};
  const cards = { us: { yellow: 0, red: 0 }, them: { yellow: 0, red: 0 } };
  for (const e of eff) {
    const p = e.payload;
    if (p.kind === 'score' && p.team === 'us' && p.playerId) {
      const field = PLAYER_SCORE[p.type];
      if (field) {
        const t = (players[p.playerId] ??= blankPlayer());
        t[field] += 1;
        t.points += pointsFor(p.type, cfg.points);
      }
    } else if (p.kind === 'card') {
      cards[p.team][p.colour] += 1;
      if (p.team === 'us' && p.playerId) (players[p.playerId] ??= blankPlayer())[p.colour] += 1;
    }
  }

  return {
    eventId: event.id,
    startsAt: event.startsAt,
    opponent: event.opponent,
    format,
    tournament,
    recorded,
    hasSheet: lineup.hasSheet,
    games: recorded
      ? states
          .filter((s) => !tournament || s.clock.period > 0)
          .map((s) => ({ ...s.score, result: resultOf(s.score.us, s.score.them) }))
      : [],
    minutes,
    starters: recorded ? lineup.starters : [],
    players,
    cards,
    penalties: {
      for: whole.penalties.for,
      against: whole.penalties.against,
      byOffence: whole.penaltiesByOffence,
    },
  };
}

export type ResultsSummary = {
  /** Recorded games (each tournament game counts once). */
  played: number;
  won: number;
  drawn: number;
  lost: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Game events held but never recorded in match mode. */
  unrecorded: number;
};
export type MinutesLine = {
  memberId: string;
  ms: number;
  /** Game events they got on the field in. */
  appearances: number;
  starts: number;
};
export type SeasonTallies = {
  results: ResultsSummary;
  minutes: MinutesLine[];
  /** Members with any points or cards, most points first. */
  scorers: (PlayerTally & { memberId: string })[];
  cards: { us: CardCount; them: CardCount };
  /** Recorded game events with a published sheet (the ones minutes come from). */
  minutesFrom: number;
};

export function seasonTallies(lines: MatchLine[]): SeasonTallies {
  const results: ResultsSummary = {
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    unrecorded: 0,
  };
  const mins = new Map<string, MinutesLine>();
  const scorers = new Map<string, PlayerTally & { memberId: string }>();
  const cards = { us: { yellow: 0, red: 0 }, them: { yellow: 0, red: 0 } };
  let minutesFrom = 0;
  for (const l of lines) {
    if (!l.recorded) {
      results.unrecorded += 1;
      continue;
    }
    for (const g of l.games) {
      results.played += 1;
      results[g.result === 'W' ? 'won' : g.result === 'D' ? 'drawn' : 'lost'] += 1;
      results.pointsFor += g.us;
      results.pointsAgainst += g.them;
    }
    if (l.hasSheet) minutesFrom += 1;
    const starters = new Set(l.starters);
    for (const [id, ms] of Object.entries(l.minutes)) {
      const m = mins.get(id) ?? { memberId: id, ms: 0, appearances: 0, starts: 0 };
      m.ms += ms;
      if (ms > 0) m.appearances += 1;
      if (starters.has(id)) m.starts += 1;
      mins.set(id, m);
    }
    for (const [id, t] of Object.entries(l.players)) {
      const s = scorers.get(id) ?? { memberId: id, ...blankPlayer() };
      for (const k of Object.keys(t) as (keyof PlayerTally)[]) s[k] += t[k];
      scorers.set(id, s);
    }
    for (const side of ['us', 'them'] as const)
      for (const c of ['yellow', 'red'] as const) cards[side][c] += l.cards[side][c];
  }
  return {
    results,
    minutes: [...mins.values()].sort((a, b) => b.ms - a.ms || a.memberId.localeCompare(b.memberId)),
    scorers: [...scorers.values()].sort(
      (a, b) => b.points - a.points || b.tries - a.tries || a.memberId.localeCompare(b.memberId),
    ),
    cards,
    minutesFrom,
  };
}

/* -------------------------------- Penalties -------------------------------- */

export type PenaltyTrend = {
  /** Recorded games in date order. */
  perMatch: {
    eventId: string;
    startsAt: number;
    opponent: string | null;
    against: number;
    for: number;
    byOffence: Record<string, number>;
  }[];
  /** Offences conceded across the window, most first. */
  top: { offence: string; count: number }[];
  against: number;
  /** Penalties conceded per recorded game event, one decimal. */
  avgAgainst: number | null;
};

export function penaltyTrend(lines: MatchLine[]): PenaltyTrend {
  const rec = lines.filter((l) => l.recorded).sort((a, b) => a.startsAt - b.startsAt);
  const totals = new Map<string, number>();
  let against = 0;
  for (const l of rec) {
    against += l.penalties.against;
    for (const [k, n] of Object.entries(l.penalties.byOffence))
      totals.set(k, (totals.get(k) ?? 0) + n);
  }
  return {
    perMatch: rec.map((l) => ({
      eventId: l.eventId,
      startsAt: l.startsAt,
      opponent: l.opponent,
      against: l.penalties.against,
      for: l.penalties.for,
      byOffence: l.penalties.byOffence,
    })),
    top: [...totals]
      .map(([offence, count]) => ({ offence, count }))
      .sort((a, b) => b.count - a.count || a.offence.localeCompare(b.offence)),
    against,
    avgAgainst: rec.length ? Math.round((against / rec.length) * 10) / 10 : null,
  };
}

/* ------------------------------ Training load ------------------------------ */

export type GroupLoad = { totalMin: number; contactMin: number; highIntensityMin: number };
const isContact = (d: DrillFacts) => d.contactLevel === 'shields' || d.contactLevel === 'full';

/**
 * Contact and high-intensity (≥ 4/5) minutes for one plan. `team` matches the planner's totals
 * (the busiest lane in each slot); `groups` splits a split session per lane, where a block in the
 * "all" lane counts for every group. A single-lane plan has one group, `all`.
 */
export function planLoad(
  plan: PlanData,
  drills: Record<string, DrillFacts>,
): { team: GroupLoad; groups: Record<string, GroupLoad> } {
  const t = planTotals(plan, drills);
  const team = {
    totalMin: t.totalMin,
    contactMin: t.contactMin,
    highIntensityMin: t.highIntensityMin,
  };
  const lanes = plan.lanes.filter((l) => l !== ALL_LANE);
  if (!lanes.length) return { team, groups: { [ALL_LANE]: team } };
  const groups: Record<string, GroupLoad> = {};
  for (const lane of lanes) {
    const g = { totalMin: 0, contactMin: 0, highIntensityMin: 0 };
    for (const slot of plan.slots) {
      g.totalMin += slotMinutes(slot);
      const b =
        slot.blocks.find((x) => x.lane === lane) ?? slot.blocks.find((x) => x.lane === ALL_LANE);
      const d = b?.drillId ? drills[b.drillId] : undefined;
      if (!b || !d) continue;
      if (isContact(d)) g.contactMin += blockMinutes(b);
      if (d.intensity >= 4) g.highIntensityMin += blockMinutes(b);
    }
    groups[lane] = g;
  }
  return { team, groups };
}

/** Monday (YYYY-MM-DD) of the week an instant falls in, in the team's timezone. */
export function weekOf(at: number, tz: string): string {
  const d = dateInTz(at, tz);
  return addDays(d, -((weekdayOf(d) + 6) % 7));
}

export type LoadWeek = GroupLoad & {
  /** Monday of the week. */
  week: string;
  /** Practices held that week. */
  sessions: number;
  /** Of those, how many had a practice plan to count from. */
  planned: number;
  groups: Record<string, GroupLoad>;
};

/**
 * Weekly team training load from the practice plans of held practices. Weeks between the first
 * and last practice are filled in, so a quiet week shows as a gap rather than disappearing.
 */
export function trainingLoad(input: {
  events: Pick<TeamEvent, 'id' | 'type' | 'startsAt'>[];
  plans: Pick<PracticePlan, 'eventId' | 'data' | 'isTemplate' | 'deletedAt'>[];
  drills: Record<string, DrillFacts>;
  tz: string;
}): LoadWeek[] {
  const plans = new Map(
    input.plans
      .filter((p) => p.eventId && !p.isTemplate && !p.deletedAt)
      .map((p) => [p.eventId!, p]),
  );
  const practices = input.events.filter((e) => e.type === 'training');
  if (!practices.length) return [];
  const weeks = new Map<string, LoadWeek>();
  const blank = (week: string): LoadWeek => ({
    week,
    sessions: 0,
    planned: 0,
    totalMin: 0,
    contactMin: 0,
    highIntensityMin: 0,
    groups: {},
  });
  for (const e of practices) {
    const key = weekOf(e.startsAt, input.tz);
    const w = weeks.get(key) ?? blank(key);
    w.sessions += 1;
    const plan = plans.get(e.id);
    if (plan) {
      w.planned += 1;
      const load = planLoad(plan.data, input.drills);
      add(w, load.team);
      for (const [lane, g] of Object.entries(load.groups))
        add((w.groups[lane] ??= { totalMin: 0, contactMin: 0, highIntensityMin: 0 }), g);
    }
    weeks.set(key, w);
  }
  const keys = [...weeks.keys()].sort();
  const out: LoadWeek[] = [];
  for (let k = keys[0]!; k <= keys.at(-1)!; k = addDays(k, 7)) out.push(weeks.get(k) ?? blank(k));
  return out;
}

function add(into: GroupLoad, g: GroupLoad) {
  into.totalMin += g.totalMin;
  into.contactMin += g.contactMin;
  into.highIntensityMin += g.highIntensityMin;
}

/* ------------------------------- Server feed ------------------------------- */

/**
 * `stats.feed`: what the snapshot doesn't carry. Match logs aren't synced, players only sync their
 * own RSVP rows, and a first sync only has 120 days of RSVP history. Never RSVP notes.
 */
export type StatsFeed = {
  from: number;
  to: number;
  /** Everyone's marks with `availability.view`; otherwise only the caller's own. */
  marks: AttendanceMark[];
  /** Team-wide counts per held event (everyone may see these). */
  turnout: EventTurnout[];
  /** Match logs of game events in the window, by event id. */
  matches: Record<string, MatchEvent[]>;
  /** True when the match log row cap was hit; older logs are left out. */
  truncated: boolean;
};
