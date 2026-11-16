/**
 * Play and drill writes. All optimistic through the outbox; deletes wait out a 5-second undo
 * window before they're queued, so Undo always works (docs/design.md principle 4).
 */
import {
  uuidv7,
  type DrillCreate,
  type DrillFull,
  type DrillMeta,
  type Play,
  type PlayCategory,
  type PlayFull,
  type PlayMeta,
  type PlayUpdate,
  type DrillUpdate,
  type Visibility,
} from '@phaseplay/shared';
import { app } from '#lib/data/app.svelte';
import { teamPath } from '#lib/data/actions';
import { toasts } from '#lib/stores/toast.svelte';
import { docPut, playDraftKey, drillDraftKey, rememberDrill, rememberPlay } from './persist';

class Hidden {
  ids = $state<string[]>([]);
  has(id: string) {
    return this.ids.includes(id);
  }
  add(id: string) {
    this.ids = [...this.ids, id];
  }
  remove(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
  }
}
/** Rows deleted locally but still inside their undo window. */
export const hidden = new Hidden();

function metaOf(
  id: string,
  b: Omit<
    PlayFull,
    'teamId' | 'version' | 'createdBy' | 'updatedAt' | 'deletedAt' | 'frameCount' | 'id'
  >,
): PlayFull {
  return {
    id,
    teamId: app.teamId!,
    title: b.title,
    category: b.category,
    tags: b.tags,
    format: b.format,
    visibility: b.visibility,
    description: b.description,
    version: 1,
    createdBy: app.me?.user.id ?? '',
    updatedAt: Date.now(),
    deletedAt: null,
    frameCount: b.data.frames.length,
    data: b.data,
  };
}

export type NewPlayInput = {
  title: string;
  category: PlayCategory;
  tags?: string[];
  format: Play['format'];
  visibility: Visibility;
  description?: string | null;
  data: Play;
};

/** Create a play (POST) and seed the caches so the editor opens instantly, even offline. */
export async function createPlay(input: NewPlayInput, id = input.data.id): Promise<string> {
  const data: Play = { ...input.data, id, title: input.title };
  const full = metaOf(id, {
    ...input,
    tags: input.tags ?? [],
    description: input.description ?? null,
    data,
  });
  const { data: _d, ...meta } = full;
  rememberPlay(full);
  await docPut(playDraftKey(id), { data, updatedAt: Date.now() });
  await app.mutate({
    method: 'POST',
    path: teamPath('/plays'),
    body: {
      id,
      title: full.title,
      category: full.category,
      tags: full.tags,
      format: full.format,
      visibility: full.visibility,
      description: full.description,
      data,
    },
    label: 'New play',
    optimistic: [{ op: 'put', entity: 'plays', key: id, value: meta satisfies PlayMeta }],
  });
  return id;
}

export async function duplicatePlay(src: PlayFull): Promise<string> {
  const id = uuidv7();
  return createPlay(
    {
      title: `${src.title} (copy)`.slice(0, 80),
      category: src.category,
      tags: src.tags,
      format: src.format,
      visibility: 'coaches',
      description: src.description,
      data: structuredClone($state.snapshot(src.data) as Play),
    },
    id,
  );
}

/** PATCH a play's fields with If-Match. */
export async function patchPlay(id: string, body: PlayUpdate, label = 'Play') {
  const optimistic: Record<string, unknown> = { updatedAt: Date.now() };
  for (const k of ['title', 'category', 'tags', 'format', 'visibility', 'description'] as const)
    if (body[k] !== undefined) optimistic[k] = body[k];
  if (body.data) optimistic.frameCount = body.data.frames.length;
  await app.mutate({
    method: 'PATCH',
    path: teamPath(`/plays/${id}`),
    body,
    label,
    versionOf: { entity: 'plays', id },
    optimistic: [{ op: 'patch', entity: 'plays', key: id, value: optimistic }],
  });
}

export async function setPlayVisibility(id: string, visibility: Visibility) {
  await patchPlay(id, { visibility }, 'Sharing');
  toasts.show(visibility === 'team' ? 'Shared with the team' : 'Now coaches only');
}

