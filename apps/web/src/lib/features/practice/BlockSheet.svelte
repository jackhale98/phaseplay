<script lang="ts">
  /** Edit one block: duration, group, coach, notes, linked play and station rotation. */
  import {
    ALL_LANE,
    CONTACT_LABELS,
    blockMinutes,
    type Block,
    type DrillMeta,
    type Member,
    type PlayMeta,
  } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import Button from '#lib/components/Button.svelte';
  import Chip from '#lib/components/Chip.svelte';
  import Stepper from './Stepper.svelte';
  import { KIND_LABELS, blockTitle, laneName } from './model';
  import { IconTrash, IconPlus, IconX } from '#lib/icons';

  type Props = {
    open: boolean;
    block: Block | null;
    lanes: string[];
    drills: Record<string, DrillMeta>;
    staff: Member[];
    plays: PlayMeta[];
    onchange: (patch: Partial<Block>) => void;
    onremove: () => void;
  };
  let {
    open = $bindable(),
    block,
    lanes,
    drills,
    staff,
    plays,
    onchange,
    onremove,
  }: Props = $props();

  const drill = $derived(block?.drillId ? drills[block.drillId] : undefined);
  const split = $derived(!(lanes.length === 1 && lanes[0] === ALL_LANE));
  const rot = $derived(block?.rotation);

  function setRotation(on: boolean) {
    if (!block) return;
    onchange({
      rotation: on
        ? { groups: 3, stations: ['Station 1', 'Station 2', 'Station 3'], intervalMin: 6 }
        : undefined,
    });
  }
  function patchRot(p: Partial<NonNullable<Block['rotation']>>) {
    if (rot) onchange({ rotation: { ...rot, ...p } });
  }
</script>

<Sheet
  bind:open
  title={block ? blockTitle(block, drills) : 'Block'}
  description={block
    ? `${KIND_LABELS[block.kind]}${drill ? ` · ${CONTACT_LABELS[drill.contactLevel]} · intensity ${drill.intensity}/5` : ''}`
    : undefined}
