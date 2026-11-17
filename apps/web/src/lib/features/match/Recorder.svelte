<!--
  Sideline match mode (PLAN.md M6, docs/design.md §Key screens 12). One-handed, full screen.
  Every derived number comes from reduceMatch over the log at `session.now`, which is re-read from
  Date.now() every 250 ms (never accumulated), so it survives screen lock and reloads.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    formatClock,
    isGame,
    matchConfig,
    reduceMatch,
    STOPPAGE_LABELS,
    type MatchEvent,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { memberName } from '#lib/data/selectors';
  import { buzz } from '#lib/haptics';
  import { toasts } from '#lib/stores/toast.svelte';
  import Button from '#lib/components/Button.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import {
    IconBack,
    IconGoal,
    IconFlag,
    IconPause,
    IconPlay,
    IconUndo,
    IconSettings,
    IconOffline,
    IconWarn,
    IconMatch,
    IconChevronRight,
  } from '#lib/icons';
  import IconCard from '@lucide/svelte/icons/rectangle-vertical';
  import IconSub from '@lucide/svelte/icons/arrow-left-right';
  import IconTally from '@lucide/svelte/icons/tally-5';
  import IconWhistle from '@lucide/svelte/icons/whistle';
  import IconChart from '@lucide/svelte/icons/chart-line';
  import { MatchSession } from './session.svelte';
  import { configFor, describe, lineupFor, periodLabel } from './lineup';
  import { lastUndoable } from './log';
  import { gameOffsetMs, MAX_GAMES, reduceDay } from './day';
  import { keepAwake } from './wake-lock';
  import type { RecCtx } from './ctx';
  import ScoreSheet from './ScoreSheet.svelte';
  import PenaltySheet from './PenaltySheet.svelte';
  import CardSheet from './CardSheet.svelte';
  import SubSheet from './SubSheet.svelte';
  import StoppageSheet from './StoppageSheet.svelte';
  import TallySheet from './TallySheet.svelte';
  import EditSheet from './EditSheet.svelte';
  import SetupSheet from './SetupSheet.svelte';
  import Timeline from './Timeline.svelte';

  let { eventId }: { eventId: string } = $props();

  const snap = $derived(app.snap);
  const event = $derived(snap?.rows.events[eventId]);
  const lineup = $derived(event ? lineupFor(snap, event) : null);
  const cfg = $derived(event && lineup ? configFor(snap, event, lineup) : matchConfig('15s', null));
  // svelte-ignore state_referenced_locally
  const session = new MatchSession(eventId, () => cfg);
  const tournament = $derived(event?.type === 'tournament');
  const day = $derived(tournament ? reduceDay(session.events, cfg, session.now) : null);
  const game = $derived(day ? day.length : 1);
  const st = $derived(
    day ? day[day.length - 1]!.state : reduceMatch(session.events, cfg, session.now),
  );
  const offset = $derived(tournament ? gameOffsetMs(game, cfg.halfMs) : 0);
  const clock = $derived(st.clock);
  const us = $derived(snap?.team.shortName ?? 'Us');
  const opponent = $derived(event?.opponent || 'Opposition');
  const staff = $derived(app.can('match.record'));

  const shown = $derived(clock.gameMs - offset);
  const periodEndAt = $derived(clock.period * cfg.halfMs);
  const over = $derived(clock.inPeriod ? clock.gameMs - periodEndAt : 0);
  const stoppage = $derived(clock.timeOff ? clock.stoppages.at(-1) : undefined);
  const phase = $derived(
    clock.period === 0
      ? 'pre'
      : clock.inPeriod
        ? 'live'
        : clock.period % 2 === 1
          ? 'break'
          : 'ended',
  );
  const canNextGame = $derived(tournament && phase === 'ended' && game < MAX_GAMES);
  const last = $derived(lastUndoable(session.events));
  /** Real time stops at the final whistle (it keeps running through half time). */
  const realMs = $derived.by(() => {
    if (phase !== 'ended') return clock.realElapsedMs;
    const start = st.log.find((e) => e.payload.kind === 'period_start')?.wallAt;
    const end = st.log.findLast((e) => e.payload.kind === 'period_end')?.wallAt;
    return start !== undefined && end !== undefined ? end - start : clock.realElapsedMs;
  });

  let said = $state('');
  let alert = $state<{ text: string; cardId?: string } | null>(null);
  const announce = (t: string) => {
    said = '';
    queueMicrotask(() => (said = t));
  };

  const ctx: RecCtx = $derived({
    session,
    snap,
    lineup: lineup ?? {
      format: cfg.format,
      starters: [],
      bench: [],
      shirt: new Map(),
      hasSheet: false,
    },
    cfg,
    state: st,
    us,
    opponent,
    tournament,
    offset,
    announce,
  });

  type SheetKind = 'score' | 'penalty' | 'card' | 'sub' | 'stop' | 'tally' | 'edit' | 'setup';
  let sheet = $state<SheetKind | null>(null);
  let at = $state(0);
  let editing = $state<MatchEvent | null>(null);
  function openSheet(k: SheetKind) {
    at = session.gameNow();
    sheet = k;
  }
  function bind(k: SheetKind) {
    return {
      get open() {
        return sheet === k;
      },
      set open(v: boolean) {
        if (!v && sheet === k) sheet = null;
        if (v) sheet = k;
      },
    };
  }
  const sScore = bind('score');
  const sPen = bind('penalty');
  const sCard = bind('card');
  const sSub = bind('sub');
  const sStop = bind('stop');
  const sTally = bind('tally');
  const sEdit = bind('edit');
  const sSetup = bind('setup');

  async function clockAction() {
    if (phase === 'pre') {
      await session.record({ kind: 'period_start', period: 1 }, 0);
      announce('Kick-off. Clock running');
    } else if (phase === 'live') {
      await session.record({ kind: 'period_end', period: clock.period });
      announce(clock.period % 2 ? 'Half time' : 'Full time');
    } else if (phase === 'break' || canNextGame) {
      const p = clock.period + 1;
      await session.record({ kind: 'period_start', period: p }, (p - 1) * cfg.halfMs);
      announce(p % 2 ? `Game ${Math.ceil(p / 2)} kick-off` : '2nd half under way');
    }
    buzz(20);
  }
  const clockLabel = $derived(
    phase === 'pre'
      ? 'Kick off'
      : phase === 'live'
        ? clock.period % 2
          ? 'Half time'
          : 'Full time'
        : phase === 'break'
          ? 'Start 2nd half'
          : canNextGame
            ? `Kick off game ${game + 1}`
            : null,
  );

  async function stoppageAction() {
    if (clock.timeOff) {
      await session.record({ kind: 'time_on' });
      buzz();
      announce('Time on. Clock running');
    } else openSheet('stop');
  }

  async function undo() {
    const e = await session.undo();
    if (!e) return;
    const d = describe(e, { snap, opponent, tournament, log: st.log });
    announce(`Undid ${d.title}`);
    toasts.show(`Undid: ${d.title}`, {
      action: { label: 'Redo', run: () => void session.restore(e) },
      timeout: 5000,
    });
  }

  async function returnCard(cardId: string) {
    await session.record({ kind: 'card_return', cardId });
    if (alert?.cardId === cardId) alert = null;
    buzz();
    announce('Back to full strength');
  }

  // Sin-bin alerts: 1 minute left, then due back. Already-passed thresholds at load stay quiet.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping only, never rendered
  const alerted = new Set<string>();
  let primed = false;
  $effect(() => {
    const bins = st.sinBins;
    if (!session.loaded) return;
    for (const b of bins) {
      if (b.permanent || b.colour !== 'yellow') continue;
      const name =
        b.team === 'us'
          ? b.playerId
            ? memberName(snap, b.playerId)
            : `${us} player`
          : `${opponent} player`;
      const k1 = `${b.cardId}:1`;
      const k0 = `${b.cardId}:0`;
      if (b.remainingMs <= 60e3 && !alerted.has(k1)) {
        alerted.add(k1);
        if (primed && b.remainingMs > 0) {
          buzz([30, 60, 30]);
          alert = { text: `1 minute left for ${name} in the bin` };
        }
      }
      if (b.remainingMs <= 0 && !alerted.has(k0)) {
        alerted.add(k0);
        if (primed) {
          buzz([60, 80, 60, 80, 60]);
          alert = { text: `${name} can come back on`, cardId: b.cardId };
        }
      }
    }
    primed = true;
  });
  $effect(() => {
    if (alert && !alert.cardId) {
      const t = setTimeout(() => (alert = null), 8000);
      return () => clearTimeout(t);
    }
  });

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (sheet || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      void undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || phase === 'pre' || !staff) return;
    const map: Record<string, () => void> = {
      s: () => openSheet('score'),
      p: () => openSheet('penalty'),
      c: () => openSheet('card'),
      r: () => openSheet('sub'),
      t: () => void stoppageAction(),
      l: () => openSheet('tally'),
    };
    const fn = map[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }

  onMount(() => {
    app.busy = true;
    const release = keepAwake();
    void session.open();
    session.start();
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        session.now = Date.now();
        void session.refresh();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      app.busy = false;
      release();
      session.stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  });

  $effect(() => {
    if (snap && app.role && !staff)
      void goto(`/events/${eventId}/match/summary`, { replaceState: true });
  });

  const status = $derived(
    !app.online
      ? 'Offline. Saved on this device'
      : app.pending
        ? `Saving ${app.pending}…`
        : 'All synced',
  );
