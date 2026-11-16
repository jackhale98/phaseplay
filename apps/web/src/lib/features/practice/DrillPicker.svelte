<script lang="ts">
  /** Search and filter the drill library; used in the "Add drill" sheet and the desktop side panel. */
  import {
    CONTACT_LABELS,
    DRILL_CATEGORIES,
    DRILL_CATEGORY_LABELS,
    type DrillCategory,
    type DrillMeta,
  } from '@phaseplay/shared';
  import Chip from '#lib/components/Chip.svelte';
  import { IconPlus, IconSearch } from '#lib/icons';

  type Props = { drills: DrillMeta[]; onpick: (d: DrillMeta) => void; autofocus?: boolean };
  let { drills, onpick, autofocus = false }: Props = $props();
  let q = $state('');
  let cat = $state<DrillCategory | null>(null);
  const id = `dp-${Math.random().toString(36).slice(2, 7)}`;

  const cats = $derived(DRILL_CATEGORIES.filter((c) => drills.some((d) => d.category === c)));
  const shown = $derived.by(() => {
    const needle = q.trim().toLowerCase();
    return drills
      .filter(
        (d) =>
          (!cat || d.category === cat) &&
          (!needle ||
            `${d.title} ${d.description} ${DRILL_CATEGORY_LABELS[d.category]}`
              .toLowerCase()
              .includes(needle)),
      )
      .sort(
        (a, b) =>
          DRILL_CATEGORIES.indexOf(a.category) - DRILL_CATEGORIES.indexOf(b.category) ||
          a.title.localeCompare(b.title),
      );
  });

  function focusOnMount(el: HTMLInputElement) {
    if (autofocus && matchMedia('(pointer: fine)').matches) el.focus();
  }
</script>

<div class="picker">
  <label class="search" for="{id}-q">
    <IconSearch />
    <span class="sr-only">Search drills</span>
    <input
      id="{id}-q"
      type="search"
      placeholder="Search drills"
      bind:value={q}
      autocomplete="off"
      {@attach focusOnMount}
    />
  </label>
  <div class="cats" role="group" aria-label="Category">
    <Chip selected={cat === null} onclick={() => (cat = null)}>All</Chip>
    {#each cats as c (c)}
      <Chip selected={cat === c} onclick={() => (cat = cat === c ? null : c)}
        >{DRILL_CATEGORY_LABELS[c]}</Chip
      >
    {/each}
  </div>
  {#if shown.length}
    <ul class="list items" aria-label="Drills">
      {#each shown as d (d.id)}
        <li>
          <button type="button" class="item" onclick={() => onpick(d)}>
            <span class="grow">
              <strong>{d.title}</strong>
              <small
                >{DRILL_CATEGORY_LABELS[d.category]} · {d.defaultDurationMin} min · {CONTACT_LABELS[
                  d.contactLevel
                ]}</small
              >
            </span>
            <span class="int" role="img" aria-label="Intensity {d.intensity} of 5">
              {#each [1, 2, 3, 4, 5] as i (i)}<i class:on={i <= d.intensity}></i>{/each}
            </span>
            <span class="add" aria-hidden="true"><IconPlus /></span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="none muted">{drills.length ? 'No drills match.' : 'Your drill library is empty.'}</p>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    min-height: 0;
  }
  .search,
  .cats {
    flex: none;
  }
  .search {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: 0 var(--s-3);
    min-height: 46px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface);
  }
  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .search :global(svg) {
    width: 18px;
    height: 18px;
    color: var(--text-3);
    flex: none;
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font-size: var(--t-16);
    outline: none;
  }
  .cats {
    display: flex;
    gap: var(--s-2);
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }
  .cats > :global(*) {
    flex: none;
    white-space: nowrap;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    min-height: 56px;
    padding: var(--s-2) var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    text-align: left;
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item strong {
    display: block;
    font-size: var(--t-16);
  }
  .item small {
    display: block;
    color: var(--text-2);
    font-size: var(--t-12);
  }
  .int {
    display: inline-flex;
    gap: 2px;
  }
  .int i {
    width: 5px;
    height: 12px;
    border-radius: 2px;
    background: var(--surface-3);
  }
  .int i.on {
    background: var(--accent);
  }
  .add {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-full);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .add :global(svg) {
    width: 18px;
    height: 18px;
  }
  .none {
    padding: var(--s-4) 0;
    font-size: var(--t-14);
  }
</style>
