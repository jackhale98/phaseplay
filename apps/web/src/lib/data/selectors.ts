/** Pure read helpers over the team snapshot. Screens derive from these with $derived. */
import {
  RULES,
  atRiskKit,
  bestOption,
  byStart,
  frontRowCover,
  isConfirmed,
  isGame,
  isProposal,
  playersSeeReplies,
  proposalCover,
  proposalTarget,
  type AnswerCounts,
  type EventOption,
  type FrontRowCover,
  type OptionTally,
  type ProposalAnswer,
  type InventoryItem,
  type KitRisk,
  groupOf,
  type Format,
  type Member,
  type PositionGroup,
  type Rsvp,
  type RsvpStatus,
  type TeamEvent,
  playsForTeam,
} from '@phaseplay/shared';
import type { LocalHandoff, TeamSnapshot } from './types';
import { answerKey, rsvpKey } from './types';

export const activeMembers = (s: TeamSnapshot | null): Member[] =>
  s
    ? Object.values(s.rows.members)
        .filter((m) => m.status === 'active')
        .sort(byName)
    : [];

/** Active + pending (staff see pending names; players never receive them). */
export const squad = (s: TeamSnapshot | null): Member[] =>
  s
    ? Object.values(s.rows.members)
        .filter((m) => m.status !== 'removed')
        .sort(byName)
    : [];

export const players = (s: TeamSnapshot | null): Member[] => squad(s).filter(playsForTeam);

export function byName(a: Member, b: Member) {
  return a.displayName.localeCompare(b.displayName);
}

export const memberName = (s: TeamSnapshot | null, id: string | null | undefined) =>
  (id && s?.rows.members[id]?.displayName) || 'Former member';

/** Every event on the schedule, proposals included (dropped ones are gone for good). */
export function allEvents(s: TeamSnapshot | null): TeamEvent[] {
  return s
    ? Object.values(s.rows.events)
        .filter((e) => !e.deletedAt && e.status !== 'dropped')
        .sort((a, b) => a.startsAt - b.startsAt)
    : [];
}

/**
 * The schedule: confirmed events only. Proposals ("Not confirmed yet") stay out of everything built
 * on this (Home's next event and replies, stats, kit, practice links, the board); screens that show
 * them use `proposals()`.
 */
export function events(s: TeamSnapshot | null): TeamEvent[] {
  return allEvents(s).filter(isConfirmed);
}

/** Events that haven't finished yet (ends_at, or start + 3 h). */
export function upcoming(s: TeamSnapshot | null, now = Date.now()): TeamEvent[] {
  return events(s).filter((e) => (e.endsAt ?? e.startsAt + 3 * 3600e3) > now);
}

export function past(s: TeamSnapshot | null, now = Date.now()): TeamEvent[] {
  return events(s)
    .filter((e) => (e.endsAt ?? e.startsAt + 3 * 3600e3) <= now)
    .reverse();
}

export const rsvpOf = (
  s: TeamSnapshot | null,
  eventId: string,
  memberId: string | undefined,
): Rsvp | undefined => (memberId ? s?.rows.rsvps[rsvpKey(eventId, memberId)] : undefined);

export function myRsvp(s: TeamSnapshot | null, eventId: string): RsvpStatus | null {
  return rsvpOf(s, eventId, s?.me.id)?.status ?? null;
}

export const eventFormat = (s: TeamSnapshot | null, e: TeamEvent): Format =>
  e.format ?? s?.team.defaultFormat ?? '15s';

export type Availability = {
  yes: Member[];
  maybe: Member[];
  no: Member[];
  none: Member[];
  byGroup: { group: PositionGroup; yes: number; maybe: number; total: number }[];
  warnings: string[];
  counts: { yes: number; no: number; maybe: number };
};

