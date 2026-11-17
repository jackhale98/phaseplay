/**
 * Where season stats get the rows the snapshot doesn't carry: match logs on this device (match
 * mode's IndexedDB copies) right away, then the last stats feed from the device cache, then a fresh
 * feed from the API when online and the cached one is over 5 minutes old (stats move slowly; this
 * keeps D1 reads down). If the feed hit its row cap, the missing games' logs come one by one from
 * `match.list`, the same read the match summary uses.
 */
import type { MatchEvent, MatchEventsResponse, StatsFeed, StatsWindow } from '@phaseplay/shared';
import { api } from '#lib/api';
import { teamPath } from '#lib/data/actions';
import { db, kv } from '#lib/data/idb';

export type FeedStatus = 'loading' | 'live' | 'cached' | 'offline';
/** A cached feed is reused without asking the server for this long. */
export const FEED_FRESH_MS = 5 * 60e3;
/** At most this many logs are fetched one by one after a capped feed. */
const BACKFILL_MAX = 40;

type Cached = { at: number; feed: StatsFeed; extra: Record<string, MatchEvent[]> };

export class StatsSource {
  feed = $state.raw<StatsFeed | null>(null);
  /** Logs fetched one by one because the feed was capped (empty array = nothing recorded). */
  extra = $state.raw<Record<string, MatchEvent[]>>({});
  local = $state.raw<Record<string, MatchEvent[]>>({});
  status = $state<FeedStatus>('loading');
  private token = 0;

  /** Load for one team and window (`key` names the window in the device cache). */
  async load(teamId: string, key: string, win: StatsWindow | null, gameIds: string[]) {
    const token = ++this.token;
    const live = () => token === this.token;
    const cacheKey = `stats:${teamId}:${key}`;
    this.status = 'loading';
    const [raw, local] = await Promise.all([kv.get<Cached>(cacheKey), readLocal(gameIds)]);
    if (!live()) return;
    // Caches from before the 5-minute rule held a bare feed: treat them as stale.
    const cached = raw && 'feed' in raw ? raw : null;
    this.feed = cached?.feed ?? null;
    this.extra = cached?.extra ?? {};
    this.local = local;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.status = cached ? 'cached' : 'offline';
      return;
    }
    if (cached && Date.now() - cached.at < FEED_FRESH_MS) {
      this.status = 'live';
      return;
    }
    if (cached) this.status = 'cached';
    const q = win ? `?from=${win.from}&to=${win.to}` : '';
    try {
      const feed = await api<StatsFeed>(teamPath(`/stats${q}`));
      if (!live()) return;
      const extra = feed.truncated ? await backfill(feed, gameIds) : {};
      if (!live()) return;
      this.feed = feed;
      this.extra = extra;
      this.status = 'live';
      void kv.set(cacheKey, { at: Date.now(), feed, extra } satisfies Cached);
    } catch {
      if (live()) this.status = cached ? 'cached' : 'offline';
    }
  }
}

async function backfill(feed: StatsFeed, gameIds: string[]) {
  const want = gameIds.filter((id) => !feed.matches[id]).slice(0, BACKFILL_MAX);
  const out: Record<string, MatchEvent[]> = {};
  for (let i = 0; i < want.length; i += 4)
    await Promise.all(
      want.slice(i, i + 4).map(async (id) => {
        try {
          out[id] = (await api<MatchEventsResponse>(teamPath(`/events/${id}/match`))).events;
        } catch {
          /* left out: the page says these games' logs didn't load */
        }
      }),
    );
  return out;
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
