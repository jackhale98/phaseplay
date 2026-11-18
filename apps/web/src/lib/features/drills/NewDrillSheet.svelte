<script lang="ts">
  import { shownTemplate } from '#lib/features/plays/templates';
  import { goto } from '$app/navigation';
  import {
    DRILL_CATEGORIES,
    DRILL_CATEGORY_LABELS,
    uuidv7,
    type ContactLevel,
    type DrillCategory,
  } from '@phaseplay/shared';
  import { DRILL_TEMPLATES, type DrillTemplateId } from '@phaseplay/diagram/drill-templates';
  import { newPlay } from '@phaseplay/diagram/presets';
  import { drillArea } from '@phaseplay/diagram/viewport';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import Button from '#lib/components/Button.svelte';
  import { createDrill } from '#lib/features/plays/actions.svelte';
  import { ApiError } from '#lib/api';

  let { open = $bindable(false) }: { open: boolean } = $props();
  /** 'photos': no diagram, just uploaded photos (a whiteboard, a scanned drill card). */
  type Start = DrillTemplateId | 'blank' | 'photos';
  const HINTS: Record<
    DrillTemplateId,
    { category: DrillCategory; contact: ContactLevel; players: [number, number] }
  > = {
    squareGrid: { category: 'handling', contact: 'none', players: [8, 16] },
    channels: { category: 'handling', contact: 'none', players: [6, 15] },
    trianglePassing: { category: 'handling', contact: 'none', players: [6, 12] },
    gates: { category: 'warmup', contact: 'none', players: [4, 30] },
    tackleBox: { category: 'contact', contact: 'full', players: [4, 12] },
    overload2v1: { category: 'attack', contact: 'touch', players: [3, 12] },
    overload3v2: { category: 'attack', contact: 'touch', players: [5, 15] },
    ruckLanes: { category: 'breakdown', contact: 'shields', players: [6, 18] },
    conditioningShuttle: { category: 'conditioning', contact: 'none', players: [4, 30] },
    touchGame: { category: 'game', contact: 'touch', players: [8, 20] },
    dynamicWarmup: { category: 'warmup', contact: 'none', players: [6, 40] },
    tackleTubes: { category: 'contact', contact: 'shields', players: [4, 16] },
    jackalClearOut: { category: 'breakdown', contact: 'shields', players: [6, 18] },
    lineSpeed: { category: 'defence', contact: 'touch', players: [8, 20] },
    lineoutPod: { category: 'set_piece', contact: 'shields', players: [4, 9] },
    lineoutThrowing: { category: 'set_piece', contact: 'none', players: [2, 6] },
    boxKickChase: { category: 'kicking', contact: 'none', players: [4, 12] },
  };

  let title = $state('');
  let start = $state<Start>('squareGrid');
  let category = $state<DrillCategory>('handling');
  let touched = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  function pickStart(s: Start) {
    start = s;
    if (!touched && s !== 'blank' && s !== 'photos') category = HINTS[s].category;
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    error = null;
    const photos = start === 'photos';
    if (photos && !navigator.onLine) {
      error = "You're offline. A photo drill needs a connection to upload its photos.";
      return;
    }
    busy = true;
    const id = uuidv7();
    const hint = start === 'blank' || start === 'photos' ? null : HINTS[start];
    const name =
      title.trim() ||
      (start === 'blank'
        ? 'New drill'
        : photos
          ? 'Photo drill'
          : DRILL_TEMPLATES[start as DrillTemplateId].label);
    const diagram = photos
      ? null
      : start === 'blank'
        ? newPlay({ id, title: name, mode: 'drill', format: 'any' })
        : { ...DRILL_TEMPLATES[start as DrillTemplateId].build(id), title: name };
    const area = (diagram && drillArea(diagram)) ?? { w: 20, h: 20 };
    try {
      await createDrill(
        {
          title: name,
          category,
          contactLevel: hint?.contact ?? 'none',
          intensity: 2,
          playersMin: hint?.players[0] ?? 4,
          playersMax: hint?.players[1] ?? 16,
          area: { w: Math.min(100, area.w), h: Math.min(120, area.h) },
          equipment: {},
          defaultDurationMin: 10,
          description: '',
          coachingPoints: [],
          setup: '',
          variations: [],
          diagram,
          visibility: 'coaches',
          parentId: null,
        },
        id,
        photos,
      );
      open = false;
      await goto(photos ? `/drills/${id}?photos=1` : `/drills/${id}/edit`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Couldn't create the drill. Try again.";
    } finally {
      busy = false;
    }
  }
</script>

<Sheet
  bind:open
  title="New drill"
  description="Pick a template to start from. Templates are editable starting points."
  size="lg"
>
  <form class="stack" onsubmit={create}>
    <Field label="Name">
      {#snippet children({ id })}<input
          {id}
          bind:value={title}
          maxlength="80"
          placeholder="e.g. Hands in the square"
          autocomplete="off"
        />{/snippet}
    </Field>
    <fieldset class="starts">
      <legend>Template</legend>
      <div class="grid">
        <label class="opt" class:sel={start === 'blank'}>
          <input
            type="radio"
            name="dstart"
            checked={start === 'blank'}
            onchange={() => pickStart('blank')}
          />
          <span>Blank 20×20 m</span>
        </label>
        <label class="opt" class:sel={start === 'photos'}>
          <input
            type="radio"
            name="dstart"
            checked={start === 'photos'}
            onchange={() => pickStart('photos')}
          />
          <span>Photos only</span>
        </label>
        {#each Object.entries(DRILL_TEMPLATES).filter( ([k]) => shownTemplate(`drill:${k}`) ) as [id, t] (id)}
          <label class="opt" class:sel={start === id}>
            <input
              type="radio"
              name="dstart"
              checked={start === id}
              onchange={() => pickStart(id as DrillTemplateId)}
            />
            <span>{t.label}</span>
          </label>
        {/each}
      </div>
    </fieldset>
    <Field label="Category">
      {#snippet children({ id })}
        <select {id} bind:value={category} onchange={() => (touched = true)}>
          {#each DRILL_CATEGORIES as c (c)}<option value={c}>{DRILL_CATEGORY_LABELS[c]}</option
            >{/each}
        </select>
      {/snippet}
    </Field>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <Button type="submit" variant="primary" block loading={busy}
      >{start === 'photos' ? 'Create and add photos' : 'Create and edit'}</Button
    >
  </form>
</Sheet>

<style>
  .err {
    margin: 0;
    padding: var(--s-3);
    border-radius: var(--r-md);
    background: var(--danger-soft);
    font-size: var(--t-14);
  }
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
</style>
