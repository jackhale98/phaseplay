<!-- Play details: title, category, tags, format, visibility, description. -->
<script lang="ts" module>
  import type { PlayMeta } from '@phaseplay/shared';
  export type MetaValues = Pick<
    PlayMeta,
    'title' | 'category' | 'tags' | 'format' | 'visibility' | 'description'
  >;
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import {
    PLAY_CATEGORIES,
    PLAY_CATEGORY_LABELS,
    type PlayCategory,
    type Visibility,
  } from '@phaseplay/shared';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import Button from '#lib/components/Button.svelte';

  type Props = { open: boolean; value: MetaValues; onsave: (v: MetaValues) => void };
  let { open = $bindable(false), value, onsave }: Props = $props();

  let title = $state('');
  let category = $state<PlayCategory>('other');
  let tags = $state('');
  let format = $state<'15s' | '7s' | 'any'>('15s');
  let visibility = $state<Visibility>('coaches');
  let description = $state('');
  let error = $state<string | null>(null);

  // Copy the play in when the sheet opens only, so a background autosave can't wipe edits.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      title = value.title;
      category = value.category;
      tags = value.tags.join(', ');
      format = value.format;
      visibility = value.visibility;
      description = value.description ?? '';
      error = null;
    });
  });

  function save(e: SubmitEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      error = 'Give the play a name';
      return;
    }
    const list = [
      ...new Set(
        tags
          .split(/[,\s]+/)
          .map((x) => x.replace(/^#/, '').trim().slice(0, 24))
          .filter(Boolean),
      ),
    ].slice(0, 12);
    onsave({
      title: t.slice(0, 80),
      category,
      tags: list,
      format,
      visibility,
      description: description.trim() || null,
    });
    open = false;
  }
</script>

<Sheet bind:open title="Play details" size="md">
  <form class="stack" onsubmit={save} novalidate>
    <Field label="Name" {error}>
      {#snippet children({ id, describedby })}<input
          {id}
          aria-describedby={describedby}
          bind:value={title}
          maxlength="80"
          required
        />{/snippet}
    </Field>
    <div class="two">
      <Field label="Category">
        {#snippet children({ id })}
          <select {id} bind:value={category}>
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
    </div>
    <Field label="Tags" hint="Comma separated, e.g. front, wet-weather">
      {#snippet children({ id, describedby })}<input
          {id}
          aria-describedby={describedby}
          bind:value={tags}
          autocomplete="off"
        />{/snippet}
    </Field>
    <Field label="Who can see it">
      {#snippet children({ id })}
        <select {id} bind:value={visibility}>
          <option value="coaches">Coaches only</option>
          <option value="team">The whole team</option>
        </select>
      {/snippet}
    </Field>
    <Field label="Notes for players">
      {#snippet children({ id })}<textarea {id} bind:value={description} maxlength="2000" rows="3"
        ></textarea>{/snippet}
    </Field>
    <Button type="submit" variant="primary" block>Save details</Button>
  </form>
</Sheet>

<style>
  .two {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--s-3);
  }
</style>
