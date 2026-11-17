<script lang="ts" module>
  import type { DrillMeta } from '@phaseplay/shared';
  export type DrillDetails = Pick<
    DrillMeta,
    | 'title'
    | 'category'
    | 'contactLevel'
    | 'intensity'
    | 'playersMin'
    | 'playersMax'
    | 'area'
    | 'equipment'
    | 'defaultDurationMin'
    | 'description'
    | 'coachingPoints'
    | 'setup'
    | 'variations'
    | 'visibility'
  >;
</script>

<!-- Drill details (stored on the drill row, not in the diagram): docs/diagrams.md §Drill mode. -->
<script lang="ts">
  import {
    CONTACT_LABELS,
    CONTACT_LEVELS,
    DRILL_CATEGORIES,
    DRILL_CATEGORY_LABELS,
    EQUIPMENT,
    EQUIPMENT_LABELS,
    equipmentFromDiagram,
    type EquipmentList,
    type Play,
  } from '@phaseplay/shared';
  import { untrack } from 'svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import Button from '#lib/components/Button.svelte';

  type Props = {
    open: boolean;
    value: DrillDetails;
    diagram: Play | null;
    onsave: (v: DrillDetails) => void;
  };
  let { open = $bindable(false), value, diagram, onsave }: Props = $props();

  let f = $state<DrillDetails & { points: string; vars: string }>({
    ...untrack(() => value),
    points: '',
    vars: '',
  });
  let errors = $state<Record<string, string>>({});
  const derived = $derived(equipmentFromDiagram(diagram));

  // Copy the drill into the form when the sheet opens, not whenever the drill changes: a
  // background save (e.g. the diagram autosave) must not wipe what's being typed.
  $effect(() => {
    if (!open) return;
    const v = untrack(() => $state.snapshot(value)) as DrillDetails;
    f = {
      ...v,
      area: { ...v.area },
      equipment: { ...v.equipment },
      points: v.coachingPoints.join('\n'),
      vars: v.variations.join('\n'),
    };
    errors = {};
  });

  const lines = (s: string, max: number, n: number) =>
    s
      .split('\n')
      .map((x) => x.trim().slice(0, max))
      .filter(Boolean)
      .slice(0, n);
  const int = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };

  function save(e: SubmitEvent) {
    e.preventDefault();
    const out: Record<string, string> = {};
    if (!f.title.trim()) out.title = 'Give the drill a name';
    const min = int(f.playersMin, 1, 80, 1);
    const max = int(f.playersMax, 1, 80, min);
    if (max < min) out.players = 'Max players must be at least the minimum';
    errors = out;
    if (Object.keys(out).length) return;
    const equipment: EquipmentList = {};
    for (const k of EQUIPMENT) {
      const n = f.equipment[k];
      if (n !== undefined && n !== null && String(n) !== '') equipment[k] = int(n, 0, 200, 0);
    }
    onsave({
      title: f.title.trim().slice(0, 80),
      category: f.category,
      contactLevel: f.contactLevel,
      intensity: int(f.intensity, 1, 5, 2),
      playersMin: min,
      playersMax: max,
      area: { w: int(f.area.w, 1, 100, 20), h: int(f.area.h, 1, 120, 20) },
      equipment,
      defaultDurationMin: int(f.defaultDurationMin, 1, 120, 10),
      description: f.description.slice(0, 2000),
      coachingPoints: lines(f.points, 200, 12),
      setup: f.setup.slice(0, 1000),
      variations: lines(f.vars, 300, 12),
      visibility: f.visibility,
    });
    open = false;
  }
</script>

