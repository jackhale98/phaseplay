/** Read-side view of one match for the summary and the tournament day (anyone in the team). */
import {
  matchConfig,
  reduceMatch,
  type MatchConfig,
  type MatchState,
  type TeamEvent,
} from '@phaseplay/shared';
import { app } from '#lib/data/app.svelte';
import type { TeamSnapshot } from '#lib/data/types';
import { MatchSession } from './session.svelte';
import { configFor, lineupFor, type Lineup } from './lineup';
import { gameOffsetMs, reduceDay, type DayGame } from './day';

export class MatchView {
  readonly eventId: string;
  readonly session: MatchSession;
  snap: TeamSnapshot | null;
  event: TeamEvent | undefined;
  lineup: Lineup | null;
  cfg: MatchConfig;
  tournament: boolean;
  us: string;
  opponent: string;
  day: DayGame[];
  whole: MatchState;

  constructor(eventId: string) {
    this.eventId = eventId;
    this.session = new MatchSession(eventId, () => this.cfg);
    this.snap = $derived(app.snap);
    this.event = $derived(this.snap?.rows.events[this.eventId]);
    this.lineup = $derived(this.event ? lineupFor(this.snap, this.event) : null);
    this.cfg = $derived(
      this.event && this.lineup
        ? configFor(this.snap, this.event, this.lineup)
        : matchConfig('15s', null),
    );
    this.tournament = $derived(this.event?.type === 'tournament');
    this.us = $derived(this.snap?.team.shortName ?? 'Us');
    this.opponent = $derived(this.event?.opponent || 'Opposition');
    this.day = $derived(reduceDay(this.session.events, this.cfg, this.session.now));
    this.whole = $derived(reduceMatch(this.session.events, this.cfg, this.session.now));
  }

  /** State for one game of a tournament (1-based), or the whole match. */
  game(n: number | null) {
    if (!this.tournament || n === null) return { state: this.whole, offset: 0 };
    const g = this.day[Math.min(this.day.length, Math.max(1, n)) - 1]!;
    return { state: g.state, offset: gameOffsetMs(g.game, this.cfg.halfMs) };
  }

  /** Open, then keep live viewers roughly current (1 s render, refresh on focus). */
  mount() {
    void this.session.open();
    this.session.start(1000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void this.session.refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      this.session.stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }
}
