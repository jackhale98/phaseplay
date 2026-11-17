<!-- One-tap RSVP (PLAN.md M2: ≤ 2 taps from Home). -->
<script lang="ts">
  import type { RsvpStatus } from '@phaseplay/shared';
  import { setRsvp } from '#lib/data/actions';
  import { IconCheck, IconX, IconHelp } from '#lib/icons';

  type Props = {
    eventId: string;
    memberId: string;
    status: RsvpStatus | null;
    size?: 'md' | 'lg';
    disabled?: boolean;
    label?: string;
  };
  let {
    eventId,
    memberId,
    status,
    size = 'md',
    disabled = false,
    label = 'Are you in?',
  }: Props = $props();
  const opts: { v: RsvpStatus; t: string }[] = [
    { v: 'yes', t: 'In' },
    { v: 'maybe', t: 'Maybe' },
    { v: 'no', t: 'Out' },
  ];
</script>

<div class="rsvp {size}" role="group" aria-label={label}>
  {#each opts as o (o.v)}
    <button
      type="button"
      class={o.v}
      aria-pressed={status === o.v}
      {disabled}
      onclick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (status !== o.v) void setRsvp(eventId, memberId, o.v);
      }}
    >
      {#if o.v === 'yes'}<IconCheck />{:else if o.v === 'no'}<IconX />{:else}<IconHelp />{/if}
      <span>{o.t}</span>
    </button>
  {/each}
</div>

<style>
  .rsvp {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s-2);
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-weight: 700;
    font-size: var(--t-14);
    color: var(--text-2);
    transition: all var(--m-fast) var(--ease);
  }
  .lg button {
    min-height: 52px;
    font-size: var(--t-16);
  }
  button :global(svg) {
    width: 18px;
    height: 18px;
  }
  button:active {
    transform: scale(0.97);
  }
  /* Chosen answer: a solid status fill with --on-sel text (white in light, ink in dark), never a
     tint, so it is obvious in both themes; the icon keeps it from relying on colour alone. */
  .yes[aria-pressed='true'] {
    --st: var(--ok);
  }
  .maybe[aria-pressed='true'] {
    --st: var(--warn);
  }
  .no[aria-pressed='true'] {
    --st: var(--danger);
  }
  [aria-pressed='true'] {
    background: var(--st);
    border-color: var(--st);
    color: var(--on-sel);
  }
</style>
