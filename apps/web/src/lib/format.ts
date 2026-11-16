/** Date/time formatting in the team's timezone (events always show their timezone). */
const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts });
    cache.set(key, f);
  }
  return f;
}

export const time = (ms: number, tz: string) => fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(ms);
export const day = (ms: number, tz: string) => fmt(tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
export const longDay = (ms: number, tz: string) => fmt(tz, { weekday: 'long', day: 'numeric', month: 'long' }).format(ms);
export const dateTime = (ms: number, tz: string) => `${day(ms, tz)}, ${time(ms, tz)}`;
export const monthYear = (ms: number, tz: string) => fmt(tz, { month: 'long', year: 'numeric' }).format(ms);

export function tzName(tz: string, at = Date.now()) {
  return fmt(tz, { timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? tz;
}

/** YYYY-MM-DD in tz (for grouping). */
export function ymd(ms: number, tz: string) {
  const p = Object.fromEntries(fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function relDay(ms: number, tz: string, now = Date.now()) {
  const a = ymd(ms, tz);
  if (a === ymd(now, tz)) return 'Today';
  if (a === ymd(now + 86400e3, tz)) return 'Tomorrow';
  if (a === ymd(now - 86400e3, tz)) return 'Yesterday';
  const diff = (ms - now) / 86400e3;
  if (diff > 0 && diff < 6) return fmt(tz, { weekday: 'long' }).format(ms);
  return day(ms, tz);
}

/** Monday-based week label, e.g. "This week", "Next week", "Week of 24 Nov". */
export function weekLabel(ms: number, tz: string, now = Date.now()) {
  const start = (x: number) => {
    const d = new Date(ymd(x, tz) + 'T00:00:00Z');
    const dow = (d.getUTCDay() + 6) % 7;
    return d.getTime() - dow * 86400e3;
  };
  const w = (start(ms) - start(now)) / (7 * 86400e3);
  if (w === 0) return 'This week';
  if (w === 1) return 'Next week';
  if (w === -1) return 'Last week';
  return `Week of ${fmt('UTC', { day: 'numeric', month: 'short' }).format(start(ms))}`;
}

export function ago(ms: number, now = Date.now()) {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function plural(n: number, one: string, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

/** Convert an <input type="datetime-local"> value interpreted in tz to UTC ms. */
export function fromLocalInput(value: string, tz: string): number {
  const [date, t] = value.split('T') as [string, string];
  const guess = Date.parse(`${date}T${t}:00Z`);
  const offset = (at: number) => {
    const p = Object.fromEntries(
      fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(at)
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - Math.floor(at / 1000) * 1000;
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

/** UTC ms → value for <input type="datetime-local"> in tz. */
export function toLocalInput(ms: number, tz: string): string {
  const p = Object.fromEntries(
    fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
