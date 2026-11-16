<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { PLAY_CATEGORY_LABELS, can, type PlayFull } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { activeMembers } from '#lib/data/selectors';
  import Button from '#lib/components/Button.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import {
    IconBack,
    IconEdit,
    IconCopy,
    IconTrash,
    IconShare,
    IconStar,
    IconLock,
    IconUsers,
  } from '#lib/icons';
  import DiagramPlayer from '#lib/features/plays/DiagramPlayer.svelte';
  import SeenBy from '#lib/features/plays/SeenBy.svelte';
  import ExportSheet from '#lib/features/plays/ExportSheet.svelte';
  import { loadPlay, recordView } from '#lib/features/plays/persist';
  import { describeFrame, type Names } from '#lib/features/plays/describe';
  import {
    deletePlay,
    duplicatePlay,
    hidden,
    setPlayVisibility,
  } from '#lib/features/plays/actions.svelte';

  const id = $derived(page.params.id ?? '');
  const s = $derived(app.snap);
  const coach = $derived(can(app.role, 'plays.manage'));
  const meta = $derived(s?.rows.plays[id]);
  let full = $state.raw<PlayFull | null>(null);
  let status = $state<'loading' | 'ready' | 'missing' | 'offline'>('loading');
  let highlight = $state(true);
  let exporting = $state(false);
  let recorded = '';

  $effect(() => {
    const pid = id;
    const version = meta?.version;
    void loadPlay(pid, version).then((r) => {
      if (pid !== id) return;
      if (r.value) {
        full = r.value;
        status = 'ready';
      } else status = r.error === 'not_found' ? 'missing' : full ? 'ready' : 'offline';
    });
  });
  $effect(() => {
    if (status === 'ready' && recorded !== id && app.teamId) {
      recorded = id;
      recordView(id);
    }
  });

  // Snapshot meta is fresher than the cached full row for title/visibility.
  const view = $derived(
    full ? { ...full, ...(meta ?? {}), data: (meta as Partial<PlayFull> | undefined)?.data ?? full.data } : null,
  );
  const myId = $derived(app.member?.id);
  const mine = $derived(!!view && !!myId && view.data.entities.some((e) => e.memberId === myId));
  const members = $derived(activeMembers(s));
  const names = $derived(Object.fromEntries(members.map((m) => [m.id, m.displayName])) as Names);
  const frames = $derived(
    view ? view.data.frames.map((_, i) => describeFrame(view.data, i, names)) : [],
  );

  async function duplicate() {
    if (!view) return;
    const nid = await duplicatePlay(view);
    await goto(`/plays/${nid}/edit`);
  }
  async function remove() {
    if (!view) return;
    deletePlay(view);
    await goto('/playbook');
  }
</script>

<svelte:head><title>{view?.title ?? 'Play'} · Playbook</title></svelte:head>

