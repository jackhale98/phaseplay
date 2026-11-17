/**
 * The app's data layer (docs/architecture.md §Offline and sync). Screens render from the IndexedDB
 * snapshot immediately, then delta-sync on load, focus, reconnect and every 60 s while visible.
 * Writes are optimistic: applied to the snapshot, queued in the outbox, and retried with backoff.
 */
import {
  can as canDo,
  type Action,
  type MeResponse,
  type Perms,
  type SyncResponse,
  type Team,
  type TeamRole,
  type Member,
} from '@phaseplay/shared';
import { api, ApiError, v1 } from '#lib/api';
import {
  db,
  kv,
  clearAll,
  saveSnapshot,
  loadSnapshot,
  type OutboxEntry,
  type Optimistic,
  type VersionedEntity,
} from './idb';
import { rsvpKey, type TeamSnapshot } from './types';
import { toasts } from '#lib/stores/toast.svelte';
import { theme } from '#lib/stores/theme.svelte';

export type SyncStatus = 'synced' | 'syncing' | 'pending' | 'offline' | 'error';

const SYNC_EVERY = 60_000;
/** After this many 5xx/429 failures an entry is discarded so it can't block the queue. */
const MAX_SERVER_RETRIES = 6;
const VERSIONED_RESPONSE_KEYS: Record<string, VersionedEntity> = {
  event: 'events',
  sheet: 'sheets',
  play: 'plays',
  drill: 'drills',
  plan: 'plans',
  item: 'items',
};
/** Rows a write's response can carry, folded into the cache when it lands. */
const RESPONSE_ROWS: Record<string, keyof TeamSnapshot['rows']> = {
  ...VERSIONED_RESPONSE_KEYS,
  created: 'items',
  handoff: 'handoffs',
};

type ConflictListener = (entity: VersionedEntity, latest: { id: string }) => void;

function emptyRows(): TeamSnapshot['rows'] {
  return {
    members: {},
    seasons: {},
    events: {},
    rsvps: {},
    counts: {},
    sheets: {},
    plays: {},
    drills: {},
    plans: {},
    roles: {},
    items: {},
    handoffs: {},
  };
}

function applyOps(snap: TeamSnapshot, ops: Optimistic[]): TeamSnapshot {
  if (!ops.length) return snap;
  const rows = { ...snap.rows };
  for (const op of ops) {
    const table = { ...(rows[op.entity] as Record<string, unknown>) };
    if (op.op === 'put') table[op.key] = op.value;
    else if (op.op === 'patch')
      table[op.key] = { ...((table[op.key] as object) ?? {}), ...op.value };
    else delete table[op.key];
    (rows as Record<string, unknown>)[op.entity] = table;
  }
  return { ...snap, rows };
}

function mergeSync(prev: TeamSnapshot | null, res: SyncResponse): TeamSnapshot {
  const base: TeamSnapshot =
    res.full || !prev
      ? {
          teamId: res.team.id,
          cursor: 0,
          syncedAt: 0,
          team: res.team,
          me: res.me,
          rows: emptyRows(),
        }
      : prev;
  const rows = { ...base.rows };
  const upsert = <K extends keyof TeamSnapshot['rows']>(
    k: K,
    list: { id?: string }[],
    key: (x: never) => string,
    gone: (x: never) => boolean,
  ) => {
    if (!list.length && !res.full) return;
    const t = res.full ? {} : { ...(rows[k] as Record<string, unknown>) };
    for (const x of list) {
      const id = key(x as never);
      if (gone(x as never)) delete (t as Record<string, unknown>)[id];
      else (t as Record<string, unknown>)[id] = x;
    }
    (rows as Record<string, unknown>)[k] = t;
  };
  const byId = (x: { id: string }) => x.id;
  const deleted = (x: { deletedAt?: number | null }) => !!x.deletedAt;
  upsert('members', res.members, byId, (m: Member) => m.status === 'removed');
  upsert('seasons', res.seasons, byId, deleted);
  upsert('events', res.events, byId, deleted);
  upsert(
    'rsvps',
    res.rsvps as never[],
    (r: { eventId: string; memberId: string }) => rsvpKey(r.eventId, r.memberId),
    () => false,
  );
  upsert('sheets', res.sheets, byId, () => false);
  upsert('plays', res.plays, byId, deleted);
  upsert('drills', res.drills, byId, deleted);
  upsert('plans', res.plans, byId, deleted);
  if (!rows.roles) rows.roles = {};
  upsert('roles', res.roles ?? [], byId, deleted);
  rows.items ??= {};
  rows.handoffs ??= {};
  upsert('items', res.items ?? [], byId, deleted);
  // Resolved handovers arrive once so devices can drop them.
  upsert(
    'handoffs',
    res.handoffs ?? [],
    byId,
    (h: { resolvedAt: number | null }) => !!h.resolvedAt,
  );
  rows.counts = res.full ? { ...res.rsvpCounts } : { ...rows.counts, ...res.rsvpCounts };
  return {
    ...base,
    teamId: res.team.id,
    team: res.team,
    me: res.me,
    cursor: res.cursor,
    syncedAt: Date.now(),
    rows,
  };
}

