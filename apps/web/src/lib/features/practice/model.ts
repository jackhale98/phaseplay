/**
 * Pure planner helpers over the shared PlanData contract (packages/shared/src/practice.ts).
 * Every edit returns a new PlanData so screens can autosave the whole document.
 */
import {
  ALL_LANE,
  EQUIPMENT,
  EQUIPMENT_LABELS,
  blockMinutes,
  laneLabel,
  planTotals,
  timeline,
  type Block,
  type BlockKind,
  type DrillFacts,
  type DrillMeta,
  type EquipmentItem,
  type PlanData,
  type PracticePlan,
  type Slot,
  type TeamEvent,
} from '@phaseplay/shared';

export const rid = (p = 'b') => `${p}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

export const SPLIT_LANES = ['forwards', 'backs'];
export type LaneMode = 'all' | 'split' | 'custom';

export function laneMode(lanes: string[]): LaneMode {
  if (lanes.length === 1 && lanes[0] === ALL_LANE) return 'all';
  if (lanes.length === 2 && lanes[0] === 'forwards' && lanes[1] === 'backs') return 'split';
  return 'custom';
}

export const KIND_LABELS: Record<BlockKind, string> = {
  drill: 'Drill',
  water: 'Water break',
  talk: 'Team talk',
  game: 'Game',
  custom: 'Custom block',
};
const KIND_MINUTES: Record<BlockKind, number> = {
  drill: 10,
  water: 3,
  talk: 5,
  game: 15,
  custom: 10,
};

export function emptyPlan(): PlanData {
  return { lanes: [ALL_LANE], slots: [], waterEveryMin: 22 };
}

export function makeBlock(
  kind: BlockKind,
  lane: string,
  drill?: Pick<DrillMeta, 'id' | 'defaultDurationMin'>,
): Block {
  const b: Block = {
    id: rid(),
    kind,
    lane,
    durationMin: drill?.defaultDurationMin ?? KIND_MINUTES[kind],
  };
  if (kind === 'drill' && drill) b.drillId = drill.id;
  if (kind !== 'drill') b.title = KIND_LABELS[kind];
  return b;
}

export function drillFacts(
  drills: Record<string, DrillMeta> | undefined,
): Record<string, DrillFacts> {
  const out: Record<string, DrillFacts> = {};
  for (const d of Object.values(drills ?? {}))
    out[d.id] = {
      contactLevel: d.contactLevel,
      intensity: d.intensity,
      equipment: d.equipment,
      title: d.title,
    };
  return out;
}

export function blockTitle(
  b: Block,
  drills: Record<string, Pick<DrillMeta, 'title'>> | undefined,
): string {
  if (b.kind === 'drill') return (b.drillId && drills?.[b.drillId]?.title) || b.title || 'Drill';
  return b.title || KIND_LABELS[b.kind];
}

const isSplitSlot = (s: Slot) => !s.blocks.some((b) => b.lane === ALL_LANE);
export { isSplitSlot };

/* --------------------------------- Edits --------------------------------- */

const withSlots = (p: PlanData, slots: Slot[]): PlanData => ({ ...p, slots });

/** Add a block as a new slot (at `index`, default the end). */
export function addSlot(p: PlanData, block: Block, index = p.slots.length): PlanData {
  const lane = block.lane === ALL_LANE || p.lanes.includes(block.lane) ? block.lane : ALL_LANE;
  const slots = [...p.slots];
  slots.splice(index, 0, { id: rid('s'), blocks: [{ ...block, lane }] });
  return withSlots(p, slots);
}

/** Put a block into one lane of a split slot (replacing whatever that lane had). */
export function setLaneBlock(p: PlanData, slotId: string, block: Block): PlanData {
  return withSlots(
    p,
    p.slots.map((s) => {
      if (s.id !== slotId) return s;
      if (block.lane === ALL_LANE) return { ...s, blocks: [block] };
      const others = s.blocks.filter(
        (b) => b.lane !== block.lane && b.lane !== ALL_LANE && b.id !== block.id,
      );
      return { ...s, blocks: sortLanes(p.lanes, [...others, block]) };
    }),
  );
}

function sortLanes(lanes: string[], blocks: Block[]): Block[] {
  return [...blocks].sort((a, b) => lanes.indexOf(a.lane) - lanes.indexOf(b.lane));
}

export function findBlock(
  p: PlanData,
  blockId: string,
): { slot: Slot; index: number; block: Block } | null {
  for (let index = 0; index < p.slots.length; index++) {
    const slot = p.slots[index]!;
    const block = slot.blocks.find((b) => b.id === blockId);
    if (block) return { slot, index, block };
  }
  return null;
}

export function updateBlock(p: PlanData, blockId: string, patch: Partial<Block>): PlanData {
  const found = findBlock(p, blockId);
  if (!found) return p;
  const next: Block = { ...found.block, ...patch };
  for (const k of Object.keys(next) as (keyof Block)[]) if (next[k] === undefined) delete next[k];
  if (patch.durationMin !== undefined) next.durationMin = clampMin(patch.durationMin);
  if (patch.lane !== undefined && patch.lane !== found.block.lane)
    return moveToLane(p, found, next);
  return withSlots(
    p,
    p.slots.map((s) =>
      s.id === found.slot.id
        ? { ...s, blocks: s.blocks.map((b) => (b.id === blockId ? next : b)) }
        : s,
    ),
  );
}

export const clampMin = (n: number) => Math.min(120, Math.max(1, Math.round(n) || 1));

function moveToLane(
  p: PlanData,
  found: { slot: Slot; index: number; block: Block },
  next: Block,
): PlanData {
  const { slot, index } = found;
  const slots = [...p.slots];
  if (next.lane === ALL_LANE) {
    // Joining everyone: if other lanes are busy in this slot, the block gets its own slot after.
    const rest = slot.blocks.filter((b) => b.id !== next.id);
    if (!rest.length) slots[index] = { ...slot, blocks: [next] };
    else {
      slots[index] = { ...slot, blocks: rest };
      slots.splice(index + 1, 0, { id: rid('s'), blocks: [next] });
    }
    return withSlots(p, slots);
  }
  const prevLane = found.block.lane;
  const blocks = slot.blocks
    .filter((b) => b.id !== next.id && b.lane !== ALL_LANE)
    // Swap with whatever held the target lane.
    .map((b) =>
      b.lane === next.lane
        ? { ...b, lane: prevLane === ALL_LANE ? otherLane(p, next.lane) : prevLane }
        : b,
    )
    .filter((b) => b.lane !== next.lane);
  slots[index] = { ...slot, blocks: sortLanes(p.lanes, [...blocks, next]) };
  return withSlots(p, slots);
}

const otherLane = (p: PlanData, lane: string) => p.lanes.find((l) => l !== lane) ?? lane;

export function removeBlock(p: PlanData, blockId: string): PlanData {
  return withSlots(
    p,
    p.slots
      .map((s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== blockId) }))
      .filter((s) => s.blocks.length > 0),
  );
}

export function removeSlot(p: PlanData, slotId: string): PlanData {
  return withSlots(
    p,
    p.slots.filter((s) => s.id !== slotId),
  );
}

export function moveSlot(p: PlanData, from: number, to: number): PlanData {
  if (from === to || from < 0 || from >= p.slots.length) return p;
  const slots = [...p.slots];
  const [s] = slots.splice(from, 1);
  slots.splice(Math.max(0, Math.min(slots.length, to)), 0, s!);
  return withSlots(p, slots);
}

export function insertWater(p: PlanData, afterIndex: number, minutes = 3): PlanData {
  return addSlot(p, { ...makeBlock('water', ALL_LANE), durationMin: minutes }, afterIndex + 1);
}

/** Split an "everyone" slot across the plan's lanes (its block goes to the first lane). */
export function splitSlot(p: PlanData, slotId: string): PlanData {
  if (laneMode(p.lanes) === 'all') return p;
  return withSlots(
    p,
    p.slots.map((s) =>
      s.id === slotId && !isSplitSlot(s)
        ? {
            ...s,
            blocks: s.blocks
              .map((b) => ({ ...b, lane: p.lanes[0]!, rotation: undefined }))
              .map(stripUndef),
          }
        : s,
    ),
  );
}

const stripUndef = (b: Block): Block => {
  const out = { ...b };
  for (const k of Object.keys(out) as (keyof Block)[]) if (out[k] === undefined) delete out[k];
  return out;
};

/**
 * Change the plan's lanes. Blocks keep their position (lane i → new lane i); when going back to
 * "everyone", parallel blocks become consecutive slots so nothing is lost.
 */
export function setLanes(p: PlanData, lanes: string[]): PlanData {
  const clean = lanes.map((l) => l.trim().slice(0, 24)).filter(Boolean);
  const next = clean.length ? [...new Set(clean)].slice(0, 4) : [ALL_LANE];
  const toAll = next.length === 1 && next[0] === ALL_LANE;
  const slots: Slot[] = [];
  for (const s of p.slots) {
    if (!isSplitSlot(s)) {
      slots.push(s);
      continue;
    }
    if (toAll) {
      s.blocks.forEach((b, i) =>
        slots.push({ id: i === 0 ? s.id : rid('s'), blocks: [{ ...b, lane: ALL_LANE }] }),
      );
      continue;
    }
    const keep: Block[] = [];
    const spill: Block[] = [];
    for (const b of s.blocks) {
      const i = p.lanes.indexOf(b.lane);
      const lane = i >= 0 && i < next.length ? next[i]! : undefined;
      if (lane && !keep.some((k) => k.lane === lane)) keep.push({ ...b, lane });
      else spill.push(b);
    }
    if (keep.length) slots.push({ ...s, blocks: sortLanes(next, keep) });
    for (const b of spill) slots.push({ id: rid('s'), blocks: [{ ...b, lane: ALL_LANE }] });
  }
  return { ...p, lanes: next, slots };
}

/** Deep copy with fresh slot/block ids (copy last week's plan, use a template). */
export function copyPlanData(p: PlanData): PlanData {
  return {
    ...p,
    lanes: [...p.lanes],
    slots: p.slots.map((s) => ({
      id: rid('s'),
      blocks: s.blocks.map((b) => ({ ...b, id: rid() })),
    })),
  };
}

/** Make a draft valid for the PlanData schema before it's sent (empty strings, half-typed stations). */
export function sanitize(p: PlanData): PlanData {
  return {
    ...p,
    slots: p.slots.slice(0, 60).map((s) => ({
      ...s,
      blocks: s.blocks.slice(0, 6).map((b) => {
        const out: Block = { ...b, durationMin: clampMin(b.durationMin) };
        const title = b.title?.trim().slice(0, 80);
        if (title) out.title = title;
        else delete out.title;
        const notes = b.notes?.trim().slice(0, 500);
        if (notes) out.notes = notes;
        else delete out.notes;
        for (const k of ['coachId', 'playId', 'drillId', 'rotation'] as const)
          if (!out[k]) delete out[k];
        if (b.rotation) {
          const stations = b.rotation.stations
            .map((x) => x.trim().slice(0, 40))
            .filter(Boolean)
            .slice(0, 8);
          out.rotation = {
            groups: Math.min(8, Math.max(1, Math.round(b.rotation.groups))),
            intervalMin: Math.min(30, Math.max(1, Math.round(b.rotation.intervalMin))),
            stations: stations.length ? stations : ['Station 1'],
          };
        }
        return out;
      }),
    })),
  };
}

/* -------------------------------- Derived -------------------------------- */

export type Overview = {
  totalMin: number;
  /** Event slot in minutes (start → finish), or null when the event has no finish time. */
  slotMin: number | null;
  overMin: number;
  contactMin: number;
  highIntensityMin: number;
  waterAfter: number[];
  equipment: { key: EquipmentItem; label: string; count: number }[];
};

export function eventSlotMin(
  e: Pick<TeamEvent, 'startsAt' | 'endsAt'> | null | undefined,
): number | null {
  if (!e?.endsAt || e.endsAt <= e.startsAt) return null;
  return Math.round((e.endsAt - e.startsAt) / 60e3);
}

export function overview(
  p: PlanData,
  drills: Record<string, DrillMeta> | undefined,
  event?: Pick<TeamEvent, 'startsAt' | 'endsAt'> | null,
): Overview {
  const t = planTotals(p, drillFacts(drills));
  const slotMin = eventSlotMin(event);
  return {
    totalMin: t.totalMin,
    slotMin,
    overMin: slotMin === null ? 0 : Math.max(0, t.totalMin - slotMin),
    contactMin: t.contactMin,
    highIntensityMin: t.highIntensityMin,
    waterAfter: t.waterAfter,
    equipment: EQUIPMENT.filter((k) => (t.equipment[k] ?? 0) > 0).map((k) => ({
      key: k,
      label: EQUIPMENT_LABELS[k],
      count: t.equipment[k]!,
    })),
  };
}

/** Rotation rounds: round r, group g is at station (g + r) mod stations. */
export function rotationRounds(
  b: Block,
): { round: number; startMin: number; groups: { group: number; station: string }[] }[] {
  const r = b.rotation;
  if (!r) return [];
  const n = r.stations.length;
  return r.stations.map((_, round) => ({
    round,
    startMin: round * r.intervalMin,
    groups: Array.from({ length: r.groups }, (_, g) => ({
      group: g + 1,
      station: r.stations[(g + round) % n]!,
    })),
  }));
}

/** Which lane a player follows: forwards are 1–8, backs 9–15 (by primary position). */
export function laneFor(lanes: string[], positions: number[] | undefined): string | null {
  const p = positions?.[0];
  if (!p) return null;
  const lane = p <= 8 ? 'forwards' : p <= 15 ? 'backs' : null;
  return lane && lanes.includes(lane) ? lane : null;
}

export function laneName(lane: string) {
  return laneLabel(lane);
}

export const fmtMin = (m: number) => {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
};

/** Upcoming/recent training sessions and the plan attached to each. */
export function plansByEvent(
  plans: Record<string, PracticePlan> | undefined,
): Map<string, PracticePlan> {
  const m = new Map<string, PracticePlan>();
  for (const p of Object.values(plans ?? {}))
    if (p.eventId && !p.deletedAt && !p.isTemplate) m.set(p.eventId, p);
  return m;
}

/** The most recent plan attached to an earlier training (for "copy last week's plan"). */
export function lastPlanBefore(
  plans: Record<string, PracticePlan> | undefined,
  events: Record<string, TeamEvent> | undefined,
  before: number,
): PracticePlan | undefined {
  let best: { p: PracticePlan; at: number } | undefined;
  for (const p of Object.values(plans ?? {})) {
    if (p.deletedAt || p.isTemplate || !p.eventId) continue;
    const at = events?.[p.eventId]?.startsAt;
    if (at === undefined || at >= before) continue;
    if (!best || at > best.at) best = { p, at };
  }
  return best?.p;
}

export { timeline, blockMinutes, ALL_LANE };
