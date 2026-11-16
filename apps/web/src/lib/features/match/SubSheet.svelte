<!-- Sub: off from the field, on from the bench, tactical or temporary. No reason is recorded. -->
<script lang="ts">
  import { formatClock } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import Button from '#lib/components/Button.svelte';
  import { memberName } from '#lib/data/selectors';
  import { buzz } from '#lib/haptics';
  import { IconWarn } from '#lib/icons';
  import PlayerPicker from './PlayerPicker.svelte';
  import { isFrontRower } from './lineup';
  import { openTemporarySubs } from './log';
  import type { RecCtx } from './ctx';

  type Props = { open: boolean; at: number; ctx: RecCtx };
  let { open = $bindable(), at, ctx }: Props = $props();

  let off = $state<string | null>(null);
  let on = $state<string | null>(null);
  let type = $state<'tactical' | 'temporary'>('tactical');

  $effect(() => {
    if (open) {
      off = null;
      on = null;
      type = 'tactical';
    }
  });

  const fr = (id: string) => isFrontRower(ctx.snap, ctx.lineup, id);
  const temps = $derived(openTemporarySubs(ctx.state.log, ctx.state.playing));
  const used = $derived(ctx.state.replacementsUsed);
  const limit = $derived(ctx.cfg.replacements);
  const warnings = $derived.by(() => {
    const w: string[] = [];
    if (type === 'tactical' && used >= limit)
      w.push(`Replacement limit reached (${used} of ${limit}). Check with the referee.`);
    if (off && fr(off) && on && !fr(on))
      w.push(
        `${memberName(ctx.snap, off)} is front row. Bring on a front-row replacement or scrums go uncontested.`,
      );
    else if (off && fr(off) && !ctx.state.bench.some(fr))
      w.push('No front-row cover left on the bench.');
    return w;
  });

  async function save() {
    if (!off || !on) return;
    await ctx.session.record({ kind: 'sub', team: 'us', offId: off, onId: on, type }, at);
    buzz(20);
    ctx.announce(
      `${memberName(ctx.snap, on)} on for ${memberName(ctx.snap, off)}${type === 'temporary' ? ', temporary' : ''}`,
    );
    open = false;
  }

  async function reverse(subId: string, back: string) {
    await ctx.session.record({ kind: 'sub_return', subId });
    buzz(20);
    ctx.announce(`${memberName(ctx.snap, back)} back on`);
    open = false;
  }
</script>

<Sheet
  bind:open
  title="Substitution"
  description="At {formatClock(at - ctx.offset)} · {used} of {limit} replacements used"
  size="lg"
>
  <div class="stack">
    {#if temps.length}
      <section class="temps" aria-label="Temporary replacements">
        {#each temps as t (t.id)}
          <div class="row">
            <span class="grow">
              <strong>{memberName(ctx.snap, t.payload.onId)}</strong>
              <small class="muted">on for {memberName(ctx.snap, t.payload.offId)} (temporary)</small
              >
            </span>
            <Button size="sm" onclick={() => reverse(t.id, t.payload.offId)}>
              Bring {memberName(ctx.snap, t.payload.offId).split(' ')[0]} back
            </Button>
          </div>
        {/each}
      </section>
    {/if}
    <Segmented
      label="Type of replacement"
      bind:value={type}
      options={[
        { value: 'tactical', label: 'Tactical' },
        { value: 'temporary', label: 'Temporary' },
      ]}
    />
    <div class="cols">
      <PlayerPicker
        ids={ctx.state.playing}
        shirt={ctx.lineup.shirt}
        snap={ctx.snap}
        label="Off"
        bind:value={off}
        note={(id) => (fr(id) ? 'Front row' : undefined)}
        empty="Nobody on the team sheet yet."
      />
      <PlayerPicker
        ids={ctx.state.bench}
        shirt={ctx.lineup.shirt}
        snap={ctx.snap}
        label="On"
        bind:value={on}
        note={(id) => (fr(id) ? 'Front row' : undefined)}
        empty="Nobody left on the bench."
      />
    </div>
    {#each warnings as w (w)}
      <p class="warn" role="status"><IconWarn />{w}</p>
    {/each}
  </div>
  {#snippet footer()}
    <Button variant="primary" size="lg" block disabled={!off || !on} onclick={save}>
      {off && on
        ? `${memberName(ctx.snap, on).split(' ')[0]} on for ${memberName(ctx.snap, off).split(' ')[0]}`
        : 'Pick who comes off and on'}
    </Button>
  {/snippet}
</Sheet>

<style>
  .cols {
    display: grid;
    gap: var(--s-4);
  }
  @media (min-width: 768px) {
    .cols {
      grid-template-columns: 1fr 1fr;
    }
  }
  .temps {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3);
    border-radius: var(--r-md);
    background: var(--info-soft);
  }
  .temps small {
    display: block;
  }
  .warn {
    display: flex;
    gap: var(--s-2);
    align-items: flex-start;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: var(--t-14);
    font-weight: 600;
  }
  .warn :global(svg) {
    width: 16px;
    height: 16px;
    flex: none;
    margin-top: 3px;
  }
</style>
