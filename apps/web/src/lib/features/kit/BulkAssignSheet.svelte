<!--
  Desktop bulk assign (PLAN.md M9): give several items out at once. "Give them all to" fills every
  row and rows can still be changed one by one. Each move is the usual per-item assign mutation.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { InventoryItem } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Button from '#lib/components/Button.svelte';
  import { app } from '#lib/data/app.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import MemberOptions from './MemberOptions.svelte';
  import { itemLabel, memberChoices, whereIs } from './meta';
  import { moveItem } from './actions';

  type Props = {
    open: boolean;
    /** The selected items (all assignable: available or with someone). */
    items: InventoryItem[];
    ondone?: () => void;
  };
  let { open = $bindable(false), items, ondone }: Props = $props();

  const uid = `ba-${Math.random().toString(36).slice(2, 8)}`;
  let everyone = $state('');
  let to = $state<Record<string, string>>({});
  let error = $state<string | null>(null);
  let busy = $state(false);

  const choices = $derived(memberChoices(app.snap));
  const has = (i: InventoryItem, m: string) =>
    i.status === 'with_someone' && i.holderMemberId === m;
  const moves = $derived(items.filter((i) => to[i.id] && !has(i, to[i.id]!)));
  const plural = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

  $effect(() => {
    if (!open) return;
    untrack(() => {
      everyone = '';
      to = {};
      error = null;
      busy = false;
    });
  });

  function fillAll(id: string) {
    everyone = id;
    to = Object.fromEntries(items.map((i) => [i.id, id]));
    error = null;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    const list = moves.map((i) => ({ item: i, memberId: to[i.id]! }));
    if (!list.length) {
      error = items.some((i) => to[i.id])
        ? 'They already have all of these.'
        : 'Pick someone for at least one item.';
      return;
    }
    busy = true;
    try {
      // Queued one by one, in order: the outbox sends them and reports any that fail.
      for (const { item, memberId } of list) await moveItem(item, 'assign', { memberId });
    } finally {
      busy = false;
    }
    toasts.success(`Assigned ${plural(list.length)}`);
    open = false;
    ondone?.();
  }
</script>

<Sheet
  bind:open
  title="Assign {plural(items.length)}"
  description="Pick one person for everything, then change any row. Kit already with them is skipped."
  size="md"
>
  <form id="{uid}-f" class="stack" onsubmit={submit} novalidate>
    <div class="all">
      <label for="{uid}-all">Give them all to</label>
      <select id="{uid}-all" value={everyone} onchange={(e) => fillAll(e.currentTarget.value)}>
        <option value="">Choose…</option>
        <MemberOptions {choices} />
      </select>
    </div>
    <ul class="rows" aria-label="Selected kit">
      {#each items as i (i.id)}
        {@const pick = to[i.id] ?? ''}
        <li>
          <span class="what">
            <label for="{uid}-{i.id}">{itemLabel(i)}</label>
            <small id="{uid}-{i.id}-d"
              >{whereIs(app.snap, i)}{#if pick && has(i, pick)}<span class="skip"
                  >&nbsp;· already with them, skipped</span
                >{/if}</small
            >
          </span>
          <select
            id="{uid}-{i.id}"
            aria-describedby="{uid}-{i.id}-d"
            value={pick}
            onchange={(e) => {
              to[i.id] = e.currentTarget.value;
              error = null;
            }}
          >
            <option value="">Leave as is</option>
            <MemberOptions {choices} />
          </select>
        </li>
      {/each}
    </ul>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button type="submit" form="{uid}-f" variant="primary" loading={busy}
      >Assign {plural(moves.length)}</Button
    >
  {/snippet}
</Sheet>

<style>
  .all {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: var(--s-4);
    border-bottom: 1px solid var(--border);
  }
  label {
    font-size: var(--t-14);
    font-weight: 650;
  }
  select {
    min-height: 44px;
    padding: 0 var(--s-3);
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
  }
  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rows li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 220px);
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--border);
  }
  .rows li:last-child {
    border-bottom: 0;
  }
  .what {
    min-width: 0;
  }
  .what label {
    display: block;
    font-weight: 600;
  }
  small {
    display: block;
    color: var(--text-2);
    font-size: var(--t-14);
  }
  .skip {
    color: var(--text-2);
    font-style: italic;
  }
  .err {
    color: var(--danger);
    font-weight: 600;
    font-size: var(--t-14);
  }
</style>
