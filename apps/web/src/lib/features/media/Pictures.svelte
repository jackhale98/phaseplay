<!--
  Pages of a picture play (or a drill's photos) on its page: the current picture, previous/next,
  a strip of thumbnails, and full screen (lazy-loaded viewer with zoom). Names come from captions,
  else "<title>, page n of m".
-->
<script lang="ts">
  import type { Component } from 'svelte';
  import { mediaLabel, type MediaRef } from '@phaseplay/shared';
  import { IconChevronLeft, IconChevronRight, IconExpand } from '#lib/icons';
  import { mediaSrc } from './upload';
  import type { ViewerItem } from './ImageViewer.svelte';

  type Props = { media: MediaRef[]; title: string; index?: number; noun?: 'page' | 'photo' };
  let { media, title, index = $bindable(0), noun = 'page' }: Props = $props();
  let full = $state(false);
  type ViewerComponent = Component<{
    open: boolean;
    items: ViewerItem[];
    index: number;
    title: string;
  }>;
  let Viewer = $state<ViewerComponent | null>(null);

  const n = $derived(media.length);
  const i = $derived(Math.min(index, Math.max(0, n - 1)));
  const cur = $derived(media[i]);
  const items = $derived<ViewerItem[]>(
    media.map((m, k) => ({
      src: mediaSrc(m),
      alt: mediaLabel(title, m, k, n),
      caption: m.caption,
    })),
  );

  async function openFull() {
    try {
      Viewer ??= (await import('./ImageViewer.svelte')).default as unknown as ViewerComponent;
      full = true;
    } catch {
      /* the viewer's code couldn't load (offline before it was cached): the picture stays inline */
    }
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' && i < n - 1) index = i + 1;
    else if (e.key === 'ArrowLeft' && i > 0) index = i - 1;
    else if (e.key === 'Enter' || e.key === ' ') void openFull();
    else return;
    e.preventDefault();
  }
</script>

{#if cur}
  <section class="pics" aria-label={noun === 'page' ? 'Pages' : 'Photos'}>
    <div class="frame">
      <button
        type="button"
        class="shot"
        aria-label="{mediaLabel(title, cur, i, n)}. Open full screen"
        onclick={openFull}
        onkeydown={key}
      >
        <img src={mediaSrc(cur)} alt="" width={cur.width} height={cur.height} decoding="async" />
      </button>
      <button type="button" class="fs" aria-label="Full screen" onclick={openFull}
        ><IconExpand /></button
      >
    </div>
    {#if cur.caption}<p class="caption">{cur.caption}</p>{/if}
    {#if n > 1}
      <div class="pager">
        <button
          type="button"
          class="step"
          aria-label="Previous {noun}"
          disabled={i === 0}
          onclick={() => (index = i - 1)}><IconChevronLeft /></button
        >
        <ol class="strip" aria-label={noun === 'page' ? 'Pages' : 'Photos'}>
          {#each media as m, k (m.id)}
            <li>
              <button
                type="button"
                class="tb"
                aria-label={mediaLabel(title, m, k, n)}
                aria-current={k === i ? 'true' : undefined}
                onclick={() => (index = k)}
              >
                <img src={mediaSrc(m, true)} alt="" loading="lazy" />
              </button>
            </li>
          {/each}
        </ol>
        <button
          type="button"
          class="step"
          aria-label="Next {noun}"
          disabled={i === n - 1}
          onclick={() => (index = i + 1)}><IconChevronRight /></button
        >
      </div>
      <p class="count subtle" aria-live="polite">
        {noun === 'page' ? 'Page' : 'Photo'}
        {i + 1} of {n}
      </p>
    {/if}
  </section>
  {#if Viewer}<Viewer bind:open={full} {items} bind:index {title} />{/if}
{/if}

<style>
  .pics {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .frame {
    position: relative;
    border-radius: var(--r-lg);
    overflow: hidden;
    background: var(--surface-sunken, var(--surface-2));
    border: 1px solid var(--border);
  }
  .shot {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: zoom-in;
  }
  .shot img {
    display: block;
    width: 100%;
    height: auto;
    max-height: 70vh;
    object-fit: contain;
  }
  .shot:focus-visible {
    outline-offset: -4px;
  }
  .fs {
    position: absolute;
    right: var(--s-2);
    top: var(--s-2);
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--r-full);
    background: rgb(0 0 0 / 0.6);
    color: #fff;
  }
  .fs :global(svg) {
    width: 20px;
    height: 20px;
  }
  .caption {
    margin: 0;
    font-weight: 600;
  }
  .pager {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .step {
    flex: none;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: var(--r-full);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
  }
  .step:disabled {
    opacity: 0.4;
  }
  .step :global(svg) {
    width: 20px;
    height: 20px;
  }
  .strip {
    flex: 1;
    display: flex;
    gap: var(--s-2);
    overflow-x: auto;
    list-style: none;
    margin: 0;
    padding: 3px;
    scrollbar-width: thin;
  }
  .tb {
    display: block;
    width: 64px;
    height: 48px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--surface-2);
  }
  .tb[aria-current='true'] {
    border-color: var(--accent);
  }
  .tb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .count {
    margin: 0;
    font-size: var(--t-14);
  }
</style>