/** Availability board for staff (docs/design.md, PLAN.md M2). Players get counts only. */
export function availability(s: TeamSnapshot | null, e: TeamEvent): Availability {
  const ms = players(s);
  const out: Availability = {
    yes: [],
    maybe: [],
    no: [],
    none: [],
    byGroup: [],
    warnings: [],
    counts: { yes: 0, no: 0, maybe: 0 },
  };
  const status = (m: Member) => rsvpOf(s, e.id, m.id)?.status ?? null;
  for (const m of ms) out[status(m) ?? 'none'].push(m);
  const fmt = eventFormat(s, e);
  for (const g of RULES[fmt].groups) {
    const inGroup = ms.filter(
      (m) => m.positions[0] !== undefined && groupOf(fmt, m.positions[0]) === g,
    );
    out.byGroup.push({
      group: g,
      yes: inGroup.filter((m) => status(m) === 'yes').length,
      maybe: inGroup.filter((m) => status(m) === 'maybe').length,
      total: inGroup.length,
    });
  }
  // The same front-row rule as proposals and team sheets (packages/shared frontRowCover).
  const cover = frontRowCover(
    out.yes.map((m) => m.positions),
    RULES[fmt].frontRowCover,
  );
  const frontRow = cover.capable;
  const need = cover.need;
  if ((e.type === 'match' || e.type === 'tournament') && frontRow < need)
    out.warnings.push(
      `Only ${frontRow} available front-rower${frontRow === 1 ? '' : 's'} (need ${need})`,
    );
  if ((e.type === 'match' || e.type === 'tournament') && out.yes.length < RULES[fmt].starters)
    out.warnings.push(
      `Only ${out.yes.length} available, short of a starting ${fmt === '15s' ? 'XV' : 'VII'}`,
    );
  const counts = s?.rows.counts[e.id];
  out.counts = counts ?? { yes: out.yes.length, no: out.no.length, maybe: out.maybe.length };
  return out;
}

export const sheetFor = (s: TeamSnapshot | null, eventId: string) =>
  s ? Object.values(s.rows.sheets).find((x) => x.eventId === eventId) : undefined;

export const planFor = (s: TeamSnapshot | null, eventId: string) =>
  s ? Object.values(s.rows.plans).find((p) => p.eventId === eventId && !p.deletedAt) : undefined;

/* ---------------------------------- Kit ---------------------------------- */

/** The team's kit (not deleted), by kind then name. */
export const kitItems = (s: TeamSnapshot | null): InventoryItem[] =>
  Object.values(s?.rows.items ?? {})
    .filter((i) => !i.deletedAt)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

/** Handovers still waiting for an answer (expired ones drop out). */
export const openHandoffs = (s: TeamSnapshot | null, now = Date.now()): LocalHandoff[] =>
  Object.values(s?.rows.handoffs ?? {})
    .filter((h) => !h.resolvedAt && h.expiresAt > now && s?.rows.items?.[h.itemId])
    .sort((a, b) => a.createdAt - b.createdAt);

export const handoffFor = (s: TeamSnapshot | null, itemId: string, now = Date.now()) =>
  openHandoffs(s, now).find((h) => h.itemId === itemId);

/** Kit someone wants to hand me. */
export const incomingHandoffs = (s: TeamSnapshot | null, now = Date.now()) =>
  openHandoffs(s, now).filter((h) => h.toMemberId === s?.me.id);

export const heldBy = (s: TeamSnapshot | null, memberId: string | undefined) =>
  kitItems(s).filter((i) => i.status === 'with_someone' && i.holderMemberId === memberId);

/** Kit held by people who are out of, or haven't replied to, an event in the next 7 days. */
export const kitAtRisk = (s: TeamSnapshot | null, now = Date.now()): KitRisk[] =>
  s ? atRiskKit(kitItems(s), events(s), Object.values(s.rows.rsvps), now) : [];

/** Kit tagged for game days that's still in service. */
export const matchDayKit = (s: TeamSnapshot | null) =>
  kitItems(s).filter(
    (i) => i.matchDay && (i.status === 'available' || i.status === 'with_someone'),
  );

/* ------------------------------- Proposals ------------------------------- */

/** A proposal's live dates, earliest first. */
export const optionsOf = (s: TeamSnapshot | null, eventId: string): EventOption[] =>
  Object.values(s?.rows.options ?? {})
    .filter((o) => o.eventId === eventId && !o.deletedAt)
    .sort(byStart);

