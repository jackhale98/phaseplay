<script lang="ts">
  import Loader from '#lib/components/Loader.svelte';
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { replaceState } from '$app/navigation';
  import {
    EVENT_CATEGORY_LABELS,
    dateInTz,
    isProposal,
    type EventCategory,
    type TeamEvent,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import {
    events,
    myRsvp,
    needMyAnswer,
    optionsOf,
    past,
    proposals,
    upcoming,
  } from '#lib/data/selectors';
  import ProposalCard from '#lib/features/schedule/ProposalCard.svelte';
  import EventCard from '#lib/components/EventCard.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Button from '#lib/components/Button.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import { tzName } from '#lib/format';
  import { IconCalendarPlus, IconHelp, IconPlus, IconSearch, IconX } from '#lib/icons';
  import EventForm from '#lib/features/schedule/EventForm.svelte';
  import CategoryTabs from '#lib/features/schedule/CategoryTabs.svelte';
  import MonthView from '#lib/features/schedule/MonthView.svelte';
  import { pendingDeletes } from '#lib/features/schedule/actions.svelte';
  import {
    countByCategory,
    groupByWeek,
    matches,
    monthOf,
    parseShow,
    type Show,
  } from '#lib/features/schedule/schedule';

  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const staff = $derived(app.can('events.manage'));
  const params = page.url.searchParams;

  let show = $state<Show>(parseShow(params.get('show')));
  let when = $state<'upcoming' | 'past'>(params.get('when') === 'past' ? 'past' : 'upcoming');
  let view = $state<'agenda' | 'month'>(params.get('view') === 'month' ? 'month' : 'agenda');
  let q = $state(params.get('q') ?? '');
  let month = $state(monthOf(dateInTz(Date.now(), app.snap?.team.timezone ?? 'UTC')));
  let formOpen = $state(false);
  let formCategory = $state<EventCategory | null>(null);
  let wide = $state(false);

  onMount(() => {
    const mq = matchMedia('(min-width: 1200px)');
    wide = mq.matches;
    const on = () => (wide = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  let wantNew = !!params.get('new');
  $effect(() => {
    if (wantNew && staff) {
      wantNew = false;
      openForm(null);
    }
  });

  // Keep the filters in the URL so they survive reloads and can be linked.
  $effect(() => {
    const u = new URL(location.href);
    const set = (k: string, val: string | null) =>
      val ? u.searchParams.set(k, val) : u.searchParams.delete(k);
    set('show', show === 'all' ? null : show);
    set('when', when === 'past' ? 'past' : null);
    set('view', view === 'month' ? 'month' : null);
    set('q', q.trim() || null);
    u.searchParams.delete('new');
    if (u.href !== location.href) {
      try {
        replaceState(u, page.state);
      } catch {
        history.replaceState(history.state, '', u);
      }
    }
  });

  const visible = (list: ReturnType<typeof events>) =>
    list.filter((e) => !pendingDeletes.hidden(e.id));
  const byStart = (a: TeamEvent, b: TeamEvent) => a.startsAt - b.startsAt;
  // Proposals ("Not confirmed yet") sit on their earliest date among what's coming up.
  const open = $derived(visible(proposals(s)));
  const all = $derived(visible([...events(s), ...open].sort(byStart)));
  const base = $derived(
    visible(when === 'upcoming' ? [...upcoming(s), ...open].sort(byStart) : past(s)),
  );
  const ask = $derived(visible(needMyAnswer(s)));
  const tentative = $derived(
    open
      .filter((e) => matches(e, show, q))
      .flatMap((e) => {
        const opts = optionsOf(s, e.id);
        return opts.map((o) => ({
          key: o.id,
          event: e,
          startsAt: o.startsAt,
          poll: opts.length > 1,
        }));
      }),
  );

  /** "N need your answer": show the agenda with everything, then move to the first one. */
  async function jumpToAsk() {
    const first = ask[0];
    if (!first) return;
    show = 'all';
    q = '';
    when = 'upcoming';
    view = 'agenda';
    await tick();
    const el = document.getElementById(`p-${first.id}`);
    el?.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    // Straight to the first answer button, so keyboard users land where they can answer.
    el?.querySelector<HTMLElement>('.body button')?.focus({ preventScroll: true });
  }
  const monthMode = $derived(wide && view === 'month');
  const counts = $derived(countByCategory(monthMode ? all : base, q));
  const list = $derived(base.filter((e) => matches(e, show, q)));
  const groups = $derived(groupByWeek(list, tz));
  const monthList = $derived(all.filter((e) => !isProposal(e) && matches(e, show, q)));

  function openForm(c: EventCategory | null) {
    formCategory = c;
    formOpen = true;
  }
  const noun = $derived(show === 'all' ? 'events' : EVENT_CATEGORY_LABELS[show].toLowerCase());
</script>

<svelte:head><title>Schedule · {s?.team.shortName ?? 'Phaseplay'}</title></svelte:head>

<div class="page">
  <header class="page-head">
    <div>
      <h1>Schedule</h1>
      <p class="muted">Times in {tzName(tz)} · {tz.replace(/_/g, ' ')}</p>
    </div>
    {#if staff}
      <Button variant="primary" onclick={() => openForm(null)}>
        {#snippet icon()}<IconPlus />{/snippet}Add to schedule
      </Button>
    {/if}
  </header>

  {#if !s}
    <Loader label="Loading the schedule" />
  {:else if !all.length}
    <EmptyState
      title={staff ? 'Add your first training' : 'Nothing scheduled yet'}
      body={staff
        ? 'Set up a weekly practice, a game or a club social. Your squad can reply straight away.'
        : "When your coach adds practices, games and events, they'll show up here."}
    >
      {#snippet icon()}<IconCalendarPlus />{/snippet}
      {#snippet action()}
        {#if staff}
          <Button variant="primary" onclick={() => openForm('practices')}
            >Add your first training</Button
          >
        {/if}
      {/snippet}
    </EmptyState>
  {:else}
    <div class="tools">
      <CategoryTabs value={show} {counts} onchange={(v) => (show = v)} />
      <div class="row wrap toggles">
        {#if !monthMode}
          <Segmented
            label="When"
            bind:value={when}
            options={[
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'past', label: 'Past' },
            ]}
          />
        {/if}
        {#if wide}
          <Segmented
            label="View"
            bind:value={view}
            options={[
              { value: 'agenda', label: 'Agenda' },
              { value: 'month', label: 'Month' },
            ]}
          />
        {/if}
      </div>
      <label class="search">
        <span class="sr-only">Search the schedule</span>
        <IconSearch />
        <input
          type="search"
          bind:value={q}
          placeholder="Search by title, opponent or place"
          autocomplete="off"
        />
        {#if q}
          <button type="button" class="clr" aria-label="Clear search" onclick={() => (q = '')}
            ><IconX /></button
          >
        {/if}
      </label>
    </div>

    {#if ask.length}
      <button type="button" class="ask" onclick={jumpToAsk}>
        <IconHelp />
        <span class="grow"
          ><strong>{ask.length} need{ask.length === 1 ? 's' : ''} your answer</strong>
          <small>Not confirmed yet: tell the coaches if you can make it</small></span
        >
      </button>
    {/if}

    <p class="sr-only" aria-live="polite">
      {monthMode ? monthList.length : list.length}
      {noun} shown
    </p>

    {#if monthMode}
      <MonthView events={monthList} {tentative} {tz} bind:month teamShort={s.team.shortName} />
    {:else if !list.length}
      <div class="none">
        <p>
          <strong
            >No {noun}
            {when === 'upcoming' ? 'coming up' : 'in the past'}{q
              ? ` matching “${q}”`
              : ''}.</strong
          >
        </p>
        <div class="row wrap">
          {#if q || show !== 'all'}
            <Button size="sm" onclick={() => ((q = ''), (show = 'all'))}>Show everything</Button>
          {/if}
          {#if staff && when === 'upcoming'}
            <Button
              size="sm"
              variant="primary"
              onclick={() => openForm(show === 'all' ? null : show)}
            >
              {#snippet icon()}<IconPlus />{/snippet}Add {show === 'games'
                ? 'a game'
                : show === 'practices'
                  ? 'a practice'
                  : 'an event'}
            </Button>
          {/if}
        </div>
      </div>
    {:else}
      {#each groups as g (g.label)}
        <section aria-labelledby="wk-{g.label.replace(/\W+/g, '-')}">
          <h2 class="section-title" id="wk-{g.label.replace(/\W+/g, '-')}">
            {g.label} <span class="subtle">{g.events.length}</span>
          </h2>
          <ul class="list stack">
            {#each g.events as e (e.id)}
              <li>
                {#if isProposal(e)}
                  <ProposalCard event={e} anchor />
                {:else}
                  <EventCard
                    event={e}
                    {tz}
                    counts={s.rows.counts[e.id]}
                    myStatus={myRsvp(s, e.id)}
                    memberId={when === 'upcoming' ? s.me.id : null}
                    teamShort={s.team.shortName}
                  />
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  {/if}
</div>

{#if staff}
  <EventForm bind:open={formOpen} category={formCategory} />
{/if}

<style>
  .page-head p {
    margin-top: var(--s-1);
    font-size: var(--t-14);
  }
  .tools {
    display: grid;
    grid-template-areas: 'tabs' 'search' 'toggles';
    gap: var(--s-3);
    margin-bottom: var(--s-2);
  }
  .tools > :global(:first-child) {
    grid-area: tabs;
  }
  .toggles {
    grid-area: toggles;
    gap: var(--s-2) var(--s-3);
  }
  .search {
    grid-area: search;
    position: relative;
    display: flex;
    align-items: center;
    min-width: min(100%, 240px);
  }
  .search > :global(svg) {
    position: absolute;
    left: 12px;
    width: 18px;
    height: 18px;
    color: var(--text-3);
    pointer-events: none;
  }
  .search input {
    width: 100%;
    min-height: 44px;
    padding: 0 44px 0 40px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-size: var(--t-16);
  }
  .search input::-webkit-search-cancel-button {
    display: none;
  }
  .search input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .clr {
    position: absolute;
    right: 2px;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--text-2);
  }
  .clr :global(svg) {
    width: 16px;
    height: 16px;
  }
  .ask {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    min-height: 52px;
    margin: var(--s-2) 0 var(--s-1);
    padding: var(--s-2) var(--s-4);
    border: 1.5px dashed var(--tent-line);
    border-radius: var(--r-lg);
    background: var(--tent-fill);
    color: var(--text);
    text-align: left;
  }
  .ask:hover {
    background: var(--surface-2);
  }
  .ask > :global(svg) {
    width: 20px;
    height: 20px;
    flex: none;
    color: var(--info);
  }
  .ask small {
    display: block;
    font-size: var(--t-12);
    color: var(--text-2);
  }
  .none {
    display: grid;
    gap: var(--s-3);
    justify-items: start;
    margin-top: var(--s-6);
    padding: var(--s-6);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-lg);
    background: var(--surface-sunken);
  }
  section .stack {
    gap: var(--s-3);
  }
  @media (min-width: 1200px) {
    .tools {
      grid-template-areas: 'tabs toggles' 'search search';
      grid-template-columns: minmax(0, 620px) 1fr;
      align-items: center;
    }
    .toggles {
      justify-content: flex-end;
    }
  }
</style>
