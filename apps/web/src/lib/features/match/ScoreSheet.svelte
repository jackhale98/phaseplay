<!-- Score: team, then type, then (for us) the scorer. A try rolls straight on to the conversion. -->
<script lang="ts">
  import { formatClock, pointsFor, SCORE_LABELS, type ScoreType } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import Button from '#lib/components/Button.svelte';
  import { memberName } from '#lib/data/selectors';
  import { buzz } from '#lib/haptics';
  import PlayerPicker from './PlayerPicker.svelte';
  import type { RecCtx } from './ctx';

  type Props = { open: boolean; at: number; ctx: RecCtx };
  let { open = $bindable(), at, ctx }: Props = $props();

  const TYPES: ScoreType[] = [
    'try',
    'conversion',
    'conversion_miss',
    'penalty_goal',
    'penalty_goal_miss',
    'drop_goal',
    'penalty_try',
  ];
  const KICKS: ScoreType[] = [
    'conversion',
    'conversion_miss',
    'penalty_goal',
    'penalty_goal_miss',
    'drop_goal',
  ];

  let team = $state<'us' | 'them'>('us');
  let step = $state<'type' | 'player' | 'conversion'>('type');
  let type = $state<ScoreType>('try');
  let player = $state<string | null>(null);
  let when = $state(0);
  let lastKicker = $state<string | null>(null);

  $effect(() => {
    if (open) {
      team = 'us';
      step = 'type';
      player = null;
      when = at;
    }
  });

  const lastScore = $derived(
    [...ctx.state.log]
      .reverse()
      .find(
        (e) =>
          e.payload.kind === 'score' &&
          e.payload.team === 'us' &&
          KICKS.includes(e.payload.type) &&
          e.payload.playerId,
      ),
  );
  const kicker = $derived(
    lastKicker ??
      (lastScore?.payload.kind === 'score' ? (lastScore.payload.playerId ?? null) : null),
  );
  const title = $derived(
    step === 'conversion'
      ? 'Conversion?'
      : step === 'player'
        ? `${SCORE_LABELS[type]}: who?`
        : 'Score',
  );

  function choose(t: ScoreType) {
    type = t;
    if (team === 'them' || t === 'penalty_try') return void save(null);
    player = KICKS.includes(t) ? kicker : null;
    step = 'player';
  }

  async function save(pid: string | null) {
    await ctx.session.record({ kind: 'score', team, type, playerId: pid }, when);
    buzz();
    if (KICKS.includes(type) && team === 'us' && pid) lastKicker = pid;
    const who = pid ? `, ${memberName(ctx.snap, pid)}` : '';
    ctx.announce(
      `${team === 'us' ? ctx.us : ctx.opponent} ${SCORE_LABELS[type].toLowerCase()}${who} at ${formatClock(when - ctx.offset)}`,
    );
    if (type === 'try') {
      step = 'conversion';
      player = team === 'us' ? kicker : null;
      return;
    }
    open = false;
  }

  async function conversion(made: boolean | null) {
    if (made === null) return void (open = false);
    type = made ? 'conversion' : 'conversion_miss';
    when = ctx.session.gameNow();
    await save(team === 'us' ? player : null);
  }
</script>

<Sheet
  bind:open
  {title}
  description="{step === 'conversion' ? 'After the try' : 'At'} {formatClock(when - ctx.offset)}"
  size="md"
>
  {#if step === 'type'}
    <div class="stack">
      <Segmented
        label="Which team scored"
        bind:value={team}
        options={[
          { value: 'us', label: ctx.us },
          { value: 'them', label: ctx.opponent },
        ]}
      />
      <div class="types">
        {#each TYPES as t (t)}
          {@const pts = pointsFor(t, ctx.cfg.points)}
          <button
            type="button"
            class="tb"
            class:miss={!pts}
            class:big={t === 'try'}
            onclick={() => choose(t)}
          >
            <span>{SCORE_LABELS[t]}</span>
            <small class="tnum">{pts ? `+${pts}` : 'no points'}</small>
          </button>
        {/each}
      </div>
    </div>
  {:else if step === 'player'}
    <div class="stack">
      <PlayerPicker
        ids={ctx.state.playing}
        shirt={ctx.lineup.shirt}
        snap={ctx.snap}
        label={KICKS.includes(type) ? 'Kicker' : 'Scorer'}
        bind:value={player}
        empty="No team sheet, so you can save without a name."
      />
    </div>
  {:else}
    <div class="stack">
      {#if team === 'us'}
        <PlayerPicker
          ids={ctx.state.playing}
          shirt={ctx.lineup.shirt}
          snap={ctx.snap}
          label="Kicker"
          bind:value={player}
          empty="No team sheet, so the kicker won't be named."
        />
      {/if}
      <div class="conv">
        <button type="button" class="tb big" onclick={() => conversion(true)}>
          <span>Made</span><small class="tnum">+{ctx.cfg.points.conversion}</small>
        </button>
        <button type="button" class="tb miss" onclick={() => conversion(false)}>
          <span>Missed</span><small>no points</small>
        </button>
      </div>
    </div>
  {/if}
  {#snippet footer()}
    {#if step === 'player'}
      <Button variant="ghost" onclick={() => (step = 'type')}>Back</Button>
      <Button variant="primary" onclick={() => save(player)}>
        {player ? `Save ${SCORE_LABELS[type].toLowerCase()}` : 'Save without a name'}
      </Button>
    {:else if step === 'conversion'}
      <Button variant="ghost" onclick={() => conversion(null)}>Not yet</Button>
    {/if}
  {/snippet}
</Sheet>

<style>
  .types {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
  }
  .conv {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
  }
  .tb {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 2px;
    min-height: 64px;
    padding: var(--s-2) var(--s-4);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface-2);
    font-weight: 700;
    text-align: left;
  }
  .tb:hover {
    background: var(--surface-3);
  }
  .tb.big {
    grid-column: 1 / -1;
    min-height: 72px;
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
    font-size: var(--t-20);
  }
  .conv .tb.big {
    grid-column: auto;
  }
  .tb.big small {
    color: inherit;
  }
  .tb.miss {
    background: var(--surface);
  }
  small {
    font-size: var(--t-12);
    font-weight: 650;
    color: var(--text-3);
  }
</style>
