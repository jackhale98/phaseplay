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
  for (const [memberId, s] of where) if (s.length > 1) out.push({ kind: 'duplicate', memberId, slots: s });
  const need = opts.frontRowCover ?? scaledFrontRowCover(format, replacements);
  const have = [...where.keys()].filter((id) => isFrontRowCapable(members[id]?.positions ?? [])).length;
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
