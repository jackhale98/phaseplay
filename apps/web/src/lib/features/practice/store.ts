/**
 * Run logs and drill diagrams. Run events are written to IndexedDB first and then posted through
 * the outbox (idempotent by id), so a session runs fine with no signal.
 */
import { uuidv7, type DrillFull, type RunEvent, type RunEventsResponse } from '@phaseplay/shared';
import { api, v1 } from '#lib/api';
import { app } from '#lib/data/app.svelte';
import { db } from '#lib/data/idb';
import { mergeEvents } from './runner';

const runsPath = (teamId: string, planId: string) => v1(`/teams/${teamId}/plans/${planId}/runs`);

export async function localRun(planId: string): Promise<RunEvent[]> {
  try {
    return (await (await db()).get('runs', planId))?.events ?? [];
  } catch {
    return [];
  }
}

async function saveLocal(planId: string, events: RunEvent[]) {
  try {
    await (await db()).put('runs', { planId, events });
  } catch {
    /* private mode: the outbox still sends */
  }
}

/** Server log merged with anything recorded locally. Falls back to local when offline. */
export async function loadRun(teamId: string, planId: string): Promise<RunEvent[]> {
  const local = await localRun(planId);
  try {
    const res = await api<RunEventsResponse>(runsPath(teamId, planId));
    const merged = mergeEvents(res.events, local);
    if (merged.length !== local.length) await saveLocal(planId, merged);
    return merged;
  } catch {
    return local;
  }
}

/** Server log only (players following along). */
export async function fetchRun(teamId: string, planId: string): Promise<RunEvent[]> {
  const res = await api<RunEventsResponse>(runsPath(teamId, planId));
  return mergeEvents(res.events, []);
}

export const newRunEventId = () => uuidv7();

/** Persist locally, then queue for the server (no optimistic rows: the log isn't in the snapshot). */
export async function appendRun(planId: string, all: RunEvent[], added: RunEvent[]) {
  if (!added.length) return;
  await saveLocal(planId, all);
  if (!app.teamId) return;
  await app.mutate({
    method: 'POST',
    path: runsPath(app.teamId, planId),
    body: { events: added },
    label: 'Practice timer',
  });
}

const memo = new Map<string, Promise<DrillFull | null>>();

/** A drill with its diagram, cached in IndexedDB (`docs`, key drill:{id}) by version. */
export function fetchDrill(
  teamId: string,
  id: string,
  version?: number,
): Promise<DrillFull | null> {
  const key = `drill:${id}`;
  const hit = memo.get(`${key}@${version ?? ''}`);
  if (hit) return hit;
  const p = (async () => {
    const d = await db().catch(() => null);
    const cached = (await d?.get('docs', key).catch(() => undefined))?.value as
      DrillFull | undefined;
    if (cached && (version === undefined || cached.version >= version)) return cached;
    try {
      const { drill } = await api<{ drill: DrillFull }>(v1(`/teams/${teamId}/drills/${id}`));
      await d?.put('docs', { key, value: drill, updatedAt: Date.now() }).catch(() => {});
      return drill;
    } catch {
      return cached ?? null;
    }
  })();
  memo.set(`${key}@${version ?? ''}`, p);
  void p.then((r) => r || memo.delete(`${key}@${version ?? ''}`));
  return p;
}
