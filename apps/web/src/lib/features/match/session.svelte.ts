/**
 * Reactive match session for the recorder, summary and day view. Wraps MatchSync with the real
 * device storage (IndexedDB `match` store), the API and the app outbox. Clocks are re-derived
 * from timestamps on a 250 ms render timer: `now` is replaced, never incremented.
 */
import {
  clockAt,
  effectiveLog,
  type MatchConfig,
  type MatchEvent,
  type MatchEventsResponse,
  type MatchPayload,
} from '@phaseplay/shared';
import { api } from '#lib/api';
import { app } from '#lib/data/app.svelte';
import { teamPath } from '#lib/data/actions';
import { db } from '#lib/data/idb';
import { createEvent, lastUndoable, toInput } from './log';
import { MatchSync, type MatchSyncDeps } from './sync';

const matchPath = (eventId: string) => teamPath(`/events/${eventId}/match`);

/** Resolves once the app has settled on a team (deep links can switch team right after boot). */
function teamReady(): Promise<void> {
  const ready = () => !!app.teamId && app.snap?.teamId === app.teamId;
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = $effect.root(() => {
      $effect(() => {
        if (ready()) {
          resolve();
          queueMicrotask(stop);
        }
      });
    });
  });
}

export const browserDeps: MatchSyncDeps = {
  async loadLocal(eventId) {
    return (await (await db()).get('match', eventId))?.events ?? [];
  },
  async saveLocal(eventId, events) {
    await (await db()).put('match', { eventId, events: [...events] });
  },
  async fetchServer(eventId) {
    await teamReady();
    return (await api<MatchEventsResponse>(matchPath(eventId))).events;
  },
  async enqueue(eventId, events) {
    await app.mutate({
      method: 'POST',
      path: matchPath(eventId),
      body: { events: events.map(toInput) },
      label: 'Match log',
    });
  },
  async pendingIds(eventId) {
    const path = matchPath(eventId);
    const out = new Set<string>();
    for (const e of await (await db()).getAll('outbox')) {
      if (e.method !== 'POST' || e.path !== path) continue;
      for (const x of (e.body as { events?: { id: string }[] } | undefined)?.events ?? [])
        out.add(x.id);
    }
    return out;
  },
};

export class MatchSession {
  events = $state.raw<MatchEvent[]>([]);
  now = $state(Date.now());
  loaded = $state(false);
  private sync: MatchSync;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly eventId: string,
    private cfg: () => MatchConfig,
    deps: MatchSyncDeps = browserDeps,
  ) {
    this.sync = new MatchSync(eventId, deps, (evs) => (this.events = evs));
  }

  async open() {
    await this.sync.open();
    this.loaded = true;
  }

  refresh() {
    return this.sync.refresh();
  }

  get serverSeen() {
    return this.sync.serverSeen;
  }

  start(everyMs = 250) {
    this.stop();
    this.now = Date.now();
    this.timer = setInterval(() => (this.now = Date.now()), everyMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The game clock right now (from timestamps). */
  gameNow(at = Date.now()) {
    return clockAt(effectiveLog(this.events), this.cfg(), at).gameMs;
  }

  /** Record a tap. `gameMs` defaults to the game clock at this instant. */
  async record(payload: MatchPayload, gameMs?: number, wallAt?: number): Promise<MatchEvent> {
    const now = Date.now();
    const e = createEvent(this.events, payload, gameMs ?? this.gameNow(now), now);
    if (wallAt !== undefined) e.wallAt = wallAt;
    this.now = now;
    await this.sync.append(e);
    return e;
  }

  /** Void the latest entry still in effect. Returns the entry that was undone. */
  async undo(): Promise<MatchEvent | null> {
    const last = lastUndoable(this.events);
    if (!last) return null;
    await this.record({ kind: 'void', supersedesId: last.id }, last.gameMs);
    return last;
  }

  async remove(target: MatchEvent) {
    await this.record({ kind: 'void', supersedesId: target.id }, target.gameMs);
  }

  /** Undo a removal: a fresh copy of the entry at its original wall time. */
  async restore(target: MatchEvent) {
    await this.record(target.payload, target.gameMs, target.wallAt);
  }

  async edit(target: MatchEvent, change: { gameMs?: number; patch?: Record<string, unknown> }) {
    await this.record(
      { kind: 'edit', supersedesId: target.id, gameMs: change.gameMs, patch: change.patch },
      change.gameMs ?? target.gameMs,
    );
  }
}
