/**
 * Kit and inventory (PLAN.md M9): what the club owns, who has it, and two-party handovers.
 * Items ride the team sync; their append-only history is fetched per item.
 */
import * as v from 'valibot';
import { Id, OptionalText, text } from './common';
import { isConfirmed, type EventStatus } from './proposals';

export const ITEM_KINDS = [
  'balls',
  'tackle_shields',
  'tackle_bags',
  'cones',
  'bibs',
  'contact_suits',
  'first_aid_kit',
  'kicking_tees',
  'flags',
  'scrum_machine',
  'other',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  balls: 'Balls',
  tackle_shields: 'Tackle shields',
  tackle_bags: 'Tackle bags',
  cones: 'Cones',
  bibs: 'Bibs',
  contact_suits: 'Contact suits',
  first_aid_kit: 'First-aid kit',
  kicking_tees: 'Kicking tees',
  flags: 'Corner flags',
  scrum_machine: 'Scrum machine',
  other: 'Other',
};

export const ITEM_CONDITIONS = ['good', 'worn', 'needs_repair'] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];
export const ITEM_CONDITION_LABELS: Record<ItemCondition, string> = {
  good: 'Good',
  worn: 'Worn',
  needs_repair: 'Needs repair',
};

/** `with_someone` iff `holderMemberId` is set. Status changes only through the action routes. */
export const ITEM_STATUSES = ['available', 'with_someone', 'lost', 'retired'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  available: 'In the store',
  with_someone: 'With someone',
  lost: 'Lost',
  retired: 'Retired',
};

export const INVENTORY_EVENT_KINDS = [
  'created',
  'edited',
  'assigned',
  'returned',
  'handoff_requested',
  'handoff_accepted',
  'handoff_declined',
  'handoff_cancelled',
  'marked_lost',
  'found',
  'condition_changed',
  'split',
  'retired',
] as const;
export type InventoryEventKind = (typeof INVENTORY_EVENT_KINDS)[number];

/** A pending handover lapses after this long. */
export const INVENTORY_HANDOFF_TTL_MS = 7 * 86400e3;
/** Kit flags look this far ahead for events whose holder is out or hasn't replied. */
export const KIT_FLAG_WINDOW_MS = 7 * 86400e3;

/** Club asset tag printed on labels and QR codes (unique per team when set). */
export const AssetTag = v.pipe(
  v.string(),
  v.trim(),
  v.regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,23}$/, 'Letters, numbers and dashes, up to 24'),
);

/** Create or edit an item's details. Holder and status change through the action routes. */
export const InventoryItemInput = v.object({
  kind: v.picklist(ITEM_KINDS),
  name: text(60, 1),
  tag: v.optional(v.nullable(AssetTag), null),
  quantity: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500)), 1),
  condition: v.optional(v.picklist(ITEM_CONDITIONS), 'good'),
  /** Where it lives when nobody has it (shed, clubhouse cage, coach's car). */
  home: OptionalText(60),
  /** Coach-visible note. Never anything about anyone's health. */
  notes: OptionalText(140),
  /** On the match-day checklist (flags, tees, first-aid box). */
  matchDay: v.optional(v.boolean(), false),
});
export type InventoryItemInput = v.InferOutput<typeof InventoryItemInput>;

/** Assign to a member, or `null` to take it back to the store. */
export const InventoryAssign = v.object({
  memberId: v.nullable(Id),
  note: OptionalText(140),
});
export type InventoryAssign = v.InferOutput<typeof InventoryAssign>;

/** Return / lost / found / retire: an optional short note for the history. */
export const InventoryNote = v.object({ note: OptionalText(140) });
export type InventoryNote = v.InferOutput<typeof InventoryNote>;

/** Split part of a set into a new item (e.g. 5 of 15 bibs go home with someone). */
export const InventorySplit = v.object({
  id: Id,
  quantity: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(499)),
});
export type InventorySplit = v.InferOutput<typeof InventorySplit>;

/** Offer an item you hold (or, with inventory.manage, anyone's) to a teammate. */
export const HandoffCreate = v.object({
  id: Id,
  toMemberId: Id,
  note: OptionalText(140),
});
export type HandoffCreate = v.InferOutput<typeof HandoffCreate>;

/* ------------------------------ Pure helpers ------------------------------ */

/** Where an item is: its status and (only while `with_someone`) who has it. */
export type ItemState = { status: ItemStatus; holderMemberId: string | null };
type EventLike = { kind: InventoryEventKind; toMemberId: string | null };

/**
 * One step of the item state machine. History-only events (edits, handover requests that were
 * not accepted, splits) leave the state as it was.
 */
export function nextItemState(s: ItemState, e: EventLike): ItemState {
  const held = (to: string | null): ItemState =>
    to
      ? { status: 'with_someone', holderMemberId: to }
      : { status: 'available', holderMemberId: null };
  switch (e.kind) {
    case 'created':
    case 'assigned':
      return held(e.toMemberId);
    case 'handoff_accepted':
      return e.toMemberId ? held(e.toMemberId) : s;
    case 'returned':
    case 'found':
      return { status: 'available', holderMemberId: null };
    case 'marked_lost':
      return { status: 'lost', holderMemberId: null };
    case 'retired':
      return { status: 'retired', holderMemberId: null };
    default:
      return s;
  }
}

