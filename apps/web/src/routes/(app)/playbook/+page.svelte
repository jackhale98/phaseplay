<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    CONTACT_LABELS,
    CONTACT_LEVELS,
    DRILL_CATEGORIES,
    DRILL_CATEGORY_LABELS,
    PLAY_CATEGORIES,
    PLAY_CATEGORY_LABELS,
    can,
    type ContactLevel,
    type DrillCategory,
    type PlayCategory,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { activeMembers } from '#lib/data/selectors';
  import Segmented from '#lib/components/Segmented.svelte';
  import Chip from '#lib/components/Chip.svelte';
  import Button from '#lib/components/Button.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import { IconPlus, IconSearch, IconPlaybook, IconDrill } from '#lib/icons';
  import PlayCard from '#lib/features/plays/PlayCard.svelte';
  import DrillCard from '#lib/features/drills/DrillCard.svelte';
  import NewPlaySheet from '#lib/features/plays/NewPlaySheet.svelte';
  import NewDrillSheet from '#lib/features/drills/NewDrillSheet.svelte';
  import { hidden } from '#lib/features/plays/actions.svelte';
  import {
    DURATION_BANDS,
    matchDrill,
    matchPlay,
    type DurationBand,
  } from '#lib/features/drills/meta';

  type Tab = 'plays' | 'drills';
  const s = $derived(app.snap);
  const coach = $derived(can(app.role, 'plays.manage'));
  const drillCoach = $derived(can(app.role, 'drills.manage'));
  let tab = $state<Tab>(page.url.searchParams.get('tab') === 'drills' ? 'drills' : 'plays');
  let q = $state('');
  let playCat = $state<PlayCategory | 'all'>('all');
  let drillCat = $state<DrillCategory | 'all'>('all');
  let contact = $state<ContactLevel | 'all'>('all');
  let players = $state<number | null>(null);
  let duration = $state<DurationBand>('all');
  let newPlay = $state(false);
  let newDrill = $state(false);

  $effect(() => {
    const want = tab === 'drills' ? 'drills' : null;
    const now = page.url.searchParams.get('tab');
    if (want !== now) {
      const u = new URL(page.url.href);
      if (want) u.searchParams.set('tab', want);
      else u.searchParams.delete('tab');
      void goto(`${u.pathname}${u.search}`, { replace: true, shallow: true });
    }
  });

  const playerCount = $derived(activeMembers(s).filter((m) => m.role === 'player').length);
  const allPlays = $derived(
    Object.values(s?.rows.plays ?? {})
      .filter((p) => !p.deletedAt && !hidden.has(p.id))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  );
  const plays = $derived(
    allPlays.filter(
      (p) =>
        (playCat === 'all' || p.category === playCat) &&
        matchPlay(p, q, PLAY_CATEGORY_LABELS[p.category]),
    ),
  );
  const playCats = $derived(PLAY_CATEGORIES.filter((c) => allPlays.some((p) => p.category === c)));
  const allDrills = $derived(
    Object.values(s?.rows.drills ?? {})
      .filter((d) => !d.deletedAt && !hidden.has(d.id))
      .sort((a, b) =>
        a.source === b.source ? a.title.localeCompare(b.title) : a.source === 'team' ? -1 : 1,
      ),
  );
  const drills = $derived(
    allDrills.filter((d) => matchDrill(d, { q, category: drillCat, contact, players, duration })),
  );
  const drillCats = $derived(
    DRILL_CATEGORIES.filter((c) => allDrills.some((d) => d.category === c)),
  );
  const filtered = $derived(
    tab === 'plays'
      ? q !== '' || playCat !== 'all'
      : q !== '' || drillCat !== 'all' || contact !== 'all' || !!players || duration !== 'all',
  );
  function clear() {
    q = '';
    playCat = 'all';
    drillCat = 'all';
    contact = 'all';
    players = null;
    duration = 'all';
  }
</script>

<svelte:head><title>Playbook · {s?.team.shortName ?? ''}</title></svelte:head>

