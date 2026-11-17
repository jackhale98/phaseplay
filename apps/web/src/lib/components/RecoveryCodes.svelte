<script lang="ts">
  import Button from './Button.svelte';
  import { IconCopy, IconDownload, IconPrint } from '#lib/icons';
  import { copyText } from '#lib/share';
  import { toasts } from '#lib/stores/toast.svelte';

  let { codes, ondone }: { codes: string[]; ondone: () => void } = $props();
  let saved = $state(false);
  const text = $derived(
    `Phaseplay recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`,
  );

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: 'phaseplay-recovery-codes.txt',
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
</script>

<div class="rc">
  <ol class="codes tnum" aria-label="Recovery codes">
    {#each codes as c (c)}<li><code>{c}</code></li>{/each}
  </ol>
  <div class="row wrap">
    <Button
      size="sm"
      onclick={async () => toasts.show((await copyText(text)) ? 'Codes copied' : "Couldn't copy")}
    >
      {#snippet icon()}<IconCopy />{/snippet}Copy
    </Button>
    <Button size="sm" onclick={download}>{#snippet icon()}<IconDownload />{/snippet}Download</Button
    >
    <Button size="sm" onclick={() => print()}>{#snippet icon()}<IconPrint />{/snippet}Print</Button>
  </div>
  <label class="ack">
    <input type="checkbox" bind:checked={saved} />
    <span>I've saved these somewhere safe</span>
  </label>
  <Button variant="primary" size="lg" block disabled={!saved} onclick={ondone}>Continue</Button>
</div>

<style>
  .rc {
    display: grid;
    gap: var(--s-4);
  }
  .codes {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--s-2) var(--s-4);
    margin: 0;
    padding: var(--s-4) var(--s-4) var(--s-4) var(--s-8);
    background: var(--surface-sunken);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    font-size: 1.0625rem;
  }
  code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    letter-spacing: 0.04em;
  }
  .ack {
    display: flex;
    gap: var(--s-3);
    align-items: center;
    min-height: 44px;
    font-weight: 600;
  }
  .ack input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
  @media print {
    :global(body *) {
      visibility: hidden;
    }
    .codes,
    .codes :global(*) {
      visibility: visible;
    }
    .codes {
      position: absolute;
      inset: 0;
    }
  }
</style>
