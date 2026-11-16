<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Props = HTMLButtonAttributes & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
    size?: 'sm' | 'md' | 'lg';
    href?: string;
    loading?: boolean;
    block?: boolean;
    children?: Snippet;
    icon?: Snippet;
  };
  let {
    variant = 'secondary',
    size = 'md',
    href,
    loading = false,
    block = false,
    disabled,
    children,
    icon,
    type = 'button',
    class: cls = '',
    ...rest
  }: Props = $props();
</script>

{#if href}
  <a {href} class="btn {variant} {size} {cls}" class:block aria-disabled={disabled}>
    {#if icon}{@render icon()}{/if}
    {#if children}<span>{@render children()}</span>{/if}
  </a>
{:else}
  <button
    {type}
    class="btn {variant} {size} {cls}"
    class:block
    class:loading
    disabled={disabled || loading}
    aria-busy={loading}
    {...rest}
  >
    {#if icon}{@render icon()}{/if}
    {#if children}<span>{@render children()}</span>{/if}
  </button>
{/if}

<style>
  .btn {
    --h: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    min-height: var(--h);
    padding: 0 var(--s-4);
    border-radius: var(--r-md);
    border: 1px solid transparent;
    font-weight: 650;
    font-size: var(--t-16);
    line-height: 1;
    text-decoration: none;
    white-space: nowrap;
    user-select: none;
    transition:
      background var(--m-fast) var(--ease),
      transform var(--m-fast) var(--ease),
      box-shadow var(--m-fast) var(--ease),
      border-color var(--m-fast) var(--ease);
  }
  .btn :global(svg) {
    width: 18px;
    height: 18px;
    flex: none;
  }
  .btn:active:not(:disabled) {
    transform: scale(0.98);
  }
  .btn:disabled,
  .btn[aria-disabled='true'] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .sm {
    --h: 36px;
    padding: 0 var(--s-3);
    font-size: var(--t-14);
  }
  .lg {
    --h: 52px;
    padding: 0 var(--s-6);
    font-size: 1.0625rem;
  }
  .block {
    width: 100%;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: var(--e-1);
  }
  .primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 88%, var(--text));
  }
  .secondary {
    background: var(--surface);
    color: var(--text);
    border-color: var(--border-strong);
  }
  .secondary:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .ghost {
    background: transparent;
    color: var(--text);
  }
  .ghost:hover:not(:disabled) {
    background: var(--surface-3);
  }
  .quiet {
    background: var(--surface-3);
    color: var(--text);
  }
  .quiet:hover:not(:disabled) {
    background: color-mix(in srgb, var(--surface-3) 80%, var(--text));
  }
  .danger {
    background: var(--danger);
    color: #fff;
  }
  .loading {
    position: relative;
    color: transparent !important;
  }
  .loading::after {
    content: '';
    position: absolute;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-color: var(--on-accent) transparent var(--on-accent) transparent;
    animation: spin 0.8s linear infinite;
  }
  .secondary.loading::after,
  .ghost.loading::after,
  .quiet.loading::after {
    border-color: var(--text) transparent var(--text) transparent;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
