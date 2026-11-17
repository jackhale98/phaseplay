<script lang="ts">
  import { shownTemplate } from '#lib/features/plays/templates';
  import { goto } from '$app/navigation';
  import {
    PLAY_CATEGORIES,
    PLAY_CATEGORY_LABELS,
    uuidv7,
    type PlayCategory,
    type View,
  } from '@phaseplay/shared';
  import { PRESETS, newPlay, type PresetId } from '@phaseplay/diagram/presets';
  import { app } from '#lib/data/app.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import Button from '#lib/components/Button.svelte';
  import { createPlay } from './actions.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  type Start = PresetId | 'blank';
  let title = $state('');
  let start = $state<Start>('lineout5');
  let format = $state<'15s' | '7s' | 'any'>(app.team?.defaultFormat ?? '15s');
  let view = $state<View>('half');
  let category = $state<PlayCategory>('lineout');
  let touched = $state(false);
  let busy = $state(false);

  const VIEWS: { value: View; label: string }[] = [
    { value: 'full', label: 'Full pitch' },
    { value: 'half', label: 'Half pitch' },
    { value: 'attack22', label: 'Attacking 22' },
    { value: 'lineout', label: 'Lineout' },
    { value: 'scrum', label: 'Scrum' },
  ];

  function guessCategory(s: Start): PlayCategory {
    if (s.startsWith('lineout')) return 'lineout';
    if (s.startsWith('scrum')) return 'scrum';
    if (s === 'kickoffReceive15') return 'kickoff';
    if (s === 'restartReceive7') return 'restart7s';
    if (s.startsWith('defensive')) return 'defence';
    return 'strike';
  }
  function pickStart(s: Start) {
    start = s;
    if (!touched) category = guessCategory(s);
    if (s !== 'blank') {
      const f = PRESETS[s].build().format;
      if (format !== 'any') format = f;
    }
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const id = uuidv7();
    const name = title.trim() || (start === 'blank' ? 'New play' : `${PRESETS[start].label} move`);
    const data = newPlay({
      id,
      title: name,
      mode: 'play',
      format,
      view: start === 'blank' ? view : undefined,
      preset: start === 'blank' ? undefined : start,
    });
    try {
      await createPlay({ title: name, category, format, visibility: 'coaches', data }, id);
      open = false;
      await goto(`/plays/${id}/edit`);
    } finally {
      busy = false;
    }
  }
</script>

<Sheet
  bind:open
  title="New play"
  description="Start from a set-piece preset or a blank pitch. You can change everything later."
  size="lg"
>
  <form class="stack" onsubmit={create}>
    <Field label="Name">
      {#snippet children({ id })}<input
          {id}
          bind:value={title}
          maxlength="80"
          placeholder="e.g. Zeus off the top"
          autocomplete="off"
        />{/snippet}
    </Field>
    <fieldset class="starts">
      <legend>Start from</legend>
      <div class="grid">
        <label class="opt" class:sel={start === 'blank'}>
          <input
            type="radio"
            name="start"
            value="blank"
            checked={start === 'blank'}
            onchange={() => pickStart('blank')}
          />
          <span>Blank pitch</span>
        </label>
        {#each Object.entries(PRESETS).filter( ([k]) => shownTemplate(`preset:${k}`) ) as [id, p] (id)}
          <label class="opt" class:sel={start === id}>
            <input
              type="radio"
              name="start"
              value={id}
              checked={start === id}
              onchange={() => pickStart(id as PresetId)}
            />
            <span>{p.label}</span>
          </label>
        {/each}
      </div>
    </fieldset>
    <div class="two">
      <Field label="Category">
        {#snippet children({ id })}
          <select {id} bind:value={category} onchange={() => (touched = true)}>
            {#each PLAY_CATEGORIES as c (c)}<option value={c}>{PLAY_CATEGORY_LABELS[c]}</option
              >{/each}
          </select>
        {/snippet}
      </Field>
      <Field label="Format">
        {#snippet children({ id })}
          <select {id} bind:value={format}>
            <option value="15s">15s</option>
            <option value="7s">7s</option>
            <option value="any">Either</option>
          </select>
        {/snippet}
      </Field>
      {#if start === 'blank'}
        <Field label="Pitch view">
          {#snippet children({ id })}
            <select {id} bind:value={view}>
              {#each VIEWS as v (v.value)}<option value={v.value}>{v.label}</option>{/each}
            </select>
          {/snippet}
        </Field>
      {/if}
    </div>
    <Button type="submit" variant="primary" block loading={busy}>Create and edit</Button>
  </form>
</Sheet>

<style>
  .starts {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend {
    font-weight: 650;
    font-size: var(--t-14);
    margin-bottom: var(--s-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--s-2);
  }
  .opt {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 44px;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--surface);
    font-size: var(--t-14);
    font-weight: 600;
    cursor: pointer;
  }
  .opt input {
    accent-color: var(--accent);
    width: 18px;
    height: 18px;
    margin: 0;
  }
  .opt.sel {
    border-color: var(--accent);
    background: var(--accent-softer);
  }
  .opt:has(input:focus-visible) {
    outline: 3px solid color-mix(in srgb, var(--accent) 70%, var(--text));
    outline-offset: 2px;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--s-3);
  }
</style>
