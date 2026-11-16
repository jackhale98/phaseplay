<!-- Small status badge for fit and replies. Text is pulled towards --text so every tone passes AA. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  type Props = {
    tone?: 'default' | 'ok' | 'warn' | 'danger' | 'info' | 'accent';
    size?: 'sm' | 'md';
    children: Snippet;
  };
  let { tone = 'default', size = 'sm', children }: Props = $props();
</script>

<span class="b {tone} {size}">{@render children()}</span>

<style>
  .b {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 var(--s-2);
    border-radius: var(--r-full);
    font-size: var(--t-12);
    font-weight: 650;
    white-space: nowrap;
    background: var(--surface-3);
    color: var(--text-2);
  }
  .md {
    height: 32px;
    padding: 0 var(--s-3);
    font-size: var(--t-14);
  }
  .ok {
    background: var(--ok-soft);
    color: color-mix(in srgb, var(--ok) 72%, var(--text));
  }
  .warn {
    background: var(--warn-soft);
    color: color-mix(in srgb, var(--warn) 80%, var(--text));
  }
  .danger {
    background: var(--danger-soft);
    color: color-mix(in srgb, var(--danger) 80%, var(--text));
  }
  .info {
    background: var(--info-soft);
    color: color-mix(in srgb, var(--info) 80%, var(--text));
  }
  .accent {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
</style>
