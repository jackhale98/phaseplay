/** Timezone helpers that work in browsers and Workers using only Intl. */

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function partsIn(tz: string, at: number) {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    });
    partsFmt.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(at))) o[p.type] = p.value;
  return o;
}

/** Offset of `tz` from UTC at instant `at`, in ms (e.g. +3600000 for BST). */
export function tzOffsetMs(tz: string, at: number): number {
  const p = partsIn(tz, at);
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Convert a wall-clock date and time in `tz` to a UTC instant. Handles DST transitions. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMs(tz, guess - tzOffsetMs(tz, guess));
  const first = guess - off;
  off = tzOffsetMs(tz, first);
  return guess - off;
}

/** YYYY-MM-DD of instant `at` in `tz`. */
export function dateInTz(at: number, tz: string): string {
  const p = partsIn(tz, at);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Day of week (0 = Sunday) of a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Expand a weekly rule to occurrence dates (inclusive). */
export function weeklyDates(startsOn: string, until: string, weekdays: number[]): string[] {
  const out: string[] = [];
  for (let d = startsOn; d <= until; d = addDays(d, 1))
    if (weekdays.includes(weekdayOf(d))) out.push(d);
  return out;
}
