<!--
  Review an emblem before it's saved: shows it on light and dark, with an option to remove a plain
  background (lib/crest-bg.ts) so it looks right in both themes.
-->
<script lang="ts">
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import { toasts } from '#lib/stores/toast.svelte';
  import { buildCrest, encodeCrest, loadCrestSource, previewUrl } from '#lib/crest';
  import type { BgResult } from '#lib/crest-bg';
  import Sheet from './Sheet.svelte';
  import Button from './Button.svelte';

  type Props = { open: boolean; file: File | null };
  let { open = $bindable(), file }: Props = $props();

  let source = $state.raw<HTMLCanvasElement | null>(null);
  let result = $state.raw<HTMLCanvasElement | null>(null);
  let url = $state('');
  let status = $state<BgResult['status'] | null>(null);
  let removeBg = $state(true);
  let error = $state<string | null>(null);
  let busy = $state(false);

  // Load the chosen file once per pick.
  $effect(() => {
    const f = file;
    source = null;
    error = null;
    status = null;
    removeBg = true;
    if (!f || !open) return;
    let alive = true;
    loadCrestSource(f)
      .then((c) => alive && (source = c))
      .catch((e: Error) => alive && (error = e.message));
    return () => {
      alive = false;
    };
  });

  // Rebuild the preview when the source or the option changes.
  $effect(() => {
    const src = source;
    const remove = removeBg;
    if (!src) return;
    const built = buildCrest(src, remove);
    result = built.canvas;
    if (status === null) {
      status = built.bg.status;
      if (built.bg.status !== 'removed') removeBg = false;
    }
    let alive = true;
    let made = '';
    void previewUrl(built.canvas).then((u) => {
      made = u;
      if (alive) url = u;
      else URL.revokeObjectURL(u);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  });

  const note = $derived(
    status === 'removed'
      ? removeBg
        ? 'We took out the plain background so it looks right on light and dark.'
        : 'Keeping the original background.'
      : status === 'transparent'
        ? 'Your image already has a transparent background.'
        : status === 'busy'
          ? "We couldn't find a plain background to remove, so it's used as is. A PNG with a transparent background works best."
          : '',
  );

  async function save() {
    if (!result) return;
    busy = true;
    try {
      await api(teamPath('/crest'), { method: 'PUT', body: await encodeCrest(result) });
      await app.sync();
      await app.refreshMe();
      toasts.success('Emblem updated');
      open = false;
    } catch (e) {
      toasts.error(e instanceof ApiError || e instanceof Error ? e.message : 'Could not upload');
    } finally {
      busy = false;
    }
  }
</script>

<Sheet bind:open title="Your emblem" description="Check how it looks before saving." size="sm">
  {#if error}
    <p class="err" role="alert">{error}</p>
  {:else if !url}
    <div class="sk" aria-busy="true" aria-label="Preparing your emblem"></div>
  {:else}
    <div class="swatches">
      <figure class="light">
        <img src={url} alt="Your emblem on a light background" width="112" height="112" />
        <figcaption>Light</figcaption>
      </figure>
      <figure class="dark">
        <img src={url} alt="Your emblem on a dark background" width="112" height="112" />
        <figcaption>Dark</figcaption>
      </figure>
    </div>
    {#if status === 'removed'}
      <label class="check">
        <input type="checkbox" bind:checked={removeBg} />
        <span>Remove the background</span>
      </label>
    {/if}
    <p class="muted" aria-live="polite">{note}</p>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" disabled={!result || busy} loading={busy} onclick={save}
      >Use this emblem</Button
    >
  {/snippet}
</Sheet>

<style>
  .swatches {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--s-3);
  }
  figure {
    margin: 0;
    display: grid;
    justify-items: center;
    gap: var(--s-2);
    padding: var(--s-4);
    border-radius: var(--r-lg);
    border: 1px solid var(--border);
  }
  /* Fixed swatch colours: the point is to see both, whatever the app theme. */
  .light {
    background: #f6f8f6;
    color: #4b5a50;
  }
  .dark {
    background: #101612;
    color: #b4c0b7;
  }
  figure img {
    width: 112px;
    height: 112px;
    object-fit: contain;
  }
  figcaption {
    font-size: var(--t-14);
    font-weight: 600;
  }
  .check {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 44px;
    margin-top: var(--s-3);
    font-weight: 600;
  }
  .check input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
  .muted {
    margin: var(--s-2) 0 0;
  }
  .err {
    color: var(--danger);
    font-weight: 600;
  }
  .sk {
    height: 170px;
    border-radius: var(--r-lg);
    background: var(--surface-2);
  }
</style>
