import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { loadSnapshot, saveSnapshot } from './idb';
import type { TeamSnapshot } from './types';

describe('team snapshot cache', () => {
  it('round-trips a snapshot keyed by team id (regression: writes used to fail silently)', async () => {
    const snap = {
      teamId: 'team-1',
      cursor: 42,
      syncedAt: 1,
      team: { id: 'team-1', name: 'Test RFC' },
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
    await saveSnapshot(snap);
    expect((await loadSnapshot('team-1'))?.cursor).toBe(42);
    await saveSnapshot({ ...snap, cursor: 43 });
    expect((await loadSnapshot('team-1'))?.cursor).toBe(43);
  });
});
