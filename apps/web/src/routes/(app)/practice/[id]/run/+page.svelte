<script lang="ts">
  import { onDestroy } from 'svelte';
  import { page } from '$app/state';
  import {
    ALL_LANE,
    can,
    laneLabel,
    type DrillFull,
    type DrillMeta,
    type RunEvent,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import Button from '#lib/components/Button.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import { time } from '#lib/format';
  import CountdownRing from '#lib/features/practice/CountdownRing.svelte';
  import DrillPreview from '#lib/features/practice/DrillPreview.svelte';
  import { blockTitle, fmtMin } from '#lib/features/practice/model';
  import {
    crossed,
    dueAdvances,
    formatClock,
    laneStatus,
    mergeEvents,
    transitionId,
    runView,
    stepInfo,
    summary,
    type StepInfo,
  } from '#lib/features/practice/runner';
  import {
    appendRun,
    fetchDrill,
    fetchRun,
    loadRun,
    newRunEventId,
  } from '#lib/features/practice/store';
  import { chime, keepAwake, unlockAudio, vibrate } from '#lib/features/practice/device';
  import { loadPrefs, savePrefs, type RunnerPrefs } from '#lib/features/practice/ui.svelte';
  import {
    IconPlay,
    IconPause,
    IconSkip,
    IconX,
    IconCheck,
    IconImage,
    IconClipboardCheck,
  } from '#lib/icons';
  import IconVolume from '@lucide/svelte/icons/volume-2';
  import IconVolumeOff from '@lucide/svelte/icons/volume-x';
  import IconVibrate from '@lucide/svelte/icons/vibrate';
  import IconVibrateOff from '@lucide/svelte/icons/vibrate-off';
  import IconStepForward from '@lucide/svelte/icons/step-forward';
  import IconTimerPlus from '@lucide/svelte/icons/alarm-clock-plus';
  import IconAuto from '@lucide/svelte/icons/fast-forward';

  const id = $derived(page.params.id ?? '');
  const s = $derived(app.snap);
  const plan = $derived(s?.rows.plans[id]);
  const event = $derived(plan?.eventId ? s?.rows.events[plan.eventId] : undefined);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const drills = $derived((s?.rows.drills ?? {}) as Record<string, DrillMeta>);
  const allowed = $derived(can(app.role, 'practice.run'));

  let events = $state.raw<RunEvent[]>([]);
  let loaded = $state(false);
  let now = $state(Date.now());
  let prefs = $state<RunnerPrefs>(loadPrefs());
  let showDiagram = $state(false);
  let announce = $state('');
  let confirmEnd = $state(false);

  $effect(() => {
    const teamId = app.teamId;
    if (!teamId || !id) return;
    let alive = true;
    void loadRun(teamId, id).then((e) => {
      if (!alive) return;
      events = mergeEvents(e, events);
      loaded = true;
    });
    return () => {
      alive = false;
    };
  });

  // Every coach and manager can open the live session on their own phone (e.g. one with the
  // forwards, one with the backs). Devices stay in step by merging the shared log every 5 s.
  $effect(() => {
    const teamId = app.teamId;
    if (!teamId || !id || !allowed) return;
    let alive = true;
    const pull = () => {
      if (document.visibilityState !== 'visible' || !app.online) return;
      void fetchRun(teamId, id)
        .then((remote) => alive && (events = mergeEvents(events, remote)))
        .catch(() => {});
    };
    const t = setInterval(pull, 5000);
    document.addEventListener('visibilitychange', pull);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', pull);
    };
  });

  // Re-render only; every number comes from timestamps.
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 250);
    const vis = () => (now = Date.now());
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  });

  const view = $derived(plan ? runView(plan.data, events, now) : null);
  const status = $derived(view?.state.status ?? 'idle');
  const live = $derived(status === 'running' || status === 'paused');
  /** Split slots (forwards / backs): each group's own countdown. */
  const lanesNow = $derived(view ? laneStatus(view) : []);

  function push(kind: RunEvent['kind'], payload: RunEvent['payload'] = {}, eventId?: string) {
    const e: RunEvent = { id: eventId ?? newRunEventId(), kind, at: Date.now(), payload };
    commit([e]);
  }
  function commit(added: RunEvent[]) {
    if (!added.length) return;
    events = mergeEvents(events, added);
    void appendRun(id, events, added);
    now = Date.now();
  }

  // Auto-advance: append advances stamped at their exact due times.
  $effect(() => {
    if (!view || !prefs.auto || view.state.status !== 'running' || view.remainingMs > 0) return;
    commit(dueAdvances(view.steps, events, now));
  });

  // Chimes, vibration and polite announcements at milestones.
  let prev: { index: number; remainingMs: number } | null = null;
  let prevIndex = -1;
  $effect(() => {
    if (!view) return;
    const cur = {
      index: view.state.index,
      remainingMs: view.remainingMs,
      running: view.state.status === 'running',
    };
    const m = crossed(prev, cur);
    if (m) {
      if (prefs.sound) chime(m);
      if (prefs.vibrate) vibrate(m);
      const name = titleOf(view.current);
      announce =
        m === 'end'
          ? prefs.auto && view.next
            ? `Time. Next: ${titleOf(view.next)}`
            : `Time on ${name}`
          : `One minute left in ${name}`;
    } else if (live && prevIndex !== -1 && cur.index !== prevIndex && view.current) {
      announce = `Now: ${titleOf(view.current)}, ${formatClock(view.remainingMs)}`;
    } else if (status === 'ended' && prevIndex !== -1 && prevIndex < view.steps.length) {
      announce = "That's the session. Well done.";
      if (prefs.sound) chime('end');
    }
    prev = { index: cur.index, remainingMs: cur.remainingMs };
    prevIndex = status === 'ended' ? view.steps.length : cur.index;
  });

  // Keep update prompts from reloading mid-session, and keep the screen on.
  $effect(() => {
    app.busy = live;
    if (!live) return;
    return keepAwake();
  });
  onDestroy(() => (app.busy = false));

  $effect(() => savePrefs(prefs));

  function titleOf(info: StepInfo | null | undefined): string {
    if (!info) return '';
    const bs = info.slot.blocks;
    const base =
      bs.length === 1
        ? blockTitle(bs[0]!, drills)
        : bs.map((b) => `${laneLabel(b.lane)}: ${blockTitle(b, drills)}`).join(', ');
    return info.round ? `${base}, round ${info.round.round + 1}` : base;
  }

  const current = $derived(view?.current ?? null);
  const currentDrill = $derived.by(() => {
    const b = current?.slot.blocks.find((x) => x.drillId && drills[x.drillId]);
    return b?.drillId ? drills[b.drillId] : undefined;
  });
  let diagram = $state.raw<DrillFull | null>(null);
  $effect(() => {
    const d = currentDrill;
    diagram = null;
    if (!d?.hasDiagram || !showDiagram || !app.teamId) return;
    let alive = true;
    void fetchDrill(app.teamId, d.id, d.version).then((full) => alive && (diagram = full));
    return () => {
      alive = false;
    };
  });

  function start() {
    unlockAudio();
    push('start', { auto: false });
  }
  function next() {
    if (!view) return;
    if (!view.next) push('end', {}, transitionId(events, 'end', 0));
    else push('advance', {}, transitionId(events, 'advance', view.state.index));
  }

  const finish = $derived(view?.projectedFinishAt ?? null);
  const lateMin = $derived(
    event?.endsAt && finish ? Math.round((finish - event.endsAt) / 60e3) : 0,
  );
  const sum = $derived(view && status === 'ended' ? summary(view.steps, view.state) : null);
  const plannedFinish = $derived(event ? event.startsAt + (view?.plannedTotalMs ?? 0) : null);
