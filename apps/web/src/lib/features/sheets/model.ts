/**
 * Pure team-sheet editing helpers (PLAN.md M3). The rules themselves (slots, fit, warnings) live in
 * packages/shared; this module only shapes them for the builder and viewer.
 */
import {
  RULES,
  positionName,
  positionsFor,
  sheetSlots,
  slotFit,
  type Format,
  type Member,
  type RsvpStatus,
  type SheetSlots,
  type SheetWarning,
  type Team,
  type TeamEvent,
  type TeamSheet,
} from '@phaseplay/shared';
import { day, time, tzName } from '#lib/format';

export type Draft = {
  format: Format;
  replacements: number;
  slots: SheetSlots;
  captainId: string | null;
  viceId: string | null;
};

export type Avail = RsvpStatus | 'none';

/** One entry from GET /sheets/:id/versions (a published snapshot). */
export type SheetVersion = {
  version: number;
  createdAt: number;
  publishedAt: number;
  format: Format;
  replacements: number;
  slots: SheetSlots;
  captainId: string | null;
  viceId: string | null;
};

export const clampReplacements = (format: Format, n: number) =>
  Math.max(0, Math.min(RULES[format].maxReplacements, Math.round(n)));

export function emptyDraft(format: Format, replacements?: number | null): Draft {
  return {
    format,
    replacements: clampReplacements(format, replacements ?? RULES[format].defaultReplacements),
    slots: {},
    captainId: null,
    viceId: null,
  };
}

export function draftFrom(
  x: Pick<TeamSheet, 'format' | 'replacements' | 'slots' | 'captainId' | 'viceId'>,
): Draft {
  return normalize({
    format: x.format,
    replacements: x.replacements,
    slots: { ...x.slots },
    captainId: x.captainId ?? null,
    viceId: x.viceId ?? null,
  });
}

/** Drop slots past the bench, empty entries and captain/vice who aren't on the sheet. */
export function normalize(d: Draft): Draft {
  const replacements = clampReplacements(d.format, d.replacements);
  const valid = new Set(sheetSlots(d.format, replacements).map(String));
  const slots: SheetSlots = {};
  for (const [k, v] of Object.entries(d.slots)) if (v && valid.has(k)) slots[k] = v;
  const on = new Set(Object.values(slots));
  const captainId = d.captainId && on.has(d.captainId) ? d.captainId : null;
  const viceId = d.viceId && on.has(d.viceId) && d.viceId !== captainId ? d.viceId : null;
  return { format: d.format, replacements, slots, captainId, viceId };
}

export const slotOf = (d: Draft, memberId: string): number | null => {
  for (const [k, v] of Object.entries(d.slots)) if (v === memberId) return Number(k);
  return null;
};

/** Put a member in a slot. If they're already elsewhere on the sheet they move (no duplicates). */
export function assign(d: Draft, slot: number, memberId: string): Draft {
  const slots = { ...d.slots };
  for (const [k, v] of Object.entries(slots)) if (v === memberId) delete slots[k];
  slots[String(slot)] = memberId;
  return normalize({ ...d, slots });
}

/** Swap two slots (either may be empty). Used when dragging between slots. */
export function swap(d: Draft, a: number, b: number): Draft {
  if (a === b) return d;
  const slots = { ...d.slots };
  const x = slots[String(a)] ?? null;
  const y = slots[String(b)] ?? null;
  if (y) slots[String(a)] = y;
  else delete slots[String(a)];
  if (x) slots[String(b)] = x;
  else delete slots[String(b)];
  return normalize({ ...d, slots });
}

export function clear(d: Draft, slot: number): Draft {
  const slots = { ...d.slots };
  delete slots[String(slot)];
  return normalize({ ...d, slots });
}

export function toggleCaptain(d: Draft, memberId: string): Draft {
  const on = d.captainId === memberId;
  return normalize({
    ...d,
    captainId: on ? null : memberId,
    viceId: d.viceId === memberId ? null : d.viceId,
  });
}

export function toggleVice(d: Draft, memberId: string): Draft {
  const on = d.viceId === memberId;
  return normalize({
    ...d,
    viceId: on ? null : memberId,
    captainId: d.captainId === memberId ? null : d.captainId,
  });
}

export const setReplacements = (d: Draft, n: number): Draft => normalize({ ...d, replacements: n });

export const filledCount = (d: Draft) => Object.keys(d.slots).length;

