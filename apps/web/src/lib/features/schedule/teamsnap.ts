/**
 * Map TeamSnap (and similar) CSV exports onto Phaseplay import rows. Columns are matched by
 * header name, case- and punctuation-insensitively, so exports from other tools mostly work too.
 * Pure functions only, so the whole pipeline is unit-tested.
 */
import { POSITIONS_15, zonedToUtc, type EventType } from '@phaseplay/shared';
import type { CsvTable } from './csv';

export type ImportKind = 'schedule' | 'roster';
export type ScheduleField =
  | 'date'
  | 'time'
  | 'endTime'
  | 'arrival'
  | 'duration'
  | 'name'
  | 'opponent'
  | 'type'
  | 'homeAway'
  | 'location'
  | 'address'
  | 'notes';
export type RosterField = 'first' | 'last' | 'fullName' | 'jersey' | 'position' | 'nonPlayer';
export type Mapping<F extends string> = Partial<Record<F, number>>;

export const SCHEDULE_FIELDS: { key: ScheduleField; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'time', label: 'Start time' },
  { key: 'endTime', label: 'End time' },
  { key: 'arrival', label: 'Arrival / meet time' },
  { key: 'duration', label: 'Duration' },
  { key: 'name', label: 'Event name' },
  { key: 'opponent', label: 'Opponent' },
  { key: 'type', label: 'Event type' },
  { key: 'homeAway', label: 'Home or away' },
  { key: 'location', label: 'Location' },
  { key: 'address', label: 'Address' },
  { key: 'notes', label: 'Notes' },
];
export const ROSTER_FIELDS: { key: RosterField; label: string; required?: boolean }[] = [
  { key: 'first', label: 'First name' },
  { key: 'last', label: 'Last name' },
  { key: 'fullName', label: 'Full name' },
  { key: 'jersey', label: 'Jersey number' },
  { key: 'position', label: 'Position' },
  { key: 'nonPlayer', label: 'Non-player flag' },
];

const SCHEDULE_ALIASES: Record<ScheduleField, string[]> = {
  date: ['date', 'start date', 'event date', 'game date', 'day'],
  time: ['time', 'start time', 'start', 'kickoff', 'kick off', 'event time', 'game time'],
  endTime: ['end time', 'end', 'finish', 'finish time'],
  arrival: ['arrival time', 'arrival', 'arrive', 'arrive by', 'meet time', 'meet'],
  duration: ['duration', 'length', 'duration minutes', 'duration (minutes)'],
  name: ['name', 'event name', 'event', 'title', 'label', 'short label', 'event label'],
  opponent: ['opponent', 'opponent name', 'opposition', 'versus', 'vs'],
  type: ['type', 'event type', 'game type', 'game or event', 'is game', 'category'],
  homeAway: ['home or away', 'home/away', 'home away', 'home-away', 'h/a', 'home'],
  location: ['location', 'location name', 'venue', 'field', 'ground', 'place'],
  address: ['location address', 'address', 'venue address'],
  notes: ['notes', 'note', 'description', 'details', 'additional info', 'comments'],
};
const ROSTER_ALIASES: Record<RosterField, string[]> = {
  first: ['first name', 'first', 'firstname', 'given name', 'forename'],
  last: ['last name', 'last', 'lastname', 'surname', 'family name'],
  fullName: ['name', 'full name', 'player name', 'player', 'member name', 'member'],
  jersey: ['jersey number', 'jersey', 'number', 'shirt number', 'shirt', '#', 'no', 'no.'],
  position: ['position', 'positions', 'pos', 'primary position'],
  nonPlayer: ['non-player', 'non player', 'nonplayer', 'is non-player', 'member type', 'role'],
};

