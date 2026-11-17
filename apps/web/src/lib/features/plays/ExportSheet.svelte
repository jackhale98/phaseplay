<script lang="ts">
  import type { Play } from '@phaseplay/shared';
  import type { ExportSize } from '@phaseplay/diagram/export/common';
  import type { ThemeName } from '@phaseplay/diagram/themes';
  import { textOn } from '@phaseplay/diagram/themes';
  import { app } from '#lib/data/app.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import Button from '#lib/components/Button.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import { shareOrDownload, copyImage } from '#lib/share';
  import { toasts } from '#lib/stores/toast.svelte';
  import { IconDownload, IconCopy, IconShare } from '#lib/icons';
  import { playImage, playVideo } from './exporting';

  let {
    open = $bindable(false),
    play,
    highlightMemberId,
  }: { open: boolean; play: Play; highlightMemberId?: string } = $props();

  type Kind = 'frame' | 'storyboard' | 'video';
  let kind = $state<Kind>('frame');
  let frame = $state(0);
  let size = $state<ExportSize>('1080x1080');
  let theme = $state<ThemeName>('grass');
  let busy = $state(false);
  let progress = $state<number | null>(null);
  let ctrl: AbortController | null = null;
  let lastBlob: Blob | null = null;
  /** Rendered but the phone refused the share (the tap went stale while rendering). */
  let ready = $state<{ blob: Blob; name: string } | null>(null);
  async function deliver(blob: Blob, name: string) {
    const r = await shareOrDownload(blob, name, play.title);
    if (r === 'blocked') {
      ready = { blob, name };
      status = 'Ready. Tap Share to send it';
    } else ready = null;
  }
  let status = $state('');

  const team = $derived(app.team);
  const accent = $derived(team?.colors.primary ?? '#1f6f43');
  const monogram = $derived(
    team
      ? { text: team.shortName, bg: team.colors.primary, fg: textOn(team.colors.primary) }
      : undefined,
  );
  const slug = $derived(
    (play.title || 'play')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'play',
  );
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  async function makeImage(): Promise<Blob> {
    return playImage({
      play,
      frameIndex: kind === 'storyboard' ? 'storyboard' : frame,
      size,
      theme,
      accent,
      title: play.title,
      monogram,
      highlightMemberId,
    });
  }

  async function exportNow() {
    if (busy) return;
    busy = true;
    status = '';
    try {
      if (kind === 'video') {
        ctrl = new AbortController();
        progress = 0;
        status = 'Rendering video…';
        const res = await playVideo({
          play,
          size,
          theme,
          accent,
          title: play.title,
          highlightMemberId,
          onProgress: (p) => (progress = p),
          signal: ctrl.signal,
        });
        status = 'Video ready';
        await deliver(res.blob, `${slug}.${res.ext}`);
      } else {
        status = 'Drawing image…';
        const blob = await makeImage();
        lastBlob = blob;
        status = 'Image ready';
        await deliver(
          blob,
          `${slug}${kind === 'storyboard' ? '-storyboard' : `-frame-${frame + 1}`}.png`,
        );
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        status = 'Export cancelled';
        toasts.show('Export cancelled');
      } else {
        status = '';
        toasts.error(`Export failed: ${(e as Error).message}`);
      }
    } finally {
      busy = false;
      progress = null;
      ctrl = null;
    }
  }

  async function copy() {
    busy = true;
    try {
      const blob = lastBlob && kind !== 'video' ? lastBlob : await makeImage();
      toasts.show(
        (await copyImage(blob)) ? 'Image copied' : "Couldn't copy the image here. Use Download",
      );
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    void [kind, frame, size, theme, play];
    lastBlob = null;
    ready = null;
  });
  $effect(() => {
    if (!open) ctrl?.abort();
  });
</script>

<Sheet bind:open title="Export" description="Share to the team chat or print." size="md">
  <div class="stack">
    <Segmented
      label="What to export"
      bind:value={kind}
      options={[
        { value: 'frame', label: 'Frame' },
        { value: 'storyboard', label: 'Storyboard' },
        { value: 'video', label: 'Video' },
      ]}
    />
    <div class="two">
      {#if kind === 'frame'}
        <Field label="Frame">
          {#snippet children({ id })}
            <select {id} bind:value={frame}>
              {#each play.frames as f, i (f.id)}<option value={i}
                  >Frame {i + 1}{f.caption ? ` · ${f.caption.slice(0, 30)}` : ''}</option
                >{/each}
            </select>
          {/snippet}
        </Field>
      {/if}
      <Field label="Size">
        {#snippet children({ id })}
          <select {id} bind:value={size}>
            <option value="1080x1080">Square 1080×1080</option>
            <option value="1920x1080">Landscape 1920×1080</option>
            <option value="1080x1920">Story 1080×1920</option>
          </select>
        {/snippet}
      </Field>
      <Field label="Style">
        {#snippet children({ id })}
          <select {id} bind:value={theme}>
            <option value="grass">Grass</option>
            <option value="chalkboard">Chalkboard</option>
            <option value="print">Print (white)</option>
          </select>
        {/snippet}
      </Field>
    </div>
    {#if kind !== 'video'}<p class="subtle">PNG at 2× for crisp printing and phones.</p>{:else}<p
        class="subtle"
      >
        MP4 where your browser supports it, otherwise WebM or GIF.
      </p>{/if}

    {#if progress !== null}
      <div class="prog">
        <label for="exp-prog"
          >Rendering <span class="tnum">{Math.round(progress * 100)}%</span></label
        >
        <progress id="exp-prog" max="1" value={progress}></progress>
        <Button variant="quiet" onclick={() => ctrl?.abort()}>Cancel</Button>
      </div>
    {/if}
    <p class="sr-only" aria-live="polite">{status}</p>

    {#if ready}
      <div class="ready" role="status">
        <span>Your {kind === 'video' ? 'video' : 'image'} is ready.</span>
        <Button variant="primary" onclick={() => ready && deliver(ready.blob, ready.name)}
          >{#snippet icon()}<IconShare />{/snippet}Share {kind === 'video'
            ? 'video'
            : 'image'}</Button
        >
      </div>
    {/if}
    <div class="row wrap">
      <Button
        variant="primary"
        onclick={exportNow}
        loading={busy && progress === null}
        disabled={busy}
      >
        {#snippet icon()}{#if coarse}<IconShare />{:else}<IconDownload />{/if}{/snippet}
        {coarse ? 'Share' : 'Download'}
        {kind === 'video' ? 'video' : 'PNG'}
      </Button>
      {#if kind !== 'video' && !coarse}
        <Button onclick={copy} disabled={busy}
          >{#snippet icon()}<IconCopy />{/snippet}Copy image</Button
        >
      {/if}
    </div>
  </div>
</Sheet>

<style>
  .ready {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    margin-bottom: var(--s-3);
    border-radius: var(--r-lg);
    background: var(--ok-soft);
    font-weight: 600;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--s-3);
  }
  .prog {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-2) var(--s-3);
  }
  .prog label {
    grid-column: 1 / -1;
    font-size: var(--t-14);
    font-weight: 650;
  }
  progress {
    width: 100%;
    height: 10px;
    accent-color: var(--accent);
  }
</style>
