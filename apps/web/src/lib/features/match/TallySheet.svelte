<!-- Set piece and other tallies: every tap counts straight away and the sheet stays open. -->
<script lang="ts">
  import type { TallyKind } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Button from '#lib/components/Button.svelte';
  import { buzz } from '#lib/haptics';
  import PlayerPicker from './PlayerPicker.svelte';
  import { TALLY_LABELS } from './lineup';
  import type { RecCtx } from './ctx';

  type Props = { open: boolean; ctx: RecCtx };
  let { open = $bindable(), ctx }: Props = $props();

  const PAIRS: {
    name: string;
    won: TallyKind;
    lost: TallyKind;
    wonLabel: string;
    lostLabel: string;
  }[] = [
    {
      name: 'Lineouts',
      won: 'lineout_won',
      lost: 'lineout_lost',
      wonLabel: 'Won',
      lostLabel: 'Lost',
    },
    { name: 'Scrums', won: 'scrum_won', lost: 'scrum_lost', wonLabel: 'Won', lostLabel: 'Lost' },
    {
      name: 'Turnovers',
      won: 'turnover_won',
      lost: 'turnover_lost',
      wonLabel: 'Won',
      lostLabel: 'Conceded',
    },
    {
      name: 'Restarts',
      won: 'restart_won',
      lost: 'restart_lost',
      wonLabel: 'Won',
      lostLabel: 'Lost',
    },
    {
      name: 'Tackles',
      won: 'tackle',
      lost: 'missed_tackle',
      wonLabel: 'Made',
      lostLabel: 'Missed',
    },
  ];

  let byPlayer = $state(false);
  let tackler = $state<string | null>(null);
  const count = (k: TallyKind) => ctx.state.tallies[k] ?? 0;

  async function add(k: TallyKind) {
    const pid = (k === 'tackle' || k === 'missed_tackle') && byPlayer ? tackler : null;
    await ctx.session.record({ kind: 'tally', tally: k, playerId: pid });
    buzz(8);
    ctx.announce(`${TALLY_LABELS[k]}, ${count(k)} so far`);
  }
</script>

<Sheet bind:open title="Tallies" description="Each tap counts. Close when you're done." size="lg">
  <div class="stack">
    <ul class="list pairs">
      {#each PAIRS as p (p.name)}
        <li>
          <span class="nm">{p.name}</span>
          <button
            type="button"
            class="tb won"
            onclick={() => add(p.won)}
            aria-label="{TALLY_LABELS[p.won]}, {count(p.won)} so far"
          >
            <span>{p.wonLabel}</span><strong class="tnum">{count(p.won)}</strong>
          </button>
          <button
            type="button"
            class="tb lost"
            onclick={() => add(p.lost)}
            aria-label="{TALLY_LABELS[p.lost]}, {count(p.lost)} so far"
          >
            <span>{p.lostLabel}</span><strong class="tnum">{count(p.lost)}</strong>
          </button>
        </li>
      {/each}
    </ul>
    {#if byPlayer}
      <PlayerPicker
        ids={ctx.state.playing}
        shirt={ctx.lineup.shirt}
        snap={ctx.snap}
        label="Tackles go to"
        bind:value={tackler}
      />
    {:else}
      <Button variant="ghost" size="sm" onclick={() => (byPlayer = true)}
        >Count tackles per player</Button
      >
    {/if}
  </div>
</Sheet>

<style>
  .pairs {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .pairs li {
    display: grid;
    grid-template-columns: minmax(80px, 1fr) minmax(0, 1.2fr) minmax(0, 1.2fr);
    gap: var(--s-2);
    align-items: center;
  }
  .nm {
    font-weight: 700;
  }
  .tb {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    min-height: 56px;
    padding: 0 var(--s-4);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface-2);
    font-weight: 650;
  }
  .tb strong {
    font-size: var(--t-20);
  }
  .won {
    background: var(--ok-soft);
    border-color: transparent;
  }
  .lost {
    background: var(--danger-soft);
    border-color: transparent;
  }
  .tb:active {
    transform: scale(0.98);
  }
</style>
