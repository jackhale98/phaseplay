<!-- Page header for the sheet route: back to the match, title, kickoff and venue. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Format, TeamEvent } from '@phaseplay/shared';
  import { longDay, time, tzName } from '#lib/format';
  import { IconBack, IconClock, IconMapPin } from '#lib/icons';
  import { eventLabel } from './model';

  type Props = {
    event: TeamEvent;
    tz: string;
    format: Format;
    teamShort: string;
    children?: Snippet;
  };
  let { event: e, tz, format, teamShort, children }: Props = $props();
</script>

<header class="head">
  <a class="back" href="/events/{e.id}"><IconBack /><span>Match</span></a>
  <div class="row wrap top">
    <div class="grow">
      <p class="eyebrow">Team sheet · {format}</p>
      <h1>{e.opponent ? `${teamShort} v ${e.opponent}` : eventLabel(e)}</h1>
      <p class="meta muted">
        <span
          ><IconClock />{longDay(e.startsAt, tz)}, {time(e.startsAt, tz)}
          {tzName(tz, e.startsAt)}</span
        >
        {#if e.locationName}<span><IconMapPin />{e.locationName}</span>{/if}
      </p>
    </div>
    {#if children}<div class="acts row wrap">{@render children()}</div>{/if}
  </div>
</header>

<style>
  .head {
    margin-bottom: var(--s-5);
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    min-height: 44px;
    margin-left: calc(-1 * var(--s-2));
    padding: 0 var(--s-2);
    font-weight: 650;
    font-size: var(--t-14);
    text-decoration: none;
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
  }
  .top {
    align-items: flex-end;
    gap: var(--s-4);
  }
  h1 {
    margin: 2px 0 var(--s-2);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-4);
    font-size: var(--t-14);
  }
  .meta span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .meta :global(svg) {
    width: 16px;
    height: 16px;
  }
  .acts {
    gap: var(--s-2);
  }
</style>
