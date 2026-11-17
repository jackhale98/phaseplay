<script lang="ts">
  import Loader from '#lib/components/Loader.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { type PlanData } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { upcoming } from '#lib/data/selectors';
  import Button from '#lib/components/Button.svelte';
  import Field from '#lib/components/Field.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import { day, time } from '#lib/format';
  import {
    addSlot,
    copyPlanData,
    emptyPlan,
    fmtMin,
    lastPlanBefore,
    makeBlock,
    plansByEvent,
  } from '#lib/features/practice/model';
  import { createPlan } from '#lib/features/practice/ui.svelte';
  import { IconChevronLeft } from '#lib/icons';

  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const q = $derived(page.url.searchParams);
  const coach = $derived(app.can('practice.manage'));
  const plans = $derived(Object.values(s?.rows.plans ?? {}).filter((p) => !p.deletedAt));
  const byEvent = $derived(plansByEvent(s?.rows.plans));
  const sessions = $derived(
    upcoming(s)
      .filter((e) => e.type === 'training' && !e.cancelledAt)
      .slice(0, 12),
  );
  const drill = $derived(q.get('drill') ? s?.rows.drills[q.get('drill')!] : undefined);

  let eventId = $state<string>('');
  let source = $state<string>('blank');
  let title = $state('');
  let touchedTitle = false;
  let busy = $state(false);
  let init = false;

  const event = $derived(eventId ? s?.rows.events[eventId] : undefined);
  const existing = $derived(eventId ? byEvent.get(eventId) : undefined);
  const last = $derived(
    lastPlanBefore(s?.rows.plans, s?.rows.events, event?.startsAt ?? Date.now()),
  );
  const templates = $derived(plans.filter((p) => p.isTemplate));
  const copyOf = $derived(q.get('copy') ? s?.rows.plans[q.get('copy')!] : undefined);

  $effect(() => {
    if (init || !s) return;
    init = true;
    const want = q.get('event');
    eventId = want && s.rows.events[want] ? want : '';
    if (q.get('template') && s.rows.plans[q.get('template')!]) source = `plan:${q.get('template')}`;
    else if (copyOf) source = `plan:${copyOf.id}`;
  });

  const defaultTitle = $derived(event ? `${day(event.startsAt, tz)} practice` : 'Practice plan');
  $effect(() => {
    if (!touchedTitle) title = defaultTitle;
  });

  function sourceData(): PlanData {
    if (source.startsWith('plan:')) {
      const p = s?.rows.plans[source.slice(5)];
      if (p) return copyPlanData(p.data);
    }
    const blank = emptyPlan();
    return drill ? addSlot(blank, makeBlock('drill', 'all', drill)) : blank;
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const id = await createPlan({
        title: title || defaultTitle,
        eventId: eventId || null,
        data: sourceData(),
      });
      await goto(`/practice/${id}`, { replaceState: true });
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>New plan · Practice</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/practice"><IconChevronLeft />Practice</a>
  <header class="page-head"><h1>New practice plan</h1></header>

  {#if !s}
    <Loader />
  {:else if !coach}
    <EmptyState
      title="Coaches plan sessions"
      body="Ask a coach to plan this practice. You'll see it in Today's session."
    />
  {:else}
    <form class="card form" onsubmit={create}>
      <Field label="Practice">
        {#snippet children({ id })}
          <select {id} bind:value={eventId}>
            <option value="">Not attached (plan ahead)</option>
            {#each sessions as e (e.id)}
              <option value={e.id} disabled={byEvent.has(e.id) && e.id !== eventId}
                >{day(e.startsAt, tz)}, {time(e.startsAt, tz)} · {e.title}{byEvent.has(e.id)
                  ? ' (planned)'
                  : ''}</option
              >
            {/each}
          </select>
        {/snippet}
      </Field>

      {#if existing}
        <p class="note">
          This practice already has a plan. <a href="/practice/{existing.id}"
            >Open “{existing.title}”</a
          >
        </p>
      {/if}

      <Field label="Title">
        {#snippet children({ id })}
          <input
            {id}
            type="text"
            maxlength="80"
            bind:value={title}
            oninput={() => (touchedTitle = true)}
            required
          />
        {/snippet}
      </Field>

      <fieldset>
        <legend>Start from</legend>
        <label class="opt">
          <input type="radio" name="src" value="blank" bind:group={source} />
          <span
            ><strong>{drill ? `Start with ${drill.title}` : 'Blank plan'}</strong><small
              class="muted"
              >{drill
                ? `${drill.defaultDurationMin} min, then add the rest`
                : 'Build it block by block'}</small
            ></span
          >
        </label>
        {#if last && last.id !== copyOf?.id}
          <label class="opt">
            <input type="radio" name="src" value="plan:{last.id}" bind:group={source} />
            <span
              ><strong>Copy last week's plan</strong><small class="muted"
                >{last.title} · {fmtMin(last.plannedTotalMin)}</small
              ></span
            >
          </label>
        {/if}
        {#if copyOf}
          <label class="opt">
            <input type="radio" name="src" value="plan:{copyOf.id}" bind:group={source} />
            <span
              ><strong>Copy “{copyOf.title}”</strong><small class="muted"
                >{fmtMin(copyOf.plannedTotalMin)}</small
              ></span
            >
          </label>
        {/if}
        {#each templates as t (t.id)}
          <label class="opt">
            <input type="radio" name="src" value="plan:{t.id}" bind:group={source} />
            <span
              ><strong>{t.title}</strong><small class="muted"
                >Template · {fmtMin(t.plannedTotalMin)} · {t.data.slots.length} blocks</small
              ></span
            >
          </label>
        {/each}
      </fieldset>

      <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!!existing}
        >Create plan</Button
      >
    </form>
  {/if}
</div>

<style>
  .narrow {
    max-width: 640px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-height: 32px;
    font-size: var(--t-14);
    font-weight: 650;
    text-decoration: none;
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
    padding: var(--s-5);
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  legend {
    margin-bottom: var(--s-2);
    font-size: var(--t-14);
    font-weight: 650;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 56px;
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    cursor: pointer;
  }
  .opt:has(input:checked) {
    border-color: var(--accent);
    background: var(--accent-softer);
  }
  .opt input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
    flex: none;
  }
  .opt small {
    display: block;
    font-size: var(--t-12);
  }
  .note {
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: var(--t-14);
    font-weight: 600;
  }
</style>