/** Proposals ("Not confirmed yet") with at least one date still to come, earliest first. */
export function proposals(s: TeamSnapshot | null, now = Date.now()): TeamEvent[] {
  return allEvents(s).filter(
    (e) =>
      isProposal(e) && optionsOf(s, e.id).some((o) => (o.endsAt ?? o.startsAt + 3 * 3600e3) > now),
  );
}

export const myAnswer = (s: TeamSnapshot | null, optionId: string): ProposalAnswer | null =>
  (s && s.rows.answers?.[answerKey(optionId, s.me.id)]?.answer) || null;

export type OptionView = {
  option: EventOption;
  counts: AnswerCounts;
  mine: ProposalAnswer | null;
  /** Who's in / can't, when the viewer may see names. */
  inPeople: Member[];
  cantPeople: Member[];
  /** Front-row cover of those in (proposed games with the check on, names visible). */
  cover: FrontRowCover | null;
};
export type ProposalView = {
  event: TeamEvent;
  kind: 'tentative' | 'poll';
  options: OptionView[];
  target: number;
  /** The date to go for (meets the target with cover, else most in), when anyone is in. */
  best: string | null;
  /** Can the viewer see names (and cover)? Staff always; players per the team reply setting. */
  names: boolean;
  /** Every date has my answer. */
  answered: boolean;
  /** I answered some dates but a newer one is waiting (a coach added a date). */
  newDate: boolean;
  /** Members who haven't answered any date (for the nudge; names visible only). */
  unanswered: Member[];
};

export function proposalView(s: TeamSnapshot | null, e: TeamEvent, staff: boolean): ProposalView {
  const opts = optionsOf(s, e.id);
  const fmt = eventFormat(s, e);
  const target = proposalTarget(s?.team.proposalTargets, fmt, e.target);
  const names = staff || playersSeeReplies(s?.team.rsvpVisibility, e.type);
  const people = squad(s);
  const answers = Object.values(s?.rows.answers ?? {}).filter((a) => a.eventId === e.id);
  const check = isGame(e.type) && e.checkPositions !== false && names;
  const options: OptionView[] = opts.map((option) => {
    const mine = myAnswer(s, option.id);
    const of = (x: ProposalAnswer) =>
      names
        ? people.filter((m) =>
            answers.some((a) => a.optionId === option.id && a.memberId === m.id && a.answer === x),
          )
        : [];
    const inPeople = of('in');
    const cantPeople = of('cant');
    // Counts come from the server; before the first sync after an answer, use what we can see.
    const counts = s?.rows.answerCounts?.[option.id] ?? {
      in: names ? inPeople.length : mine === 'in' ? 1 : 0,
      cant: names ? cantPeople.length : mine === 'cant' ? 1 : 0,
    };
    const cover = check
      ? proposalCover(
          fmt,
          target,
          inPeople.map((m) => m.positions),
        )
      : null;
    return { option, counts, mine, inPeople, cantPeople, cover };
  });
  const tallies: OptionTally[] = options.map((o) => ({
    optionId: o.option.id,
    startsAt: o.option.startsAt,
    in: o.counts.in,
    cant: o.counts.cant,
    cover: o.cover,
  }));
  const answeredSome = options.some((o) => o.mine);
  const answered = options.length > 0 && options.every((o) => o.mine);
  const who = new Set(answers.map((a) => a.memberId));
  return {
    event: e,
    kind: opts.length > 1 ? 'poll' : 'tentative',
    options,
    target,
    best: opts.length ? bestOption(tallies, target) : null,
    names,
    answered,
    newDate: answeredSome && !answered,
    unanswered: names ? people.filter((m) => m.status === 'active' && !who.has(m.id)) : [],
  };
}

/** Proposals still waiting for my answer (a date I haven't answered). */
export const needMyAnswer = (s: TeamSnapshot | null, now = Date.now()) =>
  proposals(s, now).filter((e) =>
    optionsOf(s, e.id).some((o) => o.startsAt > now && !myAnswer(s, o.id)),
  );

/** Confirmed events I was put down for from a proposal, waiting for my "Still in?". */
export const toReconfirm = (s: TeamSnapshot | null, now = Date.now()) =>
  upcoming(s, now).filter((e) => !e.cancelledAt && rsvpOf(s, e.id, s?.me.id)?.reconfirm);
