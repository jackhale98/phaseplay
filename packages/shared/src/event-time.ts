/**
 * "Time TBD": a game or event (never a practice) can be on the schedule with its date set and its
 * time still to be decided. Such an event stores `starts_at` as local noon of that date in the
 * team's timezone (so the date never shifts across zones or DST), has no meet or finish time, and
 * counts as running until the end of its local day. Every place that shows a time, sorts the
 * schedule or works out when an event is over uses these helpers (API and web alike).
 */
import type { EventType } from './events';
import { addDays, dateInTz, zonedToUtc } from './time';

/** The bits of an event (or a proposal's date) these helpers need. */
export type EventTime = {
  startsAt: number;
  endsAt?: number | null;
  /** Rows cached before "Time TBD" existed have no flag: they have a time. */
  timeTbd?: boolean | null;
};

export const TIME_TBD_LABEL = 'Time TBD';
/** Where space is tight (month-view pills, date chips). */
export const TIME_TBD_SHORT = 'TBD';

/** Practices always need a time; games and every other kind of event can be "Time TBD". */
export const canTimeTbd = (type: EventType) => type !== 'training';
export const isTimeTbd = (e: { timeTbd?: boolean | null }) => e.timeTbd === true;

/** `starts_at` of a date whose time is still to be decided: local noon on that date in `tz`. */
export const tbdStartsAt = (date: string, tz: string) => zonedToUtc(date, '12:00', tz);

/** The first instant of the next local day in `tz` (the end of the day `at` falls on). */
export const endOfLocalDay = (at: number, tz: string) =>
  zonedToUtc(addDays(dateInTz(at, tz), 1), '00:00', tz);

/** How long an event with no finish time is taken to run (it stays "upcoming" until then). */
export const DEFAULT_EVENT_MS = 3 * 3600e3;

/**
 * When an event is over: a "Time TBD" event at the end of its local day, otherwise its finish
 * time, or its start plus `fallbackMs`.
 */
export function eventEndsAt(e: EventTime, tz: string, fallbackMs = DEFAULT_EVENT_MS): number {
  if (isTimeTbd(e)) return endOfLocalDay(e.startsAt, tz);
  return e.endsAt ?? e.startsAt + fallbackMs;
}

/** Sort key for the schedule: a "Time TBD" event comes after the timed events of its day. */
export const eventSortKey = (e: EventTime, tz: string) =>
  isTimeTbd(e) ? endOfLocalDay(e.startsAt, tz) - 1 : e.startsAt;

/** Earliest first, "Time TBD" after the timed events of the same day. Keys are worked out once. */
export function sortByEventStart<T extends EventTime>(list: T[], tz: string): T[] {
  const keyed = list.map((e) => [eventSortKey(e, tz), e] as const);
  keyed.sort((a, b) => a[0] - b[0]);
  return keyed.map((x) => x[1]);
}

const clocks = new Map<string, Intl.DateTimeFormat>();
/** "2:30 PM" / "14:30" in `tz` (`locale` undefined = the device's). */
export function clockText(ms: number, tz: string, locale?: string): string {
  const key = `${locale ?? ''}|${tz}`;
  let f = clocks.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: 'numeric', minute: '2-digit' });
    } catch {
      f = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
    }
    clocks.set(key, f);
  }
  return f.format(ms);
}

/** "Time TBD" (or "TBD" with `short`), else the start time, e.g. "2:30 PM". */
export function eventTimeLabel(
  e: EventTime,
  tz: string,
  opts: { short?: boolean; locale?: string } = {},
): string {
  if (isTimeTbd(e)) return opts.short ? TIME_TBD_SHORT : TIME_TBD_LABEL;
  return clockText(e.startsAt, tz, opts.locale);
}

/** What a time change says: "Time set: 2:30 PM", "Time now TBD", or null if the time stayed. */
export function timeChangeText(
  before: EventTime,
  after: EventTime,
  tz: string,
  locale?: string,
): string | null {
  const was = isTimeTbd(before);
  const now = isTimeTbd(after);
  if (was && !now) return `Time set: ${clockText(after.startsAt, tz, locale)}`;
  if (!was && now) return 'Time now TBD';
  return null;
}

/** Hasn't started yet: a "Time TBD" event is still to come until its day is over. */
export const stillToCome = (e: EventTime, tz: string, now: number) =>
  isTimeTbd(e) ? endOfLocalDay(e.startsAt, tz) > now : e.startsAt > now;
