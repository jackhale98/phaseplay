/**
 * Local-first match log. Every tap is persisted on the device first, then queued in the app's
 * outbox (one POST per event, idempotent by id on the server). Opening a match merges the server
 * copy and the local copy (union by id) and re-queues only local events that the server doesn't
 * have and that aren't already waiting in the outbox, so nothing is ever sent twice by us.
 * Dependencies are injected so this runs in unit tests without IndexedDB or a network.
 */
import type { MatchEvent } from '@phaseplay/shared';
import { mergeLogs } from './log';

export type MatchSyncDeps = {
  loadLocal(eventId: string): Promise<MatchEvent[]>;
  saveLocal(eventId: string, events: MatchEvent[]): Promise<void>;
  /** Rejects when offline. */
  fetchServer(eventId: string): Promise<MatchEvent[]>;
  /** Queue events for upload (the outbox). */
  enqueue(eventId: string, events: MatchEvent[]): Promise<void>;
  /** Ids already waiting in the outbox for this match. */
  pendingIds(eventId: string): Promise<Set<string>>;
};

export class MatchSync {
  events: MatchEvent[] = [];
  serverSeen = false;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    readonly eventId: string,
    private deps: MatchSyncDeps,
    private onChange: (events: MatchEvent[]) => void = () => {},
  ) {}

  /** Load the local copy now, then merge the server copy when reachable. */
  async open(): Promise<void> {
    const local = await this.deps.loadLocal(this.eventId).catch(() => [] as MatchEvent[]);
    this.set(mergeLogs(this.events, local));
    await this.refresh();
  }

  /** Merge the server log; re-queue local-only events that never made it into the outbox. */
  async refresh(): Promise<boolean> {
    let server: MatchEvent[];
    try {
      server = await this.deps.fetchServer(this.eventId);
    } catch {
      return false;
    }
    this.serverSeen = true;
    const onServer = new Set(server.map((e) => e.id));
    this.set(mergeLogs(server, this.events));
    this.persist();
    const pending = await this.deps.pendingIds(this.eventId).catch(() => new Set<string>());
    const missing = this.events.filter((e) => !onServer.has(e.id) && !pending.has(e.id));
    for (let i = 0; i < missing.length; i += 500)
      await this.deps.enqueue(this.eventId, missing.slice(i, i + 500));
    return true;
  }

  /** Append one event: in memory and on the device immediately, then into the outbox. */
  async append(e: MatchEvent): Promise<void> {
    this.set(mergeLogs(this.events, [e]));
    await this.persist();
    await this.deps.enqueue(this.eventId, [e]);
  }

  /** Serialised so a slow write never overwrites a newer one. */
  persist(): Promise<void> {
    const snapshot = this.events;
    this.writes = this.writes
      .then(() => this.deps.saveLocal(this.eventId, snapshot))
      .catch(() => {});
    return this.writes;
  }

  private set(events: MatchEvent[]) {
    this.events = events;
    this.onChange(events);
  }
}
