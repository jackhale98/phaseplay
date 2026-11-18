/** Proposal writes ("Not confirmed yet"). Optimistic through the outbox like replies. */
import type {
  AnswerCounts,
  OptionAnswer,
  ProposalAnswer,
  Rsvp,
  TeamEvent,
} from '@phaseplay/shared';
import { app } from '#lib/data/app.svelte';
import { teamPath } from '#lib/data/actions';
import type { Optimistic } from '#lib/data/idb';
import { answerKey, rsvpKey } from '#lib/data/types';
import { myAnswer, optionsOf, rsvpOf } from '#lib/data/selectors';
import { buzz } from '#lib/haptics';

/** Save my answers for some dates (one tap = one date; "None work" = every date "can't"). */
export async function answerProposal(
  eventId: string,
  answers: { optionId: string; answer: ProposalAnswer }[],
) {
  const s = app.snap;
  if (!s || !answers.length) return;
  const t = Date.now();
  const ops: Optimistic[] = [];
  for (const { optionId, answer } of answers) {
    const prev = myAnswer(s, optionId);
    if (prev === answer) continue;
    const row: OptionAnswer = {
      optionId,
      eventId,
      memberId: s.me.id,
      teamId: s.teamId,
      answer,
      updatedAt: t,
    };
    const counts: AnswerCounts = { ...(s.rows.answerCounts?.[optionId] ?? { in: 0, cant: 0 }) };
    if (prev) counts[prev] = Math.max(0, counts[prev] - 1);
    counts[answer] += 1;
    ops.push(
      { op: 'put', entity: 'answers', key: answerKey(optionId, s.me.id), value: row },
      { op: 'put', entity: 'answerCounts', key: optionId, value: counts },
    );
  }
  if (!ops.length) return;
  buzz();
  await app.mutate({
    method: 'PUT',
    path: teamPath(`/events/${eventId}/answers`),
    body: { answers },
    label: 'Your answer',
    optimistic: ops,
  });
}

/**
 * Confirm one date: the event takes its times, and everyone who was in becomes a "yes" asked to
 * reconfirm (the server does the same, so this is only what the coach sees straight away).
 */
export async function confirmProposal(e: TeamEvent, optionId: string, meetAt?: number | null) {
  const s = app.snap;
  const o = optionsOf(s, e.id).find((x) => x.id === optionId);
  if (!s || !o) return;
  const t = Date.now();
  const meet = meetAt !== undefined ? meetAt : o.meetAt;
  const ins = Object.values(s.rows.answers ?? {}).filter(
    (a) => a.optionId === optionId && a.answer === 'in',
  );
  const rsvps: Optimistic[] = ins
    .filter((a) => !rsvpOf(s, e.id, a.memberId)?.status)
    .map((a) => ({
      op: 'put',
      entity: 'rsvps',
      key: rsvpKey(e.id, a.memberId),
      value: {
        eventId: e.id,
        memberId: a.memberId,
        teamId: s.teamId,
        status: 'yes',
        note: null,
        attended: null,
        reconfirm: true,
        updatedAt: t,
      } satisfies Rsvp,
    }));
  const yes = (s.rows.counts[e.id]?.yes ?? 0) + rsvps.length;
  await app.mutate({
    method: 'POST',
    path: teamPath(`/events/${e.id}/confirm`),
    body: { optionId, ...(meetAt !== undefined ? { meetAt } : {}) },
    label: 'Confirm date',
    optimistic: [
      {
        op: 'patch',
        entity: 'events',
        key: e.id,
        value: {
          status: 'confirmed',
          startsAt: o.startsAt,
          meetAt: meet !== null && meet <= o.startsAt ? meet : null,
          endsAt: o.endsAt,
          updatedAt: t,
        },
      },
      ...rsvps,
      { op: 'put', entity: 'counts', key: e.id, value: { yes, maybe: 0, no: 0 } },
    ],
  });
}

/**
 * Not going ahead: hidden everywhere, and people who answered are told. Screens go through
 * `pendingDeletes.drop` (actions.svelte.ts) for the undo window; this sends it.
 */
export async function dropProposal(id: string) {
  await app.mutate({
    method: 'POST',
    path: teamPath(`/events/${id}/drop`),
    body: {},
    label: 'Drop proposal',
    optimistic: [
      {
        op: 'patch',
        entity: 'events',
        key: id,
        value: { status: 'dropped', updatedAt: Date.now() },
      },
    ],
  });
}
