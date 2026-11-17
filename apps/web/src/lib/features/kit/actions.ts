/**
 * Kit writes (PLAN.md M9 §Offline and UX). Every one is an optimistic outbox mutation. Handover
 * answers need the other side, so they don't move the item until the server agrees: the cached
 * handover is marked `queued` and the UI says "waiting to send".
 */
import {
  INVENTORY_HANDOFF_TTL_MS,
  nextItemState,
  splitSet,
  uuidv7,
  type InventoryEventKind,
  type InventoryItem,
  type InventoryItemInput,
  type ItemStatus,
} from '@phaseplay/shared';
import { app } from '#lib/data/app.svelte';
import { teamPath } from '#lib/data/actions';
import { handoffFor } from '#lib/data/selectors';
import type { LocalHandoff } from '#lib/data/types';
import type { Optimistic } from '#lib/data/idb';
import { toasts } from '#lib/stores/toast.svelte';

/** Cancel the open handover locally when the item moves (the server does the same). */
function clearHandoff(itemId: string): Optimistic[] {
  const h = handoffFor(app.snap, itemId);
  return h ? [{ op: 'delete', entity: 'handoffs', key: h.id }] : [];
}

/** Create (no `item`) or edit an item's details. Returns the id. */
export async function saveItem(input: InventoryItemInput, item?: InventoryItem): Promise<string> {
  const id = item?.id ?? uuidv7();
  const t = Date.now();
  const value: InventoryItem = {
    id,
    teamId: app.teamId!,
    kind: input.kind,
    name: input.name,
    tag: input.tag || null,
    quantity: input.quantity,
    condition: input.condition,
    status: item?.status ?? 'available',
    holderMemberId: item?.holderMemberId ?? null,
    home: input.home || null,
    notes: input.notes || null,
    matchDay: input.matchDay,
    // Not bumped here: a queued edit must pin the version it was based on (If-Match).
    version: item?.version ?? 1,
    createdAt: item?.createdAt ?? t,
    updatedAt: t,
    deletedAt: null,
  };
  await app.mutate({
    method: 'PUT',
    path: teamPath(`/inventory/${id}`),
    body: input,
    label: item ? `Changes to ${input.name}` : `New kit: ${input.name}`,
    versionOf: item ? { entity: 'items', id } : undefined,
    optimistic: [{ op: 'put', entity: 'items', key: id, value }],
  });
  return id;
}

/** Remove a mistaken entry, with undo. */
export async function deleteItem(item: InventoryItem) {
  const id = crypto.randomUUID();
  await app.mutate({
    id,
    method: 'DELETE',
    path: teamPath(`/inventory/${item.id}`),
    label: `Removing ${item.name}`,
    optimistic: [{ op: 'delete', entity: 'items', key: item.id }, ...clearHandoff(item.id)],
  });
  toasts.undo(`Removed ${item.name}`, () => {
    void app.cancel(id).then((ok) => {
      if (!ok) toasts.show('Already removed. Add it again if that was a mistake.');
    });
  });
}

type Move = 'assign' | 'return' | 'lost' | 'found' | 'retire';
const MOVE_EVENT: Record<Move, InventoryEventKind> = {
  assign: 'assigned',
  return: 'returned',
  lost: 'marked_lost',
  found: 'found',
  retire: 'retired',
};
const MOVE_LABEL: Record<Move, string> = {
  assign: 'Handing out',
  return: 'Returning',
  lost: 'Marking lost',
  found: 'Marking found',
  retire: 'Retiring',
};

/** Assign (memberId), take back (assign with null), return, lost, found or retire. */
export async function moveItem(
  item: InventoryItem,
  move: Move,
  opts: { memberId?: string | null; note?: string | null } = {},
) {
  const to = move === 'assign' ? (opts.memberId ?? null) : null;
  const next = nextItemState(item, { kind: MOVE_EVENT[move], toMemberId: to });
  const status: ItemStatus = next.status;
  await app.mutate({
    method: 'POST',
    path: teamPath(`/inventory/${item.id}/${move}`),
    body:
      move === 'assign' ? { memberId: to, note: opts.note ?? null } : { note: opts.note ?? null },
    label: `${MOVE_LABEL[move]} ${item.name}`,
    optimistic: [
      {
        op: 'patch',
        entity: 'items',
        key: item.id,
        value: { status, holderMemberId: next.holderMemberId, updatedAt: Date.now() },
      },
      ...clearHandoff(item.id),
    ],
  });
}

/** Split `take` off a set into a new item. Returns the new id, or null if it can't be split. */
export async function splitItem(item: InventoryItem, take: number): Promise<string | null> {
  const parts = splitSet(item.quantity, take);
  if (!parts) return null;
  const id = uuidv7();
  const t = Date.now();
  await app.mutate({
    method: 'POST',
    path: teamPath(`/inventory/${item.id}/split`),
    body: { id, quantity: parts.take },
    label: `Splitting ${item.name}`,
    versionOf: { entity: 'items', id: item.id },
    optimistic: [
      {
        op: 'patch',
        entity: 'items',
        key: item.id,
        value: { quantity: parts.keep, updatedAt: t },
      },
      {
        op: 'put',
        entity: 'items',
        key: id,
        value: {
          ...item,
          id,
          tag: null,
          quantity: parts.take,
          version: 1,
          createdAt: t,
          updatedAt: t,
        } satisfies InventoryItem,
      },
    ],
  });
  return id;
}

/** Offer an item to a teammate. Until they accept, the holder still has it. */
export async function offerItem(item: InventoryItem, toMemberId: string, note: string | null) {
  const id = uuidv7();
  const t = Date.now();
  const value: LocalHandoff = {
    id,
    teamId: app.teamId!,
    itemId: item.id,
    fromMemberId: item.holderMemberId,
    toMemberId,
    note: note || null,
    createdAt: t,
    expiresAt: t + INVENTORY_HANDOFF_TTL_MS,
    resolvedAt: null,
    outcome: null,
  };
  await app.mutate({
    method: 'POST',
    path: teamPath(`/inventory/${item.id}/handoffs`),
    body: { id, toMemberId, note: note || null },
    label: `Handing over ${item.name}`,
    optimistic: [{ op: 'put', entity: 'handoffs', key: id, value }],
  });
}

/**
 * Accept or decline (the sender or a kit manager cancels with `decline`). Queued while offline;
 * the item only moves once the server has agreed.
 */
export async function answerHandoff(h: LocalHandoff, how: 'accept' | 'decline', label: string) {
  await app.mutate({
    method: 'POST',
    path: teamPath(`/handoffs/${h.id}/${how}`),
    body: {},
    label,
    optimistic: [{ op: 'patch', entity: 'handoffs', key: h.id, value: { queued: how } }],
  });
}
