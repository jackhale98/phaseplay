<!-- Collapsible list of things to check before publishing. Slot warnings jump to the slot. -->
<script lang="ts">
  import { IconWarn, IconCheck, IconChevronDown, IconChevronRight } from '#lib/icons';
  import type { WarningLine } from './model';

  type Props = { lines: WarningLine[]; note?: string; onslot: (n: number) => void; open?: boolean };
  let { lines, note, onslot, open = $bindable(false) }: Props = $props();
  const id = `wt-${Math.random().toString(36).slice(2, 7)}`;
  const danger = $derived(lines.some((l) => l.tone === 'danger'));
</script>

<section class="tray" class:ok={!lines.length} class:danger aria-label="Warnings">
  {#if !lines.length}
    <p class="sum"><IconCheck /><span>All good. Nothing to check.</span></p>
  {:else}
    <button
      type="button"
      class="sum"
      aria-expanded={open}
      aria-controls={id}
      onclick={() => (open = !open)}
    >
      <IconWarn />
      <span class="grow">{lines.length} {lines.length === 1 ? 'thing' : 'things'} to check</span>
      <span class="chev" class:up={open}><IconChevronDown /></span>
    </button>
    <div {id} hidden={!open}>
      <ul class="list">
        {#each lines as l (l.key)}
          <li class="t-{l.tone}">
            {#if l.slot !== null}
              <button type="button" class="ln" onclick={() => onslot(l.slot!)}>
                <span class="dot" aria-hidden="true"></span><span class="grow">{l.text}</span
                ><IconChevronRight />
              </button>
            {:else}
              <p class="ln">
                <span class="dot" aria-hidden="true"></span><span class="grow">{l.text}</span>
              </p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if note}<p class="note subtle">{note}</p>{/if}
    </div>
  {/if}
</section>

<style>
  .tray {
    border-radius: var(--r-lg);
    background: var(--warn-soft);
    color: color-mix(in srgb, var(--warn) 85%, var(--text));
    overflow: hidden;
  }
  .tray.danger {
    background: color-mix(in srgb, var(--warn-soft) 70%, var(--danger-soft));
  }
  .tray.ok {
    background: var(--ok-soft);
    color: color-mix(in srgb, var(--ok) 72%, var(--text));
  }
  .sum {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    width: 100%;
    min-height: 48px;
    padding: var(--s-2) var(--s-4);
    border: 0;
    background: transparent;
    color: inherit;
    font-weight: 700;
    font-size: var(--t-14);
    text-align: left;
  }
  .sum :global(svg) {
    width: 18px;
    height: 18px;
    flex: none;
  }
  .chev {
    display: grid;
    transition: transform var(--m-fast) var(--ease);
  }
  .chev.up {
    transform: rotate(180deg);
  }
  ul {
    padding: 0 var(--s-2) var(--s-2);
  }
  .ln {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    width: 100%;
    min-height: 44px;
    padding: var(--s-1) var(--s-2);
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text);
    font-size: var(--t-14);
    text-align: left;
  }
  button.ln:hover {
    background: rgb(255 255 255 / 0.5);
  }
  .ln :global(svg) {
    width: 16px;
    height: 16px;
    color: var(--text-3);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
    background: var(--warn);
  }
  .t-danger .dot {
    background: var(--danger);
  }
  .note {
    padding: 0 var(--s-4) var(--s-3);
    color: var(--text-2);
  }
</style>
