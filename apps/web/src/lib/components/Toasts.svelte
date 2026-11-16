<script lang="ts">
  import { toasts } from '#lib/stores/toast.svelte';
  import { IconAlert, IconCheck, IconX } from '#lib/icons';
</script>

<div class="toasts" role="status" aria-live="polite" aria-atomic="false">
  {#each toasts.items as t (t.id)}
    <div class="toast {t.tone}">
      {#if t.tone === 'success'}<IconCheck />{:else if t.tone === 'error' || t.tone === 'warn'}<IconAlert />{/if}
      <span class="msg">{t.message}</span>
      {#if t.action}
        <button
          class="act"
          onclick={() => {
            t.action?.run();
            toasts.dismiss(t.id);
          }}>{t.action.label}</button
        >
      {/if}
      <button class="close" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}><IconX /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    z-index: var(--z-toast);
    left: 50%;
    bottom: calc(var(--tabbar-h) + var(--safe-b) + var(--s-3));
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    width: min(calc(100vw - 24px), 480px);
    pointer-events: none;
  }
  @media (min-width: 768px) {
    .toasts {
      bottom: var(--s-6);
    }
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-2) var(--s-2) var(--s-4);
    min-height: 52px;
    border-radius: var(--r-md);
    background: var(--n-900);
    color: #f2f5f2;
    box-shadow: var(--e-3);
    font-size: var(--t-14);
    font-weight: 500;
    animation: in var(--m-med) var(--ease-emph);
  }
  :global(:root[data-theme='dark']) .toast {
    background: #2a352e;
  }
  .toast > :global(svg) {
    width: 18px;
    height: 18px;
    flex: none;
  }
  .success > :global(svg) {
    color: #7ee2a8;
  }
  .error > :global(svg) {
    color: #ff9b91;
  }
  .warn > :global(svg) {
    color: #f6c56b;
  }
  .msg {
    flex: 1;
  }
  .act {
    border: 0;
    background: transparent;
    color: #9ff0bd;
    font-weight: 700;
    padding: var(--s-2) var(--s-3);
    min-height: 40px;
    border-radius: var(--r-sm);
  }
  .close {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: #b8c4bb;
  }
  .close :global(svg) {
    width: 16px;
    height: 16px;
  }
  @keyframes in {
    from {
      transform: translateY(12px) scale(0.98);
      opacity: 0;
    }
  }
</style>