/** Replay an item's append-only history (oldest first) into its current state. */
export function reduceItemState(
  events: readonly EventLike[],
  start: ItemState = { status: 'available', holderMemberId: null },
): ItemState {
  return events.reduce(nextItemState, start);
}

/**
 * Split `take` off a set of `quantity`. Sets move as a whole, so both parts must keep at least
 * one; returns null when the split isn't possible.
 */
export function splitSet(quantity: number, take: number): { keep: number; take: number } | null {
  if (!Number.isInteger(take) || !Number.isInteger(quantity)) return null;
  if (take < 1 || take >= quantity) return null;
  return { keep: quantity - take, take };
}

/** Counted as club kit: retired (and deleted) items drop out; lost ones are counted apart. */
export const inService = (i: { status: ItemStatus; deletedAt?: number | null }) =>
  !i.deletedAt && (i.status === 'available' || i.status === 'with_someone');

type KitItem = {
  id: string;
  kind: ItemKind;
  quantity: number;
  status: ItemStatus;
  holderMemberId: string | null;
  deletedAt?: number | null;
};
type KitEvent = {
  id: string;
  startsAt: number;
  cancelledAt?: number | null;
  deletedAt?: number | null;
  status?: EventStatus | null;
};
type KitReply = { eventId: string; memberId: string; status: 'yes' | 'no' | 'maybe' | null };

export type KitRisk = {
  eventId: string;
  itemId: string;
  holderMemberId: string;
  /** `no`, or null when the holder hasn't replied. */
  reply: 'no' | null;
};

const replyIndex = (rsvps: Iterable<KitReply>) => {
  const m = new Map<string, KitReply['status']>();
  for (const r of rsvps) m.set(`${r.eventId}:${r.memberId}`, r.status);
  return m;
};

/**
 * The point of the kit feature (PLAN.md M9 §Flags): for each event starting within
 * `KIT_FLAG_WINDOW_MS`, the kit held by members who replied no or haven't replied (a maybe isn't
 * flagged). Sorted by event start.
 */
export function atRiskKit(
  items: Iterable<KitItem>,
  events: Iterable<KitEvent>,
  rsvps: Iterable<KitReply>,
  now: number,
  windowMs = KIT_FLAG_WINDOW_MS,
): KitRisk[] {
  const held = [...items].filter(
    (i) => !i.deletedAt && i.status === 'with_someone' && i.holderMemberId,
  );
  if (!held.length) return [];
  const replies = replyIndex(rsvps);
  const soon = [...events]
    .filter(
      (e) =>
        !e.deletedAt &&
        !e.cancelledAt &&
        isConfirmed(e) &&
        e.startsAt > now &&
        e.startsAt <= now + windowMs,
    )
    .sort((a, b) => a.startsAt - b.startsAt);
  const out: KitRisk[] = [];
  for (const e of soon)
    for (const i of held) {
      const r = replies.get(`${e.id}:${i.holderMemberId}`) ?? null;
      if (r === 'no' || r === null)
        out.push({ eventId: e.id, itemId: i.id, holderMemberId: i.holderMemberId!, reply: r });
    }
  return out;
}

/** Practice equipment that maps onto a kind of club kit (markers, poles and the like don't). */
export const EQUIPMENT_KIT_KIND: Partial<Record<string, ItemKind>> = {
  balls: 'balls',
  cones: 'cones',
  tackle_shields: 'tackle_shields',
  tackle_bags: 'tackle_bags',
  scrum_machine: 'scrum_machine',
  bibs: 'bibs',
};

export type KitShortfall = { kind: ItemKind; need: number; coming: number };

/**
 * A practice plan's needs against the kit that will be there: in the store, or held by someone
 * who replied yes to the event. Only the kinds that fall short are returned.
 */
export function kitShortfalls(
  needs: Partial<Record<ItemKind, number>>,
  items: Iterable<KitItem>,
  eventId: string | null,
  rsvps: Iterable<KitReply>,
): KitShortfall[] {
  const replies = replyIndex(rsvps);
  const coming: Partial<Record<ItemKind, number>> = {};
  for (const i of items) {
    if (i.deletedAt) continue;
    const there =
      i.status === 'available' ||
      (i.status === 'with_someone' &&
        !!eventId &&
        replies.get(`${eventId}:${i.holderMemberId}`) === 'yes');
    if (there) coming[i.kind] = (coming[i.kind] ?? 0) + i.quantity;
  }
  return ITEM_KINDS.filter((k) => (needs[k] ?? 0) > (coming[k] ?? 0)).map((k) => ({
    kind: k,
    need: needs[k]!,
    coming: coming[k] ?? 0,
  }));
}
