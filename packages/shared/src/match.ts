/**
 * Sideline match mode (PLAN.md M6). The match is an append-only log of events; every derived
 * value (clock, score, players on field, sin bins, minutes played) is a pure function of the log.
 * Corrections are new events (`edit`, `void`) that supersede earlier ones, so sync never conflicts.
 */
import * as v from 'valibot';
import { Id, Millis } from './common';
import { DEFAULT_POINTS, PENALTY_OFFENCES, PENALTY_OUTCOMES, RULES, type Format, type ScoringValues } from './rugby';

export const SCORE_TYPES = [
  'try',
  'conversion',
  'conversion_miss',
  'penalty_goal',
  'penalty_goal_miss',
  'drop_goal',
  'penalty_try',
] as const;
export type ScoreType = (typeof SCORE_TYPES)[number];
export const SCORE_LABELS: Record<ScoreType, string> = {
  try: 'Try',
  conversion: 'Conversion',
  conversion_miss: 'Conversion missed',
  penalty_goal: 'Penalty goal',
  penalty_goal_miss: 'Penalty missed',
  drop_goal: 'Drop goal',
  penalty_try: 'Penalty try',
};

export const STOPPAGE_REASONS = ['injury', 'referee', 'review', 'other'] as const;
export const STOPPAGE_LABELS: Record<(typeof STOPPAGE_REASONS)[number], string> = {
  injury: 'Injury stoppage',
  referee: 'Referee time off',
  review: 'Review',
  other: 'Other',
};

export const TALLY_KINDS = [
  'lineout_won',
  'lineout_lost',
  'scrum_won',
  'scrum_lost',
  'turnover_won',
  'turnover_lost',
  'restart_won',
  'restart_lost',
  'tackle',
  'missed_tackle',
] as const;
export type TallyKind = (typeof TALLY_KINDS)[number];

const Side = v.picklist(['us', 'them']);
const Pid = v.optional(v.nullable(Id));
const Zone = v.optional(
  v.nullable(v.object({ x: v.pipe(v.number(), v.minValue(0), v.maxValue(1)), y: v.pipe(v.number(), v.minValue(0), v.maxValue(1)) })),
);

export const MatchPayload = v.variant('kind', [
  v.object({ kind: v.literal('period_start'), period: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4)) }),
  v.object({ kind: v.literal('period_end'), period: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4)) }),
  v.object({ kind: v.literal('time_off'), reason: v.picklist(STOPPAGE_REASONS) }),
  v.object({ kind: v.literal('time_on') }),
  v.object({ kind: v.literal('score'), team: Side, type: v.picklist(SCORE_TYPES), playerId: Pid }),
  v.object({
    kind: v.literal('penalty'),
    side: v.picklist(['for', 'against']),
    offence: v.optional(v.nullable(v.picklist(PENALTY_OFFENCES))),
    playerId: Pid,
    zone: Zone,
    outcome: v.optional(v.nullable(v.picklist(PENALTY_OUTCOMES))),
  }),
  v.object({
    kind: v.literal('card'),
    team: Side,
    colour: v.picklist(['yellow', 'red']),
    playerId: Pid,
    mode: v.optional(v.picklist(['permanent', 'replace_after_20'])),
  }),
  v.object({ kind: v.literal('card_return'), cardId: v.string() }),
  v.object({
    kind: v.literal('sub'),
    team: v.literal('us'),
    offId: Id,
    onId: Id,
    type: v.picklist(['tactical', 'temporary']),
  }),
  v.object({ kind: v.literal('sub_return'), subId: v.string() }),
  v.object({ kind: v.literal('tally'), tally: v.picklist(TALLY_KINDS), playerId: Pid }),
  v.object({
    kind: v.literal('edit'),
    supersedesId: v.string(),
    gameMs: v.optional(Millis),
    patch: v.optional(v.record(v.string(), v.unknown())),
  }),
  v.object({ kind: v.literal('void'), supersedesId: v.string() }),
]);
export type MatchPayload = v.InferOutput<typeof MatchPayload>;
export type MatchKind = MatchPayload['kind'];

export const MatchEventInput = v.object({
  id: Id,
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  payload: MatchPayload,
  gameMs: Millis,
  wallAt: Millis,
});
export type MatchEventInput = v.InferOutput<typeof MatchEventInput>;

