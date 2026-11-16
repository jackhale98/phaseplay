<script lang="ts">
  import type { Snippet } from 'svelte';
  type Props = { label: string; hint?: string; error?: string | null; id?: string; children: Snippet<[{ id: string; describedby: string | undefined }]> };
  let { label, hint, error = null, id = `f-${Math.random().toString(36).slice(2, 8)}`, children }: Props = $props();
  const describedby = $derived([hint ? `${id}-h` : '', error ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined);
</script>

<div class="field" class:invalid={!!error}>
  <label for={id}>{label}</label>
  {@render children({ id, describedby })}
  {#if error}<p class="err" id="{id}-e" role="alert">{error}</p>{:else if hint}<p class="hint" id="{id}-h">{hint}</p>{/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  label {
    font-size: var(--t-14);
    font-weight: 650;
  }
  .hint,
  .err {
    font-size: var(--t-12);
    color: var(--text-3);
  }
  .err {
    color: var(--danger);
    font-weight: 600;
  }
  .field :global(input:not([type='checkbox']):not([type='radio']):not([type='color'])),
  .field :global(select),
  .field :global(textarea) {
    width: 100%;
    min-height: 46px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-size: var(--t-16);
    transition: border-color var(--m-fast) var(--ease), box-shadow var(--m-fast) var(--ease);
  }
  .field :global(textarea) {
    min-height: 96px;
    resize: vertical;
  }
  .field :global(input:focus),
  .field :global(select:focus),
  .field :global(textarea:focus) {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .invalid :global(input),
  .invalid :global(select),
  .invalid :global(textarea) {
    border-color: var(--danger);
  }
</style>
