<!-- Club kit (PLAN.md M9): phone list grouped by status or holder; desktop sortable, filterable table. -->
<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import {
    ITEM_CONDITION_LABELS,
    ITEM_KINDS,
    ITEM_KIND_LABELS,
    ITEM_STATUSES,
    ITEM_STATUS_LABELS,
    type InventoryItem,
    type ItemKind,
    type ItemStatus,
  } from '@phaseplay/shared';
  import IconPackage from '@lucide/svelte/icons/package';
  import { app } from '#lib/data/app.svelte';
  import { heldBy, kitItems, memberName, handoffFor } from '#lib/data/selectors';
  import Button from '#lib/components/Button.svelte';
  import Loader from '#lib/components/Loader.svelte';
  import Chip from '#lib/components/Chip.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ItemForm from '#lib/features/kit/ItemForm.svelte';
  import HandoffBanner from '#lib/features/kit/HandoffBanner.svelte';
  import { STATUS_TONE, itemLabel, whereIs } from '#lib/features/kit/meta';
  import { IconPlus, IconChevronRight, IconWarn } from '#lib/icons';

  const s = $derived(app.snap);
  const manage = $derived(app.can('inventory.manage'));
  const wide = new MediaQuery('min-width: 900px');
  const all = $derived(kitItems(s));
  const mine = $derived(heldBy(s, s?.me.id));
  const inService = $derived(all.filter((i) => i.status !== 'retired'));
  const counts = $derived({
    store: all.filter((i) => i.status === 'available').length,
    out: all.filter((i) => i.status === 'with_someone').length,
    lost: all.filter((i) => i.status === 'lost').length,
    repair: inService.filter((i) => i.condition === 'needs_repair').length,
  });

  let addOpen = $state(false);

  /* ------------------------------ Phone: grouped ----------------------------- */
  let groupBy = $state<'status' | 'holder'>('status');
  type Group = { key: string; title: string; items: InventoryItem[]; warn?: boolean };
  const groups = $derived.by((): Group[] => {
    if (groupBy === 'status')
      return (['with_someone', 'available', 'lost'] as ItemStatus[])
        .map((st) => ({
          key: st,
          title: ITEM_STATUS_LABELS[st],
          items: all.filter((i) => i.status === st),
          warn: st === 'lost',
        }))
        .filter((g) => g.items.length);
    // Kit check: what needs attention first, then by holder, then the store.
    const attention = inService.filter(
      (i) => i.status === 'lost' || i.condition === 'needs_repair',
    );
    const byHolder: Record<string, InventoryItem[]> = {};
    for (const i of all)
      if (i.status === 'with_someone' && i.holderMemberId)
        (byHolder[i.holderMemberId] ??= []).push(i);
    return [
      { key: 'attention', title: 'Lost or needs repair', items: attention, warn: true },
      ...Object.entries(byHolder)
        .map(([id, items]) => ({ key: id, title: memberName(s, id), items }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      {
        key: 'store',
        title: 'In the store',
        items: all.filter((i) => i.status === 'available'),
      },
    ].filter((g) => g.items.length);
  });
  const retired = $derived(all.filter((i) => i.status === 'retired'));

  /* ------------------------------ Desktop: table ----------------------------- */
  let fKind = $state<ItemKind | ''>('');
  let fStatus = $state<ItemStatus | 'service' | ''>('service');
  let fHolder = $state('');
  type SortKey = 'name' | 'kind' | 'status' | 'where' | 'condition';
  let sortKey = $state<SortKey>('kind');
  let sortDir = $state<1 | -1>(1);
  const holders = $derived(
    [...new Set(all.map((i) => i.holderMemberId).filter((x): x is string => !!x))]
      .map((id) => ({ id, name: memberName(s, id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const sortVal = (i: InventoryItem, k: SortKey): string | number =>
    k === 'name'
      ? i.name.toLowerCase()
      : k === 'kind'
        ? ITEM_KIND_LABELS[i.kind]
        : k === 'status'
          ? ITEM_STATUSES.indexOf(i.status)
          : k === 'condition'
            ? ['good', 'worn', 'needs_repair'].indexOf(i.condition)
            : whereIs(s, i).toLowerCase();
  const rows = $derived(
    all
      .filter((i) => !fKind || i.kind === fKind)
      .filter((i) =>
        fStatus === 'service' ? i.status !== 'retired' : !fStatus || i.status === fStatus,
      )
      .filter((i) => !fHolder || i.holderMemberId === fHolder)
      .sort((a, b) => {
        const x = sortVal(a, sortKey);
        const y = sortVal(b, sortKey);
        return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * sortDir;
      }),
  );
  function sortBy(k: SortKey) {
    if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1;
    else {
      sortKey = k;
      sortDir = 1;
    }
  }
  const ariaSort = (k: SortKey) =>
    sortKey === k ? (sortDir === 1 ? 'ascending' : 'descending') : 'none';
  const COLS: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Item' },
    { key: 'kind', label: 'Kind' },
    { key: 'status', label: 'Status' },
    { key: 'where', label: 'Where' },
    { key: 'condition', label: 'Condition' },
  ];
</script>

<svelte:head><title>Kit · {s?.team.shortName ?? 'Phaseplay'}</title></svelte:head>

<div class="page">
  <header class="page-head">
    <div>
      <p class="eyebrow">{s?.team.name ?? ''}</p>
      <h1>Kit</h1>
    </div>
    {#if manage}
      <Button variant="primary" onclick={() => (addOpen = true)}
        >{#snippet icon()}<IconPlus />{/snippet}Add kit</Button
      >
    {/if}
  </header>

  <HandoffBanner />

  {#if !s}
    <Loader label="Loading the kit" />
  {:else if !all.length}
    <EmptyState
      title={manage ? 'Log your first kit' : 'No kit logged yet'}
      body={manage
        ? 'Add the balls, tackle shields and bibs, and see who has what before every session.'
        : 'When your kit manager logs the club kit, you’ll see who has what here.'}
    >
      {#snippet icon()}<IconPackage />{/snippet}
      {#snippet action()}
        {#if manage}<Button variant="primary" onclick={() => (addOpen = true)}>Add kit</Button>{/if}
      {/snippet}
    </EmptyState>
  {:else}
    <ul class="list summary" aria-label="Kit at a glance">
      <li><strong class="tnum">{counts.store}</strong> in the store</li>
      <li><strong class="tnum">{counts.out}</strong> out with people</li>
      {#if counts.lost}<li class="bad"><strong class="tnum">{counts.lost}</strong> lost</li>{/if}
      {#if counts.repair}<li class="bad">
          <strong class="tnum">{counts.repair}</strong> need repair
        </li>{/if}
    </ul>

    {#if mine.length}
      <section aria-labelledby="mine-h">
        <h2 id="mine-h" class="section-title">With you</h2>
        <ul class="list card items">
          {#each mine as i (i.id)}
            <li>
              <a href="/kit/{i.id}">
                <span class="grow"
                  ><strong>{itemLabel(i)}</strong><small
                    >{handoffFor(s, i.id)
                      ? 'Handover waiting for an answer'
                      : (i.home ?? '')}</small
                  ></span
                >
                <IconChevronRight />
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if !wide.current}
      <div class="row group-by">
        <span class="lbl" id="gb-l">Group by</span>
        <Segmented
          label="Group by"
          size="sm"
          bind:value={groupBy}
          options={[
            { value: 'status', label: 'Status' },
            { value: 'holder', label: 'Holder' },
          ]}
        />
      </div>
      {#each groups as g (g.key)}
        <section aria-labelledby="g-{g.key}">
          <h2 id="g-{g.key}" class="section-title" class:warn={g.warn}>
            <span
              >{#if g.warn}<IconWarn />{/if}{g.title}</span
            >
            <span class="subtle tnum">{g.items.length}</span>
          </h2>
          <ul class="list card items">
            {#each g.items as i (i.id)}
              <li>
                <a href="/kit/{i.id}">
                  <span class="grow">
                    <strong>{itemLabel(i)}</strong>
                    <small
                      >{groupBy === 'holder' && g.key !== 'attention'
                        ? ITEM_KIND_LABELS[i.kind]
                        : whereIs(s, i)}{#if i.condition !== 'good'}
                        · {ITEM_CONDITION_LABELS[i.condition]}{/if}{#if i.tag}
                        · {i.tag}{/if}</small
                    >
                  </span>
                  <IconChevronRight />
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
      {#if retired.length}
        <p class="subtle retired">
          {retired.length} retired {retired.length === 1 ? 'item' : 'items'} kept for the history.
        </p>
      {/if}
    {:else}
      <div class="filters row wrap" role="group" aria-label="Filter kit">
        <label
          >Kind
          <select bind:value={fKind}>
            <option value="">All kinds</option>
            {#each ITEM_KINDS as k (k)}<option value={k}>{ITEM_KIND_LABELS[k]}</option>{/each}
          </select>
        </label>
        <label
          >Status
          <select bind:value={fStatus}>
            <option value="service">In service</option>
            <option value="">Everything</option>
            {#each ITEM_STATUSES as st (st)}<option value={st}>{ITEM_STATUS_LABELS[st]}</option
              >{/each}
          </select>
        </label>
        <label
          >Holder
          <select bind:value={fHolder}>
            <option value="">Anyone</option>
            {#each holders as h (h.id)}<option value={h.id}>{h.name}</option>{/each}
          </select>
        </label>
        <span class="subtle grow count" role="status">{rows.length} shown</span>
      </div>
      <div class="card tw">
        <table>
          <caption class="sr-only">Club kit, sortable by each column</caption>
          <thead>
            <tr>
              {#each COLS as col (col.key)}
                <th scope="col" aria-sort={ariaSort(col.key)}>
                  <button type="button" onclick={() => sortBy(col.key)}
                    >{col.label}<span aria-hidden="true" class="arrow"
                      >{sortKey === col.key ? (sortDir === 1 ? '▲' : '▼') : ''}</span
                    ></button
                  >
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as i (i.id)}
              <tr>
                <th scope="row">
                  <a href="/kit/{i.id}">{itemLabel(i)}</a>
                  {#if i.tag}<small class="tag">{i.tag}</small>{/if}
                </th>
                <td>{ITEM_KIND_LABELS[i.kind]}</td>
                <td>
                  <Chip tone={STATUS_TONE[i.status]}>{ITEM_STATUS_LABELS[i.status]}</Chip>
                </td>
                <td>{whereIs(s, i)}</td>
                <td class:bad={i.condition === 'needs_repair'}
                  >{ITEM_CONDITION_LABELS[i.condition]}</td
                >
              </tr>
            {:else}
              <tr><td colspan="5" class="none">Nothing matches those filters.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

{#if manage}<ItemForm bind:open={addOpen} />{/if}

<style>
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .summary li {
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
    font-size: var(--t-14);
  }
  .summary .bad,
  .bad {
    color: var(--danger);
    font-weight: 600;
  }
  .summary .bad {
    background: var(--danger-soft);
  }
  .group-by {
    margin-top: var(--s-5);
    justify-content: space-between;
  }
  .lbl {
    font-weight: 600;
    font-size: var(--t-14);
  }
  .section-title.warn {
    color: var(--danger);
  }
  .section-title span {
    display: inline-flex;
    gap: var(--s-2);
    align-items: center;
  }
  .section-title :global(svg) {
    width: 16px;
    height: 16px;
  }
  .items {
    overflow: hidden;
  }
  .items a {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 56px;
    padding: var(--s-2) var(--s-4);
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px solid var(--border);
  }
  .items li:last-child a {
    border-bottom: 0;
  }
  .items a:hover {
    background: var(--surface-2);
  }
  .items small {
    display: block;
    color: var(--text-2);
    font-size: var(--t-14);
  }
  .items :global(svg) {
    width: 18px;
    height: 18px;
    color: var(--text-3);
    flex: none;
  }
  .retired {
    margin-top: var(--s-4);
  }
  .filters {
    margin: var(--s-6) 0 var(--s-3);
    gap: var(--s-4);
  }
  .filters label {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-weight: 600;
    font-size: var(--t-14);
  }
  .filters select {
    min-height: 40px;
    padding: 0 var(--s-3);
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-weight: 400;
  }
  .count {
    text-align: right;
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
    text-align: left;
    padding: var(--s-2) var(--s-4);
    border-bottom: 1px solid var(--border);
  }
  tbody tr:last-child > * {
    border-bottom: 0;
  }
  thead th {
    padding: 0;
  }
  thead button {
    width: 100%;
    min-height: 44px;
    padding: 0 var(--s-4);
    display: flex;
    align-items: center;
    gap: var(--s-1);
    border: 0;
    background: none;
    font-weight: 700;
    text-align: left;
    color: var(--text-2);
  }
  thead button:hover {
    color: var(--text);
  }
  .arrow {
    font-size: 10px;
  }
  tbody th {
    font-weight: 600;
  }
  tbody th a {
    color: var(--text);
  }
  .tag {
    margin-left: var(--s-2);
    color: var(--text-3);
    font-weight: 400;
  }
  .none {
    text-align: center;
    padding: var(--s-6);
    color: var(--text-2);
  }
</style>
