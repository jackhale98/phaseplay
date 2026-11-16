<!-- Desktop month calendar. Each event shows its category by colour AND icon, never colour alone. -->
<script lang="ts">
  import { EVENT_TYPE_LABELS, eventCategory, dateInTz, type TeamEvent } from '@phaseplay/shared';
  import { monthYear, time, longDay } from '#lib/format';
  import Button from '#lib/components/Button.svelte';
  import { IconChevronLeft, IconChevronRight } from '#lib/icons';
  import { TYPE_ICON } from './category';
  import { byDay, displayTitle, monthGrid, monthOf, shiftMonth } from './schedule';

  type Props = { events: TeamEvent[]; tz: string; month: string; teamShort?: string };
  let { events, tz, month = $bindable(), teamShort }: Props = $props();

  const today = $derived(dateInTz(Date.now(), tz));
  const grid = $derived(monthGrid(month));
  const days = $derived(byDay(events, tz));
  const weeks = $derived(Array.from({ length: 6 }, (_, i) => grid.slice(i * 7, i * 7 + 7)));
  const label = $derived(monthYear(Date.parse(`${month}T12:00:00Z`), 'UTC'));
  const MAX = 3;
  const GIcon = TYPE_ICON.match;
  const PIcon = TYPE_ICON.training;
  const EIcon = TYPE_ICON.social;
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayName = (d: string) => longDay(Date.parse(`${d}T12:00:00Z`), 'UTC');
</script>

<section class="month card" aria-labelledby="month-h">
  <header>
    <h2 id="month-h" aria-live="polite">{label}</h2>
    <div class="row">
      <Button size="sm" variant="ghost" onclick={() => (month = monthOf(today))}>Today</Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Previous month"
        onclick={() => (month = shiftMonth(month, -1))}
        >{#snippet icon()}<IconChevronLeft />{/snippet}</Button
      >
      <Button
        size="sm"
        variant="ghost"
        aria-label="Next month"
        onclick={() => (month = shiftMonth(month, 1))}
        >{#snippet icon()}<IconChevronRight />{/snippet}</Button
      >
    </div>
  </header>
  <table>
    <caption class="sr-only">{label}</caption>
    <thead>
      <tr
        >{#each WD as w (w)}<th scope="col">{w}</th>{/each}</tr
      >
    </thead>
    <tbody>
      {#each weeks as wk, wi (wi)}
        <tr>
          {#each wk as d (d)}
            {@const list = days.get(d) ?? []}
            <td class:out={d.slice(0, 7) !== month.slice(0, 7)} class:today={d === today}>
              <span class="num"
                ><span aria-hidden="true">{+d.slice(8)}</span><span class="sr-only"
                  >{dayName(d)}</span
                ></span
              >
              {#if list.length}
                <ul class="list">
                  {#each list.slice(0, MAX) as e (e.id)}
                    {@const Icon = TYPE_ICON[e.type]}
                    <li>
                      <a
                        href="/events/{e.id}"
                        class="ev {eventCategory(e.type)}"
                        class:cx={!!e.cancelledAt}
                        title="{EVENT_TYPE_LABELS[e.type]}: {displayTitle(e, teamShort)}"
                      >
                        <span class="sh" aria-hidden="true"><Icon /></span>
                        <span class="sr-only">{EVENT_TYPE_LABELS[e.type]}:</span>
                        <span class="tm tnum">{time(e.startsAt, tz)}</span>
                        <span class="tt">{displayTitle(e)}</span>
                        {#if e.cancelledAt}<span class="sr-only">(cancelled)</span>{/if}
                      </a>
                    </li>
                  {/each}
                  {#if list.length > MAX}
                    <li class="more">+{list.length - MAX} more</li>
                  {/if}
                </ul>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
  <ul class="list legend" aria-label="Key">
    <li class="games">
      <span class="sh" aria-hidden="true"><GIcon /></span>Games
    </li>
    <li class="practices">
      <span class="sh" aria-hidden="true"><PIcon /></span>Practices
    </li>
    <li class="events">
      <span class="sh" aria-hidden="true"><EIcon /></span>Events
    </li>
  </ul>
</section>

<style>
  .month {
    padding: var(--s-4) var(--s-4) var(--s-3);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--s-3);
  }
  h2 {
    font-size: var(--t-20);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  th {
    padding: var(--s-2);
    font-size: var(--t-12);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-3);
    text-align: left;
  }
  td {
    height: 112px;
    padding: 6px;
    vertical-align: top;
    border: 1px solid var(--border);
  }
  td.out {
    background: var(--surface-2);
  }
  td.out .num {
    color: var(--text-3);
  }
  .num {
    display: inline-grid;
    place-items: center;
    min-width: 26px;
    height: 26px;
    border-radius: var(--r-full);
    font-size: var(--t-12);
    font-weight: 700;
    color: var(--text-2);
  }
  .today .num {
    background: var(--accent);
    color: var(--on-accent);
  }
  ul.list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 3px;
    margin-top: 2px;
  }
  .ev {
    overflow: hidden;
    max-width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 24px;
    padding: 2px 6px 2px 3px;
    border-radius: var(--r-sm);
    background: var(--cat-soft);
    color: var(--text);
    text-decoration: none;
    font-size: var(--t-12);
    line-height: 1.2;
    border-left: 3px solid var(--cat);
  }
  .ev:hover {
    background: color-mix(in srgb, var(--cat-soft) 70%, var(--cat));
  }
  .ev.cx .tt {
    text-decoration: line-through;
    color: var(--text-3);
  }
  .tm {
    font-weight: 700;
    color: var(--text-2);
    flex: none;
  }
  .tt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .sh {
    display: grid;
    place-items: center;
    flex: none;
    width: 18px;
    height: 18px;
    color: var(--cat);
  }
  .sh :global(svg) {
    width: 13px;
    height: 13px;
  }
  .more {
    padding-left: 6px;
    font-size: var(--t-12);
    color: var(--text-3);
    font-weight: 600;
  }
  .games {
    --cat: light-dark(#a1480a, #f6b25e);
    --cat-soft: light-dark(#fdf0e1, #33240f);
  }
  .practices {
    --cat: var(--accent-text);
    --cat-soft: var(--accent-soft);
  }
  .events {
    --cat: var(--info);
    --cat-soft: var(--info-soft);
  }
  .legend {
    display: flex;
    gap: var(--s-5);
    margin-top: var(--s-3);
    font-size: var(--t-12);
    font-weight: 650;
    color: var(--text-2);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .legend .sh {
    border-radius: var(--r-sm);
    background: var(--cat-soft);
  }
</style>
