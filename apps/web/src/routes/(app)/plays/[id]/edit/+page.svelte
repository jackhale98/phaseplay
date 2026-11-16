<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { can, uuidv7, type Play, type PlayFull } from '@phaseplay/shared';
  import { migratePlay } from '@phaseplay/diagram/migrate';
  import { app } from '#lib/data/app.svelte';
  import { activeMembers } from '#lib/data/selectors';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Button from '#lib/components/Button.svelte';
  import Editor from '#lib/features/plays/editor/Editor.svelte';
  import ConflictBar from '#lib/features/plays/editor/ConflictBar.svelte';
  import MetaSheet, { type MetaValues } from '#lib/features/plays/MetaSheet.svelte';
  import { Autosave } from '#lib/features/plays/autosave.svelte';
  import {
    docGet,
    docPut,
    loadPlay,
    playDraftKey,
    rememberPlay,
  } from '#lib/features/plays/persist';
  import { createPlay, patchPlay } from '#lib/features/plays/actions.svelte';

  const id = page.params.id ?? '';
  const s = $derived(app.snap);
  let initial = $state.raw<Play | null>(null);
  let server = $state.raw<PlayFull | null>(null);
  let status = $state<'loading' | 'ready' | 'missing'>('loading');
  let current: Play | null = null;
  let editor: ReturnType<typeof Editor> | undefined = $state();
  let conflict = $state.raw<PlayFull | null>(null);
  let details = $state(false);

  const row = $derived(s?.rows.plays[id]);
  const meta = $derived<MetaValues | null>(
    (row ?? server)
      ? {
          title: (row ?? server)!.title,
          category: (row ?? server)!.category,
          tags: (row ?? server)!.tags,
          format: (row ?? server)!.format,
          visibility: (row ?? server)!.visibility,
          description: (row ?? server)!.description,
        }
      : null,
  );
  const title = $derived(meta?.title ?? initial?.title ?? '');

  const autosave = new Autosave({
    key: playDraftKey(id),
    snapshot: () => ({ data: current }),
    send: async () => {
      const data = current;
      if (!data) return;
      await patchPlay(id, { data, title: data.title }, 'Play');
      const base = server ?? (row as PlayFull | undefined);
      if (base) rememberPlay({ ...base, ...(row ?? {}), data, frameCount: data.frames.length });
    },
  });

  onMount(() => {
    if (app.role && !can(app.role, 'plays.manage')) {
      void goto(`/plays/${id}`, { replace: true });
      return;
    }
    void (async () => {
      const [draft, loaded] = await Promise.all([
        docGet<{ data: Play; updatedAt: number }>(playDraftKey(id)),
        loadPlay(id, app.snap?.rows.plays[id]?.version),
      ]);
      server = loaded.value;
      let data: Play | null = null;
      if (draft?.data && (!server || draft.updatedAt > server.updatedAt)) {
        try {
          data = migratePlay(draft.data);
        } catch {
          data = null;
        }
      }
      const fromDraft = !!data;
      data ??= server?.data ?? null;
      if (!data) {
        status = 'missing';
        return;
      }
      current = data;
      initial = data;
      status = 'ready';
      if (fromDraft && server) autosave.touch();
    })();
    const off = app.onConflict((entity, latest) => {
      if (entity === 'plays' && latest.id === id) conflict = latest as PlayFull;
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
    autosave.touch();
  }
  async function close() {
    await autosave.flush();
    await goto(`/plays/${id}`);
  }
  function saveMeta(v: MetaValues) {
    editor?.apply((p) => ({ ...p, title: v.title, format: v.format }), 'Details');
    void patchPlay(id, v, 'Details');
  }

  // Conflict choices
  function keepMine() {
    conflict = null;
    void autosave.flush(true);
  }
  function takeTheirs() {
    const c = conflict;
    conflict = null;
    if (!c) return;
    try {
      const theirs = migratePlay(c.data);
      editor?.replace(theirs);
      current = theirs;
      server = c;
      rememberPlay(c);
      void docPut(playDraftKey(id), { data: theirs, updatedAt: Date.now() });
    } catch {
      /* keep mine if theirs can't be read */
    }
  }
  async function saveCopy() {
    const c = conflict;
    const mine = current;
    conflict = null;
    if (!mine || !meta) return;
    const nid = uuidv7();
    await createPlay(
      { ...meta, title: `${meta.title} (copy)`.slice(0, 80), data: structuredClone(mine) },
      nid,
    );
    if (c) {
      try {
        editor?.replace(migratePlay(c.data));
      } catch {}
    }
    // A full load so the editor starts cleanly on the copy (the outbox already holds the POST).
    location.assign(`/plays/${nid}/edit`);
  }
</script>

<svelte:head><title>Edit {title || 'play'} · Phaseplay</title></svelte:head>

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
  {#if meta}<MetaSheet bind:open={details} value={meta} onsave={saveMeta} />{/if}
  {#if conflict}<ConflictBar onmine={keepMine} ontheirs={takeTheirs} oncopy={saveCopy} />{/if}
{:else if status === 'missing'}
  <div class="page">
    <EmptyState
      title="Can't open this play"
      body="It may have been deleted, or it isn't saved on this device yet."
    >
      {#snippet action()}<Button href="/playbook">Back to the playbook</Button>{/snippet}
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