<Sheet bind:open title="Drill details" size="lg">
  <form class="stack" onsubmit={save} novalidate>
    <Field label="Name" error={errors.title}>
      {#snippet children({ id, describedby })}<input
          {id}
          aria-describedby={describedby}
          bind:value={f.title}
          maxlength="80"
        />{/snippet}
    </Field>
    <div class="grid">
      <Field label="Category">
        {#snippet children({ id })}
          <select {id} bind:value={f.category}>
            {#each DRILL_CATEGORIES as c (c)}<option value={c}>{DRILL_CATEGORY_LABELS[c]}</option
              >{/each}
          </select>
        {/snippet}
      </Field>
      <Field label="Contact">
        {#snippet children({ id })}
          <select {id} bind:value={f.contactLevel}>
            {#each CONTACT_LEVELS as c (c)}<option value={c}>{CONTACT_LABELS[c]}</option>{/each}
          </select>
        {/snippet}
      </Field>
      <Field label="Intensity (1–5)">
        {#snippet children({ id })}<input
            {id}
            type="number"
            min="1"
            max="5"
            bind:value={f.intensity}
          />{/snippet}
      </Field>
      <Field label="Duration (min)">
        {#snippet children({ id })}<input
            {id}
            type="number"
            min="1"
            max="120"
            bind:value={f.defaultDurationMin}
          />{/snippet}
      </Field>
      <Field label="Min players" error={errors.players}>
        {#snippet children({ id, describedby })}<input
            {id}
            aria-describedby={describedby}
            type="number"
            min="1"
            max="80"
            bind:value={f.playersMin}
          />{/snippet}
      </Field>
      <Field label="Max players">
        {#snippet children({ id })}<input
            {id}
            type="number"
            min="1"
            max="80"
            bind:value={f.playersMax}
          />{/snippet}
      </Field>
      <Field label="Area width (m)">
        {#snippet children({ id })}<input
            {id}
            type="number"
            min="1"
            max="100"
            bind:value={f.area.w}
          />{/snippet}
      </Field>
      <Field label="Area length (m)">
        {#snippet children({ id })}<input
            {id}
            type="number"
            min="1"
            max="120"
            bind:value={f.area.h}
          />{/snippet}
      </Field>
    </div>
    <Field label="Who can see it">
      {#snippet children({ id })}
        <select {id} bind:value={f.visibility}>
          <option value="coaches">Coaches only</option>
          <option value="team">The whole team</option>
        </select>
      {/snippet}
    </Field>
    <Field label="Description">
      {#snippet children({ id })}<textarea {id} bind:value={f.description} maxlength="2000" rows="3"
        ></textarea>{/snippet}
    </Field>
    <Field label="Setup">
      {#snippet children({ id })}<textarea {id} bind:value={f.setup} maxlength="1000" rows="3"
        ></textarea>{/snippet}
    </Field>
    <Field label="Coaching points" hint="One per line">
      {#snippet children({ id, describedby })}<textarea
          {id}
          aria-describedby={describedby}
          bind:value={f.points}
          rows="4"></textarea>{/snippet}
    </Field>
    <Field label="Progressions and variations" hint="One per line">
      {#snippet children({ id, describedby })}<textarea
          {id}
          aria-describedby={describedby}
          bind:value={f.vars}
          rows="3"></textarea>{/snippet}
    </Field>
    <fieldset class="equip">
      <legend>Equipment</legend>
      <p class="subtle">Counted from the diagram. Type a number to override.</p>
      <div class="egrid">
        {#each EQUIPMENT as k (k)}
          <label>
            <span>{EQUIPMENT_LABELS[k]}</span>
            <input
              type="number"
              min="0"
              max="200"
              placeholder={String(derived[k] ?? 0)}
              value={f.equipment[k] ?? ''}
              oninput={(e) => {
                const v = e.currentTarget.value;
                const next = { ...f.equipment };
                if (v === '') delete next[k];
                else next[k] = Number(v);
                f.equipment = next;
              }}
            />
          </label>
        {/each}
      </div>
    </fieldset>
    <Button type="submit" variant="primary" block>Save details</Button>
  </form>
</Sheet>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--s-3);
  }
  .equip {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend {
    font-weight: 650;
    font-size: var(--t-14);
  }
  .equip p {
    margin: 2px 0 var(--s-2);
  }
  .egrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--s-2) var(--s-3);
  }
  .egrid label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    font-size: var(--t-14);
  }
  .egrid input {
    width: 72px;
    min-height: 44px;
    padding: 6px 8px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-size: var(--t-16);
  }
</style>
