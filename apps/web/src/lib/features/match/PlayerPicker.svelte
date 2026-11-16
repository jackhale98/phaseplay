<!-- Big, thumb-sized player buttons (shirt number + name). Single choice; tap again to clear. -->
<script lang="ts">
  import type { TeamSnapshot } from '#lib/data/types';
  import { memberName } from '#lib/data/selectors';

  type Props = {
    ids: string[];
    shirt: Map<string, number>;
    snap: TeamSnapshot | null;
    label: string;
    value: string | null;
    /** Extra note per player, e.g. "Front row". */
    note?: (id: string) => string | undefined;
    onpick?: (id: string | null) => void;
    empty?: string;
  };
  let {
    ids,
    shirt,
    snap,
    label,
    value = $bindable(),
    note,
    onpick,
    empty = 'No players to pick from',
  }: Props = $props();

  const sorted = $derived([...ids].sort((a, b) => (shirt.get(a) ?? 99) - (shirt.get(b) ?? 99)));
  function pick(id: string) {
    value = value === id ? null : id;
    onpick?.(value);
  }
</script>

<fieldset class="pp">
  <legend>{label}</legend>
  {#if sorted.length}
    <div class="grid">
      {#each sorted as id (id)}
        {@const n = note?.(id)}
        <button type="button" class="p" aria-pressed={value === id} onclick={() => pick(id)}>
          <span class="no tnum" aria-hidden="true">{shirt.get(id) ?? '–'}</span>
          <span class="nm">
            <span class="truncate">{memberName(snap, id)}</span>
            {#if n}<small><span class="sr-only">, </span>{n}</small>{/if}
          </span>
          <span class="sr-only">, shirt {shirt.get(id) ?? 'none'}</span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="subtle">{empty}</p>
  {/if}
</fieldset>

<style>
  .pp {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  legend {
    padding: 0;
    margin-bottom: var(--s-2);
    font-size: var(--t-14);
    font-weight: 700;
    color: var(--text-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: var(--s-2);
  }
  .p {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 52px;
    padding: var(--s-2) var(--s-3) var(--s-2) var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
    text-align: left;
    font-weight: 600;
    font-size: var(--t-14);
    transition:
      background var(--m-fast) var(--ease),
      border-color var(--m-fast) var(--ease);
  }
  .p:hover {
    background: var(--surface-2);
  }
  .p[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .no {
    display: grid;
    place-items: center;
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: var(--r-sm);
    background: var(--surface-3);
    font-weight: 800;
  }
  .p[aria-pressed='true'] .no {
    background: var(--accent);
    color: var(--on-accent);
  }
  .nm {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.2;
  }
  small {
    color: var(--text-3);
    font-size: var(--t-12);
    font-weight: 600;
  }
</style>
