import * as v from 'valibot';
import { HHMM, Id, IsoDate, Millis, OptionalText, Url, text } from './common';
import { FORMATS } from './rugby';

export const EVENT_TYPES = [
  'training',
  'match',
  'tournament',
  'social',
  'fundraiser',
  'meeting',
  'other',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  training: 'Practice',
  match: 'Game',
  tournament: 'Tournament',
  social: 'Social',
  fundraiser: 'Fundraiser',
  meeting: 'Meeting',
  other: 'Event',
};

/**
 * Every event type belongs to one of three schedule categories, so the schedule can be filtered
 * by Games / Practices / Events (gatherings, fundraisers, meetings and anything else).
 */
export const EVENT_CATEGORIES = ['games', 'practices', 'events'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  games: 'Games',
  practices: 'Practices',
  events: 'Events',
};
const CATEGORY_OF: Record<EventType, EventCategory> = {
  match: 'games',
  tournament: 'games',
  training: 'practices',
  social: 'events',
  fundraiser: 'events',
  meeting: 'events',
  other: 'events',
};
export const eventCategory = (type: EventType): EventCategory => CATEGORY_OF[type];
export const typesInCategory = (c: EventCategory): EventType[] =>
  EVENT_TYPES.filter((t) => CATEGORY_OF[t] === c);
/** Games get opponents, formats, team sheets and match mode. */
export const isGame = (type: EventType) => CATEGORY_OF[type] === 'games';

export const MatchSettings = v.object({
  halfMinutes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(60))),
  sinBinMinutes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20))),
  replacements: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(12))),
  frontRowCover: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(8))),
  redCardMode: v.optional(v.picklist(['permanent', 'replace_after_20'])),
  points: v.optional(
    v.object({
      try: v.number(),
      conversion: v.number(),
      penalty_goal: v.number(),
      drop_goal: v.number(),
      penalty_try: v.number(),
    }),
  ),
});
export type MatchSettings = v.InferOutput<typeof MatchSettings>;

const eventFields = {
  seasonId: v.optional(v.nullable(Id), null),
  type: v.picklist(EVENT_TYPES),
  format: v.optional(v.nullable(v.picklist(FORMATS)), null),
  title: text(80, 1),
  startsAt: Millis,
  meetAt: v.optional(v.nullable(Millis), null),
  endsAt: v.optional(v.nullable(Millis), null),
  locationName: OptionalText(120),
  locationUrl: v.optional(v.nullable(Url), null),
  opponent: OptionalText(80),
  notes: OptionalText(2000),
  rsvpDeadline: v.optional(v.nullable(Millis), null),
  settings: v.optional(v.nullable(MatchSettings), null),
};

export const EventCreate = v.pipe(
  v.object({ id: Id, ...eventFields }),
  v.check((e) => !e.endsAt || e.endsAt >= e.startsAt, 'Finish must be after the start'),
  v.check((e) => !e.meetAt || e.meetAt <= e.startsAt, 'Meet time must be before the start'),
);
export type EventCreate = v.InferOutput<typeof EventCreate>;

export const EventUpdate = v.object({
  ...v.partial(v.object(eventFields)).entries,
  cancelled: v.optional(v.boolean()),
});
export type EventUpdate = v.InferOutput<typeof EventUpdate>;

export const RecurrenceRule = v.object({
  weekdays: v.pipe(
    v.array(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(6))),
    v.minLength(1, 'Pick at least one day'),
    v.maxLength(7),
  ),
  time: HHMM,
  durationMin: v.pipe(v.number(), v.integer(), v.minValue(15), v.maxValue(300)),
  meetBeforeMin: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(120)), 0),
  startsOn: IsoDate,
  until: IsoDate,
});
export type RecurrenceRule = v.InferOutput<typeof RecurrenceRule>;

export const RecurrenceCreate = v.pipe(
  v.object({
    id: Id,
    rule: RecurrenceRule,
    title: text(80, 1),
    locationName: OptionalText(120),
    locationUrl: v.optional(v.nullable(Url), null),
    notes: OptionalText(2000),
    seasonId: v.optional(v.nullable(Id), null),
  }),
  v.check((r) => r.rule.until >= r.rule.startsOn, 'End date must be after the start date'),
  v.check(
    (r) => Date.parse(r.rule.until) - Date.parse(r.rule.startsOn) <= 366 * 86400e3,
    'A series can run for up to a year',
  ),
);
export type RecurrenceCreate = v.InferOutput<typeof RecurrenceCreate>;

export const RSVP_STATUSES = ['yes', 'no', 'maybe'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const RsvpPut = v.object({
  status: v.picklist(RSVP_STATUSES),
  note: v.optional(v.nullable(text(280)), null),
});
export type RsvpPut = v.InferOutput<typeof RsvpPut>;

export const AttendancePut = v.object({
  entries: v.pipe(
    v.array(v.object({ memberId: Id, attended: v.nullable(v.boolean()) })),
    v.maxLength(200),
  ),
});

/** D1 allows 50 queries per invocation (free plan); clients send imports in chunks. */
export const IMPORT_CHUNK = 40;
export const ImportInput = v.object({
  events: v.pipe(v.array(v.object({ id: Id, ...eventFields })), v.maxLength(IMPORT_CHUNK)),
  members: v.pipe(
    v.array(
      v.object({
        id: Id,
        displayName: text(40, 1),
        jersey: v.optional(v.nullable(v.number())),
        positions: v.optional(v.array(v.number()), []),
      }),
    ),
    v.maxLength(IMPORT_CHUNK),
  ),
});
export type ImportInput = v.InferOutput<typeof ImportInput>;

export const RSVP_NOTE_TTL_MS = 30 * 86400e3;
