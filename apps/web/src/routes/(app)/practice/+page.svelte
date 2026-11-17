<script lang="ts">
  import { EVENT_TYPE_LABELS, can, type PracticePlan, type TeamEvent } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { upcoming } from '#lib/data/selectors';
  import Button from '#lib/components/Button.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import { ago, day, relDay, time, ymd } from '#lib/format';
  import { fmtMin, plansByEvent } from '#lib/features/practice/model';
  import { hiddenPlans } from '#lib/features/practice/ui.svelte';
  import {
    IconPlus,
    IconPlay,
    IconChevronRight,
    IconTimer,
    IconClipboard,
    IconEye,
    IconCalendarPlus,
  } from '#lib/icons';

  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const coach = $derived(can(app.role, 'practice.manage'));
  const runner = $derived(can(app.role, 'practice.run'));
  const plans = $derived(
    Object.values(s?.rows.plans ?? {}).filter(
      (p) => !p.deletedAt && !hiddenPlans.ids.includes(p.id),
    ),
  );
  const byEvent = $derived(plansByEvent(Object.fromEntries(plans.map((p) => [p.id, p]))));
  const sessions = $derived(
    upcoming(s)
      .filter((e) => e.type === 'training' && !e.cancelledAt)
      .slice(0, 6),
  );
  const today = $derived(
    sessions.find((e) => ymd(e.startsAt, tz) === ymd(Date.now(), tz) && byEvent.has(e.id)),
  );
  const templates = $derived(
    plans.filter((p) => p.isTemplate).sort((a, b) => a.title.localeCompare(b.title)),
  );
  const recent = $derived(
    plans
      .filter((p) => !p.isTemplate && !sessions.some((e) => e.id === p.eventId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8),
  );
  const weekday = (ms: number) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: tz }).format(ms);
  const span = (e: TeamEvent) =>
    `${time(e.startsAt, tz)}${e.endsAt ? `–${time(e.endsAt, tz)}` : ''}`;
  const blocks = (p: PracticePlan) => p.data.slots.length;
</script>

<svelte:head><title>Practice · {s?.team.shortName ?? 'Phaseplay'}</title></svelte:head>

