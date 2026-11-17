<!-- 7s tournament day: each game's score and every player's minutes across the day (see day.ts). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { formatClock } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { memberName } from '#lib/data/selectors';
  import { day as fmtDay } from '#lib/format';
  import Button from '#lib/components/Button.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import { IconBack, IconMatch, IconPlay, IconChevronRight } from '#lib/icons';
  import { MatchView } from './view.svelte';
  import { dayMinutes, gameOffsetMs, MAX_GAMES } from './day';
  import MatchDayKit from '#lib/features/kit/MatchDayKit.svelte';

  let { eventId }: { eventId: string } = $props();
  // svelte-ignore state_referenced_locally
  const v = new MatchView(eventId);
  onMount(() => v.mount());

  const event = $derived(v.event);
  const staff = $derived(app.can('match.record'));
  const started = $derived(v.day.filter((g) => g.state.clock.period > 0));
  const mins = $derived(dayMinutes(started));
  const rows = $derived(
    [...new Set([...(v.lineup?.starters ?? []), ...(v.lineup?.bench ?? []), ...mins.keys()])]
      .map((id) => ({
        id,
        shirt: v.lineup?.shirt.get(id),
        m: mins.get(id) ?? { perGame: started.map(() => 0), total: 0 },
      }))
      .sort((a, b) => b.m.total - a.m.total || (a.shirt ?? 99) - (b.shirt ?? 99)),
  );
  const fmtMin = (ms: number) => `${Math.round(ms / 60e3)}'`;
  const result = (us: number, them: number) => (us > them ? 'Won' : us < them ? 'Lost' : 'Drew');
</script>

<svelte:head><title>Tournament day · {event?.title ?? 'Phaseplay'}</title></svelte:head>

<div class="page">
  {#if !v.snap}
    <div aria-busy="true"></div>
  {:else if !event || event.type !== 'tournament'}
    <EmptyState
      title="Not a tournament"
      body="The day view is for tournament events with several games."
    >
      {#snippet icon()}<IconMatch />{/snippet}
      {#snippet action()}<Button href="/schedule" variant="primary">Back to the schedule</Button
        >{/snippet}
    </EmptyState>
  {:else}
    <header class="head">
      <a class="back" href="/events/{event.id}" aria-label="Back to the event"><IconBack /></a>
      <div class="grow">
        <p class="eyebrow">
          {fmtDay(event.startsAt, v.snap.team.timezone)} · {event.locationName ?? '7s'}
        </p>
        <h1>{event.title}</h1>
      </div>
      {#if staff}
        <Button href="/events/{event.id}/match" variant="primary" size="sm"
          >{#snippet icon()}<IconPlay />{/snippet}Match mode</Button
        >
      {/if}
    </header>

    <div class="kit"><MatchDayKit eventId={event.id} /></div>

    <h2 class="section-title">Games</h2>
    {#if started.length}
      <ol class="list games">
        {#each started as g (g.game)}
          {@const st = g.state}
          {@const live = st.clock.inPeriod}
          <li>
            <a class="card game" href="/events/{event.id}/match/summary">
              <span class="gn">Game {g.game}</span>
              <span class="grow sc tnum"
                >{v.us} <strong>{st.score.us}</strong> – <strong>{st.score.them}</strong>
                {v.opponent}</span
              >
              <span
                class="res"
                class:won={st.score.us > st.score.them}
                class:lost={st.score.us < st.score.them}
              >
                {live
                  ? `Live ${formatClock(st.clock.gameMs - gameOffsetMs(g.game, v.cfg.halfMs))}`
                  : result(st.score.us, st.score.them)}
              </span>
              <IconChevronRight />
            </a>
          </li>
        {/each}
      </ol>
      {#if started.length < MAX_GAMES}
        <p class="subtle note">
          Record the next game from match mode: after full time, tap “Kick off game {started.length +
            1}”. Each tournament event holds up to {MAX_GAMES} games.
        </p>
      {/if}
    {:else}
      <EmptyState
        title="No games yet"
        body="Kick off in match mode and each game shows up here with everyone's minutes."
      >
        {#snippet icon()}<IconMatch />{/snippet}
      </EmptyState>
    {/if}

    {#if started.length && rows.length}
      <h2 class="section-title">Minutes across the day</h2>
      <div class="card tw">
        <table>
          <caption class="sr-only">Minutes played per game and in total</caption>
          <thead>
            <tr>
              <th scope="col">Player</th>
              {#each started as g (g.game)}<th scope="col" class="num">G{g.game}</th>{/each}
              <th scope="col" class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as r (r.id)}
              <tr>
                <th scope="row"
                  ><span class="no tnum">{r.shirt ?? ''}</span>{memberName(v.snap, r.id)}</th
                >
                {#each started as g, i (g.game)}<td class="num tnum"
                    >{fmtMin(r.m.perGame[i] ?? 0)}</td
                  >{/each}
                <td class="num tnum total">{fmtMin(r.m.total)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .kit:empty {
    display: none;
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin-bottom: var(--s-2);
    flex-wrap: wrap;
  }
  .back {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--text);
  }
  .back:hover {
    background: var(--surface-3);
  }
  .back :global(svg) {
    width: 20px;
    height: 20px;
  }
  .games {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .game {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 60px;
    padding: var(--s-3) var(--s-4);
    color: var(--text);
    text-decoration: none;
  }
  .game :global(svg) {
    width: 18px;
    height: 18px;
    color: var(--text-3);
  }
  .gn {
    font-weight: 750;
    color: var(--text-2);
    min-width: 64px;
  }
  .sc strong {
    font-size: var(--t-20);
  }
  .res {
    padding: 2px var(--s-3);
    border-radius: var(--r-full);
    background: var(--surface-3);
    font-weight: 700;
    font-size: var(--t-14);
  }
  .res.won {
    background: var(--ok-soft);
    color: color-mix(in srgb, var(--ok) 72%, var(--text));
  }
  .res.lost {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .note {
    margin-top: var(--s-3);
  }
  .tw {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--t-14);
  }
  th,
  td {
    padding: var(--s-2) var(--s-4);
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }
  tbody tr:last-child th,
  tbody tr:last-child td {
    border-bottom: 0;
  }
  thead th {
    font-size: var(--t-12);
    color: var(--text-3);
  }
  tbody th {
    font-weight: 600;
  }
  .num {
    text-align: right;
  }
  .total {
    font-weight: 800;
  }
  .no {
    display: inline-block;
    width: 24px;
    color: var(--text-3);
    font-weight: 700;
  }
</style>
