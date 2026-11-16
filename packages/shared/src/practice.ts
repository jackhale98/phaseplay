/**
 * Practice planner and live runner (PLAN.md M5). A plan is an ordered list of time slots; each
 * slot holds one block per lane so parallel tracks stay time-aligned. Totals are derived, never
 * stored. The live runner is a pure reducer over a timestamped event log.
 */
import * as v from 'valibot';
import { Id, Millis, text } from './common';
import type { ContactLevel, EquipmentItem, EquipmentList } from './drills';

export const BLOCK_KINDS = ['drill', 'water', 'talk', 'game', 'custom'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const Rotation = v.object({
  groups: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(8)),
  stations: v.pipe(v.array(text(40, 1)), v.minLength(1), v.maxLength(8)),
  intervalMin: v.pipe(v.number(), v.minValue(1), v.maxValue(30)),
});

export const Block = v.object({
  id: v.pipe(v.string(), v.maxLength(40)),
  kind: v.picklist(BLOCK_KINDS),
  drillId: v.optional(Id),
  playId: v.optional(Id),
  title: v.optional(text(80)),
  durationMin: v.pipe(v.number(), v.minValue(1), v.maxValue(120)),
  lane: v.pipe(v.string(), v.minLength(1), v.maxLength(24)),
  coachId: v.optional(Id),
  notes: v.optional(text(500)),
  rotation: v.optional(Rotation),
});
export type Block = v.InferOutput<typeof Block>;

export const Slot = v.object({
  id: v.pipe(v.string(), v.maxLength(40)),
  blocks: v.pipe(v.array(Block), v.minLength(1), v.maxLength(6)),
});
export type Slot = v.InferOutput<typeof Slot>;

export const PlanData = v.object({
  lanes: v.pipe(v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(24))), v.minLength(1), v.maxLength(4)),
  slots: v.pipe(v.array(Slot), v.maxLength(60)),
  waterEveryMin: v.optional(v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(60)), 22),
});
export type PlanData = v.InferOutput<typeof PlanData>;

export const PlanInput = v.object({
  eventId: v.optional(v.nullable(Id), null),
  title: text(80, 1),
  isTemplate: v.optional(v.boolean(), false),
  visibility: v.optional(v.picklist(['coaches', 'team']), 'team'),
  data: PlanData,
});
export const PlanCreate = v.object({ id: Id, ...PlanInput.entries });
export type PlanCreate = v.InferOutput<typeof PlanCreate>;
export const PlanUpdate = v.partial(PlanInput);
export type PlanUpdate = v.InferOutput<typeof PlanUpdate>;

export const ALL_LANE = 'all';

export const LANE_LABELS: Record<string, string> = { all: 'Everyone', forwards: 'Forwards', backs: 'Backs' };
export const laneLabel = (lane: string) => LANE_LABELS[lane] ?? lane;

export function blockMinutes(b: Block): number {
  return b.rotation ? b.rotation.stations.length * b.rotation.intervalMin : b.durationMin;
}

export function slotMinutes(s: Slot): number {
  return Math.max(0, ...s.blocks.map(blockMinutes));
}

export type TimelineSlot = {
  index: number;
  slot: Slot;
  startMin: number;
  endMin: number;
  /** lane → filler minutes needed so the lane ends with the slot. */
  fillers: Record<string, number>;
};

export function timeline(plan: PlanData): TimelineSlot[] {
  let t = 0;
  return plan.slots.map((slot, index) => {
    const len = slotMinutes(slot);
    const fillers: Record<string, number> = {};
    const spansAll = slot.blocks.some((b) => b.lane === ALL_LANE);
    if (!spansAll)
      for (const lane of plan.lanes) {
        const b = slot.blocks.find((x) => x.lane === lane);
        const gap = len - (b ? blockMinutes(b) : 0);
        if (gap > 0) fillers[lane] = gap;
      }
    const out = { index, slot, startMin: t, endMin: t + len, fillers };
    t += len;
    return out;
  });
}

export type DrillFacts = {
  contactLevel: ContactLevel;
  intensity: number;
  equipment: EquipmentList;
  title?: string;
};

