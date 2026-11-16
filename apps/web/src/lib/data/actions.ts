/** Shared write helpers. Each is optimistic and goes through the outbox. */
import type { RsvpStatus, Rsvp } from '@phaseplay/shared';
import { v1 } from '#lib/api';
import { app } from './app.svelte';
import { rsvpKey } from './types';
import { rsvpOf } from './selectors';
import { buzz } from '#lib/haptics';
import { toasts } from '#lib/stores/toast.svelte';

export const teamPath = (p: string) => v1(`/teams/${app.teamId}${p}`);

export async function setRsvp(
  eventId: string,
  memberId: string,
  status: RsvpStatus,
  note: string | null = null,
  opts: { undo?: boolean } = {},
) {
  const s = app.snap;
  if (!s) return;
  const prev = rsvpOf(s, eventId, memberId);
  const key = rsvpKey(eventId, memberId);
  const value: Rsvp = {
    eventId,
    memberId,
    teamId: s.teamId,
    status,
    note: note ?? (prev?.status === status ? (prev?.note ?? null) : null),
    attended: prev?.attended ?? null,
    updatedAt: Date.now(),
  };
  const counts = { ...(s.rows.counts[eventId] ?? { yes: 0, no: 0, maybe: 0 }) };
  if (prev?.status) counts[prev.status] = Math.max(0, counts[prev.status] - 1);
  counts[status] += 1;
  buzz();
  const id = crypto.randomUUID();
  await app.mutate({
    id,
    method: 'PUT',
    path: teamPath(`/events/${eventId}/rsvps/${memberId}`),
    body: { status, note: value.note },
    label: 'Your reply',
    optimistic: [
      { op: 'put', entity: 'rsvps', key, value },
      { op: 'put', entity: 'counts', key: eventId, value: counts },
    ],
  });
  if (opts.undo !== false && prev?.status && prev.status !== status) {
    const back = prev.status;
    toasts.undo(`Marked ${status === 'yes' ? 'in' : status === 'no' ? 'out' : 'maybe'}`, () => {
      void app.cancel(id).then((cancelled) => {
        if (!cancelled) void setRsvp(eventId, memberId, back, prev.note, { undo: false });
      });
    });
  }
}
