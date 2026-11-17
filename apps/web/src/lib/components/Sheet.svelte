<!--
  Bottom sheet on mobile, centred dialog on larger screens. Uses <dialog> for focus trapping,
  Escape to close and an inert background.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { IconX } from '#lib/icons';

  type Props = {
    open: boolean;
    title: string;
    description?: string;
    size?: 'sm' | 'md' | 'lg' | 'full';
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  };
  let {
    open = $bindable(),
    title,
    description,
    size = 'md',
    onclose,
    children,
    footer,
  }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  const id = `sheet-${Math.random().toString(36).slice(2, 8)}`;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  function close() {
    open = false;
    onclose?.();
  }
</script>

<dialog
  bind:this={dialog}
  class="sheet {size}"
  aria-labelledby="{id}-t"
  aria-describedby={description ? `${id}-d` : undefined}
  onclose={() => open && close()}
  onclick={(e) => e.target === dialog && close()}
>
  {#if open}
    <div class="inner">
      <header>
        <div class="grip" aria-hidden="true"></div>
        <div class="titles">
          <h2 id="{id}-t">{title}</h2>
          {#if description}<p id="{id}-d" class="muted">{description}</p>{/if}
        </div>
        <button class="x" type="button" aria-label="Close" onclick={close}><IconX /></button>
      </header>
      <div class="body">{@render children()}</div>
      {#if footer}<footer>{@render footer()}</footer>{/if}
    </div>
  {/if}
</dialog>

<style>
  .sheet {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    max-width: 100vw;
    max-height: 100dvh;
    width: 100%;
    margin: auto auto 0;
    overflow: visible;
  }
  .sheet::backdrop {
    background: var(--scrim);
    animation: fade var(--m-med) var(--ease);
  }
  .inner {
    display: flex;
    flex-direction: column;
    max-height: min(92dvh, 900px);
    background: var(--surface);
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    box-shadow: var(--e-3);
    padding-bottom: var(--safe-b);
    animation: up var(--m-slow) var(--ease);
  }
  header {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-5) var(--s-4) var(--s-3) var(--s-5);
  }
  .grip {
    position: absolute;
    top: 8px;
    left: 50%;
    width: 36px;
    height: 4px;
    margin-left: -18px;
    border-radius: 2px;
    background: var(--border-strong);
  }
  .titles {
    flex: 1;
    min-width: 0;
    padding-top: var(--s-1);
  }
  h2 {
    font-size: var(--t-20);
  }
  .titles p {
    margin-top: var(--s-1);
    font-size: var(--t-14);
  }
  .x {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: var(--surface-3);
    color: var(--text-2);
  }
  .x :global(svg) {
    width: 18px;
    height: 18px;
  }
  .body {
    padding: var(--s-2) var(--s-5) var(--s-5);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  footer {
    display: flex;
    gap: var(--s-3);
    justify-content: flex-end;
    padding: var(--s-3) var(--s-5) var(--s-4);
    border-top: 1px solid var(--border);
  }
  @media (min-width: 768px) {
    .sheet {
      margin: auto;
      width: calc(100% - 48px);
    }
    .sm {
      max-width: 420px;
    }
    .md {
      max-width: 560px;
    }
    .lg {
      max-width: 820px;
    }
    .full {
      max-width: 1100px;
    }
    .inner {
      border-radius: var(--r-lg);
      animation: pop var(--m-med) var(--ease);
    }
    .grip {
      display: none;
    }
    header {
      padding-top: var(--s-5);
    }
  }
  @keyframes up {
    from {
      transform: translateY(24px);
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.97);
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
