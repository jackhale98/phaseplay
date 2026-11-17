<!-- Pick who gets an item: a staff assign (immediate) or a handover (they accept first). -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { InventoryItem } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import Button from '#lib/components/Button.svelte';
  import { app } from '#lib/data/app.svelte';
  import { activeMembers } from '#lib/data/selectors';
  import { itemLabel, itemPhrase } from './meta';
  import { moveItem, offerItem } from './actions';
  import { toasts } from '#lib/stores/toast.svelte';

  type Props = {
    open: boolean;
    item: InventoryItem | undefined;
    /** `assign` gives it now (kit managers); `handover` asks them to accept. */
    mode: 'assign' | 'handover';
    /** Members to suggest first, e.g. those going to the next session. */
    suggest?: string[];
  };
  let { open = $bindable(false), item, mode, suggest = [] }: Props = $props();

  let to = $state('');
  let note = $state('');
  let error = $state<string | null>(null);

  const people = $derived(
    // A handover needs someone who can sign in and accept it.
    activeMembers(app.snap).filter(
      (m) => m.id !== item?.holderMemberId && (mode === 'assign' || m.userId !== null),
    ),
  );
  const first = $derived(people.filter((m) => suggest.includes(m.id)));
  const rest = $derived(people.filter((m) => !suggest.includes(m.id)));

  $effect(() => {
    if (!open) return;
    untrack(() => {
      to = '';
      note = '';
      error = null;
    });
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!item) return;
    if (!to) {
      error = 'Pick someone';
      return;
    }
    const who = people.find((m) => m.id === to)?.displayName ?? 'them';
    if (mode === 'assign') {
      await moveItem(item, 'assign', { memberId: to, note: note.trim() || null });
      toasts.success(`${itemLabel(item)} is with ${who}`);
    } else {
      await offerItem(item, to, note.trim() || null);
      toasts.success(`Asked ${who} to take the ${itemPhrase(item)}`);
    }
    open = false;
  }
</script>

<Sheet
  bind:open
  title={mode === 'assign' ? 'Give it to' : 'Hand it over'}
  description={mode === 'handover'
    ? "They'll get a request to accept. Until then, it stays with its holder."
    : undefined}
  size="sm"
>
  <form class="stack" onsubmit={submit} novalidate>
    <Field label="Teammate" {error}>
      {#snippet children({ id, describedby })}
        <select {id} aria-describedby={describedby} bind:value={to}>
          <option value="" disabled>Choose…</option>
          {#if first.length}
            <optgroup label="Going to the next session">
              {#each first as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
            </optgroup>
            <optgroup label="Everyone else">
              {#each rest as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
            </optgroup>
          {:else}
            {#each rest as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
          {/if}
        </select>
      {/snippet}
    </Field>
    <Field label="Message" hint="Optional. About the kit only, nothing about anyone's health.">
      {#snippet children({ id, describedby })}<input
          {id}
          aria-describedby={describedby}
          bind:value={note}
          maxlength="140"
          placeholder={mode === 'handover' ? 'Can you bring these on Tuesday?' : ''}
        />{/snippet}
    </Field>
    <Button type="submit" variant="primary" block
      >{mode === 'assign' ? 'Give it to them' : 'Send request'}</Button
    >
  </form>
</Sheet>
