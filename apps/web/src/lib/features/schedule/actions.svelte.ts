/** Event writes for the schedule feature. All optimistic through the outbox, with undo where destructive. */
import {
  uuidv7,
  type EventCreate,
  type EventUpdate,
  type RecurrenceCreate,
  type TeamEvent,
} from '@phaseplay/shared';
import { api, ApiError } from '#lib/api';
import { app } from '#lib/data/app.svelte';
import { teamPath } from '#lib/data/actions';
import { toasts } from '#lib/stores/toast.svelte';

export async function createEvent(input: Omit<EventCreate, 'id'>): Promise<string> {
  const id = uuidv7();
  const value: TeamEvent = {
    id,
    teamId: app.teamId!,
    seasonId: input.seasonId ?? null,
    type: input.type,
    format: input.format ?? null,
    title: input.title,
    startsAt: input.startsAt,
    meetAt: input.meetAt ?? null,
    endsAt: input.endsAt ?? null,
    locationName: input.locationName ?? null,
    locationUrl: input.locationUrl ?? null,
    opponent: input.opponent ?? null,
    notes: input.notes ?? null,
    rsvpDeadline: input.rsvpDeadline ?? null,
    recurrenceId: null,
    cancelledAt: null,
    settings: input.settings ?? null,
    version: 1,
    updatedAt: Date.now(),
    deletedAt: null,
  };
  await app.mutate({
    method: 'POST',
    path: teamPath('/events'),
    body: { id, ...input },
    label: 'New event',
    optimistic: [{ op: 'put', entity: 'events', key: id, value }],
  });
  return id;
}

/** Weekly series: not optimistic (the server expands the dates), so it needs a connection. */
export async function createSeries(input: Omit<RecurrenceCreate, 'id'>): Promise<number | null> {
  try {
    const r = await api<{ count: number }>(teamPath('/recurrences'), {
      method: 'POST',
      body: { id: uuidv7(), ...input },
    });
    await app.sync();
    return r.count;
  } catch (e) {
    toasts.error(
      e instanceof ApiError && e.code === 'network'
        ? "You're offline. Weekly series need a connection, try again when you're back."
        : `Couldn't create the series: ${(e as Error).message}`,
    );
    return null;
  }
}

export async function updateEvent(
  id: string,
  patch: EventUpdate,
  label = 'Event changes',
  opts: { versioned?: boolean } = {},
) {
  const value: Record<string, unknown> = { ...patch, updatedAt: Date.now() };
  if ('cancelled' in patch) {
    delete value.cancelled;
    value.cancelledAt = patch.cancelled ? Date.now() : null;
  }
  const mid = crypto.randomUUID();
  await app.mutate({
    id: mid,
    method: 'PATCH',
    path: teamPath(`/events/${id}`),
    body: patch,
    label,
    versionOf: opts.versioned === false ? undefined : { entity: 'events', id },
    optimistic: [{ op: 'patch', entity: 'events', key: id, value }],
  });
  return mid;
}

export async function setCancelled(e: TeamEvent, cancelled: boolean) {
  // Cancel/restore is a single flag, so last write wins (no If-Match). That also lets the undo
  // queue the reverse change straight behind the first one, which is usually already in flight.
  const opts = { versioned: false };
  await updateEvent(e.id, { cancelled }, cancelled ? 'Cancel event' : 'Restore event', opts);
  toasts.undo(cancelled ? 'Event cancelled' : 'Event back on', () => {
    void updateEvent(e.id, { cancelled: !cancelled }, 'Undo', opts);
  });
}

/**
 * Deleting can't be reversed on the server, so the request is held for the 5-second undo window.
 * Meanwhile the event is hidden locally. Leaving the page commits straight away.
 */
class PendingDeletes {
  ids = $state<string[]>([]);
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  hidden = (id: string) => this.ids.includes(id);

  remove(e: TeamEvent) {
    this.ids = [...this.ids, e.id];
    const commit = () => void this.commit(e.id);
    this.timers.set(e.id, setTimeout(commit, 5000));
    addEventListener('pagehide', commit, { once: true });
    toasts.undo(`Deleted ${e.title}`, () => {
      clearTimeout(this.timers.get(e.id));
      this.timers.delete(e.id);
      removeEventListener('pagehide', commit);
      this.ids = this.ids.filter((x) => x !== e.id);
    });
  }

  private async commit(id: string) {
    if (!this.timers.has(id)) return;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    await app.mutate({
      method: 'DELETE',
      path: teamPath(`/events/${id}`),
      label: 'Delete event',
      optimistic: [{ op: 'delete', entity: 'events', key: id }],
    });
    this.ids = this.ids.filter((x) => x !== id);
  }
}
export const pendingDeletes = new PendingDeletes();
