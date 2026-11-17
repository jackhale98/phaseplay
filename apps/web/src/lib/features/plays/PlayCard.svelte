<script lang="ts">
  import { PLAY_CATEGORY_LABELS, type Play, type PlayMeta } from '@phaseplay/shared';
  import { IconLock, IconEye } from '#lib/icons';
  import PlayThumb from './PlayThumb.svelte';
  import { enqueue, loadPlay, seenBy } from './persist';
  import { onVisible } from './visible';

  let { meta, coach, players }: { meta: PlayMeta; coach: boolean; players: number } = $props();
  let data = $state.raw<Play | null>(null);
  let seen = $state<number | null>(null);
  let hover = $state(false);
  let focus = $state(false);

  function load() {
    void enqueue(() => loadPlay(meta.id, meta.version)).then((r) => (data = r.value?.data ?? null));
    if (coach && meta.visibility === 'team')
      void enqueue(() => seenBy(meta.id)).then((s) => (seen = s ? s.seen.length : null));
  }
  const total = $derived(players);
</script>

<a
  class="pcard card"
  href="/plays/{meta.id}"
  use:onVisible={load}
  onpointerenter={() => (hover = true)}
  onpointerleave={() => (hover = false)}
  onfocus={() => (focus = true)}
  onblur={() => (focus = false)}
>
  <div class="thumb"><PlayThumb play={data} active={hover || focus} /></div>
  <div class="body">
    <strong class="title">{meta.title}</strong>
    <span class="meta subtle">
      {PLAY_CATEGORY_LABELS[meta.category]} · {meta.frameCount} frame{meta.frameCount === 1
        ? ''
        : 's'}{meta.format !== 'any' ? ` · ${meta.format}` : ''}
    </span>
    {#if meta.tags.length}
      <span class="tags"
        >{#each meta.tags.slice(0, 3) as t (t)}<span class="tag">#{t}</span>{/each}</span
      >
    {/if}
    {#if coach}
      <span class="foot">
        {#if meta.visibility === 'coaches'}
          <span class="badge"><IconLock /> Coaches only</span>
        {:else}
          <span class="badge seen"><IconEye /> Seen by {seen ?? '–'}/{total}</span>
        {/if}
      </span>
    {/if}
  </div>
</a>

<style>
  .pcard {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--text);
    text-decoration: none;
    transition:
      transform var(--m-fast) var(--ease),
      box-shadow var(--m-fast) var(--ease);
  }
  .pcard:hover {
    box-shadow: var(--e-2);
    transform: translateY(-1px);
  }
  .pcard:focus-visible {
    outline-offset: 3px;
    border-radius: var(--r-lg);
  }
  .thumb {
    border-bottom: 1px solid var(--border);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--s-3) var(--s-4) var(--s-4);
  }
  .title {
    font-size: var(--t-16);
    line-height: 1.3;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }
  .tag {
    font-size: var(--t-12);
    color: var(--accent-text);
    font-weight: 600;
  }
  .foot {
    margin-top: var(--s-2);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-12);
    font-weight: 650;
    color: var(--text-2);
    background: var(--surface-2);
    border-radius: var(--r-full);
    padding: 3px 10px;
  }
  .badge :global(svg) {
    width: 14px;
    height: 14px;
  }
  .badge.seen {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
</style>
