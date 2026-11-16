<script lang="ts">
  /** Players follow along: what's on now and next for their group, from the coach's run log. */
  import { page } from '$app/state';
  import {
    ALL_LANE,
    laneLabel,
    timeline,
    type DrillMeta,
    type RunEvent,
    type Block,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import Button from '#lib/components/Button.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import { day, time } from '#lib/format';
  import { blockTitle, fmtMin, laneFor } from '#lib/features/practice/model';
  import { runView, type StepInfo } from '#lib/features/practice/runner';
  import { fetchRun, localRun } from '#lib/features/practice/store';
  import { IconChevronLeft, IconPlaybook, IconUsers } from '#lib/icons';

  const id = $derived(page.params.id ?? '');
  const s = $derived(app.snap);
  const plan = $derived(s?.rows.plans[id]);
  const event = $derived(plan?.eventId ? s?.rows.events[plan.eventId] : undefined);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const drills = $derived((s?.rows.drills ?? {}) as Record<string, DrillMeta>);
  const myLane = $derived(plan ? laneFor(plan.data.lanes, s?.me.positions) : null);
  const lanes = $derived(plan?.data.lanes ?? [ALL_LANE]);
  const split = $derived(!(lanes.length === 1 && lanes[0] === ALL_LANE));

  let events = $state.raw<RunEvent[]>([]);
  let now = $state(Date.now());

  async function poll() {
    if (!app.teamId || !id) return;
    try {
      events = await fetchRun(app.teamId, id);
    } catch {
      // Offline: if this device ran the session, show its own log.
      const local = await localRun(id);
      if (local.length) events = local;
    }
  }

  // Poll every 15 s while visible; re-render every second for the clock.
  $effect(() => {
    void id;
    let t: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (t) clearInterval(t);
      void poll();
      t = setInterval(() => void poll(), 15_000);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') startPoll();
      else if (t) {
        clearInterval(t);
        t = null;
      }
    };
    startPoll();
    const clock = setInterval(() => (now = Date.now()), 1000);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      if (t) clearInterval(t);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVis);
    };
  });

  const view = $derived(plan ? runView(plan.data, events, now) : null);
  const status = $derived(view?.state.status ?? 'idle');
  const live = $derived(status === 'running' || status === 'paused');
  const tl = $derived(plan ? timeline(plan.data) : []);
  const currentSlot = $derived(live ? view?.current?.slot.id : undefined);

  /** The block a player in `lane` does in this slot (everyone-blocks apply to all). */
  function mine(blocks: Block[]): Block[] {
    const all = blocks.filter((b) => b.lane === ALL_LANE);
    if (all.length) return all;
    if (myLane) return blocks.filter((b) => b.lane === myLane);
    return blocks;
  }
  function label(info: StepInfo | null | undefined) {
    if (!info) return '';
    return mine(info.slot.blocks)
      .map((b) => blockTitle(b, drills))
      .join(' / ');
  }
  const play = (b: Block) => (b.playId ? s?.rows.plays[b.playId] : undefined);
  const nowBlocks = $derived(view?.current ? mine(view.current.slot.blocks) : []);
</script>

