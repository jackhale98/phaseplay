/**
 * Where season stats get the rows the snapshot doesn't carry: match logs on this device (match
 * mode's IndexedDB copies) right away, the last stats feed from the device cache, then a fresh
 * feed from the API when online. The page renders from whatever has arrived.
 */
import type { MatchEvent, StatsFeed, StatsWindow } from '@phaseplay/shared';
import { api } from '#lib/api';
import { teamPath } from '#lib/data/actions';
import { db, kv } from '#lib/data/idb';

export type FeedStatus = 'loading' | 'live' | 'cached' | 'offline';

export class StatsSource {
  feed = $state.raw<StatsFeed | null>(null);
  local = $state.raw<Record<string, MatchEvent[]>>({});
  status = $state<FeedStatus>('loading');
  private token = 0;

  /** Load for one team and window (`key` names the window in the device cache). */
  async load(teamId: string, key: string, win: StatsWindow | null, gameIds: string[]) {
    const token = ++this.token;
    const live = () => token === this.token;
    const cacheKey = `stats:${teamId}:${key}`;
    this.status = 'loading';
    const [cached, local] = await Promise.all([kv.get<StatsFeed>(cacheKey), readLocal(gameIds)]);
    if (!live()) return;
    this.feed = cached ?? null;
    this.local = local;
    if (cached) this.status = 'cached';
    const q = win ? `?from=${win.from}&to=${win.to}` : '';
    try {
      const feed = await api<StatsFeed>(teamPath(`/stats${q}`));
      if (!live()) return;
      this.feed = feed;
      this.status = 'live';
      void kv.set(cacheKey, feed);
    } catch {
      if (live()) this.status = cached ? 'cached' : 'offline';
    }
  }
}

async function readLocal(ids: string[]): Promise<Record<string, MatchEvent[]>> {
  try {
    const d = await db();
    const rows = await Promise.all(ids.map((id) => d.get('match', id)));
    const out: Record<string, MatchEvent[]> = {};
    for (const r of rows) if (r?.events.length) out[r.eventId] = r.events;
    return out;
  } catch {
    return {};
  }
}
