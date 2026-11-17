<!--
  Event page: for staff, kit held by people who are out or haven't replied (PLAN.md M9 §Flags);
  for games, the match-day checklist.
-->
<script lang="ts">
  import { isGame, type InventoryItem, type TeamEvent } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { handoffFor, kitAtRisk, memberName, rsvpOf } from '#lib/data/selectors';
  import { IconWarn } from '#lib/icons';
  import GiveSheet from './GiveSheet.svelte';
  import MatchDayKit from './MatchDayKit.svelte';
  import { itemLabel } from './meta';

  let { event }: { event: TeamEvent } = $props();

  const s = $derived(app.snap);
  const staff = $derived(app.can('availability.view'));
  const risks = $derived(
    staff
      ? kitAtRisk(s)
          .filter((r) => r.eventId === event.id)
          .map((r) => ({ ...r, item: s?.rows.items?.[r.itemId] }))
          .filter((r): r is typeof r & { item: InventoryItem } => !!r.item)
      : [],
  );
  const going = $derived(
    Object.values(s?.rows.members ?? {})
      .filter((m) => rsvpOf(s, event.id, m.id)?.status === 'yes')
      .map((m) => m.id),
  );

  let open = $state(false);
  let giving = $state<InventoryItem | undefined>();
  function ask(item: InventoryItem) {
    giving = item;
    open = true;
  }
</script>

{#if risks.length}
  <section class="card flag" aria-labelledby="kit-flag-h">
    <h2 id="kit-flag-h" class="h"><IconWarn />Kit at risk</h2>
    <ul class="list">
      {#each risks as r (r.itemId)}
        {@const waiting = handoffFor(s, r.itemId)}
        <li>
          <span class="grow">
            <a href="/kit/{r.item.id}">{itemLabel(r.item)}</a>
            <small
              >{memberName(s, r.holderMemberId)}
              {r.reply === 'no' ? "isn't going" : "hasn't replied"}{waiting
                ? ` · offered to ${memberName(s, waiting.toMemberId)}`
                : ''}</small
            >
          </span>
          {#if app.can('inventory.manage') && !waiting}
            <button type="button" onclick={() => ask(r.item)}>Ask someone</button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
  <GiveSheet bind:open item={giving} mode="handover" suggest={going} />
{/if}

{#if isGame(event.type)}<MatchDayKit eventId={event.id} />{/if}

<style>
  .flag {
    padding: var(--s-4) var(--s-5);
    border-color: color-mix(in srgb, var(--warn) 40%, var(--border));
  }
  .h {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-16);
    color: var(--warn);
    margin-bottom: var(--s-2);
  }
  .h :global(svg) {
    width: 18px;
    height: 18px;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 52px;
    padding: var(--s-1) 0;
    border-bottom: 1px solid var(--border);
  }
  li:last-child {
    border-bottom: 0;
  }
  a {
    font-weight: 650;
    color: var(--text);
  }
  small {
    display: block;
    color: var(--text-2);
    font-size: var(--t-14);
  }
  button {
    min-height: 44px;
    padding: 0 var(--s-4);
    border-radius: var(--r-full);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-weight: 650;
    flex: none;
  }
</style>