<svelte:head><title>Today's session · {plan?.title ?? 'Practice'}</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/practice"><IconChevronLeft />Practice</a>
  {#if !s}
    <div class="sk" aria-busy="true"></div>
  {:else if !plan}
    <EmptyState title="Plan not found" body="Your coach may not have shared this session yet." />
  {:else}
    <header class="page-head">
      <div>
        <p class="eyebrow">Today's session</p>
        <h1>{plan.title}</h1>
        <p class="muted">
          {#if event}{day(event.startsAt, tz)} · {time(event.startsAt, tz)} ·
          {/if}{fmtMin(plan.plannedTotalMin)}
        </p>
      </div>
    </header>

    {#if split}
      <p class="group card">
        <IconUsers />
        {#if myLane}
          <span>You're with the <strong>{laneLabel(myLane)}</strong> for split sessions</span>
        {:else}
          <span
            >Split sessions run in {lanes.map(laneLabel).join(' and ')}. Your coach will put you in
            a group.</span
          >
        {/if}
      </p>
    {/if}

    <section class="card now" aria-live="polite" aria-atomic="true" aria-label="Live status">
      {#if live && view?.current}
        <p class="eyebrow">{status === 'paused' ? 'Paused' : 'On now'}</p>
        <p class="now-t">{label(view.current)}</p>
        <p class="tnum muted">
          {view.remainingMs > 0
            ? `${Math.ceil(view.remainingMs / 60e3)} min left`
            : 'Wrapping up'}{view.projectedFinishAt
            ? ` · finish ${time(view.projectedFinishAt, tz)}`
            : ''}
        </p>
        {#if view.next}
          <p class="nx"><span class="eyebrow">Next</span> {label(view.next)}</p>
        {/if}
      {:else if status === 'ended'}
        <p class="eyebrow">Finished</p>
        <p class="now-t">That's the session. Good work.</p>
      {:else}
        <p class="eyebrow">Not started</p>
        <p class="now-t">
          {view?.current ? `First up: ${label(view.current)}` : 'Nothing planned yet'}
        </p>
        {#if event}<p class="muted">Starts {time(event.startsAt, tz)}</p>{/if}
      {/if}
    </section>
    {#each nowBlocks.filter((b) => live && play(b)) as b (b.id)}
      <Button href="/plays/{b.playId}"
        >{#snippet icon()}<IconPlaybook />{/snippet}Rehearse: {play(b)?.title}</Button
      >
    {/each}

    <h2 class="section-title">The plan</h2>
    <ol class="list plan">
      {#each tl as t (t.slot.id)}
        {@const bs = mine(t.slot.blocks)}
        <li class:current={t.slot.id === currentSlot}>
          <span class="tm tnum"
            >{event ? time(event.startsAt + t.startMin * 60e3, tz) : `${t.startMin}′`}</span
          >
          <span class="grow">
            {#each bs as b (b.id)}
              <span class="bl">
                <strong>{blockTitle(b, drills)}</strong>
                {#if b.lane !== ALL_LANE && (!myLane || bs.length > 1)}<small
                    >{laneLabel(b.lane)}</small
                  >{/if}
              </span>
            {/each}
            {#if t.slot.id === currentSlot}<span class="sr-only">(on now)</span>{/if}
          </span>
          <span class="d tnum">{t.endMin - t.startMin} min</span>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .narrow {
    max-width: 680px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-height: 32px;
    font-size: var(--t-14);
    font-weight: 650;
    text-decoration: none;
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
  }
  .sk {
    height: 240px;
    border-radius: var(--r-lg);
    background: var(--surface-2);
  }
  .group {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    margin-bottom: var(--s-3);
    font-size: var(--t-14);
  }
  .group :global(svg) {
    width: 20px;
    height: 20px;
    color: var(--accent-text);
    flex: none;
  }
  .now {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    padding: var(--s-5);
    margin-bottom: var(--s-3);
    background: linear-gradient(135deg, var(--accent-soft), var(--surface) 75%);
  }
  .now-t {
    font-size: var(--t-24);
    font-weight: 800;
    line-height: 1.15;
  }
  .nx {
    margin-top: var(--s-2);
    font-weight: 650;
  }
  .plan {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .plan li {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    padding: var(--s-3);
    border-radius: var(--r-md);
  }
  .plan li.current {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .tm {
    width: 4.5em;
    flex: none;
    font-weight: 700;
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .bl {
    display: block;
  }
  .bl small {
    margin-left: var(--s-2);
    font-size: var(--t-12);
    color: var(--text-2);
  }
  .d {
    flex: none;
    font-size: var(--t-14);
    color: var(--text-2);
  }
</style>
