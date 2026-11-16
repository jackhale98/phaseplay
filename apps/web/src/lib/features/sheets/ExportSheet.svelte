<!--
  PNG export for the team chat: story, square and landscape. The renderer is loaded on demand so
  the sheet route's initial chunk stays small.
-->
<script lang="ts">
  import Sheet from '#lib/components/Sheet.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import Button from '#lib/components/Button.svelte';
  import { shareOrDownload, copyImage } from '#lib/share';
  import { toasts } from '#lib/stores/toast.svelte';
  import { IconShare, IconDownload, IconCopy } from '#lib/icons';
  import type { TeamSheetInput, SheetTemplate } from '@phaseplay/diagram/export/sheet';

  type Props = {
    open: boolean;
    input: Omit<TeamSheetInput, 'template'>;
    filename: string;
  };
  let { open = $bindable(), input, filename }: Props = $props();

  const SIZES: Record<SheetTemplate, { w: number; h: number; label: string }> = {
    story: { w: 1080, h: 1920, label: 'Story' },
    square: { w: 1080, h: 1080, label: 'Square' },
    landscape: { w: 1920, h: 1080, label: 'Landscape' },
  };
  let template = $state<SheetTemplate>('story');
  let blob = $state.raw<Blob | null>(null);
  let url = $state<string | null>(null);
  let busy = $state(false);
  let failed = $state(false);
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const size = $derived(SIZES[template]);
  const file = $derived(`${filename}-${template}.png`);

  $effect(() => {
    if (!open) return;
    const t = template;
    const data = { ...input, template: t };
    let cancelled = false;
    busy = true;
    failed = false;
    void (async () => {
      try {
        const mod = await import('@phaseplay/diagram/export/sheet');
        await document.fonts?.load("800 40px 'PP Sans'").catch(() => {});
        const b = await mod.renderTeamSheet(data);
        if (cancelled) return;
        if (url) URL.revokeObjectURL(url);
        blob = b;
        url = URL.createObjectURL(b);
      } catch {
        if (!cancelled) failed = true;
      } finally {
        if (!cancelled) busy = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  $effect(() => () => {
    if (url) URL.revokeObjectURL(url);
  });

  async function share() {
    if (!blob) return;
    const r = await shareOrDownload(blob, file, 'Team sheet');
    if (r === 'downloaded') toasts.success('Image saved');
  }
  async function copy() {
    if (!blob) return;
    toasts.show(
      (await copyImage(blob))
        ? 'Image copied. Paste it in the group chat'
        : "Couldn't copy the image",
    );
  }
</script>

<Sheet
  bind:open
  title="Export team sheet"
  description="A PNG for the group chat, in your team colours."
  size="lg"
>
  <div class="ex">
    <Segmented
      label="Image size"
      bind:value={template}
      options={(Object.keys(SIZES) as SheetTemplate[]).map((k) => ({
        value: k,
        label: SIZES[k].label,
      }))}
    />
    <p class="subtle tnum">{size.w} × {size.h}</p>
    <div
      class="frame"
      style:aspect-ratio="{size.w} / {size.h}"
      style:width="min(100%, calc(min(52dvh, 560px) * {size.w / size.h}))"
      aria-busy={busy}
    >
      {#if url}
        <img
          src={url}
          alt="Team sheet image, {size.label.toLowerCase()} {size.w} by {size.h}"
          width={size.w}
          height={size.h}
          class:dim={busy}
          data-template={template}
        />
      {/if}
      {#if failed}<p class="subtle err">Couldn't draw the image. Try again.</p>{/if}
    </div>
  </div>
  {#snippet footer()}
    {#if coarse}
      <Button variant="primary" block disabled={!blob || busy} onclick={share}>
        {#snippet icon()}<IconShare />{/snippet}Share
      </Button>
    {:else}
      <Button disabled={!blob || busy} onclick={copy}
        >{#snippet icon()}<IconCopy />{/snippet}Copy image</Button
      >
      <Button variant="primary" disabled={!blob || busy} onclick={share}>
        {#snippet icon()}<IconDownload />{/snippet}Download
      </Button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .ex {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-3);
  }
  .frame {
    position: relative;
    display: grid;
    place-items: center;

    max-width: 100%;
    border-radius: var(--r-md);
    background: var(--surface-3);
    overflow: hidden;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    transition: opacity var(--m-fast) var(--ease);
  }
  .dim {
    opacity: 0.5;
  }
  .err {
    position: absolute;
    padding: var(--s-4);
    text-align: center;
  }
</style>
