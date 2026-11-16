<script lang="ts">
  import {
    EVENT_TYPE_LABELS,
    eventCategory,
    type TeamEvent,
    type RsvpCounts,
    type RsvpStatus,
  } from '@phaseplay/shared';
  import { relDay, time, tzName } from '#lib/format';
  import RsvpButtons from './RsvpButtons.svelte';
  import { IconClock, IconMapPin, IconChevronRight } from '#lib/icons';

  type Props = {
    event: TeamEvent;
    tz: string;
    counts?: RsvpCounts | null;
    myStatus?: RsvpStatus | null;
    memberId?: string | null;
    variant?: 'hero' | 'row';
    teamShort?: string;
  };
  let {
    event: e,
    tz,
    counts = null,
    myStatus = null,
    memberId = null,
    variant = 'row',
    teamShort,
  }: Props = $props();
  const title = $derived(e.type === 'match' && e.opponent ? `v ${e.opponent}` : e.title);
  const total = $derived(counts ? counts.yes + counts.maybe + counts.no : 0);
</script>

<article class="ev {variant} {e.type} {eventCategory(e.type)}" class:cancelled={!!e.cancelledAt}>
  <a
    class="hit"
    href="/events/{e.id}"
    aria-label="{EVENT_TYPE_LABELS[e.type]}: {title}, {relDay(e.startsAt, tz)} {time(
      e.startsAt,
      tz,
    )}"
  ></a>
  <div class="when">
    <span class="day">{relDay(e.startsAt, tz)}</span>
    <span class="t tnum">{time(e.startsAt, tz)}</span>
  </div>
  <div class="main">
    <div class="kind">
      <span class="badge">{EVENT_TYPE_LABELS[e.type]}{e.format ? ` · ${e.format}` : ''}</span>
      {#if e.cancelledAt}<span class="badge cx">Cancelled</span>{/if}
    </div>
    <h3>{e.type === 'match' && teamShort && e.opponent ? `${teamShort} ${title}` : title}</h3>
    <div class="meta">
      {#if e.meetAt}<span><IconClock />Meet {time(e.meetAt, tz)}</span>{/if}
      {#if e.locationName}<span class="truncate"><IconMapPin />{e.locationName}</span>{/if}
      {#if variant === 'hero'}<span class="tz">{tzName(tz, e.startsAt)}</span>{/if}
    </div>
    {#if counts && total > 0}
      <div class="counts" aria-label="{counts.yes} in, {counts.maybe} maybe, {counts.no} out">
        <div class="bar" aria-hidden="true">
          <span class="y" style:flex={counts.yes}></span><span class="m" style:flex={counts.maybe}
          ></span><span class="n" style:flex={counts.no}></span>
        </div>
        <span class="tnum"
          ><strong>{counts.yes}</strong> in · {counts.maybe} maybe · {counts.no} out</span
        >
      </div>
    {/if}
    {#if memberId && !e.cancelledAt}
      <div class="rs">
        <RsvpButtons
          eventId={e.id}
          {memberId}
          status={myStatus}
          size={variant === 'hero' ? 'lg' : 'md'}
        />
      </div>
    {/if}
  </div>
  {#if variant === 'row'}<IconChevronRight class="chev" />{/if}
</article>

<style>
  .ev {
    position: relative;
    display: grid;
    grid-template-columns: 76px 1fr auto;
    align-items: start;
    gap: var(--s-3);
    padding: var(--s-4);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    box-shadow: var(--e-1);
    transition:
      box-shadow var(--m-fast) var(--ease),
      transform var(--m-fast) var(--ease);
  }
  .ev:hover {
    box-shadow: var(--e-2);
  }
  .hit {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    z-index: 0;
  }
  .rs {
    position: relative;
    z-index: 1;
    margin-top: var(--s-3);
  }
  .when {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: 2px;
  }
  .day {
    font-size: var(--t-12);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }
  .t {
    font-weight: 800;
    font-size: var(--t-16);
    white-space: nowrap;
  }
  .main {
    min-width: 0;
  }
  .kind {
    display: flex;
    gap: var(--s-2);
  }
  .badge {
    font-size: var(--t-12);
    font-weight: 700;
    color: var(--accent-text);
  }
  .games .badge {
    color: #b45309;
  }
  :global(:root[data-theme='dark']) .games .badge {
    color: #f6b25e;
  }
  .events .badge {
    color: var(--info);
  }
  .badge.cx {
    color: var(--danger);
  }
  h3 {
    font-size: 1.0625rem;
    margin: 2px 0 6px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px var(--s-4);
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .meta span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
  }
  .meta :global(svg) {
    width: 14px;
    height: 14px;
    flex: none;
  }
  .tz {
    color: var(--text-3);
  }
  .counts {
    display: grid;
    gap: 6px;
    margin-top: var(--s-3);
    font-size: var(--t-12);
    color: var(--text-2);
  }
  .bar {
    display: flex;
    gap: 2px;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--surface-3);
  }
  .y {
    background: var(--ok);
  }
  .m {
    background: #d79a1e;
  }
  .n {
    background: var(--border-strong);
  }
  :global(.chev) {
    align-self: center;
    width: 18px;
    height: 18px;
    color: var(--text-3);
  }
  .hero {
    grid-template-columns: 1fr;
    padding: var(--s-5);
    background: linear-gradient(160deg, var(--accent-softer), var(--surface) 55%), var(--surface);
  }
  .hero .when {
    flex-direction: row;
    align-items: baseline;
    gap: var(--s-2);
  }
  .hero .day {
    font-size: var(--t-14);
    color: var(--accent-text);
  }
  .hero .t {
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .hero h3 {
    font-size: var(--t-24);
    letter-spacing: -0.02em;
    margin: var(--s-1) 0 var(--s-2);
  }
  .cancelled h3 {
    text-decoration: line-through;
    color: var(--text-3);
  }
</style>
