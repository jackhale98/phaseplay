/**
 * Pure helpers over the append-only match log (PLAN.md M6 §Sync). The log only ever grows:
 * merging two copies is a union by id, and corrections are new `edit` / `void` events.
 */
import {
  effectiveLog,
  uuidv7,
  type MatchEvent,
  type MatchEventInput,
  type MatchPayload,
} from '@phaseplay/shared';

/** Union by id. The first copy of an id wins (pass the server copy first). Stable wall order. */
export function mergeLogs(...logs: MatchEvent[][]): MatchEvent[] {
  const byId = new Map<string, MatchEvent>();
  for (const log of logs) for (const e of log) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort(
    (a, b) => a.wallAt - b.wallAt || a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function nextSeq(log: MatchEvent[]): number {
  let max = -1;
  for (const e of log) if (e.seq > max) max = e.seq;
  return max + 1;
}

/** A new event: uuidv7 id, the next seq, wall time now and the game time it happened at. */
export function createEvent(
  log: MatchEvent[],
  payload: MatchPayload,
  gameMs: number,
  now: number,
): MatchEvent {
  return {
    id: uuidv7(now),
    seq: nextSeq(log),
    payload,
    gameMs: Math.max(0, Math.round(gameMs)),
    wallAt: now,
  };
}

/** Wire shape only (drops server-added fields). */
export function toInput(e: MatchEvent): MatchEventInput {
  return { id: e.id, seq: e.seq, payload: e.payload, gameMs: e.gameMs, wallAt: e.wallAt };
}

export const isCorrection = (e: MatchEvent) =>
  e.payload.kind === 'edit' || e.payload.kind === 'void';

/** The most recently recorded entry that is still in effect: the target of "Undo last". */
export function lastUndoable(events: MatchEvent[]): MatchEvent | undefined {
  let best: MatchEvent | undefined;
  for (const e of effectiveLog(events)) {
    if (isCorrection(e)) continue;
    if (!best || e.wallAt > best.wallAt || (e.wallAt === best.wallAt && e.seq > best.seq)) best = e;
  }
  return best;
}

/** Temporary replacements still on the field (can be reversed with `sub_return`). */
export function openTemporarySubs(events: MatchEvent[], playing: string[]) {
  const log = effectiveLog(events);
  const returned = new Set(
    log.flatMap((e) => (e.payload.kind === 'sub_return' ? [e.payload.subId] : [])),
  );
  const on = new Set(playing);
  return log.filter(
    (e): e is MatchEvent & { payload: Extract<MatchPayload, { kind: 'sub' }> } =>
      e.payload.kind === 'sub' &&
      e.payload.type === 'temporary' &&
      !returned.has(e.id) &&
      on.has(e.payload.onId),
  );
}

/** Parse "mm:ss" (or plain minutes) into ms; null when invalid. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  const m = /^(\d{1,3})(?::([0-5]\d))?$/.exec(t);
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2] ?? 0)) * 1000;
}

/** Rugby minute for a game time: 0:00–0:59 is the 1st minute. */
export const minuteOf = (gameMs: number) => Math.floor(gameMs / 60e3) + 1;
