/** Pure schedule helpers: filtering, grouping, month grid, form defaults. */
import {
  EVENT_CATEGORIES,
  eventCategory,
  isGame,
  addDays,
  dateInTz,
  weekdayOf,
  zonedToUtc,
  eventTimeLabel,
  isTimeTbd,
  type EventCategory,
  type EventTime,
  type TeamEvent,
} from '@phaseplay/shared';
import { weekLabel, ymd, day } from '#lib/format';

export type Show = 'all' | EventCategory;
export const SHOWS: Show[] = ['all', ...EVENT_CATEGORIES];
export const parseShow = (v: string | null): Show =>
  SHOWS.includes(v as Show) ? (v as Show) : 'all';

export const displayTitle = (e: TeamEvent, teamShort?: string) =>
  e.type === 'match' && e.opponent ? `${teamShort ? `${teamShort} ` : ''}v ${e.opponent}` : e.title;

export function matches(e: TeamEvent, show: Show, q: string): boolean {
  if (show !== 'all' && eventCategory(e.type) !== show) return false;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [e.title, e.opponent, e.locationName].some((x) => x?.toLowerCase().includes(needle));
}

export function countByCategory(list: TeamEvent[], q = ''): Record<Show, number> {
  const out: Record<Show, number> = { all: 0, games: 0, practices: 0, events: 0 };
  for (const e of list) {
    if (!matches(e, 'all', q)) continue;
    out.all++;
    out[eventCategory(e.type)]++;
  }
  return out;
}

export function groupByWeek(list: TeamEvent[], tz: string, now = Date.now()) {
  const groups: { label: string; events: TeamEvent[] }[] = [];
  for (const e of list) {
    const label = weekLabel(e.startsAt, tz, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.events.push(e);
    else groups.push({ label, events: [e] });
  }
  return groups;
}

/** Monday-first 6×7 grid of YYYY-MM-DD dates covering the month of `monthStart` (YYYY-MM-01). */
export function monthGrid(monthStart: string): string[] {
  const dow = (weekdayOf(monthStart) + 6) % 7;
  const first = addDays(monthStart, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export const monthOf = (date: string) => `${date.slice(0, 7)}-01`;
export function shiftMonth(monthStart: string, n: number): string {
  const [y, m] = monthStart.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

export function byDay(list: TeamEvent[], tz: string): Map<string, TeamEvent[]> {
  const out = new Map<string, TeamEvent[]>();
  for (const e of list) {
    const k = ymd(e.startsAt, tz);
    const arr = out.get(k);
    if (arr) arr.push(e);
    else out.set(k, [e]);
  }
  return out;
}

/** "Starts in the past or later today" — when attendance makes sense. */
export const attendanceOpen = (e: TeamEvent, tz: string, now = Date.now()) =>
  e.startsAt <= now || ymd(e.startsAt, tz) === ymd(now, tz);

export const mapLink = (e: Pick<TeamEvent, 'locationName' | 'locationUrl'>) =>
  e.locationUrl ??
  (e.locationName
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.locationName)}`
    : null);

/** Next date (in tz) on the given weekday (0 = Sunday), strictly after today. */
export function nextWeekday(weekday: number, tz: string, now = Date.now()): string {
  const today = dateInTz(now, tz);
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today, i);
    if (weekdayOf(d) === weekday) return d;
  }
  return addDays(today, 1);
}

/** "HH:MM" of an instant in tz. */
export function hhmm(ms: number, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  );
  return `${p.hour}:${p.minute}`;
}

/** "HH:MM" plus `min` minutes (wraps within the day). */
export function addMinutes(t: string, min: number): string {
  const [h, m] = t.split(':').map(Number) as [number, number];
  const x = (((h * 60 + m + min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
}

export const minutesBetween = (a: string, b: string) => {
  const [ah, am] = a.split(':').map(Number) as [number, number];
  const [bh, bm] = b.split(':').map(Number) as [number, number];
  return bh * 60 + bm - (ah * 60 + am);
};

/** Wall-clock (date, HH:MM) in tz → UTC ms; a finish earlier than the start rolls to the next day. */
export function at(date: string, t: string, tz: string) {
  return zonedToUtc(date, t, tz);
}

export type FormValues = {
  type: TeamEvent['type'];
  title: string;
  opponent: string;
  format: '15s' | '7s';
  date: string;
  /** "Time TBD": the date is set, the time isn't (start, meet and finish are then empty). */
  tbd: boolean;
  start: string;
  meet: string;
  finish: string;
  locationName: string;
  locationUrl: string;
  notes: string;
  deadline: string;
  halfMinutes: number;
  sinBinMinutes: number;
  replacements: number;
  repeat: boolean;
  weekdays: number[];
  until: string;
};

/** "Moved from Sat 6 Sep, 3:00 pm." first line in notes drives the rescheduled banner. */
export const MOVED_RE = /^Moved from ([^\n]+?)\.(?:\n|$)/;
export function movedNote(prev: EventTime, tz: string, notes: string | null): string {
  const rest = (notes ?? '').replace(MOVED_RE, '').trimStart();
  return `Moved from ${day(prev.startsAt, tz)}, ${eventTimeLabel(prev, tz)}.${rest ? `\n${rest}` : ''}`;
}

/**
 * Moved to another day or time? A "Time TBD" event (before or after) has only a date, so setting
 * its time on the same day isn't a move.
 */
export function isMove(prev: EventTime, next: EventTime, tz: string): boolean {
  if (isTimeTbd(prev) || isTimeTbd(next))
    return dateInTz(prev.startsAt, tz) !== dateInTz(next.startsAt, tz);
  return prev.startsAt !== next.startsAt;
}

/**
 * The team's usual start time for this kind of event ("HH:MM", the most common among its timed
 * games, practices or events; the latest wins a tie), or null when there's none yet.
 */
export function usualStart(list: TeamEvent[], type: TeamEvent['type'], tz: string): string | null {
  const cat = eventCategory(type);
  const n = new Map<string, number>();
  for (const e of list)
    if (eventCategory(e.type) === cat && !isTimeTbd(e) && !e.cancelledAt && !e.deletedAt) {
      const k = hhmm(e.startsAt, tz);
      n.set(k, (n.get(k) ?? 0) + 1);
    }
  let best: string | null = null;
  for (const [k, c] of n) if (best === null || c >= n.get(best)!) best = k;
  return best;
}
export const movedFrom = (notes: string | null) => notes?.match(MOVED_RE)?.[1] ?? null;
export const notesBody = (notes: string | null) => (notes ?? '').replace(MOVED_RE, '').trim();

export { isGame };
