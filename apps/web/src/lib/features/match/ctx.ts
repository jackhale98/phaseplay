import type { MatchConfig, MatchState } from '@phaseplay/shared';
import type { TeamSnapshot } from '#lib/data/types';
import type { Lineup } from './lineup';
import type { MatchSession } from './session.svelte';

/** Everything a recorder sheet needs, passed down as one reactive object. */
export type RecCtx = {
  session: MatchSession;
  snap: TeamSnapshot | null;
  lineup: Lineup;
  cfg: MatchConfig;
  state: MatchState;
  us: string;
  opponent: string;
  tournament: boolean;
  /** Game-clock offset of the current game (tournaments), for display. */
  offset: number;
  /** Polite announcement after a record. */
  announce: (text: string) => void;
};
