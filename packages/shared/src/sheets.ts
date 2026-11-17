import * as v from 'valibot';
import { Id } from './common';
import { FORMATS, type Format, RULES, isFrontRowCapable, slotFit, sheetSlots } from './rugby';

/** slot number (as string) → member id or null. Starters are 1..starters, bench after. */
export const SheetSlots = v.record(v.pipe(v.string(), v.regex(/^\d{1,2}$/)), v.nullable(Id));
export type SheetSlots = v.InferOutput<typeof SheetSlots>;

export const SheetPut = v.object({
  eventId: Id,
  format: v.picklist(FORMATS),
  replacements: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(12)),
  slots: SheetSlots,
  captainId: v.optional(v.nullable(Id), null),
  viceId: v.optional(v.nullable(Id), null),
});
export type SheetPut = v.InferOutput<typeof SheetPut>;

export type SheetWarning =
  | { kind: 'duplicate'; memberId: string; slots: number[] }
  | { kind: 'out_of_position'; memberId: string; slot: number }
  | { kind: 'unavailable'; memberId: string; slot: number; status: 'no' | 'maybe' | 'none' }
  | { kind: 'empty'; slot: number }
  | { kind: 'front_row_cover'; have: number; need: number }
  | { kind: 'captain_missing' };

export type SheetMemberInfo = { positions: number[]; rsvp: 'yes' | 'no' | 'maybe' | null };

export function sheetWarnings(
  format: Format,
  replacements: number,
  slots: SheetSlots,
  members: Record<string, SheetMemberInfo>,
  opts: { frontRowCover?: number; captainId?: string | null } = {},
): SheetWarning[] {
  const out: SheetWarning[] = [];
  const all = sheetSlots(format, replacements);
  const where = new Map<string, number[]>();
  for (const n of all) {
    const id = slots[String(n)];
    if (!id) {
      if (n <= RULES[format].starters) out.push({ kind: 'empty', slot: n });
      continue;
    }
    where.set(id, [...(where.get(id) ?? []), n]);
    const m = members[id];
    if (!m) continue;
    if (n <= RULES[format].starters && m.positions.length && slotFit(format, n, m.positions) === 0)
      out.push({ kind: 'out_of_position', memberId: id, slot: n });
    if (m.rsvp !== 'yes')
      out.push({ kind: 'unavailable', memberId: id, slot: n, status: m.rsvp ?? 'none' });
  }
  for (const [memberId, s] of where)
    if (s.length > 1) out.push({ kind: 'duplicate', memberId, slots: s });
  const need = opts.frontRowCover ?? scaledFrontRowCover(format, replacements);
  const have = [...where.keys()].filter((id) =>
    isFrontRowCapable(members[id]?.positions ?? []),
  ).length;
  if (need > 0 && have < need) out.push({ kind: 'front_row_cover', have, need });
  if (opts.captainId !== undefined && !opts.captainId) out.push({ kind: 'captain_missing' });
  return out;
}

/**
 * World Rugby Law 3: 23 players → 6 front-row capable, 19–22 → 5, 16–18 → 4 (15s). 7s needs 3.
 */
export function scaledFrontRowCover(format: Format, replacements: number): number {
  if (format === '7s') return 3;
  const squad = 15 + replacements;
  if (squad >= 23) return 6;
  if (squad >= 19) return 5;
  if (squad >= 16) return 4;
  return 3;
}

/** Front-row cover of a group of players (who's in for a date, or available for a game). */
export type FrontRowCover = {
  /** Players who can play prop (1 or 3) / hooker (2); someone who can do both counts in each. */
  props: number;
  hookers: number;
  /** Front-row-capable players. */
  capable: number;
  need: number;
  hookersNeeded: number;
  propsNeeded: number;
  /** Enough players to fill the props and hookers needed, each person used once. */
  ok: boolean;
  /** What's missing, e.g. "Only 1 hooker", or null when covered. */
  short: string | null;
};

const onlyN = (n: number, w: string) =>
  n === 0 ? `No ${w}` : `Only ${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Can these players cover the front row? `need` front-rowers in all (Law 3: `RULES[f].frontRowCover`
 * or `scaledFrontRowCover`), of which 2 hookers once there's a bench to cover (need ≥ 4), else 1.
 */
export function frontRowCover(positions: number[][], need: number): FrontRowCover {
  let propOnly = 0;
  let hookOnly = 0;
  let both = 0;
  for (const p of positions) {
    if (!isFrontRowCapable(p)) continue;
    const prop = p.includes(1) || p.includes(3);
    const hook = p.includes(2);
    if (prop && hook) both++;
    else if (prop) propOnly++;
    else hookOnly++;
  }
  const hookersNeeded = need >= 4 ? 2 : need > 0 ? 1 : 0;
  const propsNeeded = Math.max(0, need - hookersNeeded);
  const props = propOnly + both;
  const hookers = hookOnly + both;
  const capable = propOnly + hookOnly + both;
  // Two roles: enough of each, and enough people overall to fill both at once.
  const ok = hookers >= hookersNeeded && props >= propsNeeded && capable >= need;
  const short = ok
    ? null
    : hookers < hookersNeeded
      ? onlyN(hookers, 'hooker')
      : props < propsNeeded
        ? onlyN(props, 'prop')
        : `${onlyN(capable, 'front-rower')} (need ${need})`;
  return { props, hookers, capable, need, hookersNeeded, propsNeeded, ok, short };
}