/** Players a lower bench count would drop. */
export function droppedBy(d: Draft, n: number): string[] {
  const keep = new Set(sheetSlots(d.format, clampReplacements(d.format, n)).map(String));
  return Object.entries(d.slots)
    .filter(([k]) => !keep.has(k))
    .map(([, v]) => v!)
    .filter(Boolean);
}

/** The next empty slot after `after` (wrapping), or null when the sheet is full. */
export function nextEmpty(d: Draft, after = 0): number | null {
  const all = sheetSlots(d.format, d.replacements);
  const order = [...all.filter((n) => n > after), ...all.filter((n) => n <= after)];
  return order.find((n) => !d.slots[String(n)]) ?? null;
}

export const isBench = (format: Format, slot: number) => slot > RULES[format].starters;

export const slotLabel = (format: Format, slot: number) =>
  isBench(format, slot) ? 'Replacement' : positionName(format, slot);

export const slotShort = (format: Format, slot: number) =>
  isBench(format, slot) ? 'Bench' : (positionsFor(format).find((p) => p.n === slot)?.short ?? '');

/** Rows for the pitch view, front row first. */
export const PITCH_ROWS: Record<Format, number[][]> = {
  '15s': [[1, 2, 3], [4, 5], [6, 8, 7], [9, 10], [11, 12, 13, 14], [15]],
  '7s': [[1, 2, 3], [4], [5, 6, 7]],
};

export const AVAIL_RANK: Record<Avail, number> = { yes: 0, maybe: 1, none: 2, no: 3 };
export const AVAIL_LABEL: Record<Avail, string> = {
  yes: 'In',
  maybe: 'Maybe',
  none: 'No reply',
  no: 'Out',
};
export const AVAIL_TONE: Record<Avail, 'ok' | 'warn' | 'default' | 'danger'> = {
  yes: 'ok',
  maybe: 'warn',
  none: 'default',
  no: 'danger',
};

export function fitLabel(format: Format, slot: number, fit: number): string {
  if (isBench(format, slot)) return fit ? 'Bench' : 'No positions';
  return ['Out of position', 'Same unit', 'Can play', 'Primary'][fit] ?? '';
}
export const fitTone = (fit: number) =>
  (['warn', 'default', 'info', 'ok'] as const)[fit] ?? 'default';

export type Candidate = { member: Member; fit: number; avail: Avail; at: number | null };

/**
 * Rank players for a slot: position fit, then availability (in > maybe > no reply > out), with
 * players already on the sheet after the rest and names as the tie-break.
 */
export function rankFor(
  d: Draft,
  slot: number,
  members: Member[],
  availOf: (id: string) => Avail,
  query = '',
): Candidate[] {
  const q = query.trim().toLowerCase();
  return members
    .filter((m) => !q || m.displayName.toLowerCase().includes(q) || String(m.jersey ?? '') === q)
    .map((m) => ({
      member: m,
      fit: slotFit(d.format, slot, m.positions),
      avail: availOf(m.id),
      at: slotOf(d, m.id),
    }))
    .sort(
      (a, b) =>
        Number(a.at !== null) - Number(b.at !== null) ||
        b.fit - a.fit ||
        AVAIL_RANK[a.avail] - AVAIL_RANK[b.avail] ||
        a.member.displayName.localeCompare(b.member.displayName),
    );
}

/** The latest earlier published sheet in the same format, for "Copy from previous match". */
export function previousSheet(
  sheets: TeamSheet[],
  events: Record<string, TeamEvent>,
  current: TeamEvent,
  format: Format,
): TeamSheet | undefined {
  return sheets
    .filter((x) => x.eventId !== current.id && x.publishedAt && x.format === format)
    .map((x) => ({ x, e: events[x.eventId] }))
    .filter(({ e }) => e && !e.deletedAt && e.startsAt < current.startsAt)
    .sort((a, b) => b.e!.startsAt - a.e!.startsAt)[0]?.x;
}

/** Copy a previous sheet, keeping only players still in the squad. */
export function copyFrom(
  src: Pick<TeamSheet, 'replacements' | 'slots' | 'captainId' | 'viceId'>,
  format: Format,
  active: Set<string>,
): { draft: Draft; dropped: number } {
  const slots: SheetSlots = {};
  let dropped = 0;
  for (const [k, v] of Object.entries(src.slots)) {
    if (!v) continue;
    if (active.has(v)) slots[k] = v;
    else dropped++;
  }
  const draft = normalize({
    format,
    replacements: src.replacements,
    slots,
    captainId: src.captainId && active.has(src.captainId) ? src.captainId : null,
    viceId: src.viceId && active.has(src.viceId) ? src.viceId : null,
  });
  return { draft, dropped };
}

