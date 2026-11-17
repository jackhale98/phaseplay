/**
 * Kit and inventory (PLAN.md M9): what the club owns, who has it, and two-party handovers.
 * Items ride the team sync; their append-only history is fetched per item.
 */
import * as v from 'valibot';
import { Id, OptionalText, text } from './common';

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
