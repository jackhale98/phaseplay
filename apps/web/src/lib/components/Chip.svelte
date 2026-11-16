<script lang="ts">
  import type { Snippet } from 'svelte';
  type Props = { selected?: boolean; onclick?: () => void; children: Snippet; tone?: 'default' | 'ok' | 'warn' | 'danger' | 'accent' | 'info'; as?: 'button' | 'span' };
  let { selected = false, onclick, children, tone = 'default', as = onclick ? 'button' : 'span' }: Props = $props();
</script>

{#if as === 'button'}
  <button type="button" class="chip {tone}" class:selected aria-pressed={selected} {onclick}>{@render children()}</button>
{:else}
  <span class="chip {tone}" class:selected>{@render children()}</span>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 var(--s-3);
    border-radius: var(--r-full);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-2);
    font-size: var(--t-12);
    font-weight: 650;
    white-space: nowrap;
  }
  button.chip {
    height: 36px;
    font-size: var(--t-14);
    min-width: 44px;
    justify-content: center;
  }
  .chip :global(svg) {
    width: 14px;
    height: 14px;
  }
  .selected {
    background: var(--text);
    border-color: var(--text);
    color: var(--bg);
  }
  .ok {
    background: var(--ok-soft);
    border-color: transparent;
    color: var(--ok);
  }
  .warn {
    background: var(--warn-soft);
    border-color: transparent;
    color: var(--warn);
  }
  .danger {
    background: var(--danger-soft);
    border-color: transparent;
    color: var(--danger);
  }
  .info {
    background: var(--info-soft);
    border-color: transparent;
    color: var(--info);
  }
  .accent {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent-text);
  }
</style>
