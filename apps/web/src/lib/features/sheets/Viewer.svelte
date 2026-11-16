<!-- The published team sheet, read-only, with "you" highlighted. Players and managers land here. -->
<script lang="ts">
  import { RULES, type Format, type TeamEvent, type TeamSheet } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { ago } from '#lib/format';
  import Button from '#lib/components/Button.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import { IconShirt, IconImage, IconStar } from '#lib/icons';
  import SheetHead from './SheetHead.svelte';
  import PitchView from './PitchView.svelte';
  import ListView from './ListView.svelte';
  import ExportSheet from './ExportSheet.svelte';
  import {
    draftFrom,
    eventLabel,
    exportInput,
    exportMeta,
    fileSlug,
    slotLabel,
    slotOf,
  } from './model';

  type Props = { event: TeamEvent; sheet: TeamSheet | undefined; format: Format };
  let { event, sheet, format }: Props = $props();

  const s = $derived(app.snap!);
  const tz = $derived(s.team.timezone);
  const meId = $derived(s.me.id);
  const nameOf = (id: string) => s.rows.members[id]?.displayName ?? 'Former player';
  const published = $derived(sheet?.publishedAt ? sheet : undefined);
  const draft = $derived(published ? draftFrom(published) : null);
  const mine = $derived(draft ? slotOf(draft, meId) : null);
  let view = $state<'pitch' | 'list'>('pitch');
  let exportOpen = $state(false);
</script>

<SheetHead {event} {tz} format={draft?.format ?? format} teamShort={s.team.shortName}>
  {#if draft}
    <Button onclick={() => (exportOpen = true)}
      >{#snippet icon()}<IconImage />{/snippet}Export image</Button
    >
  {/if}
</SheetHead>

{#if !draft || !published}
  <EmptyState
    title="The team's not out yet"
    body="Your coach will name the team {event.opponent
      ? `to play ${event.opponent}`
      : `for ${event.title}`} here. It'll be on Home too, so keep an eye out."
  >
    {#snippet icon()}<IconShirt />{/snippet}
    {#snippet action()}<Button href="/events/{event.id}">Back to the match</Button>{/snippet}
  </EmptyState>
{:else}
  <div class="viewer">
    {#if mine !== null}
      <section class="you card" aria-label="Your spot">
        <span class="num tnum" aria-hidden="true">{mine}</span>
        <div class="grow">
          <strong>
            {mine > RULES[draft.format].starters
              ? `You're on the bench at ${mine}`
              : `You're in at ${mine}, ${slotLabel(draft.format, mine)}`}
          </strong>
          <small class="muted">
            {#if draft.captainId === meId}<IconStar /> And you're captain.{:else if draft.viceId === meId}<IconStar
              /> And you're vice-captain.{:else}Good luck out there.{/if}
          </small>
        </div>
      </section>
    {/if}

    <div class="bar">
      <Segmented
        label="Sheet view"
        bind:value={view}
        options={[
          { value: 'pitch', label: 'Pitch' },
          { value: 'list', label: 'List' },
        ]}
      />
      <p class="subtle">Published {ago(published.publishedAt!)}</p>
    </div>

    {#if view === 'pitch'}
      <PitchView {draft} {nameOf} {meId} />
    {:else}
      <ListView {draft} {nameOf} {meId} />
    {/if}

    {#if draft.captainId || draft.viceId}
      <p class="leaders muted">
        {#if draft.captainId}<span
            ><b class="mk" aria-hidden="true">C</b>Captain {nameOf(draft.captainId)}</span
          >{/if}
        {#if draft.viceId}<span
            ><b class="mk" aria-hidden="true">VC</b>Vice-captain {nameOf(draft.viceId)}</span
          >{/if}
      </p>
    {/if}
  </div>

  <ExportSheet
    bind:open={exportOpen}
    input={exportInput(draft, nameOf, exportMeta(s.team, event))}
    filename="team-sheet-{fileSlug(eventLabel(event))}"
  />
{/if}

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    max-width: 760px;
  }
  .you {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    padding: var(--s-4) var(--s-5);
    background: var(--accent-soft);
    border-color: transparent;
  }
  .num {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 850;
    font-size: var(--t-20);
    flex: none;
  }
  .you small {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .you small :global(svg) {
    width: 14px;
    height: 14px;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .leaders {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) var(--s-5);
    font-size: var(--t-14);
  }
  .leaders span {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
  }
  .mk {
    display: grid;
    place-items: center;
    min-width: 22px;
    height: 22px;
    padding: 0 4px;
    border-radius: var(--r-full);
    background: var(--text);
    color: var(--bg);
    font-size: 0.6875rem;
  }
  @media (min-width: 1200px) {
    .viewer {
      margin: 0 auto;
    }
  }
</style>