class AppState {
  me = $state.raw<MeResponse | null>(null);
  ready = $state(false);
  teamId = $state<string | null>(null);
  snap = $state.raw<TeamSnapshot | null>(null);
  status = $state<SyncStatus>('synced');
  pending = $state(0);
  online = $state(true);
  /** Set by match mode and the practice runner so the update toast never reloads mid-session. */
  busy = $state(false);

  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing: Promise<void> | null = null;
  private flushing = false;
  /** entity:id → (version we sent → version the server returned) for our own writes. */
  private ownVersions: Record<string, Record<number, number>> = {};
  /** Id of the outbox entry currently being sent; it can no longer be cancelled. */
  private sending: string | null = null;
  private conflictListeners = new Set<ConflictListener>();
  /** Demo mode: optimistic changes kept in memory only (the server refuses demo writes). */
  private demoOps: Optimistic[] = [];
  private demoToastShown = false;

  /** Signed in to the public demo team. */
  get demo(): boolean {
    return !!this.me?.demo;
  }

  get team(): Team | null {
    return this.snap?.team ?? null;
  }
  get member(): Member | null {
    return this.snap?.me ?? null;
  }
  get role() {
    return this.snap?.me.role ?? null;
  }
  /** Team roles, sorted by name. */
  get teamRoles(): TeamRole[] {
    return Object.values(this.snap?.rows.roles ?? {}).sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Base role plus the grants from my team roles; the API checks the same thing. */
  get perms(): Perms | null {
    const s = this.snap;
    if (!s) return null;
    const roles = s.rows.roles ?? {};
    return {
      role: s.me.role,
      grants: (s.me.roleIds ?? []).flatMap((id) => roles[id]?.permissions ?? []),
    };
  }
  can(action: Action): boolean {
    return canDo(this.perms, action);
  }

  /** Boot: render from cache, then refresh in the background. Returns false when signed out. */
  async init(): Promise<boolean> {
    if (this.ready) return !!this.me;
    theme.init();
    this.online = navigator.onLine;
    const [me, teamId] = await Promise.all([kv.get<MeResponse>('me'), kv.get<string>('teamId')]);
    if (me) {
      this.me = me;
      await this.selectTeam(teamId ?? me.memberships[0]?.team.id ?? null, { sync: false });
    }
    this.ready = true;
    void this.countPending();
    const refreshed = this.refreshMe();
    if (!me) await refreshed;
    this.listen();
    if (this.teamId) void this.sync();
    void this.flush();
    return !!this.me;
  }

  async refreshMe() {
    try {
      const me = await api<MeResponse>(v1('/me'));
      this.me = me;
      await kv.set('me', me);
      if (!this.teamId || !me.memberships.some((m) => m.team.id === this.teamId))
        await this.selectTeam(me.memberships[0]?.team.id ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await this.signedOut();
    }
  }

  async selectTeam(teamId: string | null, opts: { sync?: boolean } = {}) {
    this.teamId = teamId;
    await kv.set('teamId', teamId);
    if (!teamId) {
      this.snap = null;
      theme.applyTeam(null);
      return;
    }
    const cached = await (await db()).get('teams', teamId).catch(() => undefined);
    this.snap = cached ? await this.withPending(cached) : null;
    const t = cached?.team ?? this.me?.memberships.find((m) => m.team.id === teamId)?.team;
    theme.applyTeam(t?.colors ?? null);
    if (opts.sync !== false) await this.sync();
  }

  /** Delta sync for the current team. Concurrent callers share one request. */
  sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    const teamId = this.teamId;
    if (!teamId) return Promise.resolve();
    this.syncing = (async () => {
      this.status = 'syncing';
      try {
        // Merge onto the stored server-confirmed snapshot (never onto optimistic/demo state),
        // so a rejected write can still be rolled back.
        const prev = (await loadSnapshot(teamId).catch(() => undefined)) ?? null;
        const res = await api<SyncResponse>(v1(`/teams/${teamId}/sync?since=${prev?.cursor ?? 0}`));
        const merged = mergeSync(prev, res);
        await saveSnapshot(merged).catch((e) => console.warn('Could not cache team data', e));
        if (this.teamId === teamId) {
          this.snap = await this.withPending(merged);
          theme.applyTeam(merged.team.colors);
        }
        this.status = this.pending ? 'pending' : 'synced';
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) await this.lostTeam(teamId);
        else if (e instanceof ApiError && e.status === 401) await this.signedOut();
        else this.status = e instanceof ApiError && e.code === 'network' ? 'offline' : 'error';
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  private async lostTeam(teamId: string) {
    const name =
      this.snap?.team.name ??
      this.me?.memberships.find((m) => m.team.id === teamId)?.team.name ??
      'the team';
    await (await db()).delete('teams', teamId).catch(() => {});
    toasts.show(`You've been removed from ${name}`, { tone: 'warn', timeout: 8000 });
    await this.refreshMe();
  }

  async signedOut() {
    this.demoOps = [];
    this.me = null;
    this.snap = null;
    this.teamId = null;
    await clearAll().catch(() => {});
    theme.applyTeam(null);
    try {
      localStorage.removeItem('pp:session');
    } catch {}
  }

  async signedIn() {
    // Never let the demo's cached data or on-device edits leak into a real account (or vice versa).
    // The previous user may only be known from IndexedDB (e.g. /signin on a fresh page load).
    const prev = this.me ?? (await kv.get<MeResponse>('me'));
    const next = await api<MeResponse>(v1('/me')).catch(() => null);
    this.demoOps = [];
    if (prev && (!next || prev.user.id !== next.user.id || prev.demo || next.demo)) {
      await clearAll().catch(() => {});
      this.snap = null;
      this.teamId = null;
      this.me = null;
    }
    try {
      localStorage.setItem('pp:session', '1');
    } catch {}
    await this.refreshMe();
    if (this.teamId) await this.sync();
  }

  /** Re-apply queued optimistic changes on top of a server snapshot. */
  private async withPending(s: TeamSnapshot): Promise<TeamSnapshot> {
    const entries = await this.outbox(s.teamId);
    const pending = entries.reduce((acc, e) => applyOps(acc, e.optimistic ?? []), s);
    return this.demo ? applyOps(pending, this.demoOps) : pending;
  }

  private async outbox(teamId?: string): Promise<OutboxEntry[]> {
    try {
      const d = await db();
      return teamId ? await d.getAllFromIndex('outbox', 'team', teamId) : await d.getAll('outbox');
    } catch {
      return [];
    }
  }

  private async countPending() {
    this.pending = (await this.outbox()).length;
    if (this.pending && this.status === 'synced') this.status = 'pending';
  }

  onConflict(fn: ConflictListener) {
    this.conflictListeners.add(fn);
    return () => this.conflictListeners.delete(fn);
  }

  /**
   * Queue a write. The optimistic ops apply now; the request is sent by the outbox (with
   * If-Match resolved at send time for versioned entities).
   */
  async mutate(
    entry: Omit<OutboxEntry, 'createdAt' | 'attempts' | 'nextAt' | 'teamId' | 'id'> & {
      teamId?: string;
      id?: string;
    },
  ) {
    const teamId = entry.teamId ?? this.teamId;
    if (!teamId) throw new Error('No team selected');
    if (entry.versionOf && entry.baseVersion === undefined) {
      const rows = this.snap?.teamId === teamId ? this.snap.rows : undefined;
      const row = (
        rows?.[entry.versionOf.entity] as Record<string, { version?: number }> | undefined
      )?.[entry.versionOf.id];
      entry = { ...entry, baseVersion: row?.version ?? 0 };
    }
    if (this.demo) {
      // Demo: show the change straight away, keep it on this device, never send it.
      const ops = entry.optimistic ?? [];
      this.demoOps.push(...ops);
      if (this.snap && this.snap.teamId === teamId) this.snap = applyOps(this.snap, ops);
      if (!this.demoToastShown) {
        this.demoToastShown = true;
        toasts.show("Demo team: your changes stay on this device and aren't saved.", {
          timeout: 5000,
        });
      }
      return;
    }
    const full: OutboxEntry = {
      ...entry,
      id: entry.id ?? crypto.randomUUID(),
      teamId,
      createdAt: Date.now(),
      attempts: 0,
      nextAt: 0,
    };
    if (this.snap && this.snap.teamId === teamId && full.optimistic)
      this.snap = applyOps(this.snap, full.optimistic);
    try {
      await (await db()).add('outbox', full);
    } catch {
      // No IndexedDB (private mode): send directly.
      await this.send(full);
      return;
    }
    this.pending++;
    this.status = this.online ? 'pending' : 'offline';
    void this.flush();
  }

  /** Remove a queued entry that hasn't been sent yet (instant undo). Returns true if it was found. */
  async cancel(id: string): Promise<boolean> {
    const d = await db();
    const all = await d.getAll('outbox');
    const e = all.find((x) => x.id === id);
    if (!e?.seq || this.sending === id) return false;
    await d.delete('outbox', e.seq);
    this.pending = Math.max(0, this.pending - 1);
    if (this.snap?.teamId === e.teamId) {
      const cached = await d.get('teams', e.teamId);
      if (cached) this.snap = await this.withPending(cached);
    }
    return true;
  }

  async flush() {
    if (this.flushing || !this.online) return;
    this.flushing = true;
    const run = async () => {
      try {
        for (;;) {
          const entries = (await this.outbox()).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
          const next = entries[0];
          if (!next) break;
          if (next.nextAt > Date.now()) {
            setTimeout(() => void this.flush(), next.nextAt - Date.now());
            break;
          }
          const ok = await this.send(next);
          if (!ok) break;
        }
      } finally {
        this.flushing = false;
        await this.countPending();
        if (!this.pending && this.status === 'pending') this.status = 'synced';
      }
    };
    if ('locks' in navigator) await navigator.locks.request('pp-outbox', run);
    else await run();
  }

  /** Send one entry. Returns false when the queue should pause (offline/backoff). */
  private async send(e: OutboxEntry): Promise<boolean> {
    const d = await db().catch(() => null);
    const drop = async () => {
      if (e.seq !== undefined) await d?.delete('outbox', e.seq);
    };
    let ifMatch: number | null = null;
    if (e.versionOf && e.baseVersion !== undefined) {
      // Follow our own earlier successful writes to this row (chained edits), nothing else.
      const chain = this.ownVersions[`${e.versionOf.entity}:${e.versionOf.id}`];
      let v = e.baseVersion ?? 0;
      for (let i = 0; chain?.[v] !== undefined && i < 1000; i++) v = chain[v]!;
      ifMatch = v || null;
    } else if (e.versionOf) {
      // Entries queued by an older app version: resolve from the cache as before.
      const s = e.teamId === this.snap?.teamId ? this.snap : await d?.get('teams', e.teamId);
      const row = (
        s?.rows[e.versionOf.entity] as Record<string, { version?: number }> | undefined
      )?.[e.versionOf.id];
      ifMatch = row?.version ?? null;
    }
    this.sending = e.id;
    try {
      const res = await api<Record<string, unknown>>(e.path, {
        method: e.method,
        body: e.body,
        ifMatch,
      });
      this.sending = null;
      if (e.versionOf) {
        const k = Object.entries(VERSIONED_RESPONSE_KEYS).find(
          ([, ent]) => ent === e.versionOf!.entity,
        )?.[0];
        const row = k ? (res?.[k] as { version?: number } | undefined) : undefined;
        if (row?.version) {
          const key = `${e.versionOf.entity}:${e.versionOf.id}`;
          (this.ownVersions[key] ??= {})[ifMatch ?? 0] = row.version;
        }
      }
      await drop();
      await this.absorb(e.teamId, res, e);
      return true;
    } catch (err) {
      this.sending = null;
      if (!(err instanceof ApiError)) throw err;
      if (err.retryable) {
        if (err.code === 'network') {
          this.status = 'offline';
          return false;
        }
        const attempts = e.attempts + 1;
        if (attempts >= MAX_SERVER_RETRIES) {
          await drop();
          toasts.error(`${e.label} couldn't be saved after several tries, so it was discarded.`);
          void this.resync(e.teamId);
          return true;
        }
        const backoff = Math.min(60_000, 1000 * 2 ** attempts) * (0.75 + Math.random() * 0.5);
        if (e.seq !== undefined)
          await d?.put('outbox', { ...e, attempts, nextAt: Date.now() + backoff });
        this.status = 'error';
        return false;
      }
      await drop();
      if (err.status === 401) {
        await this.signedOut();
        return false;
      }
      if (err.status === 409 && err.extra.latest && e.versionOf) {
        const latest = err.extra.latest as { id: string };
        await this.putRow(e.teamId, e.versionOf.entity, latest.id, latest);
        // Later queued edits were based on our stale copy: drop them rather than overwrite theirs.
        const vo = e.versionOf;
        for (const later of await this.outbox(e.teamId))
          if (
            later.seq !== undefined &&
            later.versionOf?.entity === vo.entity &&
            later.versionOf.id === vo.id
          )
            await d?.delete('outbox', later.seq);
        toasts.show(`${e.label}: someone else changed this at the same time.`, {
          tone: 'warn',
          timeout: 7000,
        });
        for (const fn of this.conflictListeners) fn(e.versionOf.entity, latest);
      } else {
        toasts.error(`${e.label} didn't save: ${err.message}`);
        if (err.status === 404 && e.path.includes(`/teams/${e.teamId}/sync`))
          await this.lostTeam(e.teamId);
      }
      // Re-derive the snapshot so failed optimistic changes are rolled back.
      void this.resync(e.teamId);
      return true;
    }
  }

  private async resync(teamId: string) {
    const d = await db();
    const cached = await d.get('teams', teamId);
    if (cached && this.snap?.teamId === teamId) this.snap = await this.withPending(cached);
    if (this.teamId === teamId) await this.sync();
  }

  /** Fold a write's response (e.g. a new version) into the stored snapshot. */
  private async absorb(teamId: string, res: Record<string, unknown> | null, e: OutboxEntry) {
    const d = await db().catch(() => null);
    const stored = await d?.get('teams', teamId);
    if (!stored) return;
    let next = applyOps(stored, e.optimistic ?? []);
    for (const [k, entity] of Object.entries(RESPONSE_ROWS)) {
      const row = res?.[k] as { id: string } | undefined;
      if (row?.id) next = applyOps(next, [{ op: 'put', entity, key: row.id, value: row }]);
    }
    if (d) await saveSnapshot(next);
    if (this.snap?.teamId === teamId) {
      // Keep any still-pending optimistic changes on top.
      this.snap = await this.withPending(next);
    }
  }

  async putRow(teamId: string, entity: keyof TeamSnapshot['rows'], key: string, value: unknown) {
    const d = await db().catch(() => null);
    const stored = await d?.get('teams', teamId);
    if (stored) await saveSnapshot(applyOps(stored, [{ op: 'put', entity, key, value }]));
    if (this.snap?.teamId === teamId)
      this.snap = applyOps(this.snap, [{ op: 'put', entity, key, value }]);
  }

  private listen() {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void this.sync();
        void this.flush();
        this.startTimer();
      } else this.stopTimer();
    };
    document.addEventListener('visibilitychange', onVisible);
    addEventListener('online', () => {
      this.online = true;
      this.status = this.pending ? 'pending' : 'synced';
      void this.flush();
      void this.sync();
    });
    addEventListener('offline', () => {
      this.online = false;
      this.status = 'offline';
    });
    addEventListener('focus', () => void this.sync());
    this.startTimer();
  }
  private startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => void this.sync(), SYNC_EVERY);
  }
  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const app = new AppState();
export { mergeSync, applyOps };
