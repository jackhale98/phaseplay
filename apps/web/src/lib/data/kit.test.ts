import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { InventoryHandoff, InventoryItem, SyncResponse } from '@phaseplay/shared';
import { mergeSync } from './app.svelte';
import { incomingHandoffs, kitAtRisk, kitItems } from './selectors';
import type { TeamSnapshot } from './types';

const item = (id: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({
  id,
  teamId: 't1',
  kind: 'tackle_shields',
  name: 'Tackle shields',
  tag: null,
  quantity: 6,
  condition: 'good',
  status: 'with_someone',
  holderMemberId: 'm1',
  home: null,
  notes: null,
  matchDay: false,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  ...extra,
});
const handoff = (id: string, extra: Partial<InventoryHandoff> = {}): InventoryHandoff => ({
  id,
  teamId: 't1',
  itemId: 'i1',
  fromMemberId: 'm2',
  toMemberId: 'm1',
  note: null,
  createdAt: 1,
  expiresAt: Date.now() + 86400e3,
  resolvedAt: null,
  outcome: null,
  ...extra,
});
const res = (over: Partial<SyncResponse>): SyncResponse =>
  ({
    cursor: 10,
    full: false,
    team: { id: 't1' },
    me: { id: 'm1' },
    members: [],
    roles: [],
    seasons: [],
    events: [],
    rsvps: [],
    rsvpCounts: {},
    sheets: [],
    plays: [],
    drills: [],
    plans: [],
    items: [],
    handoffs: [],
    ...over,
  }) as SyncResponse;

describe('kit in the team snapshot', () => {
  it('upgrades a snapshot cached before kit existed', () => {
    const old = {
      teamId: 't1',
      cursor: 5,
      syncedAt: 1,
      team: { id: 't1' },
      me: { id: 'm1' },
      rows: {
        members: {},
        seasons: {},
        events: {},
        rsvps: {},
        counts: {},
        sheets: {},
        plays: {},
        drills: {},
        plans: {},
      },
    } as unknown as TeamSnapshot;
    expect(kitItems(old)).toEqual([]);
    expect(kitAtRisk(old)).toEqual([]);
    const next = mergeSync(old, res({}));
    expect(next.rows.items).toEqual({});
    expect(next.rows.handoffs).toEqual({});
  });

  it('applies tombstones and drops resolved handovers', () => {
    let snap = mergeSync(
      null,
      res({ full: true, items: [item('i1'), item('i2')], handoffs: [handoff('h1')] }),
    );
    expect(incomingHandoffs(snap).map((h) => h.id)).toEqual(['h1']);
    snap = mergeSync(
      snap,
      res({
        items: [item('i2', { deletedAt: 9 })],
        handoffs: [handoff('h1', { resolvedAt: 9, outcome: 'declined' })],
      }),
    );
    expect(Object.keys(snap.rows.items!)).toEqual(['i1']);
    expect(snap.rows.handoffs).toEqual({});
  });

  it('hides expired handovers', () => {
    const snap = mergeSync(
      null,
      res({ full: true, items: [item('i1')], handoffs: [handoff('h1', { expiresAt: 5 })] }),
    );
    expect(incomingHandoffs(snap)).toEqual([]);
  });
});