</script>

<svelte:head><title>Run · {plan?.title ?? 'Practice'}</title></svelte:head>

{#snippet blocksOf(info: StepInfo, big: boolean)}
  {#if info.slot.blocks.length === 1 && info.slot.blocks[0]!.lane === ALL_LANE}
    {@const b = info.slot.blocks[0]!}
    <p class={big ? 'now-title' : 'next-title'}>{blockTitle(b, drills)}</p>
  {:else}
    {@const laneRows = big ? lanesNow : []}
    <ul class="list lanes" class:big class:split={big && laneRows.length > 1}>
      {#each info.slot.blocks as b (b.id)}
        {@const ln = laneRows.find((x) => x.block.id === b.id)}
        {@const mine = !!b.coachId && b.coachId === s?.me.id}
        <li class:mine class:done={ln?.done}>
          <span class="lane"
            >{laneLabel(b.lane)}{#if mine}<span class="you">
                · You</span
              >{/if}{#if b.coachId && !mine}<span class="coach">
                · {s?.rows.members[b.coachId]?.displayName.split(' ')[0] ?? ''}</span
              >{/if}</span
          ><span class="lt">{blockTitle(b, drills)}</span>
          {#if ln}
            {#if ln.done}
              <span class="lc">Done · waiting for the others ({view?.clock})</span>
            {:else}
              <span
                class="lc tnum"
                aria-label="{laneLabel(b.lane)}: {formatClock(ln.remainingMs)} left"
                >{formatClock(ln.remainingMs)} left</span
              >
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<div class="runner">
  <header class="bar">
    <a class="exit" href="/practice/{id}" aria-label="Leave the runner"><IconX /></a>
    <div class="bt grow">
      <p class="truncate"><strong>{plan?.title ?? 'Practice'}</strong></p>
      {#if live && finish}
        <p class="subtle tnum">
          Finish {time(finish, tz)}{lateMin > 0 ? ` · ${lateMin} min over` : ''}
        </p>
      {:else if plannedFinish && event}
        <p class="subtle tnum">{time(event.startsAt, tz)}–{time(plannedFinish, tz)}</p>
      {/if}
    </div>
    <div class="toggles">
      <button
        type="button"
        class="tg"
        aria-pressed={prefs.auto}
        onclick={() => (prefs.auto = !prefs.auto)}><IconAuto /><span>Auto</span></button
      >
      <button
        type="button"
        class="tg"
        aria-pressed={prefs.sound}
        aria-label="Chime"
        onclick={() => (prefs.sound = !prefs.sound)}
      >
        {#if prefs.sound}<IconVolume />{:else}<IconVolumeOff />{/if}
      </button>
      <button
        type="button"
        class="tg"
        aria-pressed={prefs.vibrate}
        aria-label="Vibrate"
        onclick={() => (prefs.vibrate = !prefs.vibrate)}
      >
        {#if prefs.vibrate}<IconVibrate />{:else}<IconVibrateOff />{/if}
      </button>
    </div>
  </header>
  <p class="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>

  {#if !s || (!loaded && plan)}
    <div class="center"><div class="sk" aria-busy="true"></div></div>
  {:else if !plan}
    <div class="center"><EmptyState title="Plan not found" body="It may have been deleted." /></div>
  {:else if !allowed}
    <div class="center">
      <EmptyState
        title="Coaches run the clock"
        body="Your coach runs the session timer on their device."
      >
        {#snippet action()}<Button href="/practice/{id}">View the plan</Button>{/snippet}
      </EmptyState>
    </div>
  {:else if !plan.data.slots.length}
    <div class="center">
      <EmptyState title="Nothing to run yet" body="Add some blocks to the plan first.">
        {#snippet action()}<Button href="/practice/{id}">Open the plan</Button>{/snippet}
      </EmptyState>
    </div>
  {:else if view && status === 'idle'}
    <main class="center idle">
      <p class="eyebrow">Ready</p>
      <h1>{plan.title}</h1>
      <p class="muted tnum">{fmtMin(view.plannedTotalMs / 60e3)} · {view.steps.length} blocks</p>
      {#if view.current}
        <div class="card first">
          <p class="eyebrow">First up · {formatClock(view.current.step.plannedMs)}</p>
          {@render blocksOf(view.current, false)}
        </div>
      {/if}
      <Button variant="primary" size="lg" onclick={start}
        >{#snippet icon()}<IconPlay />{/snippet}Start session</Button
      >
      <p class="subtle">
        {prefs.auto ? 'Blocks move on automatically.' : 'You move on with Next.'} The screen stays on
        while the session runs.
      </p>
    </main>
  {:else if view && live && current}
    <main class="live" class:paused={status === 'paused'}>
      <section class="clock-col" aria-label="Timer">
        <p class="step tnum">
          Block {view.state.index + 1} of {view.steps.length}{current.round
            ? ` · Round ${current.round.round + 1} of ${current.round.of}`
            : ''}
        </p>
        <CountdownRing
          progress={view.progress}
          clock={view.clock}
          overtime={view.overtime}
          paused={status === 'paused'}
          caption={status === 'paused' ? 'Paused' : view.overtime ? 'Over time' : 'Left'}
        />
        <div class="controls">
          <Button size="lg" onclick={() => push('extend', { ms: 120e3 })}
            >{#snippet icon()}<IconTimerPlus />{/snippet}+2 min</Button
          >
          {#if status === 'paused'}
            <Button size="lg" variant="primary" onclick={() => push('resume')}
              >{#snippet icon()}<IconPlay />{/snippet}Resume</Button
            >
          {:else}
            <Button size="lg" onclick={() => push('pause')}
              >{#snippet icon()}<IconPause />{/snippet}Pause</Button
            >
          {/if}
          <Button
            size="lg"
            onclick={() =>
              push(
                'skip',
                { index: view.state.index },
                transitionId(events, 'skip', view.state.index),
              )}>{#snippet icon()}<IconSkip />{/snippet}Skip</Button
          >
          <Button
            size="lg"
            variant={view.overtime || status === 'paused' ? 'secondary' : 'primary'}
            onclick={next}
          >
            {#snippet icon()}{#if view.next}<IconStepForward />{:else}<IconCheck
                />{/if}{/snippet}{view.next ? 'Next' : 'Finish'}
          </Button>
        </div>
      </section>

      <section class="detail" aria-labelledby="now-h">
        <h1 id="now-h" class="sr-only">Now</h1>
        <p class="eyebrow">Now</p>
        {@render blocksOf(current, true)}
        {#if current.round}
          <ul class="list rounds">
            {#each current.round.groups as g (g.group)}<li>
                <b>Group {g.group}</b><span>{g.station}</span>
              </li>{/each}
          </ul>
        {/if}
        {#each current.slot.blocks.filter((b) => b.notes) as b (b.id)}
          <p class="notes">{b.notes}</p>
        {/each}
        {#if currentDrill?.coachingPoints.length}
          <h2 class="cp-h">Coaching points</h2>
          <ul class="cp">
            {#each currentDrill.coachingPoints.slice(0, 5) as p (p)}<li>{p}</li>{/each}
          </ul>
        {/if}
        {#if currentDrill?.hasDiagram}
          <Button
            variant="ghost"
            aria-pressed={showDiagram}
            onclick={() => (showDiagram = !showDiagram)}
            >{#snippet icon()}<IconImage />{/snippet}{showDiagram
              ? 'Hide diagram'
              : 'Show diagram'}</Button
          >
          {#if showDiagram}
            {#if diagram?.diagram}
              <DrillPreview
                play={diagram.diagram}
                playing
                label="Diagram: {currentDrill.title}"
                height="240px"
              />
            {:else}
              <div class="dg-sk" aria-busy="true"></div>
            {/if}
          {/if}
        {/if}

        {#if view.next}
          <div class="card next">
            <p class="eyebrow">
              Next up · {formatClock(
                view.state.durations[view.next.index] ?? view.next.step.plannedMs,
              )}
            </p>
            {@render blocksOf(view.next, false)}
            <Button
              size="sm"
              variant="ghost"
              onclick={() =>
                push(
                  'skip',
                  { index: view.next!.index },
                  transitionId(events, 'skip', view.next!.index),
                )}>Skip it</Button
            >
          </div>
        {:else}
          <div class="card next">
            <p class="eyebrow">Last block</p>
            <p>Then that's the session.</p>
          </div>
        {/if}
        <Button variant="quiet" onclick={() => (confirmEnd = true)}>End session early</Button>
      </section>
    </main>
  {:else if view && sum}
    <main class="center done">
      <p class="eyebrow">Session complete</p>
      <h1>That's a wrap</h1>
      <p class="muted tnum">
        Ran {fmtMin(Math.round(sum.actualMs / 60e3))} of {fmtMin(Math.round(sum.plannedMs / 60e3))} planned{sum.skipped
          ? ` · ${sum.skipped} skipped`
          : ''}
      </p>
      <div class="card sum">
        <table>
          <caption class="sr-only">What actually ran</caption>
          <thead
            ><tr
              ><th scope="col">Block</th><th scope="col" class="n">Planned</th><th
                scope="col"
                class="n">Actual</th
              ></tr
            ></thead
          >
          <tbody>
            {#each sum.rows as r (r.index)}
              {@const info = stepInfo(plan.data, view.steps, r.index)}
              <tr class:skipped={r.skipped}>
                <th scope="row">{titleOf(info)}</th>
                <td class="n tnum">{Math.round(r.plannedMs / 60e3)} min</td>
                <td class="n tnum">{r.skipped ? 'Skipped' : formatClock(r.actualMs ?? 0)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="row wrap">
        {#if plan.eventId}
          <Button variant="primary" href="/events/{plan.eventId}/attendance"
            >{#snippet icon()}<IconClipboardCheck />{/snippet}Mark attendance</Button
          >
        {/if}
        <Button href="/practice/{id}">Back to the plan</Button>
        <Button variant="ghost" onclick={start}>Run it again</Button>
      </div>
    </main>
  {/if}
</div>

<Sheet
  bind:open={confirmEnd}
  title="End the session now?"
  description="What's run so far is kept; the rest is marked as skipped."
  size="sm"
>
  <div class="row">
    <Button onclick={() => (confirmEnd = false)}>Keep going</Button>
    <Button
      variant="danger"
      onclick={() => {
        confirmEnd = false;
        push('end', {}, transitionId(events, 'end', 0));
      }}>End session</Button
    >
  </div>
</Sheet>

<style>
  .runner {
    display: flex;
    flex-direction: column;
    min-height: 100dvh;
    background: var(--bg);
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
  .exit {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: var(--r-full);
    color: var(--text);
  }
  .exit:hover {
    background: var(--surface-2);
  }
  .exit :global(svg) {
    width: 22px;
    height: 22px;
  }
  .bt {
    line-height: 1.25;
  }
  .bt .subtle {
    font-size: var(--t-12);
  }
  .toggles {
    flex: none;
    display: flex;
    gap: 2px;
  }
  .tg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 44px;
    height: 44px;
    padding: 0 var(--s-2);
    border: 0;
    border-radius: var(--r-full);
    background: transparent;
    color: var(--text-2);
    font-size: var(--t-12);
    font-weight: 700;
  }
  .tg[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .tg :global(svg) {
    flex: none;
    width: 20px;
    height: 20px;
  }
  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-4);
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: var(--s-6) var(--s-4) calc(var(--s-8) + var(--safe-b));
    text-align: center;
  }
  .sk {
    width: min(70vw, 320px);
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--surface-2);
  }
  .idle h1 {
    font-size: var(--t-32);
  }
  .first {
    width: 100%;
    padding: var(--s-4);
    text-align: left;
  }
  .live {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: var(--s-4) var(--s-4) calc(var(--s-8) + var(--safe-b));
  }
  .clock-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-4);
  }
  .step {
    font-size: var(--t-14);
    font-weight: 700;
    color: var(--text-2);
  }
  .controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
    width: 100%;
    max-width: 420px;
  }
  .controls :global(.btn) {
    width: 100%;
    min-height: 56px;
  }
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    min-width: 0;
  }
  .detail > :global(.btn) {
    align-self: flex-start;
  }
  .now-title {
    font-size: clamp(1.75rem, 7vw, 3rem);
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }
  .next-title {
    font-size: var(--t-20);
    font-weight: 700;
  }
  .lanes {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .lanes li {
    display: flex;
    flex-direction: column;
  }
  .lane {
    font-size: var(--t-12);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .lt {
    font-weight: 700;
    font-size: var(--t-16);
  }
  .lanes.split {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--s-3);
  }
  .lanes.split li {
    padding: var(--s-3);
    border-radius: var(--r-md);
    border: 1px solid var(--border);
    background: var(--surface);
    text-align: left;
  }
  .lanes.split li.mine {
    border: 2px solid var(--accent);
    background: var(--accent-softer);
  }
  .lanes.split li.done {
    opacity: 1;
    background: var(--surface-2);
  }
  .lanes.split .lt {
    font-size: clamp(1.15rem, 4.2vw, 1.6rem);
  }
  .you {
    color: var(--accent-text);
  }
  .coach {
    color: var(--text-3);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
  }
  .lc {
    margin-top: var(--s-1);
    font-size: var(--t-14);
    font-weight: 700;
    color: var(--text-2);
  }
  .lanes.big .lt {
    font-size: clamp(1.4rem, 5.5vw, 2.25rem);
    font-weight: 800;
    line-height: 1.15;
  }
  .rounds {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--s-2);
  }
  .rounds li {
    display: flex;
    flex-direction: column;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .rounds b {
    font-size: var(--t-12);
    color: var(--text-2);
  }
  .notes {
    padding: var(--s-2) var(--s-3);
    border-left: 3px solid var(--accent);
    background: var(--surface-2);
    border-radius: 0 var(--r-md) var(--r-md) 0;
  }
  .cp-h {
    font-size: var(--t-16);
    margin-top: var(--s-2);
  }
  .cp {
    margin: 0;
    padding-left: var(--s-5);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: var(--t-16);
  }
  .dg-sk {
    height: 240px;
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .next {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-1);
    padding: var(--s-4);
    margin-top: var(--s-2);
  }
  .paused .clock-col {
    opacity: 0.92;
  }
  .done {
    justify-content: flex-start;
  }
  .sum {
    width: 100%;
    padding: var(--s-2) var(--s-4);
    text-align: left;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--t-14);
  }
  th,
  td {
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--border);
    text-align: left;
    font-weight: 500;
  }
  thead th {
    font-size: var(--t-12);
    font-weight: 700;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  tbody th {
    font-weight: 650;
    padding-right: var(--s-3);
  }
  .n {
    text-align: right;
    white-space: nowrap;
    padding-left: var(--s-3);
  }
  tr.skipped th,
  tr.skipped td {
    color: var(--text-3);
  }
  tbody tr:last-child th,
  tbody tr:last-child td {
    border-bottom: 0;
  }
  @media (min-width: 900px) {
    .live {
      display: grid;
      grid-template-columns: minmax(340px, 1fr) minmax(0, 1.1fr);
      align-items: start;
      gap: var(--s-10);
      padding-top: var(--s-8);
    }
    .clock-col {
      position: sticky;
      top: 96px;
    }
  }
</style>
