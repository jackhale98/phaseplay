<!-- Add or edit a piece of club kit (details only; holder and status change through actions). -->
<script lang="ts">
  import { untrack } from 'svelte';
  import * as v from 'valibot';
  import {
    ITEM_CONDITIONS,
    ITEM_CONDITION_LABELS,
    ITEM_KINDS,
    ITEM_KIND_LABELS,
    InventoryItemInput,
    type InventoryItem,
    type ItemCondition,
    type ItemKind,
  } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import Button from '#lib/components/Button.svelte';
  import { kitItems } from '#lib/data/selectors';
  import { app } from '#lib/data/app.svelte';
  import { saveItem } from './actions';

  type Props = { open: boolean; item?: InventoryItem; onsaved?: (id: string) => void };
  let { open = $bindable(false), item, onsaved }: Props = $props();

  let kind = $state<ItemKind>('balls');
  let name = $state('');
  let tag = $state('');
  let quantity = $state(1);
  let condition = $state<ItemCondition>('good');
  let home = $state('');
  let notes = $state('');
  let matchDay = $state(false);
  let errors = $state<Record<string, string>>({});
  let nameTouched = false;

  $effect(() => {
    if (!open) return;
    untrack(() => {
      kind = item?.kind ?? 'balls';
      name = item?.name ?? '';
      nameTouched = !!item;
      tag = item?.tag ?? '';
      quantity = item?.quantity ?? 1;
      condition = item?.condition ?? 'good';
      home = item?.home ?? '';
      notes = item?.notes ?? '';
      matchDay = item?.matchDay ?? false;
      errors = {};
    });
  });

  // Suggest a name from the kind until the user types one.
  function pickKind() {
    if (!nameTouched) name = kind === 'other' ? '' : ITEM_KIND_LABELS[kind];
    if (!nameTouched) matchDay = ['flags', 'kicking_tees', 'first_aid_kit'].includes(kind);
  }

  function save(e: SubmitEvent) {
    e.preventDefault();
    const r = v.safeParse(InventoryItemInput, {
      kind,
      name,
      tag: tag.trim() || null,
      quantity: Number(quantity),
      condition,
      home: home.trim() || null,
      notes: notes.trim() || null,
      matchDay,
    });
    if (!r.success) {
      errors = Object.fromEntries(
        r.issues.map((i) => [String(i.path?.[0]?.key ?? 'name'), i.message]),
      );
      return;
    }
    const t = r.output.tag?.toLowerCase();
    if (t && kitItems(app.snap).some((x) => x.id !== item?.id && x.tag?.toLowerCase() === t)) {
      errors = { tag: 'Another item already has that tag' };
      return;
    }
    void saveItem(r.output, item).then((id) => onsaved?.(id));
    open = false;
  }
</script>

<Sheet bind:open title={item ? 'Edit kit' : 'Add kit'} size="md">
  <form class="stack" onsubmit={save} novalidate>
    <div class="two">
      <Field label="Kind">
        {#snippet children({ id })}
          <select {id} bind:value={kind} onchange={pickKind}>
            {#each ITEM_KINDS as k (k)}<option value={k}>{ITEM_KIND_LABELS[k]}</option>{/each}
          </select>
        {/snippet}
      </Field>
      <Field label="How many" hint="More than 1 makes it a set" error={errors.quantity}>
        {#snippet children({ id, describedby })}<input
            {id}
            aria-describedby={describedby}
            type="number"
            inputmode="numeric"
            min="1"
            max="500"
            bind:value={quantity}
          />{/snippet}
      </Field>
    </div>
    <Field label="Name" hint="e.g. Bibs, red" error={errors.name}>
      {#snippet children({ id, describedby })}<input
          {id}
          aria-describedby={describedby}
          bind:value={name}
          oninput={() => (nameTouched = true)}
          maxlength="60"
          required
        />{/snippet}
    </Field>
    <div class="two">
      <Field label="Asset tag" hint="Optional, e.g. SH-04" error={errors.tag}>
        {#snippet children({ id, describedby })}<input
            {id}
            aria-describedby={describedby}
            bind:value={tag}
            maxlength="24"
            autocomplete="off"
            autocapitalize="characters"
          />{/snippet}
      </Field>
      <Field label="Condition">
        {#snippet children({ id })}
          <select {id} bind:value={condition}>
            {#each ITEM_CONDITIONS as c (c)}<option value={c}>{ITEM_CONDITION_LABELS[c]}</option
              >{/each}
          </select>
        {/snippet}
      </Field>
    </div>
    <Field label="Lives in" hint="Where it goes when nobody has it" error={errors.home}>
      {#snippet children({ id, describedby })}<input
          {id}
          aria-describedby={describedby}
          bind:value={home}
          maxlength="60"
          placeholder="Shed, clubhouse cage…"
        />{/snippet}
    </Field>
    <Field
      label="Note for kit managers"
      hint="About the kit only. Don't write anything about anyone's health or injuries."
      error={errors.notes}
    >
      {#snippet children({ id, describedby })}<textarea
          {id}
          aria-describedby={describedby}
          bind:value={notes}
          maxlength="140"
          rows="2"></textarea>{/snippet}
    </Field>
    <label class="check">
      <input type="checkbox" bind:checked={matchDay} />
      <span><strong>Match-day kit</strong><small>On the game-day checklist</small></span>
    </label>
    <Button type="submit" variant="primary" block>{item ? 'Save changes' : 'Add kit'}</Button>
  </form>
</Sheet>

<style>
  .two {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--s-3);
    align-items: start;
  }
  .check {
    display: flex;
    gap: var(--s-3);
    align-items: center;
    min-height: 44px;
  }
  .check input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
  .check span {
    display: flex;
    flex-direction: column;
  }
  .check small {
    color: var(--text-3);
    font-size: var(--t-12);
  }
</style>
