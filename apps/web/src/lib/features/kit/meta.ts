/** Display helpers for club kit. */
import {
  can,
  ITEM_KIND_LABELS,
  ITEM_STATUS_LABELS,
  type InventoryEvent,
  type InventoryItem,
  type ItemStatus,
  type Member,
} from '@phaseplay/shared';
import { activeMembers, memberName } from '#lib/data/selectors';
import type { TeamSnapshot } from '#lib/data/types';

/** "Bibs, red × 15". */
export const itemLabel = (i: Pick<InventoryItem, 'name' | 'quantity'>) =>
  i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name;

/** Lower-case for running text: "hand the tackle shields to someone?". */
export const itemPhrase = (i: Pick<InventoryItem, 'name'>) =>
  /^[A-Z][a-z]/.test(i.name) ? i.name[0]!.toLowerCase() + i.name.slice(1) : i.name;

export const STATUS_TONE: Record<ItemStatus, 'default' | 'ok' | 'warn' | 'danger' | 'info'> = {
  available: 'ok',
  with_someone: 'info',
  lost: 'danger',
  retired: 'default',
};

/** Where it is, in a few words. */
export function whereIs(s: TeamSnapshot | null, i: InventoryItem): string {
  if (i.status === 'with_someone') return memberName(s, i.holderMemberId);
  if (i.status === 'available') return i.home ? `In the store · ${i.home}` : 'In the store';
  return ITEM_STATUS_LABELS[i.status];
}

export const kindLabel = (i: InventoryItem) => ITEM_KIND_LABELS[i.kind];

/** One history line, e.g. "Coach Casey gave it to Pip". */
export function describeEvent(s: TeamSnapshot | null, e: InventoryEvent): string {
  const who = (id: string | null) => (id === s?.me.id ? 'you' : memberName(s, id));
  const actor = e.actorMemberId === s?.me.id ? 'You' : memberName(s, e.actorMemberId);
  switch (e.kind) {
    case 'created':
      return e.toMemberId ? `${actor} added it, with ${who(e.toMemberId)}` : `${actor} added it`;
    case 'edited':
      return `${actor} edited the details`;
    case 'assigned':
      return `${actor} gave it to ${who(e.toMemberId)}`;
    case 'returned':
      return e.fromMemberId && e.fromMemberId !== e.actorMemberId
        ? `${actor} took it back from ${who(e.fromMemberId)}`
        : `${actor} returned it to the store`;
    case 'handoff_requested':
      return `${actor} offered it to ${who(e.toMemberId)}`;
    case 'handoff_accepted':
      return `${who(e.toMemberId).replace(/^you$/, 'You')} took it over from ${who(e.fromMemberId)}`;
    case 'handoff_declined':
      return `${who(e.toMemberId).replace(/^you$/, 'You')} declined the handover`;
    case 'handoff_cancelled':
      return `${actor} cancelled the handover to ${who(e.toMemberId)}`;
    case 'marked_lost':
      return `${actor} marked it lost`;
    case 'found':
      return `${actor} marked it found`;
    case 'condition_changed':
      return `${actor} changed the condition`;
    case 'split':
      return `${actor} split the set`;
    case 'retired':
      return `${actor} retired it`;
  }
}

export type MemberChoices = {
  people: Member[];
  first: Member[];
  firstLabel: string;
  rest: Member[];
};

/**
 * Who kit can go to, for the teammate pickers: active members minus `exclude` (the holder), and
 * only people who can sign in when they must accept a handover. `suggest` (e.g. those going to
 * the next session) come first; with none, coaches and kit managers do: players can't see who
 * else is going (they only sync their own replies), and staff can always take kit back.
 */
export function memberChoices(
  s: TeamSnapshot | null,
  opts: { exclude?: string | null; needsAccount?: boolean; suggest?: readonly string[] } = {},
): MemberChoices {
  const people = activeMembers(s).filter(
    (m) => m.id !== opts.exclude && (!opts.needsAccount || m.userId !== null),
  );
  const going = people.filter((m) => opts.suggest?.includes(m.id));
  const first = going.length ? going : people.filter((m) => can(m.role, 'inventory.manage'));
  return {
    people,
    first,
    firstLabel: going.length ? 'Going to the next session' : 'Coaches and kit managers',
    rest: people.filter((m) => !first.includes(m)),
  };
}