export const MatchAppend = v.object({ events: v.pipe(v.array(MatchEventInput), v.minLength(1), v.maxLength(500)) });

export type MatchEvent = MatchEventInput & { createdBy?: string; createdAt?: number };

export type MatchConfig = {
  format: Format;
  halfMs: number;
  sinBinMs: number;
  replacements: number;
  points: ScoringValues;
  redCardMode: 'permanent' | 'replace_after_20';
  /** member ids, slot order: starters first, then bench. */
  starters: string[];
  bench: string[];
};

export function matchConfig(
  format: Format,
  settings: {
    halfMinutes?: number | undefined;
    sinBinMinutes?: number | undefined;
    replacements?: number | undefined;
    points?: ScoringValues | undefined;
    redCardMode?: 'permanent' | 'replace_after_20' | undefined;
  } | null,
  lineup: { starters: string[]; bench: string[] } = { starters: [], bench: [] },
): MatchConfig {
  const r = RULES[format];
  return {
    format,
    halfMs: (settings?.halfMinutes ?? r.halfMinutes) * 60e3,
    sinBinMs: (settings?.sinBinMinutes ?? r.sinBinMinutes) * 60e3,
    replacements: settings?.replacements ?? r.defaultReplacements,
    points: settings?.points ?? DEFAULT_POINTS,
    redCardMode: settings?.redCardMode ?? 'permanent',
    starters: lineup.starters,
    bench: lineup.bench,
  };
}

/** Resolve edits and voids: returns the effective log, ordered by (wallAt, seq, id). */
export function effectiveLog(events: MatchEvent[]): MatchEvent[] {
  const sorted = [...events].sort(byOrder);
  const voided = new Set<string>();
  const edits = new Map<string, MatchEvent[]>();
  for (const e of sorted) {
    if (e.payload.kind === 'void') voided.add(e.payload.supersedesId);
    if (e.payload.kind === 'edit') edits.set(e.payload.supersedesId, [...(edits.get(e.payload.supersedesId) ?? []), e]);
  }
  const out: MatchEvent[] = [];
  for (const e of sorted) {
    if (e.payload.kind === 'void' || e.payload.kind === 'edit' || voided.has(e.id)) continue;
    let cur = e;
    for (const ed of edits.get(e.id) ?? []) {
      if (ed.payload.kind !== 'edit') continue;
      const patch = (ed.payload.patch ?? {}) as Record<string, unknown>;
      const merged = { ...cur.payload, ...patch, kind: cur.payload.kind } as MatchPayload;
      const parsed = v.safeParse(MatchPayload, merged);
      cur = {
        ...cur,
        payload: parsed.success ? parsed.output : cur.payload,
        gameMs: ed.payload.gameMs ?? cur.gameMs,
      };
    }
    out.push(cur);
  }
  return out.sort(byGameOrder);
}