>
  {#if block}
    <div class="form">
      {#if block.kind !== 'drill'}
        <Field label="Title">
          {#snippet children({ id })}
            <input
              {id}
              type="text"
              maxlength="80"
              value={block.title ?? ''}
              oninput={(e) => onchange({ title: e.currentTarget.value })}
            />
          {/snippet}
        </Field>
      {/if}

      {#if rot}
        <p class="muted small">
          A rotation runs {rot.stations.length} rounds of {rot.intervalMin} min: {blockMinutes(
            block,
          )} min in all.
        </p>
      {:else}
        <Field label="Minutes">
          {#snippet children({ id })}
            <div class="row wrap">
              <input
                {id}
                class="mins"
                type="number"
                inputmode="numeric"
                min="1"
                max="120"
                value={block.durationMin}
                oninput={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (n >= 1) onchange({ durationMin: Math.min(120, Math.round(n)) });
                }}
              />
              {#each [5, 10, 15, 20, 25] as m (m)}
                <Chip
                  selected={block.durationMin === m}
                  onclick={() => onchange({ durationMin: m })}>{m}</Chip
                >
              {/each}
            </div>
          {/snippet}
        </Field>
      {/if}

      {#if split}
        <Field label="Group">
          {#snippet children({ id })}
            <select
              {id}
              value={block.lane}
              onchange={(e) => onchange({ lane: e.currentTarget.value })}
            >
              <option value={ALL_LANE}>Everyone</option>
              {#each lanes as l (l)}<option value={l}>{laneName(l)}</option>{/each}
            </select>
          {/snippet}
        </Field>
      {/if}

      <Field label="Coach">
        {#snippet children({ id })}
          <select
            {id}
            value={block.coachId ?? ''}
            onchange={(e) => onchange({ coachId: e.currentTarget.value || undefined })}
          >
            <option value="">No one assigned</option>
            {#each staff as m (m.id)}<option value={m.id}>{m.displayName}</option>{/each}
          </select>
        {/snippet}
      </Field>

      {#if plays.length}
        <Field label="Play to rehearse" hint="Optional. Players see it in Today's session.">
          {#snippet children({ id, describedby })}
            <select
              {id}
              aria-describedby={describedby}
              value={block.playId ?? ''}
              onchange={(e) => onchange({ playId: e.currentTarget.value || undefined })}
            >
              <option value="">None</option>
              {#each plays as p (p.id)}<option value={p.id}>{p.title}</option>{/each}
            </select>
          {/snippet}
        </Field>
      {/if}

      <Field label="Notes">
        {#snippet children({ id })}
          <textarea
            {id}
            maxlength="500"
            rows="3"
            value={block.notes ?? ''}
            oninput={(e) => onchange({ notes: e.currentTarget.value })}></textarea>
        {/snippet}
      </Field>

      {#if block.kind !== 'water' && block.kind !== 'talk'}
        <div class="rot">
          <label class="check">
            <input
              type="checkbox"
              checked={!!rot}
              onchange={(e) => setRotation(e.currentTarget.checked)}
            />
            <span
              ><strong>Station rotation</strong><small class="muted"
                >Groups move round stations on a timer</small
              ></span
            >
          </label>
          {#if rot}
            <div class="rot-grid">
              <div class="rot-row">
                <span>Groups</span>
                <Stepper
                  label="Groups"
                  unit=""
                  value={rot.groups}
                  min={1}
                  max={8}
                  size="sm"
                  onchange={(v) => patchRot({ groups: v })}
                />
              </div>
              <div class="rot-row">
                <span>Every</span>
                <Stepper
                  label="Rotation interval"
                  value={rot.intervalMin}
                  min={1}
                  max={30}
                  size="sm"
                  onchange={(v) => patchRot({ intervalMin: v })}
                />
              </div>
            </div>
            <ol class="stations">
              {#each rot.stations as st, i (i)}
                <li>
                  <label class="sr-only" for="st-{i}">Station {i + 1}</label>
                  <input
                    id="st-{i}"
                    type="text"
                    maxlength="40"
                    value={st}
                    oninput={(e) =>
                      patchRot({
                        stations: rot.stations.map((x, j) => (j === i ? e.currentTarget.value : x)),
                      })}
                  />
                  <button
                    type="button"
                    class="x"
                    aria-label="Remove station {i + 1}"
                    disabled={rot.stations.length <= 1}
                    onclick={() => patchRot({ stations: rot.stations.filter((_, j) => j !== i) })}
                    ><IconX /></button
                  >
                </li>
              {/each}
            </ol>
            {#if rot.stations.length < 8}
              <Button
                size="sm"
                variant="ghost"
                onclick={() =>
                  patchRot({ stations: [...rot.stations, `Station ${rot.stations.length + 1}`] })}
              >
                {#snippet icon()}<IconPlus />{/snippet}Add station
              </Button>
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    <div class="row foot">
      <Button variant="danger" onclick={onremove}
        >{#snippet icon()}<IconTrash />{/snippet}Remove</Button
      >
      <span class="grow"></span>
      <Button variant="primary" onclick={() => (open = false)}>Done</Button>
    </div>
  {/snippet}
</Sheet>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  .small {
    font-size: var(--t-14);
  }
  .mins {
    width: 6em !important;
    flex: none;
  }
  .rot {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .check {
    display: flex;
    gap: var(--s-3);
    align-items: center;
    min-height: 44px;
    cursor: pointer;
  }
  .check input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
  .check small {
    display: block;
    font-size: var(--t-12);
  }
  .rot-grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3) var(--s-6);
  }
  .rot-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    font-weight: 600;
    font-size: var(--t-14);
  }
  .stations {
    margin: 0;
    padding-left: var(--s-6);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .stations li {
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }
  .stations input {
    flex: 1;
    min-height: 44px;
    padding: 8px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface);
  }
  .x {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text-2);
  }
  .x :global(svg) {
    width: 18px;
    height: 18px;
  }
  .foot {
    width: 100%;
  }
</style>
