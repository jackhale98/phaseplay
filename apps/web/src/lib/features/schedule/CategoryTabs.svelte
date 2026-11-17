<!-- All / Games / Practices / Events filter with counts. A radio group: arrow keys move and select. -->
<script lang="ts">
  import { EVENT_CATEGORY_LABELS } from '@phaseplay/shared';
  import { CATEGORY_ICON } from './category';
  import { SHOWS, type Show } from './schedule';

  type Props = { value: Show; counts: Record<Show, number>; onchange: (v: Show) => void };
  let { value, counts, onchange }: Props = $props();
  const label = (s: Show) => (s === 'all' ? 'All' : EVENT_CATEGORY_LABELS[s]);

  function key(e: KeyboardEvent, i: number) {
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const n = SHOWS[(i + d + SHOWS.length) % SHOWS.length]!;
    onchange(n);
    const buttons = (e.currentTarget as HTMLElement).parentElement?.querySelectorAll('button');
    buttons?.[SHOWS.indexOf(n)]?.focus();
  }
</script>

<div class="tabs" role="radiogroup" aria-label="Show">
  {#each SHOWS as s, i (s)}
    {@const Icon = CATEGORY_ICON[s]}
    <button
      type="button"
      role="radio"
      class={s}
      aria-checked={value === s}
      tabindex={value === s ? 0 : -1}
      onclick={() => onchange(s)}
      onkeydown={(e) => key(e, i)}
    >
      <span class="ic" aria-hidden="true"><Icon /></span>
      <span class="t">{label(s)}</span>
      <span class="n tnum">{counts[s]}</span>
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
    padding: 4px;
    border-radius: var(--r-lg);
    background: var(--surface-3);
  }
  button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 60px;
    padding: var(--s-2) var(--s-1);
    border: 0;
    border-radius: calc(var(--r-lg) - 4px);
    background: transparent;
    color: var(--text-2);
    font-weight: 650;
    font-size: var(--t-14);
    transition:
      background var(--m-fast) var(--ease),
      color var(--m-fast) var(--ease);
  }
  button:hover {
    color: var(--text);
  }
  .ic {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
  }
  .ic :global(svg) {
    width: 18px;
    height: 18px;
  }
  .n {
    font-size: var(--t-12);
    font-weight: 700;
    color: var(--text-3);
  }
  [aria-checked='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--e-1);
  }
  [aria-checked='true'] .ic {
    color: var(--cat);
  }
  .all {
    --cat: var(--text);
  }
  .games {
    --cat: light-dark(#a1480a, #f6b25e);
  }
  .practices {
    --cat: var(--accent-text);
  }
  .events {
    --cat: var(--info);
  }
  @media (min-width: 560px) {
    button {
      flex-direction: row;
      gap: var(--s-2);
      min-height: 48px;
    }
    .n {
      min-width: 24px;
      padding: 1px 6px;
      border-radius: var(--r-full);
      background: var(--surface-3);
    }
    [aria-checked='true'] .n {
      background: var(--surface-2);
      color: var(--text-2);
    }
  }
</style>