<div class="page">
  <header class="page-head">
    <div>
      <p class="eyebrow">{s?.team.name ?? ''}</p>
      <h1>Practice</h1>
    </div>
    {#if coach}
      <Button variant="primary" href="/practice/new"
        >{#snippet icon()}<IconPlus />{/snippet}New plan</Button
      >
    {/if}
  </header>

  {#if !s}
    <div class="sk" aria-busy="true"></div>
  {:else}
    {#if today}
      {@const p = byEvent.get(today.id)!}
      <section class="card hero" aria-labelledby="today-h">
        <p class="eyebrow">Today · {span(today)}</p>
        <h2 id="today-h">{p.title}</h2>
        <p class="muted">{fmtMin(p.plannedTotalMin)} · {blocks(p)} blocks</p>
        <div class="row wrap">
          {#if runner}
            <Button variant="primary" href="/practice/{p.id}/run"
              >{#snippet icon()}<IconPlay />{/snippet}Live session</Button
            >
          {/if}
          <Button href="/practice/{p.id}">{#snippet icon()}<IconEye />{/snippet}View plan</Button>
        </div>
      </section>
    {/if}

    <h2 class="section-title">Coming up</h2>
    {#if !sessions.length}
      <EmptyState
        title="No practices scheduled"
        body={coach
          ? 'Add a practice to the schedule, then plan it here.'
          : "When your coach schedules practices, they'll show up here."}
      >
        {#snippet icon()}<IconCalendarPlus />{/snippet}
        {#snippet action()}
          {#if can(app.role, 'events.manage')}<Button href="/schedule?new=1">Add a practice</Button
            >{/if}
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="list stack sessions">
        {#each sessions as e (e.id)}
          {@const p = byEvent.get(e.id)}
          <li class="card session" class:planned={!!p}>
            <div class="date" aria-hidden="true">
              <span>{day(e.startsAt, tz).split(' ')[0]}</span>
              <strong class="tnum"
                >{new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: tz }).format(
                  e.startsAt,
                )}</strong
              >
            </div>
            <div class="grow info">
              <p class="t">{e.title || EVENT_TYPE_LABELS.training}</p>
              <p class="muted small">{relDay(e.startsAt, tz)} · {span(e)}</p>
              {#if p}
                <a class="plan-link" href="/practice/{p.id}">
                  <IconClipboard /><span class="truncate">{p.title}</span><small class="tnum"
                    >{fmtMin(p.plannedTotalMin)}</small
                  >
                </a>
              {:else if !coach}
                <p class="subtle">No plan yet</p>
              {/if}
            </div>
            <div class="acts">
              {#if p}
                {#if runner}
                  <Button size="sm" href="/practice/{p.id}/run" aria-label="Live session: {p.title}"
                    >{#snippet icon()}<IconPlay />{/snippet}Live</Button
                  >
                {:else}
                  <Button size="sm" href="/practice/{p.id}">View</Button>
                {/if}
              {:else if coach}
                <Button size="sm" variant="primary" href="/practice/new?event={e.id}"
                  >Plan {weekday(e.startsAt)}'s practice</Button
                >
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if coach}
      <h2 class="section-title">Templates</h2>
      {#if templates.length}
        <ul class="list grid">
          {#each templates as p (p.id)}
            <li class="card tpl">
              <a class="tpl-main" href="/practice/{p.id}">
                <strong>{p.title}</strong>
                <small class="muted">{fmtMin(p.plannedTotalMin)} · {blocks(p)} blocks</small>
              </a>
              <Button size="sm" href="/practice/new?template={p.id}" aria-label="Use {p.title}"
                >Use</Button
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="subtle">Save any plan as a template from its options menu to reuse it here.</p>
      {/if}
    {/if}

    {#if recent.length && coach}
      <h2 class="section-title">Recent plans</h2>
      <ul class="list stack recent">
        {#each recent as p (p.id)}
          {@const e = p.eventId ? s.rows.events[p.eventId] : undefined}
          <li>
            <a class="card link" href="/practice/{p.id}">
              <span class="ic"><IconTimer /></span>
              <span class="grow">
                <strong>{p.title}</strong>
                <small class="muted"
                  >{e ? `${day(e.startsAt, tz)} · ` : ''}{fmtMin(p.plannedTotalMin)} · edited {ago(
                    p.updatedAt,
                  )}</small
                >
              </span>
              <IconChevronRight />
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .sk {
    height: 260px;
    border-radius: var(--r-lg);
    background: var(--surface-2);
  }
  .hero {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-5);
    background: linear-gradient(135deg, var(--accent-soft), var(--surface) 70%);
  }
  .hero h2 {
    font-size: var(--t-24);
  }
  .sessions {
    gap: var(--s-2);
  }
  .session {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
  }
  .date {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 56px;
    border-radius: var(--r-md);
    background: var(--surface-2);
    line-height: 1.1;
  }
  .date span {
    font-size: var(--t-12);
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .date strong {
    font-size: var(--t-20);
  }
  .planned .date {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .planned .date span {
    color: var(--accent-text);
  }
  .info {
    flex: 1 1 180px;
  }
  .t {
    font-weight: 700;
  }
  .small {
    font-size: var(--t-14);
  }
  .plan-link {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    max-width: 100%;
    min-height: 32px;
    margin-top: 2px;
    font-size: var(--t-14);
    font-weight: 650;
    text-decoration: none;
  }
  .plan-link :global(svg) {
    width: 16px;
    height: 16px;
    flex: none;
  }
  .plan-link small {
    white-space: nowrap;
    color: var(--text-2);
    font-weight: 500;
  }
  .acts {
    margin-left: auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--s-2);
  }
  .tpl {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
  }
  .tpl-main {
    flex: 1;
    min-width: 0;
    color: var(--text);
    text-decoration: none;
  }
  .tpl-main small {
    display: block;
  }
  .recent {
    gap: var(--s-2);
  }
  .link {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    color: var(--text);
    text-decoration: none;
  }
  .link small {
    display: block;
  }
  .link > :global(svg:last-child) {
    width: 18px;
    height: 18px;
    color: var(--text-3);
  }
  .ic {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--r-md);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ic :global(svg) {
    width: 20px;
    height: 20px;
  }
</style>
