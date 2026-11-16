/** Small per-device UI state for practice screens. */
import { uuidv7, type PlanData, type PracticePlan } from '@phaseplay/shared';
import { app } from '#lib/data/app.svelte';
import { teamPath } from '#lib/data/actions';
import { toasts } from '#lib/stores/toast.svelte';
import { timeline } from '@phaseplay/shared';
import { sanitize } from './model';

/** Plans deleted in the last few seconds (hidden while the undo toast is up). */
export const hiddenPlans = $state<{ ids: string[] }>({ ids: [] });

const UNDO_MS = 5000;

/** Delete with undo: hide now, send after the undo window. */
export function deletePlan(plan: PracticePlan) {
  hiddenPlans.ids = [...hiddenPlans.ids, plan.id];
  let undone = false;
  toasts.undo(`Deleted “${plan.title}”`, () => {
    undone = true;
    hiddenPlans.ids = hiddenPlans.ids.filter((x) => x !== plan.id);
  });
  setTimeout(() => {
    if (undone) return;
    void app
      .mutate({
        method: 'DELETE',
        path: teamPath(`/plans/${plan.id}`),
        label: 'Delete plan',
        optimistic: [{ op: 'delete', entity: 'plans', key: plan.id }],
      })
      .finally(() => (hiddenPlans.ids = hiddenPlans.ids.filter((x) => x !== plan.id)));
  }, UNDO_MS);
}

/** Create a plan (optimistic row with version 1, matching the server's first version). */
export async function createPlan(o: {
  title: string;
  eventId: string | null;
  data: PlanData;
  isTemplate?: boolean;
  visibility?: 'coaches' | 'team';
}): Promise<string> {
  const id = uuidv7();
  const s = app.snap;
  const data = sanitize(o.data);
  const body = {
    id,
    eventId: o.eventId,
    title: o.title.trim().slice(0, 80) || 'Practice',
    isTemplate: !!o.isTemplate,
    visibility: o.visibility ?? 'team',
    data,
  };
  const row: PracticePlan = {
    ...body,
    teamId: s?.teamId ?? '',
    plannedTotalMin: timeline(data).at(-1)?.endMin ?? 0,
    version: 1,
    createdBy: app.me?.user.id ?? '',
    updatedAt: Date.now(),
    deletedAt: null,
  };
  await app.mutate({
    method: 'POST',
    path: teamPath('/plans'),
    body,
    label: o.isTemplate ? 'Template' : 'Practice plan',
    optimistic: [{ op: 'put', entity: 'plans', key: id, value: row }],
  });
  return id;
}

/** Equipment ticks are local to this device (packing the kit bag). */
export function loadTicks(planId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`pp:eq:${planId}`) ?? '[]') as string[];
  } catch {
    return [];
  }
}
export function saveTicks(planId: string, ticks: string[]) {
  try {
    localStorage.setItem(`pp:eq:${planId}`, JSON.stringify(ticks));
  } catch {}
}

/** Runner preferences (sound, vibration, auto-advance). */
export type RunnerPrefs = { sound: boolean; vibrate: boolean; auto: boolean };
export function loadPrefs(): RunnerPrefs {
  try {
    return {
      sound: true,
      vibrate: true,
      auto: true,
      ...(JSON.parse(localStorage.getItem('pp:runner') ?? '{}') as Partial<RunnerPrefs>),
    };
  } catch {
    return { sound: true, vibrate: true, auto: true };
  }
}
export function savePrefs(p: RunnerPrefs) {
  try {
    localStorage.setItem('pp:runner', JSON.stringify(p));
  } catch {}
}
