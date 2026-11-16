<!-- Penalty: for/against is the only required tap; offence, player, zone and outcome are optional. -->
<script lang="ts">
  import {
    formatClock,
    OFFENCE_LABELS,
    OUTCOME_LABELS,
    PENALTY_OFFENCES,
    PENALTY_OUTCOMES,
  } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import Button from '#lib/components/Button.svelte';
  import Chip from '#lib/components/Chip.svelte';
  import { buzz } from '#lib/haptics';
  import PlayerPicker from './PlayerPicker.svelte';
  import MiniPitch from './MiniPitch.svelte';
  import { zoneName, type Zone } from './zones';
  import type { RecCtx } from './ctx';

  type Offence = (typeof PENALTY_OFFENCES)[number];
  type Outcome = (typeof PENALTY_OUTCOMES)[number];
  type Props = { open: boolean; at: number; ctx: RecCtx };
  let { open = $bindable(), at, ctx }: Props = $props();

  let side = $state<'for' | 'against'>('against');
  let offence = $state<Offence | null>(null);
  let outcome = $state<Outcome | null>(null);
  let player = $state<string | null>(null);
  let zone = $state<Zone | null>(null);
  let more = $state(false);

  $effect(() => {
    if (open) {
      side = 'against';
      offence = null;
      outcome = null;
      player = null;
      zone = null;
      more = false;
    }
  });

  const period = $derived(Math.max(1, ctx.state.clock.period));
  const half = $derived(ctx.state.penalties.byPeriod[period] ?? { for: 0, against: 0 });

  async function save() {
    await ctx.session.record(
      { kind: 'penalty', side, offence, playerId: player, zone, outcome },
      at,
    );
    buzz();
    ctx.announce(
      `Penalty ${side === 'for' ? 'to us' : `to ${ctx.opponent}`}${offence ? `, ${OFFENCE_LABELS[offence]}` : ''} at ${formatClock(at - ctx.offset)}`,
    );
    open = false;
  }
</script>

<Sheet
  bind:open
  title="Penalty"
  description="At {formatClock(at - ctx.offset)} · this half {half.for} for, {half.against} against"
  size="lg"
>
  <div class="stack">
    <Segmented
      label="Penalty to"
      bind:value={side}
      options={[
        { value: 'against', label: `To ${ctx.opponent}` },
        { value: 'for', label: `To ${ctx.us}` },
      ]}
    />
    <fieldset>
      <legend>Offence</legend>
      <div class="chips">
        {#each PENALTY_OFFENCES as o (o)}
          <Chip selected={offence === o} onclick={() => (offence = offence === o ? null : o)}
            >{OFFENCE_LABELS[o]}</Chip
          >
        {/each}
      </div>
    </fieldset>
    <fieldset>
      <legend>Outcome</legend>
      <div class="chips">
        {#each PENALTY_OUTCOMES as o (o)}
          <Chip selected={outcome === o} onclick={() => (outcome = outcome === o ? null : o)}
            >{OUTCOME_LABELS[o]}</Chip
          >
        {/each}
      </div>
    </fieldset>
    <fieldset>
      <legend>Where on the pitch <span class="subtle">· {zoneName(zone)}</span></legend>
      <MiniPitch mode="pick" bind:value={zone} label="Pitch zone" />
    </fieldset>
    {#if more}
      <PlayerPicker
        ids={ctx.state.playing}
        shirt={ctx.lineup.shirt}
        snap={ctx.snap}
        label={side === 'against' ? 'Who gave it away' : 'Who won it'}
        bind:value={player}
      />
    {:else}
      <Button variant="ghost" size="sm" onclick={() => (more = true)}>Add the player</Button>
    {/if}
  </div>
  {#snippet footer()}
    <Button variant="primary" size="lg" block onclick={save}>Save penalty</Button>
  {/snippet}
</Sheet>

<style>
  fieldset {
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
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
</style>
