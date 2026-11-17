/** IndexedDB access. One database, small number of stores; all values are plain JSON. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MatchEvent, RunEvent } from '@phaseplay/shared';
import type { TeamSnapshot } from './types';

export type OutboxEntry = {
  seq?: number;
  id: string;
  teamId: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** Resolve If-Match at send time from the cache, so queued edits chain correctly. */
  versionOf?: { entity: VersionedEntity; id: string };
  /**
   * The version the user's edit was based on, pinned when it was made. Sent as If-Match (advanced
   * only through this device's own successful writes), so another person's change is a 409.
   */
  baseVersion?: number | null;
  /** Applied to the cache optimistically and re-applied after every sync until sent. */
  optimistic?: Optimistic[];
  label: string;
  createdAt: number;
  attempts: number;
  nextAt: number;
};

export type VersionedEntity = 'events' | 'sheets' | 'plays' | 'drills' | 'plans' | 'items';
export type Optimistic =
  | { op: 'put'; entity: keyof TeamSnapshot['rows']; key: string; value: unknown }
  | { op: 'patch'; entity: keyof TeamSnapshot['rows']; key: string; value: Record<string, unknown> }
  | { op: 'delete'; entity: keyof TeamSnapshot['rows']; key: string };

interface PPDB extends DBSchema {
  kv: { key: string; value: unknown };
  teams: { key: string; value: TeamSnapshot };
  docs: { key: string; value: { key: string; value: unknown; updatedAt: number } };
  outbox: { key: number; value: OutboxEntry; indexes: { team: string } };
  match: { key: string; value: { eventId: string; events: MatchEvent[] } };
  runs: { key: string; value: { planId: string; events: RunEvent[] } };
}

let dbp: Promise<IDBPDatabase<PPDB>> | null = null;

export function db() {
  dbp ??= openDB<PPDB>('phaseplay', 1, {
    upgrade(d) {
      d.createObjectStore('kv');
      d.createObjectStore('teams');
      d.createObjectStore('docs', { keyPath: 'key' });
      const o = d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      o.createIndex('team', 'teamId');
      d.createObjectStore('match', { keyPath: 'eventId' });
      d.createObjectStore('runs', { keyPath: 'planId' });
    },
    blocking() {
      // A newer tab upgraded the schema; close so it can proceed.
      void dbp?.then((x) => x.close());
      dbp = null;
    },
  });
  return dbp;
}

export const kv = {
  async get<T>(key: string): Promise<T | undefined> {
    try {
      return (await (await db()).get('kv', key)) as T | undefined;
    } catch {
      return undefined;
    }
  },
  async set(key: string, value: unknown) {
    try {
      await (await db()).put('kv', value, key);
    } catch {
      /* private mode or quota: the app still works online */
    }
  },
  async del(key: string) {
    try {
      await (await db()).delete('kv', key);
    } catch {}
  },
};

/** The `teams` store uses out-of-line keys: always write snapshots through these helpers. */
export async function saveSnapshot(s: TeamSnapshot): Promise<void> {
  await (await db()).put('teams', s, s.teamId);
}
export async function loadSnapshot(teamId: string): Promise<TeamSnapshot | undefined> {
  return (await db()).get('teams', teamId);
}

export async function clearAll() {
  const d = await db();
  await Promise.all(
    (['kv', 'teams', 'docs', 'outbox', 'match', 'runs'] as const).map((s) => d.clear(s)),
  );
}