export type WarningLine = {
  key: string;
  text: string;
  slot: number | null;
  tone: 'warn' | 'danger';
};

/** Human copy for the warnings tray. Empty starter slots are folded into one line. */
export function warningLines(
  warnings: SheetWarning[],
  format: Format,
  nameOf: (id: string) => string,
): WarningLine[] {
  const out: WarningLine[] = [];
  const empty = warnings.filter((w) => w.kind === 'empty').map((w) => w.slot);
  if (empty.length)
    out.push({
      key: 'empty',
      tone: 'danger',
      slot: empty[0]!,
      text:
        empty.length === 1
          ? `${empty[0]} (${positionName(format, empty[0]!)}) is still empty`
          : `${empty.length} starting spots still empty: ${empty.join(', ')}`,
    });
  for (const w of warnings) {
    if (w.kind === 'duplicate')
      out.push({
        key: `dup-${w.memberId}`,
        tone: 'danger',
        slot: w.slots[1] ?? null,
        text: `${nameOf(w.memberId)} is picked twice (${w.slots.join(' and ')})`,
      });
    else if (w.kind === 'out_of_position')
      out.push({
        key: `oop-${w.slot}`,
        tone: 'warn',
        slot: w.slot,
        text: `${nameOf(w.memberId)} is out of position at ${w.slot} (${positionName(format, w.slot)})`,
      });
    else if (w.kind === 'unavailable')
      out.push({
        key: `un-${w.slot}`,
        tone: w.status === 'no' ? 'danger' : 'warn',
        slot: w.slot,
        text:
          w.status === 'no'
            ? `${nameOf(w.memberId)} (${w.slot}) said they're out`
            : w.status === 'maybe'
              ? `${nameOf(w.memberId)} (${w.slot}) is a maybe`
              : `${nameOf(w.memberId)} (${w.slot}) hasn't replied`,
      });
    else if (w.kind === 'front_row_cover')
      out.push({
        key: 'fr',
        tone: 'danger',
        slot: null,
        text: `Front-row cover: ${w.have} of ${w.need} front-rowers named`,
      });
    else if (w.kind === 'captain_missing')
      out.push({ key: 'capt', tone: 'warn', slot: null, text: 'No captain picked yet' });
  }
  return out;
}

/** Per-slot flags for the tokens. */
export function slotFlags(warnings: SheetWarning[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const w of warnings) {
    if (w.kind === 'out_of_position') m.set(w.slot, 'out of position');
    else if (w.kind === 'unavailable' && !m.has(w.slot))
      m.set(w.slot, w.status === 'no' ? 'said out' : w.status === 'maybe' ? 'maybe' : 'no reply');
    else if (w.kind === 'duplicate') for (const n of w.slots) m.set(n, 'picked twice');
  }
  return m;
}

/** "v Harlequins" for matches with an opponent, otherwise the event title. */
export const eventLabel = (e: Pick<TeamEvent, 'opponent' | 'title'>) =>
  e.opponent ? `v ${e.opponent}` : e.title;

/** Team, opponent, kickoff (in the team's timezone) and venue for the PNG. */
export function exportMeta(team: Team, e: TeamEvent) {
  const tz = team.timezone;
  return {
    team: {
      name: team.name,
      shortName: team.shortName,
      primary: team.colors.primary,
      secondary: team.colors.secondary,
    },
    opponent: e.opponent ?? undefined,
    kickoff: `${day(e.startsAt, tz)} · ${time(e.startsAt, tz)} ${tzName(tz, e.startsAt)}`,
    venue: e.locationName ?? undefined,
  };
}

export const fileSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'match';

/** "Jess Taylor" → "J. Taylor" for pitch labels. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  return `${parts[0]![0]}. ${parts.slice(1).join(' ')}`;
}

/** Input for renderTeamSheet (packages/diagram/src/export/sheet.ts). */
export function exportInput(
  d: Draft,
  nameOf: (id: string) => string,
  extra: {
    team: { name: string; shortName: string; primary: string; secondary: string };
    opponent?: string;
    kickoff: string;
    venue?: string;
  },
) {
  const starters = [];
  const bench = [];
  for (const n of sheetSlots(d.format, d.replacements)) {
    const id = d.slots[String(n)];
    if (!id) continue;
    if (isBench(d.format, n)) bench.push({ n, name: nameOf(id) });
    else starters.push({ n, name: nameOf(id), captain: d.captainId === id, vice: d.viceId === id });
  }
  return { ...extra, format: d.format, starters, bench };
}
