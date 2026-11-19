<!--
  "Upload a play": pick images (camera roll, files, drag-and-drop), order and caption the pages,
  and set the usual details. Also edits an existing picture play's pages and details. Uploading
  needs a connection; the play is created coaches-only and shared once its pages are in, so the
  squad's notification never points at an empty play.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    MEDIA_PER_PLAY,
    PLAY_CATEGORIES,
    PLAY_CATEGORY_LABELS,
    picturePlaceholder,
    uuidv7,
    type PlayCategory,
    type PlayMeta,
    type Visibility,
  } from '@phaseplay/shared';
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import { toasts } from '#lib/stores/toast.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import Button from '#lib/components/Button.svelte';
  import { IconOffline } from '#lib/icons';
  import { patchPlay } from '#lib/features/plays/actions.svelte';
  import { rememberPlay } from '#lib/features/plays/persist';
  import PagesEditor from './PagesEditor.svelte';
  import { Drafts } from './drafts.svelte';
  import { applyList } from './upload';

  type Props = { open: boolean; play?: PlayMeta | null };
  let { open = $bindable(false), play = null }: Props = $props();

  let drafts = $state(new Drafts(MEDIA_PER_PLAY));
  let title = $state('');
  let category = $state<PlayCategory>('other');
  let tags = $state('');
  let format = $state<'15s' | '7s' | 'any'>('any');
  let visibility = $state<Visibility>('coaches');
  let description = $state('');
  let error = $state<string | null>(null);
  let titleError = $state<string | null>(null);
  let saving = $state(false);
  /** A new play already created by an earlier (failed or cancelled) attempt in this sheet. */
  let createdId: string | null = null;

  $effect(() => {
    if (!open) return;
    untrack(() => {
      drafts.dispose();
      drafts = new Drafts(MEDIA_PER_PLAY, play?.media ?? []);
      drafts.snapshot();
      title = play?.title ?? '';
      category = play?.category ?? 'other';
      tags = play?.tags.join(', ') ?? '';
      format = play?.format ?? app.team?.defaultFormat ?? 'any';
      visibility = play?.visibility ?? 'coaches';
      description = play?.description ?? '';
      error = null;
      titleError = null;
      createdId = null;
    });
  });
  onDestroy(() => drafts.dispose());

  const online = $derived(app.online);
  const tagList = () =>
    [
      ...new Set(
        tags
          .split(/[,\s]+/)
          .map((x) => x.replace(/^#/, '').trim().slice(0, 24))
          .filter(Boolean),
      ),
    ].slice(0, 12);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (saving) return;
    error = null;
    const t = title.trim();
    titleError = t ? null : 'Give the play a name';
    if (!t) return;
    if (!drafts.count) {
      error = 'Add at least one picture.';
      return;
    }
    if (drafts.busy) {
      error = 'Hang on, pictures are still being prepared.';
      return;
    }
    if (!navigator.onLine) {
      error = "You're offline. Uploading pictures needs a connection.";
      return;
    }
    if (app.demo) {
      error = "This is the demo team, so uploads aren't saved. Create your own team to keep plays.";
      return;
    }
    saving = true;
    const fields = {
      title: t.slice(0, 80),
      category,
      tags: tagList(),
      format,
      description: description.trim() || null,
    };
    try {
      let id = play?.id ?? createdId;
      if (!id) {
        id = uuidv7();
        await api(teamPath('/plays'), {
          method: 'POST',
          body: {
            id,
            ...fields,
            kind: 'picture',
            visibility: 'coaches',
            data: picturePlaceholder(id, fields.title, format),
          },
        });
        createdId = id;
        const meta: PlayMeta = {
          id,
          teamId: app.teamId!,
          ...fields,
          visibility: 'coaches',
          version: 1,
          createdBy: app.me?.user.id ?? '',
          updatedAt: Date.now(),
          deletedAt: null,
          frameCount: 1,
          kind: 'picture',
          media: [],
        };
        await app.putRow(app.teamId!, 'plays', id, meta);
        rememberPlay({ ...meta, data: picturePlaceholder(id, fields.title, format) });
      }
      const list = await drafts.save('play', id);
      if (list) await applyList('play', id, list);
      const before = play;
      const changed =
        !before ||
        before.title !== fields.title ||
        before.category !== fields.category ||
        before.format !== fields.format ||
        (before.description ?? null) !== fields.description ||
        before.tags.join(',') !== fields.tags.join(',') ||
        before.visibility !== visibility;
      if (before && changed) await patchPlay(id, { ...fields, visibility }, 'Play details');
      else if (!before && visibility === 'team') await patchPlay(id, { visibility }, 'Sharing');
      toasts.success(before ? 'Play updated' : 'Picture play saved');
      open = false;
      if (!before) await goto(`/plays/${id}`);
    } catch (err) {
      if ((err as Error).name === 'AbortError') error = 'Upload cancelled.';
      else if (err instanceof ApiError) error = err.message;
      else error = (err as Error).message || 'Something went wrong. Try again.';
      // Nothing uploaded: don't leave an empty play behind (Save again creates it afresh).
      await dropEmpty();
    } finally {
      saving = false;
    }
  }

  function cancel() {
    if (saving) {
      drafts.cancelAll();
      return;
    }
    open = false;
  }

  /** Closing mid-way: a new play with no pages yet is removed again. */
  async function closed() {
    drafts.cancelAll();
    await dropEmpty();
  }

  /** Remove a play this sheet just created if none of its pages made it. */
  async function dropEmpty() {
    const id = createdId;
    if (id && !app.snap?.rows.plays[id]?.media?.length) {
      createdId = null;
      try {
        await api(teamPath(`/plays/${id}`), { method: 'DELETE' });
      } catch {}
      await app.putRow(app.teamId!, 'plays', id, {
        ...app.snap?.rows.plays[id],
        deletedAt: Date.now(),
      });
    }
  }
</script>

<Sheet
  bind:open
  title={play ? 'Edit picture play' : 'Upload a play'}
  description={play
    ? 'Add, reorder or caption pages, and change the details.'
    : 'Photos of a whiteboard, a scanned page or a screenshot. Each picture becomes a page.'}
  size="lg"
  onclose={closed}
>
  <form class="stack" onsubmit={save} novalidate>
    {#if !online}
      <p class="offline" role="status">
        <IconOffline /> You're offline. You can pick pictures now, but uploading needs a connection.
      </p>
    {/if}
    <PagesEditor {drafts} noun="page" locked={saving} />
    <Field label="Name" error={titleError}>
      {#snippet children({ id, describedby })}<input
          {id}
          aria-describedby={describedby}
          bind:value={title}
          maxlength="80"
          placeholder="e.g. Lineout calls (whiteboard)"
          autocomplete="off"
          required
        />{/snippet}
    </Field>
    <div class="two">
      <Field label="Category">
        {#snippet children({ id })}
          <select {id} bind:value={category}>
            {#each PLAY_CATEGORIES as c (c)}<option value={c}>{PLAY_CATEGORY_LABELS[c]}</option
              >{/each}
          </select>
        {/snippet}
      </Field>
      <Field label="Format">
        {#snippet children({ id })}
          <select {id} bind:value={format}>
            <option value="15s">15s</option>
            <option value="7s">7s</option>
            <option value="any">Either</option>
          </select>
        {/snippet}
      </Field>
    </div>
    <div class="two">
      <Field label="Tags" hint="Comma separated, e.g. front, wet-weather">
        {#snippet children({ id, describedby })}<input
            {id}
            aria-describedby={describedby}
            bind:value={tags}
            autocomplete="off"
          />{/snippet}
      </Field>
      <Field label="Who can see it">
        {#snippet children({ id })}
          <select {id} bind:value={visibility}>
            <option value="coaches">Coaches only</option>
            <option value="team">The whole team</option>
          </select>
        {/snippet}
      </Field>
    </div>
    <Field label="Notes for players">
      {#snippet children({ id })}<textarea {id} bind:value={description} maxlength="2000" rows="2"
        ></textarea>{/snippet}
    </Field>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="actions">
      <Button onclick={cancel}>{saving ? 'Cancel upload' : 'Cancel'}</Button>
      <Button type="submit" variant="primary" loading={saving} disabled={!online || drafts.busy}
        >{play ? 'Save' : 'Save play'}</Button
      >
    </div>
  </form>
</Sheet>

<style>
  .two {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--s-3);
  }
  @media (max-width: 480px) {
    .two {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .offline {
    display: flex;
    gap: var(--s-2);
    align-items: center;
    margin: 0;
    padding: var(--s-3);
    border-radius: var(--r-md);
    background: var(--warn-soft);
    font-size: var(--t-14);
  }
  .offline :global(svg) {
    flex: none;
    width: 18px;
    height: 18px;
  }
  .err {
    margin: 0;
    padding: var(--s-3);
    border-radius: var(--r-md);
    background: var(--danger-soft);
    font-size: var(--t-14);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--s-2);
  }
</style>
