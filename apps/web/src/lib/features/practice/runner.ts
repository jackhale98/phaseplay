/**
 * Live runner view-model. Everything is derived from the timestamped run log with the shared
 * `runState` reducer, so the clock never drifts: the UI ticks only to re-render.
 *
 * Auto-advance is done here rather than in the reducer (runs start with `auto: false`): when a
 * step is due, we append an `advance` stamped with the exact due time. That keeps the toggle
 * changeable mid-session and still gives exact timings after the screen was locked.
 */
import {
  blockMinutes,
  uuidv7,
  runState,
  runSteps,
  type Block,
  type PlanData,
  type RunEvent,
  type RunState,
  type RunStep,
  type Slot,
} from '@phaseplay/shared';
import { rotationRounds } from './model';

export type StepInfo = {
  index: number;
  step: RunStep;
  slot: Slot;
  /** Rotation round (station per group) when the step is one round of a rotation. */
  round?: { round: number; of: number; groups: { group: number; station: string }[] };
};

export type RunView = {
  state: RunState;
  steps: RunStep[];
  current: StepInfo | null;
  next: StepInfo | null;
  remainingMs: number;
  /** 0 → 1 through the current step (clamped). */
  progress: number;
  overtime: boolean;
  clock: string;
  projectedFinishAt: number | null;
  plannedTotalMs: number;
};

export function stepInfo(plan: PlanData, steps: RunStep[], index: number): StepInfo | null {
  const step = steps[index];
  const slot = step && plan.slots[step.slotIndex];
  if (!step || !slot) return null;
  const info: StepInfo = { index, step, slot };
  if (step.subCount > 1) {
    const rot = slot.blocks[0] as Block;
    const r = rotationRounds(rot)[step.sub];
    if (r) info.round = { round: step.sub, of: step.subCount, groups: r.groups };
  }
  return info;
}