function byOrder(a: MatchEvent, b: MatchEvent) {
  return a.wallAt - b.wallAt || a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function isClock(e: MatchEvent) {
  const k = e.payload.kind;
  return k === 'period_start' || k === 'period_end' || k === 'time_off' || k === 'time_on';
}
function byGameOrder(a: MatchEvent, b: MatchEvent) {
  // Clock events keep wall order (they define the clock); others sort by game time.
  if (isClock(a) && isClock(b)) return byOrder(a, b);
  return a.gameMs - b.gameMs || byOrder(a, b);
}

export type Stoppage = { reason: string; startWall: number; endWall: number | null; gameMs: number; period: number };

export type ClockState = {
  period: number;
  /** true while a period has started, not ended, and time is on. */
  running: boolean;
  inPeriod: boolean;
  timeOff: boolean;
  gameMs: number;
  /** wall time since the first period_start, ignoring time off. */
  realElapsedMs: number;
  periodsEnded: number[];
  stoppages: Stoppage[];
};

/**
 * Derive the game clock at wall time `now` from clock events. Never uses interval ticks, so it
 * survives screen lock and restarts. Each period starts at (period-1) × halfMs on the game clock.
 */
export function clockAt(log: MatchEvent[], cfg: Pick<MatchConfig, 'halfMs'>, now: number): ClockState {
  const clock = log.filter(isClock).sort(byOrder);
  let period = 0;
  let inPeriod = false;
  let timeOff = false;
  let runStart = 0;
  let accumulated = 0;
  let firstStart: number | null = null;
  const ended: number[] = [];
  const stoppages: Stoppage[] = [];
  for (const e of clock) {
    if (e.wallAt > now) break;
    const p = e.payload;
    if (p.kind === 'period_start') {
      period = p.period;
      inPeriod = true;
      timeOff = false;
      runStart = e.wallAt;
      accumulated = 0;
      firstStart ??= e.wallAt;
    } else if (p.kind === 'period_end' && inPeriod) {
      if (!timeOff) accumulated += e.wallAt - runStart;
      closeStoppage(stoppages, e.wallAt);
      inPeriod = false;
      timeOff = false;
      ended.push(p.period);
    } else if (p.kind === 'time_off' && inPeriod && !timeOff) {
      accumulated += e.wallAt - runStart;
      timeOff = true;
      stoppages.push({
        reason: p.reason,
        startWall: e.wallAt,
        endWall: null,
        gameMs: base(period, cfg.halfMs) + accumulated,
        period,
      });
    } else if (p.kind === 'time_on' && inPeriod && timeOff) {
      timeOff = false;
      runStart = e.wallAt;
      closeStoppage(stoppages, e.wallAt);
    }
  }
  const running = inPeriod && !timeOff;
  const live = accumulated + (running ? now - runStart : 0);
  return {
    period,
    running,
    inPeriod,
    timeOff,
    gameMs: period === 0 ? 0 : base(period, cfg.halfMs) + live,
    realElapsedMs: firstStart === null ? 0 : now - firstStart,
    periodsEnded: ended,
    stoppages,
  };
}

function base(period: number, halfMs: number) {
  return Math.max(0, period - 1) * halfMs;
}
function closeStoppage(s: Stoppage[], at: number) {
  const last = s[s.length - 1];
  if (last && last.endWall === null) last.endWall = at;
}

export type SinBin = {
  cardId: string;
  team: 'us' | 'them';
  playerId: string | null;
  colour: 'yellow' | 'red';
  issuedGameMs: number;
  /** remaining on the game clock; 0 means due back (awaiting the "return player" prompt). */
  remainingMs: number;
  permanent: boolean;
};

export type MatchState = {
  clock: ClockState;
  score: { us: number; them: number };
  /** score after each scoring event, for the progression chart. */
  progression: { gameMs: number; us: number; them: number; eventId: string }[];
  onField: { us: number; them: number };
  sinBins: SinBin[];
  penalties: { for: number; against: number; byPeriod: Record<number, { for: number; against: number }> };
  penaltiesByOffence: Record<string, number>;
  tallies: Partial<Record<TallyKind, number>>;
  /** member id → ms on field (game clock). */
  minutesPlayed: Record<string, number>;
  /** member ids currently on the field (us). */
  playing: string[];
  bench: string[];
  replacementsUsed: number;
  log: MatchEvent[];
};

const SCORING: Record<ScoreType, keyof ScoringValues | null> = {
  try: 'try',
  conversion: 'conversion',
  conversion_miss: null,
  penalty_goal: 'penalty_goal',
  penalty_goal_miss: null,
  drop_goal: 'drop_goal',
  penalty_try: 'penalty_try',
};

export function pointsFor(type: ScoreType, points: ScoringValues): number {
  const k = SCORING[type];
  return k ? points[k] : 0;
}

export function reduceMatch(events: MatchEvent[], cfg: MatchConfig, now: number): MatchState {
  const log = effectiveLog(events);
  const clock = clockAt(log, cfg, now);
  const gameNow = clock.gameMs;
  const starters = RULES[cfg.format].starters;
  const score = { us: 0, them: 0 };
  const progression: MatchState['progression'] = [];
  const penalties: MatchState['penalties'] = { for: 0, against: 0, byPeriod: {} };
  const penaltiesByOffence: Record<string, number> = {};
  const tallies: MatchState['tallies'] = {};
  const cards = new Map<string, SinBin & { returned: boolean }>();
  const playing = new Set(cfg.starters);
  const bench = new Set(cfg.bench);
  const onSince = new Map<string, number>();
  const played: Record<string, number> = {};
  for (const id of cfg.starters) onSince.set(id, 0);
  const subs = new Map<string, { offId: string; onId: string; type: string }>();
  let replacementsUsed = 0;

  const periodOf = (gameMs: number) => Math.min(4, Math.floor(gameMs / cfg.halfMs) + 1);
  const goOff = (id: string, at: number) => {
    const since = onSince.get(id);
    if (since !== undefined) played[id] = (played[id] ?? 0) + Math.max(0, at - since);
    onSince.delete(id);
  };
  const goOn = (id: string, at: number) => {
    if (!onSince.has(id)) onSince.set(id, at);
  };

  for (const e of log) {
    const p = e.payload;
    switch (p.kind) {
      case 'score': {
        score[p.team] += pointsFor(p.type, cfg.points);
        if (SCORING[p.type]) progression.push({ gameMs: e.gameMs, ...score, eventId: e.id });
        break;
      }
      case 'penalty': {
        penalties[p.side] += 1;
        const per = periodOf(e.gameMs);
        const bp = (penalties.byPeriod[per] ??= { for: 0, against: 0 });
        bp[p.side] += 1;
        if (p.side === 'against') {
          const key = p.offence ?? 'other';
          penaltiesByOffence[key] = (penaltiesByOffence[key] ?? 0) + 1;
        }
        break;
      }
      case 'tally':
        tallies[p.tally] = (tallies[p.tally] ?? 0) + 1;
        break;
      case 'card': {
        const permanent = p.colour === 'red' && (p.mode ?? cfg.redCardMode) === 'permanent';
        const dur = p.colour === 'yellow' ? cfg.sinBinMs : 20 * 60e3;
        cards.set(e.id, {
          cardId: e.id,
          team: p.team,
          playerId: p.playerId ?? null,
          colour: p.colour,
          issuedGameMs: e.gameMs,
          remainingMs: permanent ? Infinity : Math.max(0, e.gameMs + dur - gameNow),
          permanent,
          returned: false,
        });
        if (p.team === 'us' && p.playerId && playing.has(p.playerId)) {
          goOff(p.playerId, e.gameMs);
          playing.delete(p.playerId);
        }
        break;
      }
      case 'card_return': {
        const c = cards.get(p.cardId);
        if (c && !c.permanent && !c.returned) {
          c.returned = true;
          if (c.team === 'us' && c.playerId && c.colour === 'yellow') {
            playing.add(c.playerId);
            goOn(c.playerId, e.gameMs);
          }
        }
        break;
      }
      case 'sub': {
        if (!playing.has(p.offId) || playing.has(p.onId)) break;
        playing.delete(p.offId);
        goOff(p.offId, e.gameMs);
        bench.delete(p.onId);
        bench.add(p.offId);
        playing.add(p.onId);
        goOn(p.onId, e.gameMs);
        subs.set(e.id, { offId: p.offId, onId: p.onId, type: p.type });
        if (p.type === 'tactical') replacementsUsed += 1;
        break;
      }
      case 'sub_return': {
        const s = subs.get(p.subId);
        if (!s || s.type !== 'temporary' || !playing.has(s.onId)) break;
        playing.delete(s.onId);
        goOff(s.onId, e.gameMs);
        bench.add(s.onId);
        bench.delete(s.offId);
        playing.add(s.offId);
        goOn(s.offId, e.gameMs);
        subs.delete(p.subId);
        break;
      }
      default:
        break;
    }
  }

  // Close on-field intervals at the current game time, or at the end of the last period.
  const endAt = gameNow;
  for (const [id, since] of onSince) played[id] = (played[id] ?? 0) + Math.max(0, endAt - since);

  const sinBins = [...cards.values()].filter((c) => !c.returned && (c.permanent || c.colour === 'yellow' || c.remainingMs > 0));
  const down = (team: 'us' | 'them') => sinBins.filter((c) => c.team === team).length;
  return {
    clock,
    score,
    progression,
    onField: { us: starters - down('us'), them: starters - down('them') },
    sinBins: sinBins.map(({ returned: _r, ...c }) => c),
    penalties,
    penaltiesByOffence,
    tallies,
    minutesPlayed: played,
    playing: [...playing],
    bench: [...bench],
    replacementsUsed,
    log,
  };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
