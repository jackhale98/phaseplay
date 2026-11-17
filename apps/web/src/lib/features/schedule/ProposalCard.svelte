<!--
  A proposal ("Not confirmed yet") as a card: the same on Home, the agenda and the event page.
  Not answered → open with "I'm in / Can't" (one date) or a row per date plus "None work"; every tap
  saves at once. Once every date has an answer it folds to one line with Change. A date the coach
  adds later reopens it ("New date added").
-->
<script lang="ts">
  import { cubicInOut } from 'svelte/easing';
  import { fade, slide } from 'svelte/transition';
  import type { ProposalAnswer, TeamEvent } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { proposalView } from '#lib/data/selectors';
  import { day as dayMonth, longDay, time } from '#lib/format';
  import { IconCheck, IconX, IconMapPin } from '#lib/icons';
  import { displayTitle } from './schedule';
  import { answerProposal } from './proposals';

  type Props = {
    event: TeamEvent;
    /** `card` links to the event; `plain` sits inside the event page. */
    variant?: 'card' | 'plain';
    /** Give the card an anchor (`#p-<id>`) so "N need your answer" can jump to it. */
    anchor?: boolean;
  };
  let { event: e, variant = 'card', anchor = false }: Props = $props();

  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const v = $derived(proposalView(s, e, app.can('availability.view')));
  const poll = $derived(v.kind === 'poll');
  const title = $derived(displayTitle(e));
  let changing = $state(false);
  let said = $state('');
  const open = $derived(!v.answered || changing);

  const reduce =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const d = reduce ? 0 : 320;

  const when = (ms: number) => `${dayMonth(ms, tz)}, ${time(ms, tz)}`;
  const summary = $derived.by(() => {
    const works = v.options
      .filter((o) => o.mine === 'in')
      .map((o) => dayMonth(o.option.startsAt, tz));
    if (!poll) {
      const o = v.options[0];
      if (!o) return '';
      return o.mine === 'in'
        ? `You're in ${dayMonth(o.option.startsAt, tz)}`
        : `Can't make ${dayMonth(o.option.startsAt, tz)}`;
    }
    return works.length ? `Works: ${works.join(', ')}` : 'None work';
  });

  async function pick(optionId: string, answer: ProposalAnswer) {
    const o = v.options.find((x) => x.option.id === optionId);
    await answerProposal(e.id, [{ optionId, answer }]);
    said = `Saved: ${answer === 'in' ? (poll ? 'works' : "you're in") : "can't"} for ${
      o ? longDay(o.option.startsAt, tz) : 'that date'
    }.`;
    // One date: a change is done in one tap.
    if (!poll) changing = false;
  }
  async function noneWork() {
    await answerProposal(
      e.id,
      v.options.map((o) => ({ optionId: o.option.id, answer: 'cant' as const })),
    );
    said = 'Saved: none of the dates work.';
    changing = false;
  }
  const allCant = $derived(v.options.length > 0 && v.options.every((o) => o.mine === 'cant'));
</script>

<article
  class="prop {variant}"
  class:poll
  class:folded={!open}
  id={anchor ? `p-${e.id}` : undefined}
  aria-labelledby={variant === 'card' ? `pt-${e.id}` : undefined}
  aria-label={variant === 'card' ? undefined : `Your answer for ${title}`}
