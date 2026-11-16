/** Lineup, config and copy for match mode, all derived from the snapshot and the shared rules. */
import {
  OFFENCE_LABELS,
  OUTCOME_LABELS,
  RULES,
  SCORE_LABELS,
  STOPPAGE_LABELS,
  isFrontRowCapable,
  matchConfig,
  type Format,
  type MatchConfig,
  type MatchEvent,
  type TallyKind,
  type TeamEvent,
} from '@phaseplay/shared';
import { eventFormat, memberName, sheetFor } from '#lib/data/selectors';
import type { TeamSnapshot } from '#lib/data/types';

export type Lineup = {
  format: Format;
  starters: string[];
  bench: string[];
  /** member id → shirt number (sheet slot). */
  shirt: Map<string, number>;
  hasSheet: boolean;
};

/** The event's team sheet: slots 1..starters start, the rest are the bench. */
export function lineupFor(s: TeamSnapshot | null, e: TeamEvent): Lineup {
  const sheet = sheetFor(s, e.id);
  const format = sheet?.format ?? eventFormat(s, e);
  const n = RULES[format].starters;
  const slots = Object.entries(sheet?.slots ?? {})
    .map(([k, id]) => [Number(k), id] as const)
    .filter((x): x is readonly [number, string] => !!x[1])
    .sort((a, b) => a[0] - b[0]);
  const shirt = new Map<string, number>();
  const starters: string[] = [];
  const bench: string[] = [];
  for (const [slot, id] of slots) {
    if (shirt.has(id)) continue;
    shirt.set(id, slot);
    (slot <= n ? starters : bench).push(id);
  }
  return { format, starters, bench, shirt, hasSheet: !!sheet && slots.length > 0 };
}

export function configFor(s: TeamSnapshot | null, e: TeamEvent, lineup: Lineup): MatchConfig {
  return matchConfig(lineup.format, e.settings ?? null, {
    starters: lineup.starters,
    bench: lineup.bench,
  });
}

/** Front-row cover: the sheet's slots 1–3 or anyone listing a front-row position. */
export function isFrontRower(s: TeamSnapshot | null, lineup: Lineup, id: string) {
  const slot = lineup.shirt.get(id);
  if (slot !== undefined && slot <= 3) return true;
  return isFrontRowCapable(s?.rows.members[id]?.positions ?? []);
}

export const TALLY_LABELS: Record<TallyKind, string> = {
  lineout_won: 'Lineout won',
  lineout_lost: 'Lineout lost',
  scrum_won: 'Scrum won',
  scrum_lost: 'Scrum lost',
  turnover_won: 'Turnover won',
  turnover_lost: 'Turnover conceded',
  restart_won: 'Restart won',
  restart_lost: 'Restart lost',
  tackle: 'Tackle made',
  missed_tackle: 'Tackle missed',
};

export const periodLabel = (period: number, tournament: boolean) => {
  if (period === 0) return 'Pre-match';
  const half = period % 2 === 1 ? '1st half' : '2nd half';
  return tournament ? `Game ${Math.ceil(period / 2)} · ${half}` : half;
};

export type Described = {
  title: string;
  detail?: string;
  tone: 'us' | 'them' | 'clock' | 'neutral' | 'warn' | 'danger';
};

/** Human copy for a timeline entry. */
export function describe(
  e: MatchEvent,
  ctx: { snap: TeamSnapshot | null; opponent: string; tournament: boolean; log: MatchEvent[] },
): Described {
  const p = e.payload;
  const who = (id: string | null | undefined) => (id ? memberName(ctx.snap, id) : undefined);
  const side = (t: 'us' | 'them') => (t === 'us' ? 'us' : 'them');
  switch (p.kind) {
    case 'period_start':
      return {
        title:
          p.period % 2 === 1
            ? ctx.tournament && p.period > 1
              ? `Game ${Math.ceil(p.period / 2)} kick-off`
              : 'Kick-off'
            : '2nd half under way',
        tone: 'clock',
      };
    case 'period_end':
      return {
        title:
          p.period % 2 === 1
            ? 'Half time'
            : ctx.tournament
              ? `Full time, game ${Math.ceil(p.period / 2)}`
              : 'Full time',
        tone: 'clock',
      };
    case 'time_off':
      return { title: 'Time off', detail: STOPPAGE_LABELS[p.reason], tone: 'clock' };
    case 'time_on':
      return { title: 'Time on', tone: 'clock' };
    case 'score':
      return {
        title:
          p.team === 'us'
            ? SCORE_LABELS[p.type]
            : `${ctx.opponent} ${SCORE_LABELS[p.type].toLowerCase()}`,
        detail: who(p.playerId),
        tone: side(p.team),
      };
    case 'penalty':
      return {
        title: p.side === 'for' ? 'Penalty to us' : `Penalty to ${ctx.opponent}`,
        detail:
          [
            p.offence ? OFFENCE_LABELS[p.offence] : null,
            who(p.playerId),
            p.outcome ? OUTCOME_LABELS[p.outcome] : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
        tone: p.side === 'for' ? 'us' : 'them',
      };
    case 'card':
      return {
        title: `${p.colour === 'yellow' ? 'Yellow' : 'Red'} card${p.team === 'them' ? `, ${ctx.opponent}` : ''}`,
        detail: who(p.playerId),
        tone: p.colour === 'yellow' ? 'warn' : 'danger',
      };
    case 'card_return': {
      const card = ctx.log.find((x) => x.id === p.cardId);
      const c = card?.payload.kind === 'card' ? card.payload : null;
      return {
        title: c?.team === 'them' ? `${ctx.opponent} back to full strength` : 'Back from the bin',
        detail: who(c?.playerId),
        tone: 'neutral',
      };
    }
    case 'sub':
      return {
        title: p.type === 'temporary' ? 'Temporary replacement' : 'Replacement',
        detail: `${who(p.onId)} on for ${who(p.offId)}`,
        tone: 'us',
      };
    case 'sub_return': {
      const sub = ctx.log.find((x) => x.id === p.subId);
      const s = sub?.payload.kind === 'sub' ? sub.payload : null;
      return {
        title: 'Back on',
        detail: s ? `${who(s.offId)} returns for ${who(s.onId)}` : undefined,
        tone: 'us',
      };
    }
    case 'tally':
      return { title: TALLY_LABELS[p.tally], detail: who(p.playerId), tone: 'neutral' };
    case 'edit':
      return { title: 'Correction', tone: 'neutral' };
    case 'void':
      return { title: 'Removed', tone: 'neutral' };
  }
}

/** Does this entry name one of our players (so the edit sheet can offer a player fix)? */
export function playerField(e: MatchEvent): 'playerId' | null {
  const p = e.payload;
  if (p.kind === 'score' && p.team === 'us') return 'playerId';
  if (p.kind === 'card' && p.team === 'us') return 'playerId';
  if (p.kind === 'penalty' || p.kind === 'tally') return 'playerId';
  return null;
}
