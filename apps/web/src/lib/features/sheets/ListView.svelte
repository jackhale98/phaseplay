<!-- Every slot as a row: number, position, player and their reply. -->
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { RULES, sheetSlots } from '@phaseplay/shared';
  import SlotToken from './SlotToken.svelte';
  import { AVAIL_LABEL, type Avail, type Draft } from './model';

  type Props = {
    draft: Draft;
    nameOf: (id: string) => string;
    availOf?: (id: string) => Avail | null;
    flags?: Map<number, string>;
    meId?: string | null;
    editable?: boolean;
    over?: number | null;
    slotProps?: (n: number) => HTMLButtonAttributes;
  };
  let {
    draft,
    nameOf,
    availOf = () => null,
    flags = new Map(),
    meId = null,
    editable = false,
    over = null,
    slotProps = () => ({}),
  }: Props = $props();

  const all = $derived(sheetSlots(draft.format, draft.replacements));
  const starters = $derived(all.filter((n) => n <= RULES[draft.format].starters));
  const bench = $derived(all.filter((n) => n > RULES[draft.format].starters));
</script>

{#snippet rowsOf(list: number[])}
  <ul class="list rows">
    {#each list as n (n)}
      {@const id = draft.slots[String(n)] ?? null}
      {@const a = id ? availOf(id) : null}
      <li>
        <SlotToken
          format={draft.format}
          {n}
          variant="row"
          name={id ? nameOf(id) : null}
          captain={!!id && draft.captainId === id}
          vice={!!id && draft.viceId === id}
          flag={flags.get(n)}
          me={!!id && id === meId}
          over={over === n}
          detail={a && !flags.get(n) ? AVAIL_LABEL[a] : undefined}
          {editable}
          attrs={editable ? slotProps(n) : {}}
        />
      </li>
    {/each}
  </ul>
{/snippet}

<section aria-label={draft.format === '15s' ? 'Starting XV' : 'Starting VII'}>
  <h2 class="lh">{draft.format === '15s' ? 'Starting XV' : 'Starting VII'}</h2>
  {@render rowsOf(starters)}
</section>
{#if bench.length}
  <section aria-label="Replacements">
    <h2 class="lh">Replacements</h2>
    {@render rowsOf(bench)}
  </section>
{/if}

<style>
  .lh {
    margin: var(--s-5) 0 var(--s-2);
    font-size: var(--t-16);
  }
  section:first-child .lh {
    margin-top: 0;
  }
  .rows {
    display: grid;
    gap: var(--s-2);
  }
  @media (min-width: 900px) {
    .rows {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
</style>
