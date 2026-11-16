<!-- Scrollable match log, newest first. Each entry can be edited (time / player) or removed. -->
<script lang="ts">
  import { formatClock, type MatchEvent } from '@phaseplay/shared';
  import type { TeamSnapshot } from '#lib/data/types';
  import { IconEdit } from '#lib/icons';
  import { describe } from './lineup';

  type Props = {
    log: MatchEvent[];
    snap: TeamSnapshot | null;
    opponent: string;
    tournament: boolean;
    offset: number;
    onedit?: (e: MatchEvent) => void;
    heading?: string;
  };
  let { log, snap, opponent, tournament, offset, onedit, heading = 'Match log' }: Props = $props();

  const rows = $derived(
    [...log].reverse().map((e) => ({ e, d: describe(e, { snap, opponent, tournament, log }) })),
  );
</script>

<section class="tl" aria-labelledby="tl-h">
  <h2 id="tl-h" class="h">{heading} <span class="subtle tnum">{log.length}</span></h2>
  {#if rows.length}
    <ol class="list">
      {#each rows as { e, d } (e.id)}
        <li class="it {d.tone}">
          <span class="t tnum">{formatClock(e.gameMs - offset)}</span>
          <span class="mk" aria-hidden="true"></span>
          <span class="tx grow">
            <strong>{d.title}</strong>
            {#if d.detail}<small>{d.detail}</small>{/if}
          </span>
          {#if onedit}
            <button
              type="button"
              class="ed"
              aria-label="Edit {d.title} at {formatClock(e.gameMs - offset)}"
              onclick={() => onedit(e)}><IconEdit /></button
            >
          {/if}
        </li>
      {/each}
    </ol>
  {:else}
    <p class="subtle empty">Nothing yet. Every tap lands here with its game time.</p>
  {/if}
</section>

<style>
  .h {
    display: flex;
    align-items: baseline;
    gap: var(--s-2);
    font-size: var(--t-16);
    margin-bottom: var(--s-2);
  }
  .it {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 52px;
    padding: var(--s-1) 0;
    border-bottom: 1px solid var(--border);
  }
  .it:last-child {
    border-bottom: 0;
  }
  .t {
    flex: none;
    width: 52px;
    font-weight: 700;
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .mk {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--border-strong);
  }
  .us .mk {
    background: var(--accent);
  }
  .them .mk {
    background: var(--text-2);
    border-radius: 2px;
  }
  .warn .mk {
    background: #f5c518;
    border-radius: 2px;
    width: 8px;
    height: 11px;
  }
  .danger .mk {
    background: #d92d20;
    border-radius: 2px;
    width: 8px;
    height: 11px;
  }
  .clock .mk {
    background: transparent;
    border: 2px solid var(--text-3);
  }
  .tx {
    display: flex;
    flex-direction: column;
    line-height: 1.25;
  }
  .tx strong {
    font-size: var(--t-14);
  }
  .tx small {
    color: var(--text-2);
    font-size: var(--t-12);
  }
  .ed {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-2);
  }
  .ed:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .ed :global(svg) {
    width: 18px;
    height: 18px;
  }
  .empty {
    padding: var(--s-4) 0;
  }
</style>
