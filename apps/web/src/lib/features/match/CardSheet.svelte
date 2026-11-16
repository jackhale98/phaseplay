<!-- Card: pick the team (and our player), then Yellow or Red records it. -->
<script lang="ts">
  import { formatClock } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import { memberName } from '#lib/data/selectors';
  import { buzz } from '#lib/haptics';
  import PlayerPicker from './PlayerPicker.svelte';
  import type { RecCtx } from './ctx';

  type Props = { open: boolean; at: number; ctx: RecCtx };
  let { open = $bindable(), at, ctx }: Props = $props();

  let team = $state<'us' | 'them'>('them');
  let player = $state<string | null>(null);

  $effect(() => {
    if (open) {
      team = 'them';
      player = null;
    }
  });

  const sinBin = $derived(Math.round(ctx.cfg.sinBinMs / 60e3));
  const redNote = $derived(
    ctx.cfg.redCardMode === 'replace_after_20'
      ? 'Red: replaced after 20 minutes'
      : 'Red: off for the rest of the match',
  );

  async function card(colour: 'yellow' | 'red') {
    await ctx.session.record(
      {
        kind: 'card',
        team,
        colour,
        playerId: team === 'us' ? player : null,
        ...(colour === 'red' ? { mode: ctx.cfg.redCardMode } : {}),
      },
      at,
    );
    buzz([20, 40, 20]);
    const who = team === 'us' && player ? ` for ${memberName(ctx.snap, player)}` : '';
    ctx.announce(
      `${colour === 'yellow' ? 'Yellow' : 'Red'} card${who}${team === 'them' ? `, ${ctx.opponent}` : ''}. ${colour === 'yellow' ? `${sinBin} minute sin bin started` : ''}`,
    );
    open = false;
  }
</script>

<Sheet
  bind:open
  title="Card"
  description="At {formatClock(at - ctx.offset)} · sin bin {sinBin} min on the game clock"
  size="md"
>
  <div class="stack">
    <Segmented
      label="Which team"
      bind:value={team}
      options={[
        { value: 'them', label: ctx.opponent },
        { value: 'us', label: ctx.us },
      ]}
    />
    {#if team === 'us'}
      <PlayerPicker
        ids={ctx.state.playing}
        shirt={ctx.lineup.shirt}
        snap={ctx.snap}
        label="Who"
        bind:value={player}
        empty="No team sheet, so the player won't be named."
      />
    {/if}
    <div class="cards">
      <button type="button" class="cb yellow" onclick={() => card('yellow')}>
        <span class="swatch" aria-hidden="true"></span>Yellow card
      </button>
      <button type="button" class="cb red" onclick={() => card('red')}>
        <span class="swatch" aria-hidden="true"></span>Red card
      </button>
    </div>
    <p class="subtle">{redNote}. Change it in the event's match settings.</p>
  </div>
</Sheet>

<style>
  .cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
  }
  .cb {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 72px;
    padding: 0 var(--s-4);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    font-weight: 750;
    font-size: var(--t-16);
  }
  .cb:hover {
    background: var(--surface-2);
  }
  .swatch {
    width: 22px;
    height: 30px;
    border-radius: 3px;
    box-shadow: var(--e-1);
    transform: rotate(-8deg);
  }
  .yellow .swatch {
    background: #f5c518;
  }
  .red .swatch {
    background: #d92d20;
  }
</style>
