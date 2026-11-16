<script lang="ts">
  import type { Snippet } from 'svelte';
  type Props = { title: string; body?: string; icon?: Snippet; action?: Snippet };
  let { title, body, icon, action }: Props = $props();
</script>

<div class="empty">
  {#if icon}<div class="ic">{@render icon()}</div>{/if}
  <h3>{title}</h3>
  {#if body}<p class="muted">{body}</p>{/if}
  {#if action}<div class="act">{@render action()}</div>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--s-2);
    padding: var(--s-10) var(--s-6);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-lg);
    background: var(--surface-sunken);
  }
  .ic {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    margin-bottom: var(--s-2);
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ic :global(svg) {
    width: 24px;
    height: 24px;
  }
  h3 {
    font-size: var(--t-16);
  }
  p {
    max-width: 38ch;
    font-size: var(--t-14);
  }
  .act {
    margin-top: var(--s-3);
  }
</style>
