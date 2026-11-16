<!-- Time off: one tap on a reason stops the clock. Reasons are never linked to a player. -->
<script lang="ts">
  import { formatClock, STOPPAGE_LABELS, STOPPAGE_REASONS } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import { buzz } from '#lib/haptics';
  import type { RecCtx } from './ctx';

  type Props = { open: boolean; at: number; ctx: RecCtx };
  let { open = $bindable(), at, ctx }: Props = $props();

  async function stop(reason: (typeof STOPPAGE_REASONS)[number]) {
    await ctx.session.record({ kind: 'time_off', reason }, at);
    buzz();
    ctx.announce(
      `Time off, ${STOPPAGE_LABELS[reason].toLowerCase()}. Clock stopped at ${formatClock(at - ctx.offset)}`,
    );
    open = false;
  }
</script>

<Sheet
  bind:open
  title="Time off"
  description="Clock stops at {formatClock(at - ctx.offset)}"
  size="sm"
>
  <div class="reasons">
    {#each STOPPAGE_REASONS as r (r)}
      <button type="button" class="rb" onclick={() => stop(r)}>{STOPPAGE_LABELS[r]}</button>
    {/each}
  </div>
  <p class="subtle note">Only the reason and length are kept. Never who was involved.</p>
</Sheet>

<style>
  .reasons {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
  }
  .rb {
    min-height: 72px;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface-2);
    font-weight: 700;
  }
  .rb:hover {
    background: var(--surface-3);
  }
  .note {
    margin-top: var(--s-3);
  }
</style>