export const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/[^a-z0-9#/ -]/g, '')
    .trim();

function autoMap<F extends string>(headers: string[], aliases: Record<F, string[]>): Mapping<F> {
  const out: Mapping<F> = {};
  const used = new Set<number>();
  const hs = headers.map(norm);
  // Exact alias matches first, in alias priority order, then "contains" matches.
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of Object.keys(aliases) as F[]) {
      if (out[f] !== undefined) continue;
      for (const a of aliases[f]) {
        const i = hs.findIndex(
          (h, j) => !used.has(j) && (pass === 'exact' ? h === a : a.length > 3 && h.includes(a)),
        );
        if (i >= 0) {
          out[f] = i;
          used.add(i);
          break;
        }
      }
    }
  }
  return out;
}

export const mapSchedule = (headers: string[]) => autoMap(headers, SCHEDULE_ALIASES);
export const mapRoster = (headers: string[]) => autoMap(headers, ROSTER_ALIASES);

export function detectKind(headers: string[]): ImportKind {
  const r = mapRoster(headers);
  const s = mapSchedule(headers);
  const rosterScore =
    (r.first !== undefined ? 2 : 0) +
    (r.last !== undefined ? 2 : 0) +
    (r.jersey !== undefined ? 1 : 0);
  const scheduleScore =
    (s.date !== undefined ? 3 : 0) +
    (s.opponent !== undefined ? 1 : 0) +
    (s.time !== undefined ? 1 : 0);
  return rosterScore > scheduleScore ? 'roster' : 'schedule';
}

/** Whether the mapping has what it needs; otherwise the UI opens the column-mapping step. */
export function mappingComplete(kind: ImportKind, m: Mapping<string>): boolean {
  if (kind === 'schedule') return m.date !== undefined;
  return m.fullName !== undefined || m.first !== undefined || m.last !== undefined;
}

// ---------------------------------------------------------------------------------------------
// Dates and times

export type DateOrder = 'dmy' | 'mdy';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) => {
  if (!(y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const year = (y: number) => (y < 100 ? 2000 + y : y);

/** Look at all numeric dates to decide day/month order; falls back to the given default. */
export function detectDateOrder(values: string[], fallback: DateOrder): DateOrder {
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (!m) continue;
    if (+m[1]! > 12) return 'dmy';
    if (+m[2]! > 12) return 'mdy';
  }
  return fallback;
}

/** Parse many common date spellings to YYYY-MM-DD, or null. */
export function parseDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const [a, b, y] = [+m[1]!, +m[2]!, year(+m[3]!)];
    return order === 'dmy' ? valid(y, b, a) : valid(y, a, b);
  }
  // "Sat, Sep 6, 2025", "September 6 2025", "6 Sep 2025", "Saturday 6th September 2025"
  const words = s
    .replace(/,/g, ' ')
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .split(/\s+/);
  let mon = -1;
  const nums: number[] = [];
  for (const w of words) {
    const mi = MONTHS.indexOf(w.slice(0, 3));
    if (mi >= 0 && /^[a-z]+$/.test(w)) mon = mi + 1;
    else if (/^\d+$/.test(w)) nums.push(+w);
  }
  if (mon > 0 && nums.length >= 2) {
    const y = nums.find((n) => n > 31);
    const d = nums.find((n) => n <= 31);
    if (y && d) return valid(year(y), mon, d);
  }
  return null;
}

/** "7:00 PM", "19:00", "7pm", "19.30", "7:00:00 PM" → "HH:MM", or null. */
export function parseTime(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!s || /^(tbd|tba|tbc)$/.test(s)) return null;
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = +m[1]!;
  const min = m[2] ? +m[2] : 0;
  const ap = m[3]?.[0];
  if (!m[2] && !ap) return null; // a bare number is too ambiguous
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** "90", "1:30", "1h 30m", "2 hours" → minutes, or null. */
export function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d+):(\d{2})$/);
  if (m) return +m[1]! * 60 + +m[2]!;
  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/);
  if (m && (m[1] || m[2])) return Math.round(+(m[1] ?? 0) * 60 + +(m[2] ?? 0));
  if (/^\d+$/.test(s)) return +s;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Rows