function deleteWithUndo(kind: 'play' | 'drill', id: string, title: string) {
  hidden.add(id);
  let undone = false;
  const timer = setTimeout(() => {
    if (undone) return;
    void app
      .mutate({
        method: 'DELETE',
        path: teamPath(`/${kind}s/${id}`),
        label: kind === 'play' ? 'Delete play' : 'Delete drill',
        optimistic: [{ op: 'delete', entity: kind === 'play' ? 'plays' : 'drills', key: id }],
      })
      .finally(() => hidden.remove(id));
  }, 5000);
  toasts.undo(`Deleted “${title}”`, () => {
    undone = true;
    clearTimeout(timer);
    hidden.remove(id);
  });
}
export const deletePlay = (p: Pick<PlayMeta, 'id' | 'title'>) =>
  deleteWithUndo('play', p.id, p.title);
export const deleteDrill = (d: Pick<DrillMeta, 'id' | 'title'>) =>
  deleteWithUndo('drill', d.id, d.title);

// ---------------------------------------------------------------------------------------------
// Drills

export type DrillFields = Omit<DrillCreate, 'id'>;

export async function createDrill(input: DrillFields, id = uuidv7()): Promise<string> {
  const diagram = input.diagram ? { ...input.diagram, id, title: input.title } : null;
  const body: DrillCreate = { ...input, id, diagram };
  const meta: DrillMeta = {
    id,
    teamId: app.teamId!,
    title: body.title,
    category: body.category,
    contactLevel: body.contactLevel,
    intensity: body.intensity,
    playersMin: body.playersMin,
    playersMax: body.playersMax,
    area: body.area,
    equipment: body.equipment,
    defaultDurationMin: body.defaultDurationMin,
    description: body.description,
    coachingPoints: body.coachingPoints,
    setup: body.setup,
    variations: body.variations,
    visibility: body.visibility,
    source: 'team',
    parentId: body.parentId,
    version: 1,
    createdBy: app.me?.user.id ?? null,
    updatedAt: Date.now(),
    deletedAt: null,
    hasDiagram: !!diagram,
  };
  rememberDrill({ ...meta, diagram } satisfies DrillFull);
  if (diagram) await docPut(drillDraftKey(id), { diagram, updatedAt: Date.now() });
  await app.mutate({
    method: 'POST',
    path: teamPath('/drills'),
    body,
    label: 'New drill',
    optimistic: [{ op: 'put', entity: 'drills', key: id, value: meta }],
  });
  return id;
}

export function drillFields(d: DrillFull): DrillFields {
  return {
    title: d.title,
    category: d.category,
    contactLevel: d.contactLevel,
    intensity: d.intensity,
    playersMin: d.playersMin,
    playersMax: d.playersMax,
    area: d.area,
    equipment: d.equipment,
    defaultDurationMin: d.defaultDurationMin,
    description: d.description,
    coachingPoints: d.coachingPoints,
    setup: d.setup,
    variations: d.variations,
    diagram: d.diagram,
    visibility: d.visibility,
    parentId: d.parentId,
  };
}

/** "Duplicate as variation": a copy linked back to its parent. */
export async function duplicateDrill(src: DrillFull): Promise<string> {
  const f = structuredClone($state.snapshot(drillFields(src)) as DrillFields);
  return createDrill({
    ...f,
    title: `${src.title} — variation`.slice(0, 80),
    parentId: src.id,
    visibility: 'coaches',
  });
}

export async function patchDrill(id: string, body: DrillUpdate, label = 'Drill') {
  const optimistic: Record<string, unknown> = { ...body, updatedAt: Date.now() };
  delete optimistic.diagram;
  if (body.diagram !== undefined) optimistic.hasDiagram = !!body.diagram;
  await app.mutate({
    method: 'PATCH',
    path: teamPath(`/drills/${id}`),
    body,
    label,
    versionOf: { entity: 'drills', id },
    optimistic: [{ op: 'patch', entity: 'drills', key: id, value: optimistic }],
  });
}
