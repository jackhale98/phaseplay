<!--
  Pick, reorder, caption and remove pages (picture plays) or photos (drills). Files come from the
  picker (camera roll / camera / files) or drag-and-drop on a laptop; each is prepared in the
  browser with its own progress and can be cancelled. Reordering is by buttons, so it works by
  keyboard and screen reader.
-->
<script lang="ts">
  import { IconArrowDown, IconArrowUp, IconImagePlus, IconTrash, IconAlert } from '#lib/icons';
  import { mediaSrc } from './upload';
  import type { Drafts } from './drafts.svelte';

  type Props = { drafts: Drafts; noun?: 'page' | 'photo'; locked?: boolean };
  let { drafts, noun = 'page', locked = false }: Props = $props();
  let input: HTMLInputElement | undefined = $state();
  let over = $state(false);
  const Noun = $derived(noun === 'page' ? 'Page' : 'Photo');
  const full = $derived(drafts.count >= drafts.max);

  function picked(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    if (el.files?.length) drafts.add([...el.files]);
    el.value = '';
  }
  function drop(e: DragEvent) {
    e.preventDefault();
    over = false;
    if (locked) return;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) drafts.add(files);
  }
  const pct = (f: number) => Math.round(f * 100);
</script>

<div class="pe">
  <div
    class="drop"
    class:over
    class:compact={drafts.items.length > 0}
    role="group"
    aria-label="Add {noun}s"
    ondragover={(e) => {
      e.preventDefault();
      over = true;
    }}
    ondragleave={() => (over = false)}
    ondrop={drop}
  >
    <IconImagePlus />
    <div class="drop-text">
      <button type="button" class="pick" disabled={locked || full} onclick={() => input?.click()}
        >Add {noun}s</button
      >
      <span class="subtle hint-fine">or drop images here</span>
      <span class="subtle hint-coarse">from your photos, camera or files</span>
    </div>
    <span class="subtle small">JPEG, PNG, WebP or HEIC · up to {drafts.max}</span>
    <input
      bind:this={input}
      class="sr-only"
      type="file"
      accept="image/*,.heic,.heif"
      multiple
      tabindex="-1"
      aria-hidden="true"
      onchange={picked}
    />
  </div>

  <p class="sr-only" aria-live="polite">{drafts.status}</p>

  {#if drafts.items.length}
    <ol class="pages" aria-label="{Noun}s">
      {#each drafts.items as d, i (d.id)}
        {@const n = i + 1}
        <li class="pg" class:err={d.state === 'error'}>
          <div class="th">
            {#if d.preview}
              <img src={d.preview} alt="" />
            {:else if d.remote}
              <img src={mediaSrc(d.remote, true)} alt="" loading="lazy" />
            {:else}
              <span class="ph" aria-hidden="true"></span>
            {/if}
            <span class="num" aria-hidden="true">{n}</span>
          </div>
          <div class="mid">
            {#if d.state === 'error'}
              <p class="msg" role="alert"><IconAlert /> {d.name ? `${d.name}: ` : ''}{d.error}</p>
            {:else}
              <label class="sr-only" for="cap-{d.id}">Caption for {noun} {n}</label>
              <input
                id="cap-{d.id}"
                class="cap"
                bind:value={d.caption}
                maxlength="140"
                placeholder="Caption (optional)"
                autocomplete="off"
                disabled={locked}
              />
              {#if d.state === 'waiting' || d.state === 'preparing'}
                <span class="prog">
                  <progress
                    max="100"
                    value={pct(d.progress)}
                    aria-label="Preparing {noun} {n}: {pct(d.progress)}%"
                  ></progress>
                  <span class="subtle small">Preparing…</span>
                </span>
              {:else if d.state === 'uploading'}
                <span class="prog">
                  <progress
                    max="100"
                    value={pct(d.progress)}
                    aria-label="Uploading {noun} {n}: {pct(d.progress)}%"
                  ></progress>
                  <span class="subtle small">Uploading {pct(d.progress)}%</span>
                </span>
              {:else if d.prepared && !d.remote}
                <span class="subtle small"
                  >{d.prepared.width}×{d.prepared.height} · {Math.round(
                    d.prepared.blob.size / 1024,
                  )} KB</span
                >
              {/if}
            {/if}
          </div>
          <div class="btns">
            <button
              type="button"
              class="ib"
              aria-label="Move {noun} {n} up"
              disabled={locked || i === 0 || d.state === 'error'}
              onclick={() => drafts.move(d.id, -1)}><IconArrowUp /></button
            >
            <button
              type="button"
              class="ib"
              aria-label="Move {noun} {n} down"
              disabled={locked || i === drafts.items.length - 1 || d.state === 'error'}
              onclick={() => drafts.move(d.id, 1)}><IconArrowDown /></button
            >
            <button
              type="button"
              class="ib"
              aria-label={d.state === 'preparing' ? `Cancel ${noun} ${n}` : `Remove ${noun} ${n}`}
              disabled={locked}
              onclick={() => drafts.remove(d.id)}><IconTrash /></button
            >
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .pe {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-1);
    padding: var(--s-5) var(--s-4);
    border: 2px dashed var(--border-strong);
    border-radius: var(--r-lg);
    background: var(--surface-2);
    text-align: center;
  }
  .drop.compact {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    padding: var(--s-3);
    gap: var(--s-2);
  }
  .drop.compact > :global(svg) {
    display: none;
  }
  .drop.over {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .drop > :global(svg) {
    width: 28px;
    height: 28px;
    color: var(--text-2);
  }
  .drop-text {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 6px;
  }
  .pick {
    min-height: 44px;
    padding: 0 var(--s-4);
    border-radius: var(--r-full);
    border: 0;
    background: var(--accent);
    color: var(--on-accent, #fff);
    font-weight: 700;
    font-size: var(--t-16);
  }
  .pick:disabled {
    opacity: 0.55;
  }
  .small {
    font-size: var(--t-12);
  }
  .hint-coarse {
    display: none;
  }
  @media (pointer: coarse) {
    .hint-fine {
      display: none;
    }
    .hint-coarse {
      display: inline;
    }
  }
  .pages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .pg {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr) auto;
    grid-template-areas: 'th mid btns';
    gap: var(--s-3);
    align-items: center;
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
  }
  .pg.err {
    border-color: var(--danger, #b42318);
  }
  .th {
    grid-area: th;
    position: relative;
    width: 72px;
    height: 72px;
    border-radius: var(--r-sm, 6px);
    overflow: hidden;
    background: var(--surface-2);
  }
  .th img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .ph {
    display: block;
    width: 100%;
    height: 100%;
  }
  .num {
    position: absolute;
    left: 4px;
    top: 4px;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 11px;
    background: rgb(0 0 0 / 0.72);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    line-height: 22px;
    text-align: center;
  }
  .mid {
    grid-area: mid;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .cap {
    min-height: 44px;
    padding: 6px 10px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
    font-size: var(--t-16);
    width: 100%;
  }
  .prog {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  progress {
    flex: 1;
    height: 6px;
    accent-color: var(--accent);
  }
  .msg {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    margin: 0;
    font-size: var(--t-14);
    color: var(--danger-text, var(--text));
  }
  .msg :global(svg) {
    flex: none;
    width: 16px;
    height: 16px;
    margin-top: 2px;
  }
  .btns {
    grid-area: btns;
    display: flex;
    gap: 2px;
  }
  .ib {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text-2);
  }
  .ib:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .ib:disabled {
    opacity: 0.35;
  }
  .ib :global(svg) {
    width: 18px;
    height: 18px;
  }
  @media (max-width: 420px) {
    .pg {
      grid-template-columns: 64px minmax(0, 1fr);
      grid-template-areas: 'th mid' 'th btns';
      row-gap: 0;
      align-items: start;
    }
    .th {
      width: 64px;
      height: 64px;
    }
    .btns {
      justify-content: flex-end;
      margin-right: -6px;
    }
  }
</style>
