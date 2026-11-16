<script lang="ts">
  import { IconMinus, IconPlus } from '#lib/icons';

  type Props = {
    value: number;
    label: string;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    size?: 'sm' | 'md';
    onchange: (v: number) => void;
  };
  let {
    value,
    label,
    min = 1,
    max = 120,
    step = 1,
    unit = 'min',
    size = 'md',
    onchange,
  }: Props = $props();
  const set = (v: number) => onchange(Math.min(max, Math.max(min, v)));
</script>

<div class="stepper {size}" role="group" aria-label={label}>
  <button type="button" aria-label="Less" disabled={value <= min} onclick={() => set(value - step)}
    ><IconMinus /></button
  >
  <span class="v tnum">{value}<small>{unit}</small></span>
  <button type="button" aria-label="More" disabled={value >= max} onclick={() => set(value + step)}
    ><IconPlus /></button
  >
</div>

<style>
  .stepper {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-full);
    background: var(--surface);
    flex: none;
  }
  button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--r-full);
    background: transparent;
    color: var(--text);
  }
  button:hover:not(:disabled) {
    background: var(--surface-2);
  }
  button:disabled {
    color: var(--text-3);
    cursor: default;
    opacity: 0.6;
  }
  button :global(svg) {
    width: 18px;
    height: 18px;
  }
  .v {
    min-width: 3.6em;
    text-align: center;
    font-weight: 700;
  }
  small {
    margin-left: 2px;
    font-size: var(--t-12);
    font-weight: 600;
    color: var(--text-2);
  }
  .sm .v {
    min-width: 3.4em;
    font-size: var(--t-14);
  }
</style>
