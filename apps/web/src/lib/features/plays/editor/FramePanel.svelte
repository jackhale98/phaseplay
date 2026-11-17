<!-- Frame properties: caption (or step instructions for drills), duration, reorder, duplicate, delete. -->
<script lang="ts">
  import type { Play } from '@phaseplay/shared';
  import { duplicateFrame } from '@phaseplay/diagram/presets';
  import Button from '#lib/components/Button.svelte';
  import { IconCopy, IconTrash, IconChevronLeft, IconChevronRight } from '#lib/icons';
  import { deleteFrame, moveFrame, setCaption, setDuration } from '../ops';

  type Props = {
    play: Play;
    fi: number;
    apply: (fn: (p: Play) => Play, label: string) => void;
    select: (fi: number) => void;
  };
  let { play, fi, apply, select }: Props = $props();
  const f = $derived(play.frames[fi]);
  const drill = $derived(play.mode === 'drill');
  const uid = `fp-${Math.random().toString(36).slice(2, 7)}`;
</script>

{#if f}
  <div class="fp">
    <h3>Frame {fi + 1} of {play.frames.length}{fi === 0 ? ' · start' : ''}</h3>
    <label for="{uid}-c">{drill ? 'Step instructions' : 'Caption'}</label>
    <textarea
      id="{uid}-c"
      rows="2"
      maxlength="280"
      placeholder={drill
        ? 'e.g. Pass left, follow your pass'
        : 'e.g. 9 to 10, 12 hits the short line'}
      value={f.caption ?? ''}
      onchange={(e) => {
        const v = e.currentTarget.value;
        apply((p) => setCaption(p, fi, v.trim()), 'Caption');
      }}></textarea>
    {#if fi > 0}
      <label for="{uid}-d">Duration (seconds)</label>
      <input
        id="{uid}-d"
        type="number"
        min="0.2"
        max="30"
        step="0.1"
        value={(f.durationMs / 1000).toFixed(1)}
        onchange={(e) => {
          const s = Number(e.currentTarget.value);
          if (Number.isFinite(s)) apply((p) => setDuration(p, fi, s * 1000), 'Duration');
        }}
      />
    {:else}
      <p class="subtle">The starting formation. Move tokens here to set where everyone begins.</p>
    {/if}
    <div class="acts">
      {#if fi > 1}
        <Button
          size="sm"
          variant="quiet"
          aria-label="Move frame earlier"
          onclick={() => {
            apply((p) => moveFrame(p, fi, -1), 'Reorder');
            select(fi - 1);
          }}
        >
          {#snippet icon()}<IconChevronLeft />{/snippet}Earlier
        </Button>
      {/if}
      {#if fi > 0 && fi < play.frames.length - 1}
        <Button
          size="sm"
          variant="quiet"
          aria-label="Move frame later"
          onclick={() => {
            apply((p) => moveFrame(p, fi, 1), 'Reorder');
            select(fi + 1);
          }}
        >
          {#snippet icon()}<IconChevronRight />{/snippet}Later
        </Button>
      {/if}
      <Button
        size="sm"
        onclick={() => {
          apply((p) => duplicateFrame(p, fi), 'Duplicate frame');
          select(fi + 1);
        }}
      >
        {#snippet icon()}<IconCopy />{/snippet}Duplicate
      </Button>
      {#if play.frames.length > 1}
        <Button
          size="sm"
          variant="danger"
          onclick={() => {
            apply((p) => deleteFrame(p, fi), 'Delete frame');
            select(Math.max(0, fi - 1));
          }}
        >
          {#snippet icon()}<IconTrash />{/snippet}Delete frame
        </Button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .fp {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  h3 {
    font-size: var(--t-16);
    margin: 0 0 var(--s-1);
  }
  label {
    font-size: var(--t-14);
    font-weight: 600;
    color: var(--text-2);
  }
  textarea,
  input {
    width: 100%;
    min-height: 44px;
    padding: 8px 10px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-size: var(--t-16);
    resize: vertical;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-top: var(--s-2);
  }
</style>
