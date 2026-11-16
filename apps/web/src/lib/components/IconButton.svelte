<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  type Props = HTMLButtonAttributes & { label: string; href?: string; children: Snippet; tone?: 'default' | 'accent' | 'danger' };
  let { label, href, children, tone = 'default', class: cls = '', type = 'button', ...rest }: Props = $props();
</script>

{#if href}
  <a {href} class="ib {tone} {cls}" aria-label={label} title={label}>{@render children()}</a>
{:else}
  <button {type} class="ib {tone} {cls}" aria-label={label} title={label} {...rest}>{@render children()}</button>
{/if}

<style>
  .ib {
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: none;
    border-radius: var(--r-full);
    border: 0;
    background: transparent;
    color: var(--text-2);
    transition: background var(--m-fast) var(--ease), color var(--m-fast) var(--ease);
  }
  .ib:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .ib :global(svg) {
    width: 20px;
    height: 20px;
  }
  .accent {
    color: var(--accent-text);
  }
  .danger {
    color: var(--danger);
  }
  .ib:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
