<!--
  "It's on: v Harlequins, Sat 12, 2:30. Still in?" A proposal was confirmed and I'd said I was in,
  so I'm down as a yes until I reconfirm (or say I can't now).
-->
<script lang="ts">
  import { eventTimeLabel, type TeamEvent } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { setRsvp } from '#lib/data/actions';
  import { day as dayMonth } from '#lib/format';
  import { IconCheck, IconX } from '#lib/icons';
  import { displayTitle } from './schedule';

  let { event: e }: { event: TeamEvent } = $props();
  const tz = $derived(app.snap?.team.timezone ?? 'UTC');
  const me = $derived(app.snap?.me.id);
  const title = $derived(displayTitle(e, app.snap?.team.shortName));
</script>

<article class="still card" aria-labelledby="still-{e.id}">
  <p class="eyebrow">It's on</p>
  <h3 id="still-{e.id}"><a href="/events/{e.id}">{title}</a></h3>
  <p class="when tnum">
    {dayMonth(e.startsAt, tz)}, {eventTimeLabel(e, tz)}{e.locationName
      ? ` · ${e.locationName}`
      : ''}. You said you were in. <strong>Still in?</strong>
  </p>
  {#if me}
    <div class="two" role="group" aria-label="Still in for {title}?">
      <button
        type="button"
        class="in"
        onclick={() => setRsvp(e.id, me, 'yes', null, { undo: false })}
        ><IconCheck />Still in</button
      >
      <button type="button" class="out" onclick={() => setRsvp(e.id, me, 'no')}
        ><IconX />Can't now</button
      >
    </div>
  {/if}
</article>

<style>
  .still {
    display: grid;
    gap: var(--s-2);
    padding: var(--s-4);
    border-left: 4px solid var(--ok);
  }
  .eyebrow {
    margin: 0;
    font-size: var(--t-12);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ok);
  }
  h3 {
    margin: 0;
    font-size: 1.0625rem;
  }
  h3 a {
    color: inherit;
    text-decoration: none;
  }
  h3 a:hover {
    text-decoration: underline;
  }
  .when {
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .when strong {
    color: var(--text);
  }
  .two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
    max-width: 420px;
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
  }
  button :global(svg) {
    width: 18px;
    height: 18px;
  }
  .in {
    background: var(--ok);
    border-color: var(--ok);
    color: var(--on-sel);
  }
</style>
