/** Pure read helpers over the team snapshot. Screens derive from these with $derived. */
import {
  RULES,
  groupOf,
  isFrontRowCapable,
  type Format,
  type Member,
  type PositionGroup,
  type Rsvp,
  type RsvpStatus,
  type TeamEvent,
} from '@phaseplay/shared';
import type { TeamSnapshot } from './types';
import { rsvpKey } from './types';

export const activeMembers = (s: TeamSnapshot | null): Member[] =>
  s ? Object.values(s.rows.members).filter((m) => m.status === 'active').sort(byName) : [];

/** Active + pending (staff see pending names; players never receive them). */
export const squad = (s: TeamSnapshot | null): Member[] =>
  s ? Object.values(s.rows.members).filter((m) => m.status !== 'removed').sort(byName) : [];

export const players = (s: TeamSnapshot | null): Member[] => squad(s).filter((m) => m.role === 'player' || m.positions.length > 0);

export function byName(a: Member, b: Member) {
  return a.displayName.localeCompare(b.displayName);
}

export const memberName = (s: TeamSnapshot | null, id: string | null | undefined) =>
  (id && s?.rows.members[id]?.displayName) || 'Former member';

export function events(s: TeamSnapshot | null): TeamEvent[] {
  return s ? Object.values(s.rows.events).filter((e) => !e.deletedAt).sort((a, b) => a.startsAt - b.startsAt) : [];
}

/** Events that haven't finished yet (ends_at, or start + 3 h). */
export function upcoming(s: TeamSnapshot | null, now = Date.now()): TeamEvent[] {
  return events(s).filter((e) => (e.endsAt ?? e.startsAt + 3 * 3600e3) > now);
}

export function past(s: TeamSnapshot | null, now = Date.now()): TeamEvent[] {
  return events(s).filter((e) => (e.endsAt ?? e.startsAt + 3 * 3600e3) <= now).reverse();
}

export const rsvpOf = (s: TeamSnapshot | null, eventId: string, memberId: string | undefined): Rsvp | undefined =>
  memberId ? s?.rows.rsvps[rsvpKey(eventId, memberId)] : undefined;

export function myRsvp(s: TeamSnapshot | null, eventId: string): RsvpStatus | null {
  return rsvpOf(s, eventId, s?.me.id)?.status ?? null;
}

export const eventFormat = (s: TeamSnapshot | null, e: TeamEvent): Format => e.format ?? s?.team.defaultFormat ?? '15s';

export type Availability = {
  yes: Member[];
  maybe: Member[];
  no: Member[];
  none: Member[];
  byGroup: { group: PositionGroup; yes: number; maybe: number; total: number }[];
  warnings: string[];
  counts: { yes: number; no: number; maybe: number };
};

/** Availability board for staff (docs/design.md, PLAN.md M2). Players get counts only. */
export function availability(s: TeamSnapshot | null, e: TeamEvent): Availability {
  const ms = players(s);
  const out: Availability = { yes: [], maybe: [], no: [], none: [], byGroup: [], warnings: [], counts: { yes: 0, no: 0, maybe: 0 } };
  const status = (m: Member) => rsvpOf(s, e.id, m.id)?.status ?? null;
  for (const m of ms) out[status(m) ?? 'none'].push(m);
  const fmt = eventFormat(s, e);
  for (const g of RULES[fmt].groups) {
    const inGroup = ms.filter((m) => m.positions[0] !== undefined && groupOf(fmt, m.positions[0]) === g);
    out.byGroup.push({
      group: g,
      yes: inGroup.filter((m) => status(m) === 'yes').length,
      maybe: inGroup.filter((m) => status(m) === 'maybe').length,
      total: inGroup.length,
    });
  }
  const frontRow = out.yes.filter((m) => isFrontRowCapable(m.positions)).length;
  const need = fmt === '15s' ? 6 : 3;
  if ((e.type === 'match' || e.type === 'tournament') && frontRow < need)
    out.warnings.push(`Only ${frontRow} available front-rower${frontRow === 1 ? '' : 's'} (need ${need})`);
  if ((e.type === 'match' || e.type === 'tournament') && out.yes.length < RULES[fmt].starters)
    out.warnings.push(`Only ${out.yes.length} available, short of a starting ${fmt === '15s' ? 'XV' : 'VII'}`);
  const counts = s?.rows.counts[e.id];
  out.counts = counts ?? { yes: out.yes.length, no: out.no.length, maybe: out.maybe.length };
  return out;
}

export const sheetFor = (s: TeamSnapshot | null, eventId: string) =>
  s ? Object.values(s.rows.sheets).find((x) => x.eventId === eventId) : undefined;

export const planFor = (s: TeamSnapshot | null, eventId: string) =>
  s ? Object.values(s.rows.plans).find((p) => p.eventId === eventId && !p.deletedAt) : undefined;
