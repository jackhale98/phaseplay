<!-- Fix an entry's time or player (appends an `edit`), or remove it (appends a `void`, with undo). -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { formatClock, type MatchEvent } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Button from '#lib/components/Button.svelte';
  import Field from '#lib/components/Field.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { IconTrash } from '#lib/icons';
  import PlayerPicker from './PlayerPicker.svelte';
  import { describe, playerField } from './lineup';
  import { parseClock } from './log';
  import type { RecCtx } from './ctx';

  type Props = { open: boolean; entry: MatchEvent | null; ctx: RecCtx };
  let { open = $bindable(), entry, ctx }: Props = $props();

  let time = $state('');
  let player = $state<string | null>(null);
  let touched = $state(false);

  // Reset only when the sheet opens on an entry, not on every clock tick (ctx changes 4×/s).
  $effect(() => {
    if (open && entry) {
      const e = entry;
      untrack(() => {
        time = formatClock(e.gameMs - ctx.offset);
        player = (e.payload as { playerId?: string | null }).playerId ?? null;
        touched = false;
      });
    }
  });

  const d = $derived(
    entry
      ? describe(entry, {
          snap: ctx.snap,
          opponent: ctx.opponent,
          tournament: ctx.tournament,
          log: ctx.state.log,
        })
      : null,
  );
  const field = $derived(entry ? playerField(entry) : null);
  const parsed = $derived(parseClock(time));
  const error = $derived(
    touched && parsed === null ? 'Use minutes and seconds, like 23:05' : undefined,
  );
  const pool = $derived([...new Set([...ctx.lineup.starters, ...ctx.lineup.bench])]);

  async function save() {
    touched = true;
    if (!entry || parsed === null) return;
    const gameMs = parsed + ctx.offset;
    const patch: Record<string, unknown> = {};
    const before = (entry.payload as { playerId?: string | null }).playerId ?? null;
    if (field && player !== before) patch.playerId = player;
    const moved = gameMs !== entry.gameMs;
    if (!moved && !Object.keys(patch).length) return void (open = false);
    await ctx.session.edit(entry, {
      ...(moved ? { gameMs } : {}),
      ...(Object.keys(patch).length ? { patch } : {}),
    });
    ctx.announce(`${d?.title ?? 'Entry'} updated`);
    open = false;
  }

  async function remove() {
    if (!entry) return;
    const target = entry;
    await ctx.session.remove(target);
    open = false;
    toasts.undo(`Removed: ${d?.title ?? 'entry'}`, () => void ctx.session.restore(target));
  }
</script>

<Sheet bind:open title="Edit {d?.title ?? 'entry'}" description={d?.detail} size="md">
  {#if entry}
    <form
      class="stack"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Game time" {error} hint="Minutes and seconds on the game clock">
        {#snippet children({ id, describedby })}
          <input
            {id}
            aria-describedby={describedby}
            class="input tnum"
            inputmode="numeric"
            autocomplete="off"
            bind:value={time}
            onblur={() => (touched = true)}
          />
        {/snippet}
      </Field>
      {#if field}
        <PlayerPicker
          ids={pool}
          shirt={ctx.lineup.shirt}
          snap={ctx.snap}
          label="Player"
          bind:value={player}
        />
      {/if}
      <button type="submit" hidden>Save</button>
    </form>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={remove}>
      {#snippet icon()}<IconTrash />{/snippet}Remove
    </Button>
    <span class="grow"></span>
    <Button variant="primary" onclick={save}>Save changes</Button>
  {/snippet}
</Sheet>

<style>
  .input {
    width: 100%;
    max-width: 200px;
    min-height: 48px;
    padding: 0 var(--s-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    font-size: var(--t-20);
    font-weight: 700;
  }
</style>
