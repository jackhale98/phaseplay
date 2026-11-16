/**
 * 7s tournament day (PLAN.md M6 §Afterwards).
 *
 * Choice: a tournament event keeps ONE append-only match log, and each game on the day is a pair
 * of consecutive periods: periods 1–2 are game 1, periods 3–4 are game 2 (the shared reducer and
 * the API accept periods 1–12, so one tournament event holds up to six recorded games). Every
 * event belongs to the game whose kick-off (`period_start` of an odd period) most recently
 * preceded it on the wall clock; corrections follow their target. Each game is then reduced on
 * its own (so the lineup resets to the team sheet at every kick-off), and minutes played are
 * summed across games. Nothing is stored outside the synced log, so every device agrees.
 */
import { MAX_PERIODS } from '@phaseplay/shared';
import {
  effectiveLog,
  reduceMatch,
  type MatchConfig,
  type MatchEvent,
  type MatchState,
} from '@phaseplay/shared';

export const MAX_GAMES = MAX_PERIODS / 2;

/** Wall times of each game's kick-off, in order (only kick-offs still in effect). */
export function kickoffs(events: MatchEvent[]): number[] {
  return effectiveLog(events)
    .filter((e) => e.payload.kind === 'period_start' && e.payload.period % 2 === 1)
    .map((e) => e.wallAt)
    .sort((a, b) => a - b);
}

export const gameOfPeriod = (period: number) => Math.max(1, Math.ceil(period / 2));
/** First period of a game. */
export const firstPeriod = (game: number) => game * 2 - 1;

/** Split the raw log into games (1-based array index + 1). Always at least one game. */
export function splitGames(events: MatchEvent[]): MatchEvent[][] {
  const starts = kickoffs(events);
  const gameAt = (wallAt: number) => {
    let g = 1;
    for (let i = 0; i < starts.length; i++) if (starts[i]! <= wallAt) g = i + 1;
    return g;
  };
  const byId = new Map(events.map((e) => [e.id, e]));
  const rootOf = (e: MatchEvent): MatchEvent => {
    let cur = e;
    for (let i = 0; i < 20; i++) {
      const p = cur.payload;
      if (p.kind !== 'edit' && p.kind !== 'void') return cur;
      const t = byId.get(p.supersedesId);
      if (!t) return cur;
      cur = t;
    }
    return cur;
  };
  const games: MatchEvent[][] = Array.from({ length: Math.max(1, starts.length) }, () => []);
  for (const e of events) games[Math.min(games.length, gameAt(rootOf(e).wallAt)) - 1]!.push(e);
  return games;
}

/** Offset to show a game's clock from 00:00 (game 2 starts at 2 × half on the shared clock). */
export const gameOffsetMs = (game: number, halfMs: number) => (game - 1) * 2 * halfMs;

export type DayGame = { game: number; state: MatchState; events: MatchEvent[] };

export function reduceDay(events: MatchEvent[], cfg: MatchConfig, now: number): DayGame[] {
  return splitGames(events).map((evs, i) => {
    const state = reduceMatch(evs, cfg, now);
    // The reducer starts starters' first stint at game-clock 0; game 2 kicks off later on the
    // shared clock, so shift that first stint to the game's own kick-off.
    const offset = gameOffsetMs(i + 1, cfg.halfMs);
    if (offset > 0) {
      const minutesPlayed = { ...state.minutesPlayed };
      for (const id of cfg.starters)
        if (minutesPlayed[id] !== undefined)
          minutesPlayed[id] = Math.max(0, minutesPlayed[id] - offset);
      return { game: i + 1, events: evs, state: { ...state, minutesPlayed } };
    }
    return { game: i + 1, events: evs, state };
  });
}

/** member id → { per game ms, total ms } across the day. */
export function dayMinutes(games: DayGame[]): Map<string, { perGame: number[]; total: number }> {
  const out = new Map<string, { perGame: number[]; total: number }>();
  games.forEach((g, i) => {
    for (const [id, ms] of Object.entries(g.state.minutesPlayed)) {
      const row = out.get(id) ?? { perGame: games.map(() => 0), total: 0 };
      row.perGame[i] = (row.perGame[i] ?? 0) + ms;
      row.total += ms;
      out.set(id, row);
    }
  });
  return out;
}