</script>

<svelte:window onkeydown={onKey} />
<svelte:head><title>Match mode · {opponent}</title></svelte:head>

{#if !snap}
  <div class="rec" aria-busy="true"></div>
{:else if !event || event.deletedAt}
  <div class="rec pad">
    <EmptyState
      title="We can't find that match"
      body="It may have been deleted, or it's for another team."
    >
      {#snippet icon()}<IconMatch />{/snippet}
      {#snippet action()}<Button href="/schedule" variant="primary">Back to the schedule</Button
        >{/snippet}
    </EmptyState>
  </div>
{:else if !isGame(event.type)}
  <div class="rec pad">
    <EmptyState
      title="Match mode is for games"
      body="Open a game or tournament to record the score, cards and subs."
    >
      {#snippet icon()}<IconMatch />{/snippet}
      {#snippet action()}<Button href="/events/{event.id}" variant="primary"
          >Back to the event</Button
        >{/snippet}
    </EmptyState>
  </div>
{:else}
  <div class="rec" class:off={clock.timeOff}>
    <header class="bar">
      <a class="back" href="/events/{event.id}" aria-label="Leave match mode"><IconBack /></a>
      <div class="ttl grow">
        <h1 class="truncate">{us} v {opponent}</h1>
        <p class="st" class:offline={!app.online}>
          {#if !app.online}<IconOffline />{/if}<span>{status}</span>
        </p>
      </div>
      {#if tournament}
        <a class="iconlink" href="/events/{event.id}/match/day" aria-label="Tournament day"
          ><IconChart /></a
        >
      {:else}
        <a class="iconlink" href="/events/{event.id}/match/summary" aria-label="Match summary"
          ><IconChart /></a
        >
      {/if}
      {#if phase === 'pre'}
        <button
          class="iconlink"
          type="button"
          aria-label="Match settings"
          onclick={() => openSheet('setup')}><IconSettings /></button
        >
      {/if}
    </header>

    <div class="grid">
      <div class="main">
        <section class="clock card" aria-labelledby="clock-h">
          <div class="cl-top">
            <h2 id="clock-h" class="eyebrow">{periodLabel(clock.period, tournament)}</h2>
            {#if clock.timeOff}
              <span class="badge off"
                >Time off{stoppage
                  ? ` · ${STOPPAGE_LABELS[stoppage.reason as keyof typeof STOPPAGE_LABELS]}`
                  : ''}</span
              >
            {:else if phase === 'live'}
              <span class="badge live">Running</span>
            {:else if phase === 'break'}
              <span class="badge">Half time</span>
            {:else if phase === 'ended'}
              <span class="badge">Full time</span>
            {/if}
          </div>
          <div class="time tnum" role="timer" aria-label="Game clock {formatClock(shown)}">
            {formatClock(shown)}
          </div>
          <div class="cl-sub tnum">
            <span>Real time <strong>{formatClock(realMs)}</strong></span>
            {#if over > 0}<span class="over"
                >+{formatClock(over)} past {Math.round((periodEndAt - offset) / 60e3)}:00</span
              >{/if}
            {#if stoppage}<span
                >Stopped <strong>{formatClock(session.now - stoppage.startWall)}</strong></span
              >{/if}
          </div>

          {#if st.sinBins.length && phase !== 'ended'}
            <ul class="list bins" aria-label="Sin bin">
              {#each st.sinBins as b (b.cardId)}
                {@const who =
                  b.team === 'us' ? (b.playerId ? memberName(snap, b.playerId) : us) : opponent}
                {@const due = !b.permanent && b.remainingMs <= 0}
                <li class="bin {b.colour}" class:soon={!due && b.remainingMs <= 60e3} class:due>
                  <span class="sw" aria-hidden="true"></span>
                  <span class="bn truncate">{who}</span>
                  {#if b.permanent}
                    <span class="br">Off</span>
                  {:else if due && b.colour === 'yellow'}
                    <button type="button" class="ret" onclick={() => returnCard(b.cardId)}
                      >Return {b.team === 'us' && b.playerId ? who.split(' ')[0] : 'player'}</button
                    >
                  {:else}
                    <span class="br tnum">{formatClock(b.remainingMs)}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}

          {#if staff && clockLabel}
            <Button
              variant={phase === 'live' ? 'secondary' : 'primary'}
              size="lg"
              block
              onclick={clockAction}
            >
              {#snippet icon()}{#if phase === 'live'}<IconWhistle />{:else}<IconPlay
                  />{/if}{/snippet}
              {clockLabel}
            </Button>
          {/if}
        </section>

        {#if alert}
          <div class="alert" role="alert">
            <IconWarn /><span class="grow">{alert.text}</span>
            {#if alert.cardId}
              <Button size="sm" variant="primary" onclick={() => returnCard(alert!.cardId!)}
                >Return player</Button
              >
            {:else}
              <Button size="sm" variant="ghost" onclick={() => (alert = null)}>OK</Button>
            {/if}
          </div>
        {/if}

        <section class="board card" aria-labelledby="score-h">
          <h2 id="score-h" class="sr-only">Score</h2>
          <p class="sr-only">
            {us}
            {st.score.us}, {opponent}
            {st.score.them}. Players on the field: {st.onField.us} v {st.onField.them}
          </p>
          <div class="side" aria-hidden="true">
            <span class="tm truncate">{us}</span>
            <span class="sc tnum">{st.score.us}</span>
          </div>
          <div class="mid" aria-hidden="true">
            <span class="nf tnum">{st.onField.us} v {st.onField.them}</span>
            <small>on field</small>
          </div>
          <div class="side them" aria-hidden="true">
            <span class="sc tnum">{st.score.them}</span>
            <span class="tm truncate">{opponent}</span>
          </div>
        </section>

        {#if phase === 'pre'}
          <section class="card pre" aria-label="Before kick-off">
            <div class="row">
              <span class="grow">
                <strong class="tnum">2 × {Math.round(cfg.halfMs / 60e3)} min halves</strong>
                <small class="muted"
                  >{Math.round(cfg.sinBinMs / 60e3)} min sin bin · {cfg.replacements} replacements · {cfg.format}</small
                >
              </span>
              {#if staff}<Button size="sm" onclick={() => openSheet('setup')}>Change</Button>{/if}
            </div>
            {#if lineup?.hasSheet}
              <p class="muted">
                {lineup.starters.length} starting and {lineup.bench.length} on the bench, from the team
                sheet.
              </p>
            {:else}
              <p class="warn-line">
                <IconWarn />No team sheet yet, so scorers and subs can't be named.
                <a href="/events/{event.id}/sheet">Pick the team <IconChevronRight /></a>
              </p>
            {/if}
          </section>
        {:else if phase === 'ended' && !canNextGame}
          <a class="card done" href="/events/{event.id}/match/{tournament ? 'day' : 'summary'}">
            <strong class="grow"
              >{tournament ? 'See the tournament day' : 'See the match summary'}</strong
            >
            <IconChevronRight />
          </a>
        {/if}

        {#if staff}
          <div class="actions" role="group" aria-label="Record">
            <button
              type="button"
              class="act primary"
              disabled={phase === 'pre'}
              onclick={() => openSheet('score')}
              aria-keyshortcuts="S"
            >
              <IconGoal /><span>Score</span>
            </button>
            <button
              type="button"
              class="act"
              disabled={phase === 'pre'}
              onclick={() => openSheet('penalty')}
              aria-keyshortcuts="P"
            >
              <IconFlag /><span>Penalty</span>
            </button>
            <button
              type="button"
              class="act"
              disabled={phase === 'pre'}
              onclick={() => openSheet('card')}
              aria-keyshortcuts="C"
            >
              <IconCard /><span>Card</span>
            </button>
            <button
              type="button"
              class="act"
              disabled={phase === 'pre'}
              onclick={() => openSheet('sub')}
              aria-keyshortcuts="R"
            >
              <IconSub /><span>Sub</span>
            </button>
            <button
              type="button"
              class="act"
              class:hot={clock.timeOff}
              disabled={!clock.inPeriod}
              onclick={stoppageAction}
              aria-keyshortcuts="T"
            >
              {#if clock.timeOff}<IconPlay /><span>Time on</span>{:else}<IconPause /><span
                  >Stoppage</span
                >{/if}
            </button>
            <button
              type="button"
              class="act"
              disabled={phase === 'pre'}
              onclick={() => openSheet('tally')}
              aria-keyshortcuts="L"
            >
              <IconTally /><span>Tallies</span>
            </button>
          </div>
        {/if}
      </div>

      <aside class="log card">
        <Timeline
          log={st.log}
          {snap}
          {opponent}
          {tournament}
          {offset}
          heading={tournament ? `Game ${game} log` : 'Match log'}
          onedit={staff
            ? (e) => {
                editing = e;
                openSheet('edit');
              }
            : undefined}
        />
      </aside>
    </div>

    {#if staff}
      <div class="undo">
        <span class="lu grow truncate">
          {#if last}
            {@const d = describe(last, { snap, opponent, tournament, log: st.log })}
            Last: <strong>{d.title}</strong>{d.detail ? ` · ${d.detail}` : ''}
            <span class="tnum">{formatClock(last.gameMs - offset)}</span>
          {:else}
            Nothing recorded yet
          {/if}
        </span>
        <Button variant="quiet" disabled={!last} onclick={undo} aria-keyshortcuts="Control+Z">
          {#snippet icon()}<IconUndo />{/snippet}Undo last
        </Button>
      </div>
    {/if}

    <p class="sr-only" aria-live="polite">{said}</p>
  </div>

  {#if staff}
    <ScoreSheet bind:open={sScore.open} {at} {ctx} />
    <PenaltySheet bind:open={sPen.open} {at} {ctx} />
    <CardSheet bind:open={sCard.open} {at} {ctx} />
    <SubSheet bind:open={sSub.open} {at} {ctx} />
    <StoppageSheet bind:open={sStop.open} {at} {ctx} />
    <TallySheet bind:open={sTally.open} {ctx} />
    <EditSheet bind:open={sEdit.open} entry={editing} {ctx} />
    <SetupSheet bind:open={sSetup.open} {event} {cfg} />
  {/if}
{/if}

<style>
  .rec {
    --viz-us: #2a78d6;
    min-height: 100dvh;
    background: var(--bg);
    padding-bottom: calc(72px + var(--safe-b));
  }
  .pad {
    padding: var(--s-6) var(--s-4);
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: calc(var(--safe-t) + var(--s-2)) var(--s-3) var(--s-2);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
  }
  .back,
  .iconlink {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: none;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text);
  }
  .back:hover,
  .iconlink:hover {
    background: var(--surface-3);
  }
  .back :global(svg),
  .iconlink :global(svg) {
    width: 20px;
    height: 20px;
  }
  .ttl h1 {
    font-size: var(--t-16);
    letter-spacing: -0.01em;
  }
  .st {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--t-12);
    font-weight: 650;
    color: var(--text-3);
  }
  .st.offline {
    color: var(--warn);
  }
  .st :global(svg) {
    width: 13px;
    height: 13px;
  }
  .grid {
    display: grid;
    gap: var(--s-3);
    padding: var(--s-3);
    max-width: 1280px;
    margin: 0 auto;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    min-width: 0;
  }
  .clock {
    padding: var(--s-4);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .off .clock {
    border-color: var(--warn);
    box-shadow: 0 0 0 1px var(--warn);
  }
  .cl-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
  }
  .badge {
    padding: 2px var(--s-2);
    border-radius: var(--r-full);
    background: var(--surface-3);
    font-size: var(--t-12);
    font-weight: 700;
  }
  .badge.live {
    background: var(--ok-soft);
    color: color-mix(in srgb, var(--ok) 72%, var(--text));
  }
  .badge.off {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .time {
    font-size: clamp(4.5rem, 24vw, 9.5rem);
    font-weight: 800;
    line-height: 0.95;
    letter-spacing: -0.04em;
    text-align: center;
  }
  .off .time {
    color: var(--warn);
  }
  .cl-sub {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--s-1) var(--s-4);
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .cl-sub strong {
    color: var(--text);
  }
  .over {
    color: var(--warn);
    font-weight: 700;
  }
  .bins {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin: var(--s-1) 0;
  }
  .bin {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 44px;
    padding: var(--s-1) var(--s-2) var(--s-1) var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
    font-weight: 650;
  }
  .bin .sw {
    flex: none;
    width: 12px;
    height: 16px;
    border-radius: 2px;
    background: #f5c518;
  }
  .bin.red .sw {
    background: #d92d20;
  }
  .bn {
    flex: 1;
    min-width: 0;
  }
  .br {
    font-size: var(--t-20);
    font-weight: 800;
  }
  .bin.soon {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .bin.due {
    background: var(--ok-soft);
  }
  .ret {
    min-height: 40px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: var(--ok);
    color: var(--surface);
    font-weight: 750;
  }
  .alert {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-lg);
    background: var(--warn-soft);
    color: var(--warn);
    font-weight: 700;
    animation: pulse 1s var(--ease) 2;
  }
  .alert :global(svg) {
    width: 20px;
    height: 20px;
    flex: none;
  }
  @keyframes pulse {
    50% {
      transform: scale(1.02);
    }
  }
  .board {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
  }
  .side {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
  }
  .side.them {
    justify-content: flex-end;
  }
  .tm {
    font-weight: 700;
    color: var(--text-2);
  }
  .sc {
    font-size: var(--t-40);
    font-weight: 800;
    line-height: 1;
  }
  .mid {
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.1;
  }
  .nf {
    font-weight: 800;
    font-size: var(--t-16);
  }
  .mid small {
    font-size: var(--t-12);
    color: var(--text-3);
  }
  .pre {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
  }
  .pre small {
    display: block;
  }
  .warn-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1) var(--s-2);
    color: var(--warn);
    font-size: var(--t-14);
    font-weight: 600;
  }
  .warn-line a {
    display: inline-flex;
    align-items: center;
    font-weight: 700;
  }
  .warn-line :global(svg) {
    width: 16px;
    height: 16px;
  }
  .done {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-4);
    color: var(--accent-text);
    text-decoration: none;
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s-2);
  }
  .act {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-1);
    min-height: 84px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--e-1);
    font-weight: 750;
    font-size: var(--t-16);
    transition:
      transform var(--m-fast) var(--ease),
      background var(--m-fast) var(--ease);
  }
  .act :global(svg) {
    width: 26px;
    height: 26px;
  }
  .act:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .act:active:not(:disabled) {
    transform: scale(0.97);
  }
  .act:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .act.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .act.primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 88%, var(--text));
  }
  .act.hot {
    background: var(--warn-soft);
    border-color: var(--warn);
    color: var(--warn);
  }
  .log {
    padding: var(--s-3) var(--s-4);
    min-width: 0;
  }
  .undo {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) var(--s-3) calc(var(--s-2) + var(--safe-b)) var(--s-4);
    background: var(--surface);
    border-top: 1px solid var(--border);
    box-shadow: var(--e-2);
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .lu strong {
    color: var(--text);
  }
  @media (min-width: 960px) {
    .grid {
      grid-template-columns: minmax(0, 1.25fr) minmax(340px, 0.75fr);
      align-items: start;
      padding: var(--s-5) var(--s-6);
      gap: var(--s-5);
    }
    .log {
      position: sticky;
      top: 80px;
      max-height: calc(100dvh - 80px - 88px);
      overflow-x: hidden;
      overflow-y: auto;
    }
    .act {
      min-height: 96px;
    }
    .undo {
      left: 50%;
      right: auto;
      bottom: var(--s-4);
      width: min(640px, calc(100% - 48px));
      transform: translateX(-50%);
      border: 1px solid var(--border);
      border-radius: var(--r-lg);
      padding: var(--s-2) var(--s-2) var(--s-2) var(--s-4);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .alert {
      animation: none;
    }
  }
</style>
