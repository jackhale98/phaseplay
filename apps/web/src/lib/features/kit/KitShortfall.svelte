<!--
  Practice plan: the plan's equipment against kit that will be there (in the store, or with
  someone who replied yes), e.g. "Shields: need 6, 4 coming" (PLAN.md M9 §Flags).
-->
<script lang="ts">
  import {
    EQUIPMENT_KIT_KIND,
    ITEM_KIND_LABELS,
    kitShortfalls,
    type ItemKind,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { kitItems } from '#lib/data/selectors';
  import { IconWarn } from '#lib/icons';

  let {
    equipment,
    eventId,
  }: { equipment: { key: string; count: number }[]; eventId: string | null } = $props();

  const s = $derived(app.snap);
  const items = $derived(kitItems(s));
  const short = $derived.by(() => {
    // Only for staff, who see replies, and only once the club logs its kit.
    if (!app.can('availability.view') || !items.length || !s) return [];
    const needs: Partial<Record<ItemKind, number>> = {};
    for (const e of equipment) {
      const k = EQUIPMENT_KIT_KIND[e.key];
      if (k) needs[k] = (needs[k] ?? 0) + e.count;
    }
    return kitShortfalls(needs, items, eventId, Object.values(s.rows.rsvps));
  });
</script>

{#if short.length}
  <div class="short" role="status" aria-label="Kit shortfalls">
    <IconWarn />
    <ul class="list">
      {#each short as x (x.kind)}
        <li>
          <strong>{ITEM_KIND_LABELS[x.kind]}:</strong> need {x.need}, {x.coming}
          {eventId ? 'coming' : 'in the store'}
        </li>
      {/each}
    </ul>
    <a href="/kit">See the kit</a>
  </div>
{/if}

<style>
  .short {
    display: flex;
    gap: var(--s-2);
    align-items: flex-start;
    margin-top: var(--s-3);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: var(--t-14);
  }
  .short :global(svg) {
    width: 16px;
    height: 16px;
    flex: none;
    margin-top: 2px;
  }
  ul {
    flex: 1;
  }
  a {
    color: inherit;
    font-weight: 650;
    min-height: 24px;
  }
</style>