export type ImportEvent = {
  type: EventType;
  title: string;
  startsAt: number;
  meetAt: number | null;
  endsAt: number | null;
  opponent: string | null;
  locationName: string | null;
  notes: string | null;
  /** Shown in the preview, e.g. "No time given, set to 10:00". */
  warning: string | null;
};
export type ImportMember = { displayName: string; jersey: number | null; positions: number[] };
export type RowResult<T> =
  { ok: true; value: T; line: number } | { ok: false; error: string; line: number };

const cell = (row: string[], i: number | undefined) =>
  i === undefined ? '' : (row[i] ?? '').trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

export function inferType(typeCell: string, name: string, opponent: string): EventType {
  const t = `${typeCell} ${name}`.toLowerCase();
  if (/tournament|festival|\b7s\b|sevens/.test(t)) return 'tournament';
  if (/practi[cs]e|training|session/.test(t)) return 'training';
  if (/fundrais|raffle|quiz|auction/.test(t)) return 'fundraiser';
  if (/meeting|\bagm\b|committee/.test(t)) return 'meeting';
  if (/social|party|dinner|bbq|drinks|awards|presentation/.test(t)) return 'social';
  if (opponent || /game|match|fixture|friendly|league|cup|scrimmage/.test(t)) return 'match';
  if (/^(yes|true|1)$/.test(typeCell.trim().toLowerCase())) return 'match'; // "Is Game: Yes"
  return 'other';
}

const DEFAULT_TITLES: Record<EventType, string> = {
  training: 'Practice',
  match: 'Game',
  tournament: '7s tournament',
  social: 'Social',
  fundraiser: 'Fundraiser',
  meeting: 'Meeting',
  other: 'Team event',
};

export function scheduleRows(
  t: CsvTable,
  m: Mapping<ScheduleField>,
  tz: string,
  order: DateOrder,
): RowResult<ImportEvent>[] {
  return t.rows.map((row, idx) => {
    const line = idx + 2;
    const date = parseDate(cell(row, m.date), order);
    if (!date) return { ok: false, error: `No date we can read (“${cell(row, m.date)}”)`, line };
    const rawTime = cell(row, m.time);
    const time = parseTime(rawTime);
    const opponent = cell(row, m.opponent).replace(/^(vs?\.?|versus)\s+/i, '');
    const name = cell(row, m.name);
    const type = inferType(cell(row, m.type), name, opponent);
    const startsAt = zonedToUtc(date, time ?? '10:00', tz);
    const arrival = parseTime(cell(row, m.arrival));
    let meetAt = arrival ? zonedToUtc(date, arrival, tz) : null;
    if (meetAt !== null && meetAt > startsAt) meetAt = null;
    // TeamSnap sometimes exports "arrival" as minutes early.
    const early = !arrival ? parseDuration(cell(row, m.arrival)) : null;
    if (early && early > 0 && early <= 240) meetAt = startsAt - early * 60e3;
    const end = parseTime(cell(row, m.endTime));
    let endsAt = end ? zonedToUtc(date, end, tz) : null;
    if (endsAt !== null && endsAt < startsAt) endsAt += 86400e3;
    const dur = parseDuration(cell(row, m.duration));
    if (endsAt === null && dur && dur > 0 && dur <= 24 * 60) endsAt = startsAt + dur * 60e3;
    const ha = cell(row, m.homeAway).toLowerCase();
    const where = [cell(row, m.location), cell(row, m.address)].filter(Boolean);
    const notes = [
      ha.startsWith('h') ? 'Home' : ha.startsWith('a') ? 'Away' : '',
      cell(row, m.notes),
    ]
      .filter(Boolean)
      .join('. ');
    const title =
      name ||
      (opponent && (type === 'match' || type === 'tournament')
        ? `v ${opponent}`
        : DEFAULT_TITLES[type]);
    return {
      ok: true,
      line,
      value: {
        type,
        title: clip(title, 80),
        startsAt,
        meetAt,
        endsAt,
        opponent:
          opponent && (type === 'match' || type === 'tournament') ? clip(opponent, 80) : null,
        locationName: where.length ? clip([...new Set(where)].join(', '), 120) : null,
        notes: notes ? clip(notes, 2000) : null,
        warning: time
          ? null
          : rawTime
            ? `Couldn't read “${rawTime}”, set to 10:00`
            : 'No time given, set to 10:00',
      },
    };
  });
}