/** m:ss, rounding up so "0:00" only shows at the end. Over time shows "+m:ss". */
export function formatClock(ms: number): string {
  const over = ms < 0;
  const s = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${over ? '+' : ''}${m}:${String(s % 60).padStart(2, '0')}`;
}

export function runView(plan: PlanData, events: RunEvent[], now: number): RunView {
  const steps = runSteps(plan);
  const state = runState(steps, events, now);
  const live = state.status === 'running' || state.status === 'paused';
  const current = live || state.status === 'idle' ? stepInfo(plan, steps, state.index) : null;
  let nextIndex = state.index + 1;
  const skippedAhead = skippedIndexes(events);
  while (skippedAhead.has(nextIndex)) nextIndex++;
  const next = live || state.status === 'idle' ? stepInfo(plan, steps, nextIndex) : null;
  const dur = state.durations[state.index] ?? 0;
  const remainingMs = live ? state.remainingMs : state.status === 'idle' ? dur : 0;
  return {
    state,
    steps,
    current,
    next,
    remainingMs,
    progress: live && dur > 0 ? Math.min(1, Math.max(0, state.elapsedMs / dur)) : 0,
    overtime: live && remainingMs < 0,
    clock: formatClock(remainingMs),
    projectedFinishAt: state.projectedFinishAt,
    plannedTotalMs: steps.reduce((n, s) => n + s.plannedMs, 0),
  };
}

/**
 * Ids for step transitions (advance / skip / end) are derived from the run's start event and the
 * step index, so when two coaches' phones both move on from the same block (auto-advance on
 * both, or both tap Next) they produce the same event and the merge keeps one.
 */
export function transitionId(
  events: RunEvent[],
  kind: 'advance' | 'skip' | 'end',
  index: number,
): string {
  const start = mergeEvents(events, [])
    .filter((e) => e.kind === 'start')
    .at(-1);
  if (!start) return uuidv7();
  const code = { advance: 'a', skip: 'b', end: 'c' }[kind];
  const h = start.id.replace(/-/g, '').slice(0, 20) + code + index.toString(16).padStart(11, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type LaneNow = {
  lane: string;
  block: Block;
  /** Time left in this group's own block (its drill may be shorter than the slot). */
  remainingMs: number;
  /** This group has finished and is waiting for the others to finish the slot. */
  done: boolean;
};

/**
 * Per-group countdowns for a split slot (e.g. forwards at the scrum machine, backs on strike
 * moves). +2 min extensions apply to every group. Empty for single-block or rotation steps.
 */
export function laneStatus(view: RunView): LaneNow[] {
  const info = view.current;
  if (!info || info.round || info.slot.blocks.length < 2) return [];
  const live = view.state.status === 'running' || view.state.status === 'paused';
  const extra = (view.state.durations[info.index] ?? 0) - info.step.plannedMs;
  const elapsed = live ? view.state.elapsedMs : 0;
  return info.slot.blocks.map((b) => {
    const remainingMs = blockMinutes(b) * 60e3 + extra - elapsed;
    return {
      lane: b.lane,
      block: b,
      remainingMs,
      done: live && remainingMs <= 0 && view.remainingMs > 0,
    };
  });
}

/** Indexes queued to skip (skip events with a future index) since the last start. */
export function skippedIndexes(events: RunEvent[]): Set<number> {
  const sorted = [...events].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const from = sorted.map((e) => e.kind).lastIndexOf('start');
  const out = new Set<number>();
  for (const e of from >= 0 ? sorted.slice(from) : [])
    if (e.kind === 'skip' && e.payload?.index !== undefined) out.add(e.payload.index);
  return out;
}

/**
 * Auto-advance: the `advance` events due by `now`, each stamped with its exact due time.
 * Returns [] when nothing is due (or the run is paused/ended).
 */
export function dueAdvances(steps: RunStep[], events: RunEvent[], now: number): RunEvent[] {
  const out: RunEvent[] = [];
  let all = events;
  for (let guard = 0; guard <= steps.length; guard++) {
    const s = runState(steps, all, now);
    if (s.status !== 'running' || s.remainingMs > 0) break;
    const at = Math.round(now + s.remainingMs);
    const e: RunEvent = {
      id: transitionId(all, 'advance', s.index),
      kind: 'advance',
      payload: { auto: true },
      at,
    };
    if (all.some((x) => x.id === e.id)) break;
    out.push(e);
    all = [...all, e];
  }
  return out;
}

export type Milestone = 'one-minute' | 'end';

/**
 * Milestones crossed between two renders of the same step. Only recent crossings count, so
 * waking a locked phone doesn't replay old chimes.
 */
export function crossed(
  prev: { index: number; remainingMs: number } | null,
  cur: { index: number; remainingMs: number; running: boolean },
  windowMs = 5000,
): Milestone | null {
  if (!prev || !cur.running) return null;
  if (prev.index !== cur.index) return null;
  if (prev.remainingMs > 0 && cur.remainingMs <= 0 && cur.remainingMs > -windowMs) return 'end';
  if (prev.remainingMs > 60e3 && cur.remainingMs <= 60e3 && cur.remainingMs > 60e3 - windowMs)
    return 'one-minute';
  return null;
}

export type SummaryRow = {
  index: number;
  slotIndex: number;
  sub: number;
  plannedMs: number;
  actualMs: number | null;
  skipped: boolean;
};

/** What actually ran, step by step (actual null = never reached). */
export function summary(
  steps: RunStep[],
  state: RunState,
): { rows: SummaryRow[]; plannedMs: number; actualMs: number; skipped: number } {
  const byIndex = new Map(state.actuals.map((a) => [a.index, a]));
  const rows = steps.map((s, index) => {
    const a = byIndex.get(index);
    return {
      index,
      slotIndex: s.slotIndex,
      sub: s.sub,
      plannedMs: s.plannedMs,
      actualMs: a && !a.skipped ? a.ms : null,
      skipped: !a || a.skipped,
    };
  });
  return {
    rows,
    plannedMs: steps.reduce((n, s) => n + s.plannedMs, 0),
    actualMs: rows.reduce((n, r) => n + (r.actualMs ?? 0), 0),
    skipped: rows.filter((r) => r.skipped).length,
  };
}

/** Merge two event logs by id (server + local), sorted by time. */
export function mergeEvents(a: RunEvent[], b: RunEvent[]): RunEvent[] {
  const m = new Map<string, RunEvent>();
  for (const e of [...a, ...b]) m.set(e.id, e);
  return [...m.values()].sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
}
