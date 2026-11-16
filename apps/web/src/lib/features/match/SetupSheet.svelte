<!--
  Quick override of halves, sin bin and replacements before kick-off. Saved on the event's match
  settings (synced), so every device derives the same clock.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { RULES, type MatchSettings, type TeamEvent } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Button from '#lib/components/Button.svelte';
  import Chip from '#lib/components/Chip.svelte';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import { toasts } from '#lib/stores/toast.svelte';
  import { IconMinus, IconPlus } from '#lib/icons';
  import type { MatchConfig } from '@phaseplay/shared';

  type Props = { open: boolean; event: TeamEvent; cfg: MatchConfig };
  let { open = $bindable(), event, cfg }: Props = $props();

  let half = $state(40);
  let sinBin = $state(10);
  let reps = $state(8);

  $effect(() => {
    if (open)
      untrack(() => {
        half = Math.round(cfg.halfMs / 60e3);
        sinBin = Math.round(cfg.sinBinMs / 60e3);
        reps = cfg.replacements;
      });
  });

  const r = $derived(RULES[cfg.format]);
  const presets = $derived(
    cfg.format === '7s'
      ? [
          { m: r.halfMinutes, label: `${r.halfMinutes} min` },
          { m: r.finalHalfMinutes, label: `${r.finalHalfMinutes} min (final)` },
        ]
      : [40, 35, 30, 25, 20].map((m) => ({ m, label: `${m} min` })),
  );
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  async function save() {
    const settings: MatchSettings = {
      ...(event.settings ?? {}),
      halfMinutes: clamp(half, 1, 60),
      sinBinMinutes: clamp(sinBin, 1, 20),
      replacements: clamp(reps, 0, 12),
    };
    await app.mutate({
      method: 'PATCH',
      path: teamPath(`/events/${event.id}`),
      body: { settings },
      label: 'Match settings',
      versionOf: { entity: 'events', id: event.id },
      optimistic: [{ op: 'patch', entity: 'events', key: event.id, value: { settings } }],
    });
    toasts.success(`${half} minute halves set`);
    open = false;
  }
</script>

{#snippet stepper(
  label: string,
  value: number,
  set: (v: number) => void,
  lo: number,
  hi: number,
  unit: string,
)}
  <div class="step">
    <span class="sl" id="st-{label.replace(/\s+/g, '-')}">{label}</span>
    <div class="ctl" role="group" aria-labelledby="st-{label.replace(/\s+/g, '-')}">
      <button
        type="button"
        aria-label="Less {label.toLowerCase()}"
        disabled={value <= lo}
        onclick={() => set(value - 1)}><IconMinus /></button
      >
      <output class="tnum" aria-live="polite">{value}{unit}</output>
      <button
        type="button"
        aria-label="More {label.toLowerCase()}"
        disabled={value >= hi}
        onclick={() => set(value + 1)}><IconPlus /></button
      >
    </div>
  </div>
{/snippet}

<Sheet
  bind:open
  title="Match settings"
  description="Set before kick-off. Everyone recording sees the same clock."
  size="sm"
>
  <div class="stack">
    <div class="chips" role="group" aria-label="Half length presets">
      {#each presets as p (p.label)}
        <Chip selected={half === p.m} onclick={() => (half = p.m)}>{p.label}</Chip>
      {/each}
    </div>
    {@render stepper('Half length', half, (v) => (half = v), 1, 60, ' min')}
    {@render stepper('Sin bin', sinBin, (v) => (sinBin = v), 1, 20, ' min')}
    {@render stepper('Replacements', reps, (v) => (reps = v), 0, 12, '')}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" onclick={save}>Save</Button>
  {/snippet}
</Sheet>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .step {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .sl {
    font-weight: 650;
  }
  .ctl {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .ctl button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    background: var(--surface);
  }
  .ctl button:disabled {
    opacity: 0.4;
  }
  .ctl :global(svg) {
    width: 18px;
    height: 18px;
  }
  output {
    min-width: 72px;
    text-align: center;
    font-weight: 750;
    font-size: var(--t-20);
  }
</style>