export type PlanTotals = {
  totalMin: number;
  contactMin: number;
  highIntensityMin: number;
  equipment: Partial<Record<EquipmentItem, number>>;
  /** Suggest a water break after these slot indexes. */
  waterAfter: number[];
};

const isContact = (l: ContactLevel) => l === 'shields' || l === 'full';

export function planTotals(plan: PlanData, drills: Record<string, DrillFacts>): PlanTotals {
  let totalMin = 0;
  let contactMin = 0;
  let highIntensityMin = 0;
  const equipment: Partial<Record<EquipmentItem, number>> = {};
  const waterAfter: number[] = [];
  let sinceWater = 0;
  const every = plan.waterEveryMin ?? 22;
  plan.slots.forEach((slot, i) => {
    const len = slotMinutes(slot);
    totalMin += len;
    let slotContact = 0;
    let slotHigh = 0;
    const slotEq: Partial<Record<EquipmentItem, number>> = {};
    for (const b of slot.blocks) {
      const d = b.drillId ? drills[b.drillId] : undefined;
      if (!d) continue;
      const m = blockMinutes(b);
      if (isContact(d.contactLevel)) slotContact = Math.max(slotContact, m);
      if (d.intensity >= 4) slotHigh = Math.max(slotHigh, m);
      for (const [k, n] of Object.entries(d.equipment) as [EquipmentItem, number][])
        slotEq[k] = (slotEq[k] ?? 0) + n;
    }
    for (const [k, n] of Object.entries(slotEq) as [EquipmentItem, number][])
      equipment[k] = Math.max(equipment[k] ?? 0, n);
    contactMin += slotContact;
    highIntensityMin += slotHigh;
    const isWater = slot.blocks.every((b) => b.kind === 'water');
    if (isWater) sinceWater = 0;
    else {
      sinceWater += len;
      const next = plan.slots[i + 1];
      const nextIsWater = next?.blocks.every((b) => b.kind === 'water') ?? false;
      if (sinceWater >= every && !nextIsWater && i < plan.slots.length - 1) {
        waterAfter.push(i);
        sinceWater = 0;
      }
    }
  });
  return { totalMin, contactMin, highIntensityMin, equipment, waterAfter };
}

/* ---------------------------------- Runner ---------------------------------- */

export type RunStep = {
  slotIndex: number;
  /** rotation index within the slot, or 0 */
  sub: number;
  subCount: number;
  plannedMs: number;
};

export function runSteps(plan: PlanData): RunStep[] {
  const out: RunStep[] = [];
  plan.slots.forEach((slot, slotIndex) => {
    const rot = slot.blocks.find((b) => b.rotation)?.rotation;
    if (rot && slot.blocks.length === 1) {
      for (let sub = 0; sub < rot.stations.length; sub++)
        out.push({ slotIndex, sub, subCount: rot.stations.length, plannedMs: rot.intervalMin * 60e3 });
    } else out.push({ slotIndex, sub: 0, subCount: 1, plannedMs: slotMinutes(slot) * 60e3 });
  });
  return out;
}

export const RUN_KINDS = ['start', 'advance', 'extend', 'pause', 'resume', 'skip', 'end'] as const;
export const RunEventInput = v.object({
  id: Id,
  kind: v.picklist(RUN_KINDS),
  payload: v.optional(
    v.object({
      auto: v.optional(v.boolean()),
      ms: v.optional(v.pipe(v.number(), v.minValue(-3600e3), v.maxValue(3600e3))),
      index: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    }),
    {},
  ),
  at: Millis,
});
export type RunEvent = v.InferOutput<typeof RunEventInput>;
export const RunAppend = v.object({ events: v.pipe(v.array(RunEventInput), v.minLength(1), v.maxLength(200)) });

export type RunState = {
  status: 'idle' | 'running' | 'paused' | 'ended';
  index: number;
  auto: boolean;
  stepStartedAt: number;
  /** effective duration of each step, including +2 min extensions. */
  durations: number[];
  remainingMs: number;
  elapsedMs: number;
  projectedFinishAt: number | null;
  startedAt: number | null;
  actuals: { index: number; ms: number; skipped: boolean }[];
};

