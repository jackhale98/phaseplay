<!--
  Kit on Home: handovers waiting for my answer, and a nudge when I hold kit for a session I'm not
  going to (PLAN.md M9 §Flags: "You're not going on Tuesday: hand the tackle shields to someone?").
-->
<script lang="ts">
  import IconPackage from '@lucide/svelte/icons/package';
  import { app } from '#lib/data/app.svelte';
  import { handoffFor, kitAtRisk, memberName, rsvpOf } from '#lib/data/selectors';
  import { relDay } from '#lib/format';
  import HandoffBanner from './HandoffBanner.svelte';
  import GiveSheet from './GiveSheet.svelte';
  import { itemPhrase } from './meta';
  import type { InventoryItem, TeamEvent } from '@phaseplay/shared';

  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  /** My at-risk kit, each item once (its soonest event). */
  const nudges = $derived.by(() => {
    const seen: Record<string, true> = {};
    const out: { item: InventoryItem; event: TeamEvent; reply: 'no' | null }[] = [];
    for (const r of kitAtRisk(s)) {
      if (r.holderMemberId !== s?.me.id || seen[r.itemId]) continue;
      const item = s.rows.items?.[r.itemId];
      const event = s.rows.events[r.eventId];
      if (!item || !event) continue;
      seen[r.itemId] = true;
      out.push({ item, event, reply: r.reply });
    }
    return out;
  });

  let open = $state(false);
  let giving = $state<InventoryItem | undefined>();
  let suggest = $state<string[]>([]);
  function handOver(item: InventoryItem, event: TeamEvent) {
    giving = item;
    suggest = Object.values(s?.rows.members ?? {})
      .filter((m) => rsvpOf(s, event.id, m.id)?.status === 'yes')
      .map((m) => m.id);
    open = true;
  }
  const when = (e: TeamEvent) => {
    const d = relDay(e.startsAt, tz);
    return d === 'Today' || d === 'Tomorrow' ? d.toLowerCase() : `on ${d}`;
  };
</script>

<HandoffBanner />

{#each nudges as n (n.item.id)}
  {@const waiting = handoffFor(s, n.item.id)}
  <aside class="nudge card" aria-label="Kit you have">
    <span class="ic"><IconPackage /></span>
    <p class="grow">
      <strong
        >{n.reply === 'no'
          ? `You're not going ${when(n.event)}: hand the ${itemPhrase(n.item)} to someone?`
          : `Not replied for ${n.event.title} ${when(n.event)} yet. You have the ${itemPhrase(n.item)}.`}</strong
      >
      {#if waiting}<span class="muted"
          >Waiting for {memberName(s, waiting.toMemberId)} to accept.</span
        >{/if}
    </p>
    {#if !waiting}
      <button type="button" class="go" onclick={() => handOver(n.item, n.event)}>Hand over</button>
    {/if}
  </aside>
{/each}

<GiveSheet bind:open item={giving} mode="handover" {suggest} />

<style>
  .nudge {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    margin-bottom: var(--s-4);
    background: color-mix(in srgb, var(--warn) 8%, var(--surface));
  }
  .ic {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--r-md);
    background: var(--warn-soft);
    color: var(--warn);
    flex: none;
  }
  .ic :global(svg) {
    width: 20px;
    height: 20px;
  }
  p {
    margin: 0;
    min-width: 12rem;
  }
  p .muted {
    display: block;
    font-size: var(--t-14);
  }
  .go {
    min-height: 44px;
    padding: 0 var(--s-4);
    border-radius: var(--r-full);
    font-weight: 650;
    border: 0;
    background: var(--accent);
    color: var(--on-accent);
  }
</style>
