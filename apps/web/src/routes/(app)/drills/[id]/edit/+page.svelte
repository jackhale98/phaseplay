<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { type DrillFull, type Play } from '@phaseplay/shared';
  import { migratePlay } from '@phaseplay/diagram/migrate';
  import { newPlay } from '@phaseplay/diagram/presets';
  import { app } from '#lib/data/app.svelte';
  import { activeMembers } from '#lib/data/selectors';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Button from '#lib/components/Button.svelte';
  import Editor from '#lib/features/plays/editor/Editor.svelte';
  import ConflictBar from '#lib/features/plays/editor/ConflictBar.svelte';
  import DrillForm, { type DrillDetails } from '#lib/features/drills/DrillForm.svelte';
  import { Autosave } from '#lib/features/plays/autosave.svelte';
  import {
    whenTeam,
    docGet,
    docPut,
    drillDraftKey,
    loadDrill,
    rememberDrill,
  } from '#lib/features/plays/persist';
  import { createDrill, drillFields, patchDrill } from '#lib/features/plays/actions.svelte';
  import { setArea } from '#lib/features/plays/ops';

  const id = page.params.id ?? '';
  const s = $derived(app.snap);
  let initial = $state.raw<Play | null>(null);
  let server = $state.raw<DrillFull | null>(null);
  let status = $state<'loading' | 'ready' | 'missing'>('loading');
  let current: Play | null = null;
  let editor: ReturnType<typeof Editor> | undefined = $state();
  let conflict = $state.raw<DrillFull | null>(null);
  let details = $state(false);

  const row = $derived(s?.rows.drills[id] ?? server);
  const value = $derived<DrillDetails | null>(
    row
      ? {
          title: row.title,
          category: row.category,
          contactLevel: row.contactLevel,
          intensity: row.intensity,
          playersMin: row.playersMin,
          playersMax: row.playersMax,
          area: row.area,
          equipment: row.equipment,
          defaultDurationMin: row.defaultDurationMin,
          description: row.description,
          coachingPoints: row.coachingPoints,
          setup: row.setup,
          variations: row.variations,
          visibility: row.visibility,
        }
      : null,
  );
  const title = $derived(row?.title ?? initial?.title ?? '');
  let diagramNow = $state.raw<Play | null>(null);

  const autosave = new Autosave({
    key: drillDraftKey(id),
    snapshot: () => ({ diagram: current }),
    version: () => app.snap?.rows.drills[id]?.version,
    send: async (baseVersion) => {
      const diagram = current;
      if (!diagram) return;
      await patchDrill(id, { diagram }, 'Drill', baseVersion);
      const base = server;
      if (base)
        rememberDrill({ ...base, ...(s?.rows.drills[id] ?? {}), diagram, hasDiagram: true });
    },
  });

  onMount(() => {
    if (app.role && !app.can('drills.manage')) {
      void goto(`/drills/${id}`, { replace: true });
      return;
    }
    void (async () => {
      await whenTeam();
      const [draft, loaded] = await Promise.all([
        docGet<{ diagram: Play; updatedAt: number }>(drillDraftKey(id)),
        loadDrill(id, app.snap?.rows.drills[id]?.version),
      ]);
      server = loaded.value;
      let data: Play | null = null;
      if (draft?.diagram && (!server || draft.updatedAt > server.updatedAt)) {
        try {
          data = migratePlay(draft.diagram);
        } catch {
          data = null;
        }
      }
      const fromDraft = !!data;
      data ??= server?.diagram ?? null;
      if (!data && server) {
        data = newPlay({ id, title: server.title, mode: 'drill', format: 'any' });
        data.background = { kind: 'grass', w: server.area.w, h: server.area.h };
      }
      if (!data) {
        status = 'missing';
        return;
      }
      current = data;
      diagramNow = data;
      initial = data;
      status = 'ready';
      if (fromDraft && server) autosave.touch();
    })();
    const off = app.onConflict((entity, latest) => {
      if (entity === 'drills' && latest.id === id) conflict = latest as DrillFull;
    });
    const leave = () => void autosave.flush();
    addEventListener('pagehide', leave);
    return () => {
      off();
      removeEventListener('pagehide', leave);
      autosave.dispose();
    };
  });

  function onchange(p: Play) {
    current = p;
    diagramNow = p;
    autosave.touch();
  }
  async function close() {
    await autosave.flush();
    await goto(`/drills/${id}`);
  }
  function saveDetails(v: DrillDetails) {
    editor?.apply((p) => setArea({ ...p, title: v.title }, v.area.w, v.area.h), 'Details');
    void patchDrill(id, v, 'Drill details');
  }

  function keepMine() {
    conflict = null;
    void autosave.flush(true);
  }
  function takeTheirs() {
    const c = conflict;
    conflict = null;
    if (!c?.diagram) return;
    try {
      const theirs = migratePlay(c.diagram);
      editor?.replace(theirs);
      current = theirs;
      server = c;
      rememberDrill(c);
      void docPut(drillDraftKey(id), { diagram: theirs, updatedAt: Date.now() });
    } catch {}
  }
  async function saveCopy() {
    const base = conflict ?? server;
    const mine = current;
    conflict = null;
    if (!base || !mine) return;
    const nid = await createDrill({
      ...drillFields(base),
      title: `${base.title} (copy)`.slice(0, 80),
      diagram: structuredClone(mine),
      visibility: 'coaches',
    });
    location.assign(`/drills/${nid}/edit`);
  }
</script>

<svelte:head><title>Edit {title || 'drill'} · Phaseplay</title></svelte:head>

{#if status === 'ready' && initial}
  <h1 class="sr-only">Edit {title}</h1>
  <Editor
    bind:this={editor}
    {initial}
    {title}
    status={autosave.label}
    members={activeMembers(s)}
    {onchange}
    ondetails={() => (details = true)}
    onclose={close}
  />
  {#if value}<DrillForm
      bind:open={details}
      {value}
      diagram={diagramNow}
      onsave={saveDetails}
    />{/if}
  {#if conflict}<ConflictBar onmine={keepMine} ontheirs={takeTheirs} oncopy={saveCopy} />{/if}
{:else if status === 'missing'}
  <div class="page">
    <EmptyState
      title="Can't open this drill"
      body="It may have been deleted, or it isn't saved on this device yet."
    >
      {#snippet action()}<Button href="/playbook?tab=drills">Back to drills</Button>{/snippet}
    </EmptyState>
  </div>
{:else}
  <div class="loading" aria-busy="true" aria-label="Opening the editor"></div>
{/if}

<style>
  .loading {
    position: fixed;
    inset: 0;
    background: #2f6b3a;
  }
</style>