/** Reduce run events (only those after the last `start`) at wall time `now`. Pure and drift-free. */
export function runState(steps: RunStep[], events: RunEvent[], now: number): RunState {
  const sorted = [...events].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const lastStart = sorted.map((e) => e.kind).lastIndexOf('start');
  const evs = lastStart >= 0 ? sorted.slice(lastStart) : [];
  const durations = steps.map((s) => s.plannedMs);
  const skipped = new Set<number>();
  const s: RunState = {
    status: 'idle',
    index: 0,
    auto: true,
    stepStartedAt: 0,
    durations,
    remainingMs: durations[0] ?? 0,
    elapsedMs: 0,
    projectedFinishAt: null,
    startedAt: null,
    actuals: [],
  };
  let pausedAt = 0;
  let pausedInStep = 0;

  const nextIndex = (from: number) => {
    let i = from + 1;
    while (i < steps.length && skipped.has(i)) i++;
    return i;
  };
  const finishStep = (at: number, wasSkipped = false) => {
    s.actuals.push({ index: s.index, ms: Math.max(0, at - s.stepStartedAt - pausedInStep), skipped: wasSkipped });
    s.index = nextIndex(s.index);
    s.stepStartedAt = at;
    pausedInStep = 0;
    if (s.index >= steps.length) s.status = 'ended';
  };
  const autoAdvanceUntil = (t: number) => {
    if (!s.auto) return;
    while (s.status === 'running' && s.index < steps.length) {
      const due = s.stepStartedAt + pausedInStep + (durations[s.index] ?? 0);
      if (due > t) break;
      finishStep(due);
    }
  };

  for (const e of evs) {
    if (e.at > now) break;
    if (s.status === 'running') autoAdvanceUntil(e.at);
    switch (e.kind) {
      case 'start':
        s.status = steps.length ? 'running' : 'ended';
        s.index = 0;
        s.auto = e.payload?.auto ?? true;
        s.stepStartedAt = e.at;
        s.startedAt = e.at;
        s.actuals = [];
        pausedInStep = 0;
        break;
      case 'pause':
        if (s.status === 'running') {
          s.status = 'paused';
          pausedAt = e.at;
        }
        break;
      case 'resume':
        if (s.status === 'paused') {
          pausedInStep += e.at - pausedAt;
          s.status = 'running';
        }
        break;
      case 'extend':
        if (s.status === 'running' || s.status === 'paused')
          durations[s.index] = Math.max(0, (durations[s.index] ?? 0) + (e.payload?.ms ?? 120e3));
        break;
      case 'advance':
        if (s.status === 'running' || s.status === 'paused') {
          if (s.status === 'paused') {
            pausedInStep += e.at - pausedAt;
            s.status = 'running';
          }
          finishStep(e.at);
        }
        break;
      case 'skip': {
        const idx = e.payload?.index ?? s.index;
        if (idx === s.index && (s.status === 'running' || s.status === 'paused')) {
          if (s.status === 'paused') {
            pausedInStep += e.at - pausedAt;
            s.status = 'running';
          }
          finishStep(e.at, true);
        } else if (idx > s.index) skipped.add(idx);
        break;
      }
      case 'end':
        if (s.status === 'running' || s.status === 'paused') {
          if (s.status === 'paused') pausedInStep += e.at - pausedAt;
          if (s.index < steps.length) finishStep(e.at);
        }
        s.status = 'ended';
        break;
    }
  }
  if (s.status === 'running') autoAdvanceUntil(now);

  if (s.status === 'running' || s.status === 'paused') {
    const ref = s.status === 'paused' ? pausedAt : now;
    s.elapsedMs = Math.max(0, ref - s.stepStartedAt - pausedInStep);
    s.remainingMs = (durations[s.index] ?? 0) - s.elapsedMs;
    let rest = 0;
    for (let i = s.index + 1; i < steps.length; i++) if (!skipped.has(i)) rest += durations[i] ?? 0;
    s.projectedFinishAt = now + Math.max(0, s.remainingMs) + rest;
  } else {
    s.remainingMs = 0;
  }
  return s;
}
