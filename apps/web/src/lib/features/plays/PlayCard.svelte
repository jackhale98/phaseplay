<script lang="ts">
  import { PLAY_CATEGORY_LABELS, type Play, type PlayMeta } from '@phaseplay/shared';
  import { IconLock, IconEye, IconImage } from '#lib/icons';
  import { mediaSrc } from '#lib/features/media/upload';
  import PlayThumb from './PlayThumb.svelte';
  import { enqueue, loadPlay, seenBy } from './persist';
  import { onVisible } from './visible';

  let { meta, coach, players }: { meta: PlayMeta; coach: boolean; players: number } = $props();
  let data = $state.raw<Play | null>(null);
  let seen = $state<number | null>(null);
  let hover = $state(false);
  let focus = $state(false);

  const picture = $derived(meta.kind === 'picture');
  const first = $derived(meta.media?.[0]);
  const pages = $derived(meta.media?.length ?? 0);
  let shown = $state(false);

  function load() {
    shown = true;
    if (!picture)
      void enqueue(() => loadPlay(meta.id, meta.version)).then(
        (r) => (data = r.value?.data ?? null),
      );
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
  <div class="thumb">
    {#if picture}
      <div class="pic">
        {#if first && shown}<img
            src={mediaSrc(first, true)}
            alt=""
            loading="lazy"
            decoding="async"
          />{/if}
        <span class="marker"><IconImage /> Picture</span>
      </div>
    {:else}
      <PlayThumb play={data} active={hover || focus} />
    {/if}
  </div>
  <div class="body">
    <strong class="title">{meta.title}</strong>
    <span class="meta subtle">
      {PLAY_CATEGORY_LABELS[meta.category]} · {picture
        ? `${pages} page${pages === 1 ? '' : 's'}`
        : `${meta.frameCount} frame${meta.frameCount === 1 ? '' : 's'}`}{meta.format !== 'any'
        ? ` · ${meta.format}`
        : ''}
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
  .pic {
    position: relative;
    aspect-ratio: 16 / 10;
    background: var(--surface-2);
    overflow: hidden;
  }
  .pic img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .marker {
    position: absolute;
    left: 8px;
    bottom: 8px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: var(--r-full);
    background: rgb(0 0 0 / 0.72);
    color: #fff;
    font-size: var(--t-12);
    font-weight: 700;
  }
  .marker :global(svg) {
    width: 14px;
    height: 14px;
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
