<!-- Starters in formation on a grass pitch, the bench underneath. Shared by builder and viewer. -->
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { RULES, sheetSlots } from '@phaseplay/shared';
  import SlotToken from './SlotToken.svelte';
  import { PITCH_ROWS, type Draft } from './model';

  type Props = {
    draft: Draft;
    nameOf: (id: string) => string;
    flags?: Map<number, string>;
    meId?: string | null;
    editable?: boolean;
    over?: number | null;
    slotProps?: (n: number) => HTMLButtonAttributes;
  };
  let {
    draft,
    nameOf,
    flags = new Map(),
    meId = null,
    editable = false,
    over = null,
    slotProps = () => ({}),
  }: Props = $props();

  const rows = $derived(PITCH_ROWS[draft.format]);
  const bench = $derived(
    sheetSlots(draft.format, draft.replacements).filter((n) => n > RULES[draft.format].starters),
  );
  const startersLabel = $derived(draft.format === '15s' ? 'Starting XV' : 'Starting VII');
</script>

{#snippet token(n: number, variant: 'pitch' | 'row')}
  {@const id = draft.slots[String(n)] ?? null}
  <SlotToken
    format={draft.format}
    {n}
    {variant}
    name={id ? nameOf(id) : null}
    captain={!!id && draft.captainId === id}
    vice={!!id && draft.viceId === id}
    flag={flags.get(n)}
    me={!!id && id === meId}
    over={over === n}
    {editable}
    attrs={editable ? slotProps(n) : {}}
  />
{/snippet}

<section class="pitch" aria-label={startersLabel}>
  <div class="lines" aria-hidden="true">
    <span class="l l1"></span><span class="l l2"></span><span class="l l3"></span>
  </div>
  {#each rows as r, i (i)}
    <ul class="prow" class:wide={r.length >= 4}>
      {#each r as n (n)}<li>{@render token(n, 'pitch')}</li>{/each}
    </ul>
  {/each}
</section>

{#if bench.length}
  <section class="bench" aria-label="Replacements">
    <h2 class="bh">Replacements <span class="subtle">{bench.length}</span></h2>
    <ul class="blist">
      {#each bench as n (n)}<li>{@render token(n, 'row')}</li>{/each}
    </ul>
  </section>
{/if}

<style>
  .pitch {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: var(--s-3);
    padding: var(--s-5) var(--s-2) var(--s-6);
    border-radius: var(--r-lg);
    overflow: hidden;
    background: repeating-linear-gradient(180deg, #2b7446 0 56px, #276b40 56px 112px), #2b7446;
    box-shadow:
      inset 0 0 0 2px rgb(255 255 255 / 0.12),
      var(--e-2);
    isolation: isolate;
  }
  .lines {
    position: absolute;
    inset: 10px;
    border: 2px solid rgb(255 255 255 / 0.35);
    border-radius: 8px;
    pointer-events: none;
    z-index: -1;
  }
  .l {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 2px solid rgb(255 255 255 / 0.3);
  }
  .l1 {
    top: 14%;
    border-top-style: dashed;
  }
  .l2 {
    top: 50%;
  }
  .l3 {
    top: 86%;
    border-top-style: dashed;
  }
  .prow {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    justify-content: center;
    gap: var(--s-2);
  }
  .prow li {
    flex: 0 1 96px;
    display: flex;
    justify-content: center;
    min-width: 0;
  }
  .prow.wide {
    justify-content: space-between;
  }
  .bench {
    margin-top: var(--s-5);
  }
  .bh {
    display: flex;
    gap: var(--s-2);
    align-items: baseline;
    margin-bottom: var(--s-3);
    font-size: var(--t-16);
  }
  .blist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
    gap: var(--s-2);
  }
  @media (min-width: 768px) {
    .pitch {
      gap: var(--s-5);
      padding: var(--s-8) var(--s-6);
      background: repeating-linear-gradient(180deg, #2b7446 0 72px, #276b40 72px 144px), #2b7446;
    }
    .prow li {
      flex-basis: 128px;
    }
    .prow.wide {
      justify-content: space-around;
    }
  }
</style>
