<!-- One item: details, who has it, actions and its history. `/kit/<tag>` (QR labels) opens it too. -->
<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    ITEM_CONDITION_LABELS,
    ITEM_KIND_LABELS,
    ITEM_STATUS_LABELS,
    type InventoryEvent,
  } from '@phaseplay/shared';
  import IconPackage from '@lucide/svelte/icons/package';
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import { handoffFor, kitItems, memberName } from '#lib/data/selectors';
  import Button from '#lib/components/Button.svelte';
  import Loader from '#lib/components/Loader.svelte';
  import Chip from '#lib/components/Chip.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import ItemForm from '#lib/features/kit/ItemForm.svelte';
  import GiveSheet from '#lib/features/kit/GiveSheet.svelte';
  import HandoffBanner from '#lib/features/kit/HandoffBanner.svelte';
  import {
    STATUS_TONE,
    describeEvent,
    itemLabel,
    itemPhrase,
    whereIs,
  } from '#lib/features/kit/meta';
  import { answerHandoff, deleteItem, moveItem, splitItem } from '#lib/features/kit/actions';
  import { toasts } from '#lib/stores/toast.svelte';
  import { ago, dateTime } from '#lib/format';
  import { IconBack, IconEdit, IconTrash } from '#lib/icons';

  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const key = $derived(page.params.id ?? '');
  // An id, or a club asset tag from a printed QR label.
  const item = $derived(
    s?.rows.items?.[key] ??
      kitItems(s).find((i) => i.tag && i.tag.toLowerCase() === key.toLowerCase()),
  );
  const me = $derived(s?.me.id);
  const manage = $derived(app.can('inventory.manage'));
  const mine = $derived(!!item && item.status === 'with_someone' && item.holderMemberId === me);
  const handoff = $derived(item ? handoffFor(s, item.id) : undefined);
  const canCancel = $derived(
    !!handoff && (manage || handoff.fromMemberId === me) && handoff.toMemberId !== me,
  );
  const live = $derived(item && (item.status === 'available' || item.status === 'with_someone'));

  let editOpen = $state(false);
  let give = $state<'assign' | 'handover' | null>(null);
  let giveOpen = $state(false);
  let splitOpen = $state(false);
  let retireOpen = $state(false);
  let take = $state(1);

  function openGive(mode: 'assign' | 'handover') {
    give = mode;
    giveOpen = true;
  }

  /* --------------------------------- History --------------------------------- */
  let events = $state<InventoryEvent[] | null>(null);
  let historyError = $state<string | null>(null);
  const itemId = $derived(item?.id);
  const stamp = $derived(item ? `${item.updatedAt}:${handoff?.id ?? ''}` : '');
  $effect(() => {
    if (!itemId || !stamp) return;
    const ctl = new AbortController();
    historyError = null;
    api<{ events: InventoryEvent[] }>(teamPath(`/inventory/${itemId}/history`), {
      signal: ctl.signal,
    })
      .then((r) => (events = r.events.slice().reverse()))
      .catch((e) => {
        if ((e as Error).name === 'AbortError') return;
        historyError =
          e instanceof ApiError && e.code === 'network'
            ? 'The history needs a connection.'
            : 'Couldn’t load the history.';
      });
    return () => ctl.abort();
  });

  async function act(move: 'assign' | 'return' | 'lost' | 'found' | 'retire', done: string) {
    if (!item) return;
    await moveItem(item, move, { memberId: null });
    toasts.success(done);
  }
  async function split(e: SubmitEvent) {
    e.preventDefault();
    if (!item) return;
    const id = await splitItem(item, Number(take));
    if (!id) return;
    splitOpen = false;
    toasts.success(`Split ${take} off into a new item`);
  }
  async function remove() {
    if (!item) return;
    await deleteItem(item);
    await goto('/kit');
  }
</script>

