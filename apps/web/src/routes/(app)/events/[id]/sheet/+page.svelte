<script lang="ts">
  import Loader from '#lib/components/Loader.svelte';
  import { page } from '$app/state';
  import { isGame } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { eventFormat, sheetFor } from '#lib/data/selectors';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Button from '#lib/components/Button.svelte';
  import { IconShirt } from '#lib/icons';
  import Builder from '#lib/features/sheets/Builder.svelte';
  import Viewer from '#lib/features/sheets/Viewer.svelte';
  import { eventLabel } from '#lib/features/sheets/model';

  const s = $derived(app.snap);
  const id = $derived(page.params.id ?? '');
  const event = $derived(s?.rows.events[id]);
  const sheet = $derived(sheetFor(s, id));
  const format = $derived(sheet?.format ?? (event && s ? eventFormat(s, event) : '15s'));
  const coach = $derived(app.can('sheets.manage'));
</script>

<svelte:head>
  <title
    >Team sheet{event ? ` ${eventLabel(event)}` : ''} · {s?.team.shortName ?? 'Phaseplay'}</title
  >
</svelte:head>

<div class="page">
  {#if !s}
    <Loader label="Loading team sheet" />
  {:else if !event}
    <h1 class="sr-only">Team sheet</h1>
    <EmptyState
      title="Match not found"
      body="It may have been deleted, or it belongs to another team."
    >
      {#snippet icon()}<IconShirt />{/snippet}
      {#snippet action()}<Button href="/schedule">Back to the schedule</Button>{/snippet}
    </EmptyState>
  {:else if !isGame(event.type)}
    <h1 class="sr-only">Team sheet</h1>
    <EmptyState
      title="Team sheets are for games"
      body="Pick a match or tournament from the schedule to name a team."
    >
      {#snippet icon()}<IconShirt />{/snippet}
      {#snippet action()}<Button href="/events/{event.id}">Back to the event</Button>{/snippet}
    </EmptyState>
  {:else}
    {#key event.id}
      {#if coach}
        <Builder {event} {sheet} {format} />
      {:else}
        <Viewer {event} {sheet} {format} />
      {/if}
    {/key}
  {/if}
</div>

<style>
</style>