<div class="page">
  <header class="page-head">
    <div>
      <h1>Playbook</h1>
      <p class="muted">
        {tab === 'plays'
          ? `${allPlays.length} play${allPlays.length === 1 ? '' : 's'}`
          : `${allDrills.length} drill${allDrills.length === 1 ? '' : 's'}`}
      </p>
    </div>
    {#if tab === 'plays' && coach}
      <Button variant="primary" onclick={() => (newPlay = true)}
        >{#snippet icon()}<IconPlus />{/snippet}New play</Button
      >
    {:else if tab === 'drills' && drillCoach}
      <Button variant="primary" onclick={() => (newDrill = true)}
        >{#snippet icon()}<IconPlus />{/snippet}New drill</Button
      >
    {/if}
  </header>

  <div class="toolbar">
    <Segmented
      label="Show"
      bind:value={tab}
      options={[
        { value: 'plays', label: 'Plays' },
        { value: 'drills', label: 'Drills' },
      ]}
    />
    <label class="search">
      <IconSearch />
      <span class="sr-only">Search {tab}</span>
      <input
        type="search"
        bind:value={q}
        placeholder={tab === 'plays' ? 'Search plays or #tags' : 'Search drills'}
        autocomplete="off"
      />
    </label>
  </div>

  {#if tab === 'plays'}
    {#if playCats.length > 1}
      <div class="chips" role="group" aria-label="Category">
        <Chip selected={playCat === 'all'} onclick={() => (playCat = 'all')}>All</Chip>
        {#each playCats as c (c)}
          <Chip selected={playCat === c} onclick={() => (playCat = playCat === c ? 'all' : c)}
            >{PLAY_CATEGORY_LABELS[c]}</Chip
          >
        {/each}
      </div>
    {/if}
    {#if plays.length}
      <ul class="grid list" aria-label="Plays">
        {#each plays as p (p.id)}<li><PlayCard meta={p} {coach} players={playerCount} /></li>{/each}
      </ul>
    {:else if filtered}
      <EmptyState title="No plays match" body="Try a different search or category.">
        {#snippet action()}<Button onclick={clear}>Clear filters</Button>{/snippet}
      </EmptyState>
    {:else}
      <EmptyState
        title={coach ? 'Draw your first play' : 'No plays shared yet'}
        body={coach
          ? 'Start from a lineout or scrum preset and animate it frame by frame.'
          : "When your coaches share plays they'll show up here."}
      >
        {#snippet icon()}<IconPlaybook />{/snippet}
        {#snippet action()}{#if coach}<Button variant="primary" onclick={() => (newPlay = true)}
              >New play</Button
            >{/if}{/snippet}
      </EmptyState>
    {/if}
  {:else}
    {#if drillCats.length > 1}
      <div class="chips" role="group" aria-label="Category">
        <Chip selected={drillCat === 'all'} onclick={() => (drillCat = 'all')}>All</Chip>
        {#each drillCats as c (c)}
          <Chip selected={drillCat === c} onclick={() => (drillCat = drillCat === c ? 'all' : c)}
            >{DRILL_CATEGORY_LABELS[c]}</Chip
          >
        {/each}
      </div>
    {/if}
    <div class="filters">
      <label>
        <span>Contact</span>
        <select bind:value={contact}>
          <option value="all">Any contact</option>
          {#each CONTACT_LEVELS as c (c)}<option value={c}>{CONTACT_LABELS[c]}</option>{/each}
        </select>
      </label>
      <label>
        <span>Players</span>
        <input
          type="number"
          inputmode="numeric"
          min="1"
          max="80"
          placeholder="Any"
          value={players ?? ''}
          oninput={(e) => {
            const n = parseInt(e.currentTarget.value, 10);
            players = Number.isFinite(n) && n > 0 ? n : null;
          }}
        />
      </label>
      <label>
        <span>Duration</span>
        <select bind:value={duration}>
          {#each DURATION_BANDS as b (b.value)}<option value={b.value}>{b.label}</option>{/each}
        </select>
      </label>
    </div>
    {#if drills.length}
      <ul class="grid list" aria-label="Drills">
        {#each drills as d (d.id)}<li><DrillCard drill={d} coach={drillCoach} /></li>{/each}
      </ul>
    {:else if filtered}
      <EmptyState title="No drills match" body="Loosen a filter or try another search.">
        {#snippet action()}<Button onclick={clear}>Clear filters</Button>{/snippet}
      </EmptyState>
    {:else}
      <EmptyState
        title="No drills yet"
        body={drillCoach
          ? 'Start from a template: grids, tackle boxes, overloads and more.'
          : "Your coaches haven't shared any drills yet."}
      >
        {#snippet icon()}<IconDrill />{/snippet}
        {#snippet action()}{#if drillCoach}<Button
              variant="primary"
              onclick={() => (newDrill = true)}>New drill</Button
            >{/if}{/snippet}
      </EmptyState>
    {/if}
  {/if}
</div>

{#if coach}<NewPlaySheet bind:open={newPlay} />{/if}
{#if drillCoach}<NewDrillSheet bind:open={newDrill} />{/if}

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3);
    align-items: center;
  }
  .search {
    flex: 1 1 220px;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 44px;
    padding: 0 var(--s-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-full);
    background: var(--surface);
  }
  .search:focus-within {
    outline: 3px solid color-mix(in srgb, var(--accent) 70%, var(--text));
    outline-offset: 2px;
  }
  .search :global(svg) {
    width: 18px;
    height: 18px;
    color: var(--text-3);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    font-size: var(--t-16);
    height: 42px;
    outline: none;
  }
  .chips {
    display: flex;
    gap: var(--s-2);
    overflow-x: auto;
    padding: var(--s-4) 2px 2px;
    margin: 0 -2px;
    scrollbar-width: none;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3);
    margin-top: var(--s-3);
  }
  .filters label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--t-12);
    font-weight: 650;
    color: var(--text-2);
    flex: 1 1 120px;
    max-width: 220px;
  }
  .filters select,
  .filters input {
    min-height: 44px;
    padding: 8px 10px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-size: var(--t-16);
    color: var(--text);
    font-weight: 400;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--s-4);
    margin-top: var(--s-5);
  }
  .grid > li {
    display: flex;
  }
  .grid > li > :global(*) {
    flex: 1;
  }
  @media (max-width: 520px) {
    .grid {
      grid-template-columns: 1fr 1fr;
      gap: var(--s-3);
    }
  }
</style>