const POSITION_WORDS: [RegExp, number[]][] = [
  [/loose ?head|\blhp\b/, [1]],
  [/tight ?head|\bthp\b/, [3]],
  [/\bprops?\b/, [1, 3]],
  [/hooker|\bhk\b/, [2]],
  [/front row/, [1, 2, 3]],
  [/\blocks?\b|second row|\blk\b/, [4, 5]],
  [/blind ?side/, [6]],
  [/open ?side/, [7]],
  [/flanker|wing ?forward|back row|loose forward/, [6, 7]],
  [/number ?(8|eight)|no\.? ?8|\bn8\b|eighth man/, [8]],
  [/scrum ?-?half|\bsh\b|\b9\b/, [9]],
  [/fly ?-?half|out ?-?half|stand ?-?off|first five|\bfh\b/, [10]],
  [/inside cent(re|er)|second five|\bic\b/, [12]],
  [/outside cent(re|er)|\boc\b/, [13]],
  [/cent(re|er)s?/, [12, 13]],
  [/left wing|\blw\b/, [11]],
  [/right wing|\brw\b/, [14]],
  [/wing(er)?s?\b/, [11, 14]],
  [/full ?-?back|\bfb\b/, [15]],
  [/back three|outside back/, [11, 14, 15]],
  [/forward/, [1, 2, 3, 4, 5, 6, 7, 8]],
  [/\bbacks?\b/, [9, 10, 12, 13]],
];

/** "Prop, Hooker", "10/12", "Number 8" → 15s position numbers (deduped, in order). */
export function parsePositions(raw: string): number[] {
  const out: number[] = [];
  for (const part of raw.toLowerCase().split(/[,;/|&]+|\band\b/)) {
    const p = part.trim();
    if (!p) continue;
    if (/^\d{1,2}$/.test(p) && +p >= 1 && +p <= 15) {
      out.push(+p);
      continue;
    }
    const exact = POSITIONS_15.find((x) => x.name.toLowerCase() === p);
    if (exact) {
      out.push(exact.n);
      continue;
    }
    const hit = POSITION_WORDS.find(([re]) => re.test(p));
    if (hit) out.push(...hit[1]);
  }
  return [...new Set(out)].slice(0, 6);
}

export function rosterRows(t: CsvTable, m: Mapping<RosterField>): RowResult<ImportMember>[] {
  return t.rows.map((row, idx) => {
    const line = idx + 2;
    const flag = cell(row, m.nonPlayer).toLowerCase();
    if (/^(yes|true|1|y)$/.test(flag) || /non-?player|manager|coach|staff|parent/.test(flag))
      return { ok: false, error: 'Non-player, skipped', line };
    const full = cell(row, m.fullName);
    const name = (full || [cell(row, m.first), cell(row, m.last)].filter(Boolean).join(' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) return { ok: false, error: 'No name', line };
    const j = cell(row, m.jersey).replace(/^#/, '');
    const jersey = /^\d{1,3}$/.test(j) ? +j : null;
    return {
      ok: true,
      line,
      value: {
        displayName: clip(name, 40),
        jersey,
        positions: parsePositions(cell(row, m.position)),
      },
    };
  });
}

/** Split into requests of at most `size` rows (events and members count together). */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
