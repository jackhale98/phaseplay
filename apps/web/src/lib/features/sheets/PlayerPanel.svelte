<!--
  Desktop side panel: the squad ranked for the selected slot. Drag a player onto any slot, or click
  to put them in the selected one.
-->
<script lang="ts">
  import type { Member } from '@phaseplay/shared';
  import { positionsFor } from '@phaseplay/shared';
  import Badge from './Badge.svelte';
  import Avatar from '#lib/components/Avatar.svelte';
  import { IconSearch, IconGrip } from '#lib/icons';
  import {
    AVAIL_LABEL,
    AVAIL_TONE,
    fitLabel,
    fitTone,
    rankFor,
    slotLabel,
    type Avail,
    type Draft,
  } from './model';

  type Props = {
    draft: Draft;
    slot: number;
    members: Member[];
    availOf: (id: string) => Avail;
    onadd: (memberId: string) => void;
    ondragstate?: (dragging: boolean) => void;
  };
  let { draft, slot, members, availOf, onadd, ondragstate }: Props = $props();
  let query = $state('');
  const list = $derived(rankFor(draft, slot, members, availOf, query));
  const shorts = (m: Member) =>
    m.positions
      .slice(0, 3)
      .map((n) => positionsFor('15s').find((p) => p.n === n)?.short ?? String(n))
      .join(' · ');
</script>

<aside class="panel card" aria-labelledby="pp-h">
  <div class="head">
    <h2 id="pp-h">Squad</h2>
    <p class="subtle">
      Best for {slot} · {slotLabel(draft.format, slot)}. Drag onto a slot or click to add.
    </p>
    <div class="search">
      <IconSearch />
      <input
        type="search"
        aria-label="Filter squad"
        placeholder="Filter"
        bind:value={query}
        autocomplete="off"
      />
    </div>
  </div>
  <ul class="list rows">
    {#each list as c (c.member.id)}
      <li>
        <button
          type="button"
          class="prow"
          class:on={c.at !== null}
          draggable="true"
          aria-label="{c.member.displayName}: {fitLabel(draft.format, slot, c.fit)}, {AVAIL_LABEL[
            c.avail
          ]}{c.at !== null ? `, on sheet at ${c.at}` : ''}. Add to {slot}"
          onclick={() => onadd(c.member.id)}
          ondragstart={(e) => {
            e.dataTransfer?.setData('text/plain', `member:${c.member.id}`);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
            ondragstate?.(true);
          }}
          ondragend={() => ondragstate?.(false)}
        >
          <span class="grip" aria-hidden="true"><IconGrip /></span>
          <Avatar name={c.member.displayName} jersey={c.member.jersey} size={32} />
          <span class="who" aria-hidden="true">
            <strong class="truncate">{c.member.displayName}</strong>
            <small class="truncate"
              >{c.member.status === 'pending' ? 'Not joined · ' : ''}{shorts(c.member) ||
                'No positions'}{c.at !== null ? ` · at ${c.at}` : ''}</small
            >
          </span>
          <span class="chips" aria-hidden="true">
            <Badge tone={fitTone(c.fit)}>{fitLabel(draft.format, slot, c.fit)}</Badge>
            <Badge tone={AVAIL_TONE[c.avail]}>{AVAIL_LABEL[c.avail]}</Badge>
          </span>
        </button>
      </li>
    {:else}
      <li class="subtle none">No one matches “{query}”</li>
    {/each}
  </ul>
</aside>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 48px);
    overflow: hidden;
  }
  .head {
    padding: var(--s-4) var(--s-4) var(--s-3);
    border-bottom: 1px solid var(--border);
  }
  h2 {
    font-size: var(--t-16);
  }
  .head p {
    margin: 2px 0 var(--s-3);
  }
  .search {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: 0 var(--s-3);
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
  }
  .search:focus-within {
    outline: 3px solid color-mix(in srgb, var(--accent) 70%, var(--text));
    outline-offset: 1px;
  }
  .search :global(svg) {
    width: 16px;
    height: 16px;
    color: var(--text-3);
  }
  .search input {
    flex: 1;
    min-width: 0;
    height: 40px;
    border: 0;
    outline: none;
    background: transparent;
  }
  .rows {
    overflow-y: auto;
    padding: var(--s-2);
  }
  .prow {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    width: 100%;
    min-height: 52px;
    padding: var(--s-1) var(--s-2);
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    text-align: left;
    cursor: grab;
  }
  .prow:hover {
    background: var(--surface-2);
  }
  .prow:active {
    cursor: grabbing;
  }
  .on {
    background: var(--surface-2);
  }
  .on .who strong {
    color: var(--text-2);
  }
  .grip :global(svg) {
    width: 14px;
    height: 14px;
    color: var(--text-3);
  }
  .who {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    line-height: 1.25;
  }
  .who strong {
    font-size: var(--t-14);
    font-weight: 650;
  }
  .who small {
    font-size: var(--t-12);
    color: var(--text-3);
  }
  .chips {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .none {
    padding: var(--s-4);
    text-align: center;
  }
</style>
