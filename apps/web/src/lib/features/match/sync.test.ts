import { describe, expect, it } from 'vitest';
import type { MatchEvent, MatchPayload } from '@phaseplay/shared';
import { createEvent } from './log';
import { MatchSync, type MatchSyncDeps } from './sync';

/** A fake device (IDB + outbox) and server. The outbox only delivers while online. */
function world() {
  const server = new Map<string, MatchEvent>();
  const sent: string[] = [];
  let online = true;
  const outbox: MatchEvent[][] = [];
  const local = new Map<string, MatchEvent[]>();
  const deliver = () => {
    while (online && outbox.length) {
      const batch = outbox.shift()!;
      for (const e of batch) {
        sent.push(e.id);
        if (!server.has(e.id)) server.set(e.id, e); // idempotent by id
      }
    }
  };
  const deps: MatchSyncDeps = {
    loadLocal: async (id) => local.get(id) ?? [],
    saveLocal: async (id, evs) => void local.set(id, [...evs]),
    fetchServer: async () => {
      if (!online) throw new Error('offline');
      return [...server.values()];
    },
    enqueue: async (_id, evs) => {
      outbox.push(evs);
      deliver();
    },
    pendingIds: async () => new Set(outbox.flat().map((e) => e.id)),
  };
  return {
    deps,
    server,
    sent,
    local,
    outbox,
    setOnline(v: boolean) {
      online = v;
      deliver();
    },
  };
}

const T0 = 1_750_000_000_000;
const tap = (s: MatchSync, payload: MatchPayload, at: number, gameMs = 0) =>
  s.append(createEvent(s.events, payload, gameMs, at));

describe('MatchSync', () => {
  it('records in airplane mode and sends each event exactly once on reconnect', async () => {
    const w = world();
    const s = new MatchSync('m1', w.deps);
    await s.open();
    w.setOnline(false);
    await tap(s, { kind: 'period_start', period: 1 }, T0);
    await tap(s, { kind: 'score', team: 'us', type: 'try' }, T0 + 60e3, 60e3);
    await tap(s, { kind: 'score', team: 'us', type: 'conversion' }, T0 + 90e3, 90e3);
    await tap(s, { kind: 'card', team: 'them', colour: 'yellow' }, T0 + 120e3, 120e3);
    expect(w.server.size).toBe(0);
    expect(w.local.get('m1')).toHaveLength(4);

    // Re-opening while still offline (e.g. the app was killed) re-sends nothing.
    const again = new MatchSync('m1', w.deps);
    await again.open();
    expect(again.events).toHaveLength(4);
    expect(w.outbox.flat()).toHaveLength(4);

    w.setOnline(true);
    await again.refresh();
    expect(w.server.size).toBe(4);
    expect(w.sent).toHaveLength(4);
    expect(new Set(w.sent).size).toBe(4);
  });

  it('re-queues local events that never reached the outbox, once', async () => {
    const w = world();
    const orphan = createEvent([], { kind: 'period_start', period: 1 }, 0, T0);
    w.local.set('m1', [orphan]);
    const s = new MatchSync('m1', w.deps);
    await s.open();
    await s.refresh();
    expect(w.sent).toEqual([orphan.id]);
  });

  it('merges the server log with the local log as a union', async () => {
    const w = world();
    const a = new MatchSync('m1', w.deps);
    const b = new MatchSync('m1', w.deps);
    await a.open();
    await b.open();
    await tap(a, { kind: 'period_start', period: 1 }, T0);
    w.setOnline(false);
    await tap(b, { kind: 'tally', tally: 'scrum_won' }, T0 + 5e3, 5e3);
    w.setOnline(true);
    await a.refresh();
    await b.refresh();
    expect(a.events.map((e) => e.id).sort()).toEqual(b.events.map((e) => e.id).sort());
    expect(a.events).toHaveLength(2);
    expect(new Set(w.sent).size).toBe(w.sent.length);
  });
});
