<script lang="ts" generics="T extends string">
  type Props = {
    value: T;
    options: { value: T; label: string }[];
    label: string;
    size?: 'sm' | 'md';
  };
  let { value = $bindable(), options, label, size = 'md' }: Props = $props();
  function key(e: KeyboardEvent, i: number) {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = options[(i + d + options.length) % options.length]!;
    value = n.value;
    const buttons = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll('button');
    buttons?.item(options.indexOf(n))?.focus();
  }
</script>

<div class="seg {size}" role="radiogroup" aria-label={label}>
  {#each options as o, i (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === o.value}
      tabindex={value === o.value ? 0 : -1}
      onclick={() => (value = o.value)}
      onkeydown={(e) => key(e, i)}>{o.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    border-radius: var(--r-md);
    background: var(--surface-3);
  }
  button {
    border: 0;
    background: transparent;
    min-height: 38px;
    padding: 0 var(--s-4);
    border-radius: calc(var(--r-md) - 3px);
    font-weight: 600;
    font-size: var(--t-14);
    color: var(--text-2);
    transition:
      background var(--m-fast) var(--ease),
      color var(--m-fast) var(--ease);
  }
  .sm button {
    min-height: 32px;
    padding: 0 var(--s-3);
  }
  button[aria-checked='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--e-1);
  }
</style>
