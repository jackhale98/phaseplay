/**
 * Reads that aren't in the team snapshot: full plays and drills (with diagrams), cached in the
 * IndexedDB `docs` store for offline use, plus drafts and "seen by". Thumbnail loads go through a
 * small queue so a long playbook doesn't fire dozens of requests at once.
 */
import type { DrillFull, PlayFull, SeenBy } from '@phaseplay/shared';
import { migratePlay } from '@phaseplay/diagram/migrate';
import { api, ApiError } from '#lib/api';
import { db } from '#lib/data/idb';
import { app } from '#lib/data/app.svelte';
import { teamPath } from '#lib/data/actions';

export async function docGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await (await db()).get('docs', key))?.value as T | undefined;
  } catch {
    return undefined;
  }
}
export async function docPut(key: string, value: unknown): Promise<void> {
  try {
    await (await db()).put('docs', { key, value: plain(value), updatedAt: Date.now() });
  } catch {
    /* private mode or quota: still works online */
  }
}
export async function docDel(key: string): Promise<void> {
  try {
    await (await db()).delete('docs', key);
  } catch {}
}
/** Svelte $state proxies can't be structured-cloned; plain JSON round-trips them. */
function plain(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v));
}

export const playKey = (id: string) => `play:${id}`;
export const drillKey = (id: string) => `drill:${id}`;
export const playDraftKey = (id: string) => `draft:play:${id}`;
export const drillDraftKey = (id: string) => `draft:drill:${id}`;

const mem = new Map<string, { version: number; value: unknown }>();

function normalisePlay(p: PlayFull): PlayFull {
  try {
    return { ...p, data: migratePlay(p.data) };
  } catch {
    return p;
  }
}
function normaliseDrill(d: DrillFull): DrillFull {
  if (!d.diagram) return d;
  try {
    return { ...d, diagram: migratePlay(d.diagram) };
  } catch {
    return { ...d, diagram: null };
  }
}

/** Resolve once a team is selected (deep links select it just after boot). */
export async function whenTeam(timeoutMs = 10_000): Promise<string | null> {
  const t0 = Date.now();
  while (!app.teamId && Date.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 50));
  return app.teamId;
}

export type Loaded<T> = { value: T | null; cached: boolean; error?: 'offline' | 'not_found' };

async function load<T extends { version: number }>(
  key: string,
  path: string,
  pick: (r: Record<string, unknown>) => T,
  normalise: (t: T) => T,
  version?: number,
): Promise<Loaded<T>> {
  if (!app.teamId) return { value: null, cached: false, error: 'offline' };
  const hit = mem.get(key);
  if (hit && version !== undefined && hit.version >= version)
    return { value: hit.value as T, cached: true };
  const cached = await docGet<T>(key);
  if (cached && version !== undefined && cached.version >= version) {
    mem.set(key, { version: cached.version, value: cached });
    return { value: cached, cached: true };
  }
  try {
    const res = await api<Record<string, unknown>>(teamPath(path));
    const value = normalise(pick(res));
    mem.set(key, { version: value.version, value });
    void docPut(key, value);
    return { value, cached: false };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      void docDel(key);
      mem.delete(key);
      return { value: null, cached: false, error: 'not_found' };
    }
    return { value: cached ?? null, cached: true, error: 'offline' };
  }
}

export const loadPlay = (id: string, version?: number) =>
  load<PlayFull>(playKey(id), `/plays/${id}`, (r) => r.play as PlayFull, normalisePlay, version);

export const loadDrill = (id: string, version?: number) =>
  load<DrillFull>(
    drillKey(id),
    `/drills/${id}`,
    (r) => r.drill as DrillFull,
    normaliseDrill,
    version,
  );

/** Remember a full row we already have (after create/edit) so the viewer opens instantly. */
export function rememberPlay(p: PlayFull) {
  mem.set(playKey(p.id), { version: p.version, value: p });
  void docPut(playKey(p.id), p);
}
export function rememberDrill(d: DrillFull) {
  mem.set(drillKey(d.id), { version: d.version, value: d });
  void docPut(drillKey(d.id), d);
}

// ---------------------------------------------------------------------------------------------
// Thumbnail queue

type Job = () => Promise<void>;
const queue: Job[] = [];
let running = 0;
const MAX = 3;
function pump() {
  while (running < MAX && queue.length) {
    const job = queue.shift()!;
    running++;
    void job().finally(() => {
      running--;
      pump();
    });
  }
}
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    pump();
  });
}

// ---------------------------------------------------------------------------------------------
// Seen by (coaches)

const seenCache = new Map<string, { at: number; value: SeenBy }>();
export async function seenBy(id: string, fresh = false): Promise<SeenBy | null> {
  const hit = seenCache.get(id);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.value;
  try {
    const value = await api<SeenBy>(teamPath(`/plays/${id}/seen`));
    seenCache.set(id, { at: Date.now(), value });
    return value;
  } catch {
    return hit?.value ?? null;
  }
}

/** Record a view (one per player per play per day server-side). Fire-and-forget. */
export function recordView(id: string) {
  if (!app.teamId) return;
  void app
    .mutate({ method: 'POST', path: teamPath(`/plays/${id}/view`), body: {}, label: 'Seen' })
    .catch(() => {});
}