>
  <!-- One line once answered: "Date poll · v Harlequins? · ✓ Works: Sat 12, Sat 19 · Change". -->
  <div class="top">
    {#if variant === 'card'}
      <span class="chip">{poll ? 'Date poll' : 'Tentative'}</span>
      <h3 id="pt-{e.id}"><a href="/events/{e.id}">{title}?</a></h3>
    {/if}
    {#if v.newDate && !changing}<span class="new">New date added</span>{/if}
    {#if open}
      {#if variant === 'card'}<span class="sub">Not confirmed yet</span>{/if}
    {:else}
      <span class="line" in:fade={{ duration: d, delay: d / 2 }}>
        <span class="ok"><IconCheck />{summary}</span>
        <button type="button" class="change" onclick={() => (changing = true)}
          >Change<span class="sr-only"> your answer for {title}</span></button
        >
      </span>
    {/if}
  </div>

  {#if open}
    <div class="body" transition:slide={{ duration: d, easing: cubicInOut }}>
      {#if e.locationName && variant === 'card'}
        <p class="meta"><IconMapPin />{e.locationName}</p>
      {/if}
      {#if !poll && v.options[0]}
        {@const o = v.options[0]}
        <p class="when tnum">
          <strong>{when(o.option.startsAt)}</strong>
          <span class="n">{o.counts.in} in</span>
        </p>
        <div
          class="two"
          role="group"
          aria-label="Can you make it on {longDay(o.option.startsAt, tz)}?"
        >
          <button
            type="button"
            class="in"
            aria-pressed={o.mine === 'in'}
            onclick={() => pick(o.option.id, 'in')}><IconCheck />I'm in</button
          >
          <button
            type="button"
            class="cant"
            aria-pressed={o.mine === 'cant'}
            onclick={() => pick(o.option.id, 'cant')}><IconX />Can't</button
          >
        </div>
      {:else}
        <ul class="dates">
          {#each v.options as o (o.option.id)}
            <li class:new={!o.mine && v.newDate}>
              <span class="d tnum"
                ><strong>{dayMonth(o.option.startsAt, tz)}</strong>
                {time(o.option.startsAt, tz)}<span class="n">{o.counts.in} in</span></span
              >
              <div class="two" role="group" aria-label={when(o.option.startsAt)}>
                <button
                  type="button"
                  class="in"
                  aria-pressed={o.mine === 'in'}
                  onclick={() => pick(o.option.id, 'in')}><IconCheck />Works</button
                >
                <button
                  type="button"
                  class="cant"
                  aria-pressed={o.mine === 'cant'}
                  onclick={() => pick(o.option.id, 'cant')}><IconX />Can't</button
                >
              </div>
            </li>
          {/each}
        </ul>
        <div class="foot">
          <button type="button" class="none" aria-pressed={allCant} onclick={noneWork}
            >None work</button
          >
          {#if changing}
            <button type="button" class="done" onclick={() => (changing = false)}>Done</button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
  <p class="sr-only" role="status" aria-live="polite">{said}</p>
</article>

<style>
  /* Proposals look provisional everywhere: dashed outline, lighter fill, a "Tentative" chip. */
  .prop {
    position: relative;
    display: grid;
    gap: var(--s-2);
    padding: var(--s-4);
    border: 1.5px dashed var(--tent-line);
    border-radius: var(--r-lg);
    background: var(--tent-fill);
  }
  .plain {
    border: 0;
    padding: 0;
    background: none;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-1) var(--s-3);
  }
  .folded {
    padding-block: var(--s-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 var(--s-2);
    border: 1px dashed currentColor;
    border-radius: var(--r-full);
    font-size: var(--t-12);
    font-weight: 700;
    color: var(--text-2);
  }
  .new {
    font-size: var(--t-12);
    font-weight: 700;
    color: var(--info);
  }
  .sub {
    font-size: var(--t-12);
    color: var(--text-2);
  }
  h3 {
    font-size: 1.0625rem;
    margin: 0;
  }
  h3 a {
    color: inherit;
    text-decoration: none;
  }
  h3 a:hover {
    text-decoration: underline;
  }
  .body {
    display: grid;
    gap: var(--s-3);
  }
  .meta {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .meta :global(svg) {
    width: 14px;
    height: 14px;
  }
  .when {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-3);
  }
  .n {
    font-size: var(--t-14);
    font-weight: 650;
    color: var(--text-2);
  }
  .d .n {
    margin-left: var(--s-2);
  }
  .dates {
    display: grid;
    gap: var(--s-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .dates li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 220px);
    align-items: center;
    gap: var(--s-3);
  }
  .dates li.new .d strong::after {
    content: ' · new';
    color: var(--info);
    font-weight: 700;
  }
  @media (max-width: 480px) {
    .dates li {
      grid-template-columns: minmax(0, 1fr);
      gap: 6px;
    }
  }
  .two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2);
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    padding: 0 var(--s-3);
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-weight: 700;
    font-size: var(--t-14);
    color: var(--text-2);
    transition: all var(--m-fast) var(--ease);
  }
  button :global(svg) {
    width: 18px;
    height: 18px;
  }
  button:active {
    transform: scale(0.97);
  }
  .in[aria-pressed='true'] {
    --st: var(--ok);
  }
  .cant[aria-pressed='true'],
  .none[aria-pressed='true'] {
    --st: var(--danger);
  }
  [aria-pressed='true'] {
    background: var(--st);
    border-color: var(--st);
    color: var(--on-sel);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .none,
  .done {
    min-width: 120px;
  }
  .done {
    border-color: var(--sel);
    color: var(--accent-text);
  }
  .line {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--s-3);
    font-size: var(--t-14);
  }
  .ok {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 650;
  }
  .ok :global(svg) {
    width: 16px;
    height: 16px;
    color: var(--ok);
  }
  .change {
    min-height: 44px;
    border: 0;
    background: none;
    padding: 0 var(--s-1);
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  @media (prefers-reduced-motion: reduce) {
    button {
      transition: none;
    }
  }
</style>
