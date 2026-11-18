/** Event writes for the schedule feature. All optimistic through the outbox, with undo where destructive. */
import {
  byStart,
  defaultAnswerBy,
  uuidv7,
  type EventOption,
  type ProposalOption,
  type EventCreate,
  type EventUpdate,
  type Recurrence,
  type RecurrenceCreate,
  type RecurrenceUpdate,
  type TeamEvent,
} from '@phaseplay/shared';
import { api, ApiError } from '#lib/api';
import { app } from '#lib/data/app.svelte';
import { teamPath } from '#lib/data/actions';
import type { Optimistic } from '#lib/data/idb';
import { answerKey } from '#lib/data/types';
import { optionsOf } from '#lib/data/selectors';
import { dropProposal } from './proposals';
import { toasts } from '#lib/stores/toast.svelte';

export async function createEvent(
  input: Omit<EventCreate, 'id' | 'status'> & { status?: EventCreate['status'] },
): Promise<string> {
  const id = uuidv7();
  const options = input.status === 'proposed' ? [...(input.options ?? [])].sort(byStart) : [];
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
    status: options.length ? 'proposed' : 'confirmed',
    answerBy: options.length
      ? (input.answerBy ?? defaultAnswerBy(Date.now(), options[0]!.startsAt))
      : null,
    target: options.length ? (input.target ?? null) : null,
    checkPositions: input.checkPositions !== false,
    version: 1,
    updatedAt: Date.now(),
    deletedAt: null,
  };
  if (options[0]) {
    value.startsAt = options[0].startsAt;
    value.meetAt = options[0].meetAt ?? null;
    value.endsAt = options[0].endsAt ?? null;
  }
  await app.mutate({
    method: 'POST',
    path: teamPath('/events'),
    body: { id, ...input },
    label: options.length ? 'New proposal' : 'New event',
    optimistic: [{ op: 'put', entity: 'events', key: id, value }, ...optionOps(id, options, [])],
  });
  return id;
}

/** Optimistic rows for a proposal's dates: put the listed ones, drop the rest (and their answers). */
function optionOps(eventId: string, next: ProposalOption[], prev: EventOption[]): Optimistic[] {
  const t = Date.now();
  const keep = new Set(next.map((o) => o.id));
  const gone = prev.filter((o) => !keep.has(o.id)).map((o) => o.id);
  const answers = Object.values(app.snap?.rows.answers ?? {}).filter((a) =>
    gone.includes(a.optionId),
  );
  return [
    ...next.map((o): Optimistic => ({
      op: 'put',
      entity: 'options',
      key: o.id,
      value: {
        id: o.id,
        eventId,
        teamId: app.teamId!,
        startsAt: o.startsAt,
        meetAt: o.meetAt ?? null,
        endsAt: o.endsAt ?? null,
        updatedAt: t,
        deletedAt: null,
      } satisfies EventOption,
    })),
    ...gone.map((key): Optimistic => ({ op: 'delete', entity: 'options', key })),
    ...answers.map((a): Optimistic => ({
      op: 'delete',
      entity: 'answers',
      key: answerKey(a.optionId, a.memberId),
    })),
  ];
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

/** Load a weekly series (needs a connection). */
export async function loadSeries(id: string): Promise<Recurrence | null> {
  try {
    return (await api<{ recurrence: Recurrence }>(teamPath(`/recurrences/${id}`))).recurrence;
  } catch (e) {
    toasts.error(
      e instanceof ApiError && e.code === 'network'
        ? "You're offline. Editing a whole series needs a connection."
        : `Couldn't load the series: ${(e as Error).message}`,
    );
    return null;
  }
}

/** Change every upcoming session in a series. Returns what changed, or null on failure. */
export async function updateSeries(
  id: string,
  input: RecurrenceUpdate,
): Promise<{ updated: number; added: number; removed: number } | null> {
  try {
    const r = await api<{ updated: number; added: number; removed: number }>(
      teamPath(`/recurrences/${id}`),
      { method: 'PUT', body: input },
    );
    await app.sync();
    return r;
  } catch (e) {
    toasts.error(
      e instanceof ApiError && e.code === 'network'
        ? "You're offline. Editing a whole series needs a connection."
        : `Couldn't update the series: ${(e as Error).message}`,
    );
    return null;
  }
}

/** Remove every upcoming session in a series (past ones stay). */
export async function deleteSeries(id: string): Promise<boolean> {
  try {
    await api(teamPath(`/recurrences/${id}`), { method: 'DELETE' });
    await app.sync();
    return true;
  } catch (e) {
    toasts.error(`Couldn't delete the series: ${(e as Error).message}`);
    return false;
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
  const extra: Optimistic[] = [];
  if (patch.options) {
    // The event mirrors its earliest date, as on the server.
    delete value.options;
    const first = [...patch.options].sort(byStart)[0]!;
    Object.assign(value, {
      startsAt: first.startsAt,
      meetAt: first.meetAt ?? null,
      endsAt: first.endsAt ?? null,
    });
    extra.push(...optionOps(id, patch.options, optionsOf(app.snap, id)));
  }
  const mid = crypto.randomUUID();
  await app.mutate({
    id: mid,
    method: 'PATCH',
    path: teamPath(`/events/${id}`),
    body: patch,
    label,
    versionOf: opts.versioned === false ? undefined : { entity: 'events', id },
    optimistic: [{ op: 'patch', entity: 'events', key: id, value }, ...extra],
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
 * Deleting an event, or dropping a proposal, can't be reversed on the server (and tells people),
 * so the request is held for the 5-second undo window. Meanwhile the event is hidden locally.
 * Leaving the page commits straight away.
 */
class PendingDeletes {
  ids = $state<string[]>([]);
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private drops = new Set<string>();

  hidden = (id: string) => this.ids.includes(id);

  /** "Not going ahead": the proposal disappears now; the drop is sent after the undo window. */
  drop(e: TeamEvent) {
    this.drops.add(e.id);
    this.remove(e, `Dropped ${e.title}. Everyone who answered will hear.`);
  }

  remove(e: TeamEvent, message = `Deleted ${e.title}`) {
    this.ids = [...this.ids, e.id];
    const commit = () => void this.commit(e.id);
    this.timers.set(e.id, setTimeout(commit, 5000));
    addEventListener('pagehide', commit, { once: true });
    toasts.undo(message, () => {
      clearTimeout(this.timers.get(e.id));
      this.timers.delete(e.id);
      this.drops.delete(e.id);
      removeEventListener('pagehide', commit);
      this.ids = this.ids.filter((x) => x !== e.id);
    });
  }

  private async commit(id: string) {
    if (!this.timers.has(id)) return;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    if (this.drops.delete(id)) {
      await dropProposal(id);
      this.ids = this.ids.filter((x) => x !== id);
      return;
    }
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
