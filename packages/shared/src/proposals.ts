/**
 * Tentative games and events ("Not confirmed yet"). A proposal is a normal game or event (never a
 * practice) whose status is `proposed`. One date makes it a tentative item; 2–4 dates make it a
 * date poll. Members answer for themselves per date ("in" / "can't"); staff confirm one date
 * (everyone who was in becomes a "yes" asked to reconfirm) or drop it.
 */
import * as v from 'valibot';
import { Id, Millis } from './common';
import type { EventType } from './events';
import type { Format } from './rugby';
import { frontRowCover, scaledFrontRowCover, type FrontRowCover } from './sheets';

export const EVENT_STATUSES = ['confirmed', 'proposed', 'dropped'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const PROPOSAL_ANSWERS = ['in', 'cant'] as const;
export type ProposalAnswer = (typeof PROPOSAL_ANSWERS)[number];

export const MAX_OPTIONS = 4;
const DAY = 86400e3;

/** Confirmed events are the schedule. Rows cached before proposals existed have no status. */
export const isConfirmed = (e: { status?: EventStatus | null }) =>
  !e.status || e.status === 'confirmed';
export const isProposal = (e: { status?: EventStatus | null }) => e.status === 'proposed';
/** Games and events can be proposed; practices can't. */
export const canPropose = (type: EventType) => type !== 'training';

/** Initial team defaults for "players needed", per format. */
export const DEFAULT_PROPOSAL_TARGETS: Record<Format, number> = { '15s': 20, '7s': 10 };
export const ProposalTargets = v.object({
  '15s': v.pipe(v.number(), v.integer(), v.minValue(2), v.maxValue(60)),
  '7s': v.pipe(v.number(), v.integer(), v.minValue(2), v.maxValue(30)),
});
export type ProposalTargets = v.InferOutput<typeof ProposalTargets>;

/** Players needed for a proposal: its own override, else the team default for the format. */
export const proposalTarget = (
  targets: ProposalTargets | null | undefined,
  format: Format,
  override: number | null | undefined,
) => override ?? targets?.[format] ?? DEFAULT_PROPOSAL_TARGETS[format];

/** Default "answers by": a week from now, or two days before the first date if that's sooner. */
export function defaultAnswerBy(now: number, firstStart: number): number {
  const by = Math.min(now + 7 * DAY, firstStart - 2 * DAY);
  // Too close to call two days ahead: give people until a few hours before.
  return by > now ? by : Math.max(now + 3600e3, firstStart - 3 * 3600e3);
}
/** The "answer by" reminder goes out this long before the deadline (once per proposal). */
export const PROPOSAL_REMIND_BEFORE_MS = 2 * DAY;

export const ProposalOption = v.pipe(
  v.object({
    id: Id,
    startsAt: Millis,
    meetAt: v.optional(v.nullable(Millis), null),
    endsAt: v.optional(v.nullable(Millis), null),
    /** The date is set, the time isn't: `startsAt` is local noon, no meet or finish time. */
    timeTbd: v.optional(v.boolean(), false),
  }),
  v.check((o) => !o.endsAt || o.endsAt >= o.startsAt, 'Finish must be after the start'),
  v.check((o) => !o.meetAt || o.meetAt <= o.startsAt, 'Meet time must be before the start'),
  v.check(
    (o) => !o.timeTbd || (!o.meetAt && !o.endsAt),
    'No meet or finish time while the time is TBD',
  ),
);
export type ProposalOption = v.InferOutput<typeof ProposalOption>;

export const ProposalOptions = v.pipe(
  v.array(ProposalOption),
  v.minLength(1, 'Add a date'),
  v.maxLength(MAX_OPTIONS, `Up to ${MAX_OPTIONS} dates`),
  v.check((a) => new Set(a.map((o) => o.id)).size === a.length, 'Dates must be unique'),
);

/** Extra fields on events.create / events.update for proposals. */
export const proposalFields = {
  options: v.optional(ProposalOptions),
  answerBy: v.optional(v.nullable(Millis)),
  target: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(99)))),
  checkPositions: v.optional(v.boolean()),
};

/** `proposals.answer`: my answers, one per date ("None work" sends "cant" for every date). */
export const ProposalAnswerPut = v.object({
  answers: v.pipe(
    v.array(v.object({ optionId: Id, answer: v.picklist(PROPOSAL_ANSWERS) })),
    v.minLength(1),
    v.maxLength(MAX_OPTIONS),
  ),
});
export type ProposalAnswerPut = v.InferOutput<typeof ProposalAnswerPut>;

/**
 * `proposals.confirm`: the chosen date, plus a kick-off or meet time if it didn't have one. A
 * "Time TBD" date stays TBD unless `startsAt` sets its time (meet times need one).
 */
export const ProposalConfirm = v.object({
  optionId: Id,
  startsAt: v.optional(Millis),
  meetAt: v.optional(v.nullable(Millis)),
});
export type ProposalConfirm = v.InferOutput<typeof ProposalConfirm>;

/** Earliest first: the order dates are shown and the event's own start. */
export const byStart = <T extends { startsAt: number }>(a: T, b: T) => a.startsAt - b.startsAt;

/* ------------------------------ Date summary ------------------------------ */

export type OptionTally = {
  optionId: string;
  startsAt: number;
  in: number;
  cant: number;
  /** Front-row cover of the people who are in, when names are known and it's a game. */
  cover: FrontRowCover | null;
};

/**
 * Front-row cover for a proposal: the scaled Law 3 requirement for a matchday squad of the target
 * size (e.g. 20 → 5 front-rowers, 2 of them hookers), using the same rules as the availability
 * board and the team sheet.
 */
export function proposalCover(format: Format, target: number, inPositions: number[][]) {
  const bench = format === '15s' ? Math.max(0, target - 15) : 0;
  return frontRowCover(inPositions, scaledFrontRowCover(format, bench));
}

/**
 * The best date: the one that meets the target with full cover (if checked), the most people in
 * among those; otherwise simply the most in. Ties go to the earlier date. Null when nobody is in.
 */
export function bestOption(tallies: OptionTally[], target: number): string | null {
  const ok = (t: OptionTally) => t.in >= target && (!t.cover || t.cover.ok);
  const rank = [...tallies].sort(
    (a, b) => Number(ok(b)) - Number(ok(a)) || b.in - a.in || a.startsAt - b.startsAt,
  );
  return rank[0] && rank[0].in > 0 ? rank[0].optionId : null;
}