<div class="page">
  <a class="back" href="/playbook"><IconBack /> Playbook</a>
  {#if view && !hidden.has(view.id)}
    <header class="page-head">
      <div class="grow">
        <p class="eyebrow">
          {PLAY_CATEGORY_LABELS[view.category]}{view.format !== 'any' ? ` · ${view.format}` : ''} · {view
            .data.frames.length} frames
        </p>
        <h1>{view.title}</h1>
        {#if view.tags.length}<p class="tags">
            {#each view.tags as t (t)}<span>#{t}</span>{/each}
          </p>{/if}
      </div>
      {#if coach}
        <div class="row wrap actions">
          <Button variant="primary" href="/plays/{view.id}/edit"
            >{#snippet icon()}<IconEdit />{/snippet}Edit</Button
          >
          <Button onclick={() => (exporting = true)}
            >{#snippet icon()}<IconShare />{/snippet}Export</Button
          >
        </div>
      {:else}
        <Button onclick={() => (exporting = true)}
          >{#snippet icon()}<IconShare />{/snippet}Save image</Button
        >
      {/if}
    </header>

    <div class="layout">
      <div class="main">
        <DiagramPlayer play={view.data} highlightMemberId={mine && highlight ? myId : undefined} />
        {#if mine}
          <button class="hl" aria-pressed={highlight} onclick={() => (highlight = !highlight)}>
            <IconStar /> Highlight me
          </button>
        {/if}
        {#if view.description}<p class="desc">{view.description}</p>{/if}
      </div>
      <aside class="side">
        {#if coach}
          <section class="card share">
            <div class="grow">
              <strong>{view.visibility === 'team' ? 'Shared with the team' : 'Coaches only'}</strong
              >
              <p class="subtle">
                {view.visibility === 'team'
                  ? 'Players can watch it in their playbook.'
                  : "Players can't see this yet."}
              </p>
            </div>
            <Button
              size="sm"
              variant={view.visibility === 'team' ? 'secondary' : 'primary'}
              onclick={() =>
                setPlayVisibility(view!.id, view!.visibility === 'team' ? 'coaches' : 'team')}
            >
              {#snippet icon()}{#if view!.visibility === 'team'}<IconLock />{:else}<IconUsers
                  />{/if}{/snippet}
              {view.visibility === 'team' ? 'Make coaches only' : 'Share with team'}
            </Button>
          </section>
          <SeenBy play={view} {members} />
        {/if}
        <section class="steps card" aria-labelledby="steps-h">
          <h2 id="steps-h">Step by step</h2>
          <ol>
            {#each frames as d, i (i)}<li><strong>Frame {i + 1}.</strong> {d}</li>{/each}
          </ol>
        </section>
        {#if coach}
          <div class="row wrap more">
            <Button variant="quiet" onclick={duplicate}
              >{#snippet icon()}<IconCopy />{/snippet}Duplicate</Button
            >
            <Button variant="quiet" onclick={remove}
              >{#snippet icon()}<IconTrash />{/snippet}Delete</Button
            >
          </div>
        {/if}
      </aside>
    </div>
    <ExportSheet
      bind:open={exporting}
      play={view.data}
      highlightMemberId={mine && highlight ? myId : undefined}
    />
  {:else if status === 'loading'}
    <div class="skeleton" aria-busy="true" aria-label="Loading play"></div>
  {:else if status === 'offline'}
    <EmptyState
      title="You're offline"
      body="This play hasn't been saved on this device yet. Open it again when you're back online."
    />
  {:else}
    <EmptyState title="Play not found" body="It may have been deleted, or it's for coaches only.">
      {#snippet action()}<Button href="/playbook">Back to the playbook</Button>{/snippet}
    </EmptyState>
  {/if}
</div>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    color: var(--text-2);
    text-decoration: none;
    font-weight: 600;
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
  }
  h1 {
    margin: 2px 0 0;
  }
  .tags {
    display: flex;
    gap: var(--s-2);
    margin: var(--s-1) 0 0;
    color: var(--accent-text);
    font-weight: 600;
    font-size: var(--t-14);
  }
  .layout {
    display: grid;
    gap: var(--s-5);
  }
  @media (min-width: 1000px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 340px;
      align-items: start;
    }
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .hl {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 var(--s-4);
    border-radius: var(--r-full);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-weight: 650;
  }
  .hl[aria-pressed='true'] {
    background: var(--secondary);
    border-color: transparent;
    color: #1a1a1a;
  }
  .hl :global(svg) {
    width: 18px;
    height: 18px;
  }
  .desc {
    white-space: pre-wrap;
    margin: 0;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  .share {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-4);
    flex-wrap: wrap;
  }
  .share p {
    margin: 2px 0 0;
  }
  .steps {
    padding: var(--s-4);
  }
  .steps h2 {
    font-size: var(--t-16);
    margin: 0 0 var(--s-2);
  }
  .steps ol {
    margin: 0;
    padding-left: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    font-size: var(--t-14);
    line-height: 1.5;
  }
  .skeleton {
    height: 60vh;
    border-radius: var(--r-lg);
    background: var(--surface-2);
  }
  .actions {
    gap: var(--s-2);
  }
</style>