<svelte:head><title>{item ? itemLabel(item) : 'Kit'} · Phaseplay</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/kit"><IconBack /> Kit</a>
  <HandoffBanner />

  {#if !s}
    <Loader label="Loading the kit" />
  {:else if !item}
    <EmptyState
      title="Not in your team's kit"
      body="It may have been removed, or the label belongs to another club."
    >
      {#snippet icon()}<IconPackage />{/snippet}
      {#snippet action()}<Button href="/kit" variant="primary">All kit</Button>{/snippet}
    </EmptyState>
  {:else}
    <header class="head">
      <p class="eyebrow">{ITEM_KIND_LABELS[item.kind]}{item.tag ? ` · ${item.tag}` : ''}</p>
      <h1>{itemLabel(item)}</h1>
      <div class="row wrap chips">
        <Chip tone={STATUS_TONE[item.status]}>{ITEM_STATUS_LABELS[item.status]}</Chip>
        <Chip tone={item.condition === 'needs_repair' ? 'danger' : 'default'}
          >{ITEM_CONDITION_LABELS[item.condition]}</Chip
        >
        {#if item.matchDay}<Chip tone="accent">Match-day kit</Chip>{/if}
      </div>
    </header>

    <section class="card pad" aria-labelledby="where-h">
      <h2 id="where-h" class="h">Where it is</h2>
      <p class="where">
        {#if mine}<strong>With you</strong>{:else}<strong>{whereIs(s, item)}</strong>{/if}
        {#if item.home && item.status !== 'available'}<span class="muted">
            Lives in {item.home}</span
          >{/if}
      </p>
      {#if handoff}
        <p class="pending" role="status">
          {handoff.toMemberId === me
            ? 'Waiting for you to accept.'
            : `Waiting for ${memberName(s, handoff.toMemberId)} to accept.`}
          {#if handoff.queued}Your answer is waiting to send.{/if}
        </p>
        {#if canCancel && !handoff.queued}
          <div class="row wrap">
            {#if manage}
              <Button
                size="sm"
                onclick={() => answerHandoff(handoff!, 'accept', `Completing the handover`)}
                >Complete the handover</Button
              >
            {/if}
            <Button
              size="sm"
              variant="ghost"
              onclick={() => answerHandoff(handoff!, 'decline', `Cancelling the handover`)}
              >Cancel the request</Button
            >
          </div>
        {/if}
      {/if}
      {#if item.notes}<p class="notes"><span class="sr-only">Note: </span>{item.notes}</p>{/if}
    </section>

    {#if live && (mine || manage)}
      <section class="acts" aria-label="Actions">
        {#if item.status === 'with_someone' && !handoff}
          <Button variant="primary" onclick={() => openGive('handover')}>Hand over</Button>
        {/if}
        {#if manage}
          <Button
            variant={item.status === 'available' ? 'primary' : 'secondary'}
            onclick={() => openGive('assign')}
            >{item.status === 'available'
              ? 'Give it to someone'
              : 'Give it to someone else'}</Button
          >
        {/if}
        {#if mine}
          <Button
            onclick={() => act('return', `Back in the store${item.home ? `: ${item.home}` : ''}`)}
            >I've returned it</Button
          >
        {:else if manage && item.status === 'with_someone'}
          <Button onclick={() => act('return', 'Taken back to the store')}>Take it back</Button>
        {/if}
        <Button onclick={() => act('lost', `Marked the ${itemPhrase(item)} lost`)}>Mark lost</Button
        >
        {#if manage && item.quantity > 1}
          <Button
            onclick={() => {
              take = Math.floor(item!.quantity / 2);
              splitOpen = true;
            }}>Split the set</Button
          >
        {/if}
      </section>
    {/if}
    {#if manage}
      <section class="acts" aria-label="Manage">
        {#if item.status === 'lost'}
          <Button variant="primary" onclick={() => act('found', 'Found, back in the store')}
            >Found it</Button
          >
        {/if}
        <Button onclick={() => (editOpen = true)}
          >{#snippet icon()}<IconEdit />{/snippet}Edit</Button
        >
        {#if item.status !== 'retired'}
          <Button onclick={() => (retireOpen = true)}>Retire</Button>
        {/if}
        <Button variant="ghost" onclick={remove}
          >{#snippet icon()}<IconTrash />{/snippet}Delete</Button
        >
      </section>
    {/if}

    <section aria-labelledby="hist-h">
      <h2 id="hist-h" class="section-title">History</h2>
      {#if historyError}
        <p class="muted">{historyError}</p>
      {:else if !events}
        <Loader label="Loading the history" size={56} />
      {:else}
        <ol class="list card hist">
          {#each events as e (e.id)}
            <li>
              <span class="grow"
                >{describeEvent(s, e)}{#if e.note}<small class="note">“{e.note}”</small>{/if}</span
              >
              <time
                class="subtle"
                datetime={new Date(e.at).toISOString()}
                title={dateTime(e.at, tz)}>{ago(e.at)}</time
              >
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}
</div>

{#if item}
  {#if manage}<ItemForm bind:open={editOpen} {item} />{/if}
  {#if give}<GiveSheet bind:open={giveOpen} {item} mode={give} />{/if}
  <Sheet bind:open={splitOpen} title="Split the set" size="sm">
    <form class="stack" onsubmit={split} novalidate>
      <p class="muted">
        Part of the {itemPhrase(item)} going somewhere else? Split it off into its own item.
      </p>
      <Field label="How many to split off" hint="Between 1 and {item.quantity - 1}">
        {#snippet children({ id, describedby })}<input
            {id}
            aria-describedby={describedby}
            type="number"
            inputmode="numeric"
            min="1"
            max={item!.quantity - 1}
            bind:value={take}
          />{/snippet}
      </Field>
      <Button type="submit" variant="primary" block>Split</Button>
    </form>
  </Sheet>
  <Sheet bind:open={retireOpen} title="Retire this kit?" size="sm">
    <div class="stack">
      <p class="muted">
        Retired kit drops out of the counts and flags but keeps its history. This can't be undone.
      </p>
      <Button
        variant="danger"
        block
        onclick={async () => {
          retireOpen = false;
          await act('retire', `Retired the ${itemPhrase(item!)}`);
        }}>Retire it</Button
      >
    </div>
  </Sheet>
{/if}

<style>
  .narrow {
    max-width: 760px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    color: var(--text-2);
    text-decoration: none;
    font-weight: 600;
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
  }
  .head {
    margin: var(--s-2) 0 var(--s-4);
  }
  .chips {
    margin-top: var(--s-2);
    gap: var(--s-2);
  }
  .pad {
    padding: var(--s-4) var(--s-5);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .h {
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .where {
    display: flex;
    flex-direction: column;
    font-size: var(--t-20);
  }
  .where .muted {
    font-size: var(--t-14);
  }
  .pending {
    color: var(--info);
    font-weight: 600;
  }
  .notes {
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
    font-size: var(--t-14);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-top: var(--s-4);
  }
  .hist li {
    display: flex;
    gap: var(--s-3);
    align-items: baseline;
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid var(--border);
  }
  .hist li:last-child {
    border-bottom: 0;
  }
  .note {
    display: block;
    color: var(--text-2);
    font-size: var(--t-14);
  }
  time {
    flex: none;
  }
</style>
