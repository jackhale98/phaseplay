<!--
  The event page for a proposal ("Not confirmed yet"). Everyone answers here too. Each date shows
  how close it is to the players needed, the counts and (for games) front-row cover; the best date
  is marked. Staff confirm a date in one step, edit, nudge or drop it.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    EVENT_TYPE_LABELS,
    eventTimeLabel,
    isGame,
    isTimeTbd,
    positionsFor,
    type Member,
    type TeamEvent,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { proposalView } from '#lib/data/selectors';
  import Button from '#lib/components/Button.svelte';
  import Field from '#lib/components/Field.svelte';
  import { copyText } from '#lib/share';
  import { toasts } from '#lib/stores/toast.svelte';
  import { day as dayMonth, longDay, plural, tzName } from '#lib/format';
  import {
    IconCheck,
    IconCopy,
    IconEdit,
    IconMapPin,
    IconStar,
    IconTrash,
    IconLock,
  } from '#lib/icons';
  import ProposalCard from './ProposalCard.svelte';
  import { displayTitle, hhmm, mapLink, notesBody } from './schedule';
  import { confirmProposal } from './proposals';
  import { pendingDeletes } from './actions.svelte';
  import { zonedToUtc, dateInTz } from '@phaseplay/shared';

  type Props = { event: TeamEvent; onedit: () => void };
  let { event: e, onedit }: Props = $props();

  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const manage = $derived(app.can('events.manage'));
  const v = $derived(proposalView(s, e, app.can('availability.view')));
  const game = $derived(isGame(e.type));
  const title = $derived(displayTitle(e, s?.team.shortName));
  const notes = $derived(notesBody(e.notes));
  const map = $derived(mapLink(e));
  const dates = $derived(v.options.map((o) => dayMonth(o.option.startsAt, tz)));

  /** Everyone's answer per date, for coaches (and players when the team shows names). */
  type Row = { m: Member; by: Record<string, 'in' | 'cant'> };
  const answered = $derived.by((): Row[] => {
    const rows: Record<string, Row> = {};
    for (const o of v.options)
      for (const [list, a] of [
        [o.inPeople, 'in'],
        [o.cantPeople, 'cant'],
      ] as const)
        for (const m of list) (rows[m.id] ??= { m, by: {} }).by[o.option.id] = a;
    return Object.values(rows).sort((a, b) => a.m.displayName.localeCompare(b.m.displayName));
  });
  const positions = $derived(positionsFor(e.format ?? '15s'));
  const pos = (m: Member) =>
    game && m.positions[0] ? positions.find((p) => p.n === m.positions[0])?.short : undefined;

  /**
   * The date being confirmed (one step, inline), a meet time if the date has none, and for a
   * "Time TBD" date an optional time (left blank, it stays TBD).
   */
  let confirming = $state<string | null>(null);
  let meet = $state('');
  let start = $state('');
  let dropping = $state(false);
  function askConfirm(optionId: string) {
    confirming = optionId;
    dropping = false;
    const o = v.options.find((x) => x.option.id === optionId)?.option;
    start = '';
    meet = o && !o.meetAt && game && !isTimeTbd(o) ? hhmm(o.startsAt - 60 * 60e3, tz) : '';
  }
  async function confirm(optionId: string) {
    const o = v.options.find((x) => x.option.id === optionId);
    if (!o) return;
    const date = dateInTz(o.option.startsAt, tz);
    const tbd = isTimeTbd(o.option);
    const startsAt = tbd && start ? zonedToUtc(date, start, tz) : undefined;
    const kickoff = startsAt ?? o.option.startsAt;
    const needMeet = game && !o.option.meetAt && (!tbd || startsAt !== undefined);
    const meetAt = needMeet && meet ? zonedToUtc(date, meet, tz) : undefined;
    if (meetAt !== undefined && meetAt > kickoff) {
      toasts.error('Meet time must be before kick-off');
      return;
    }
    await confirmProposal(e, optionId, meetAt, startsAt);
    confirming = null;
    // The page becomes the confirmed event: start from the top, not mid-list under the header.
    window.scrollTo({ top: 0, behavior: 'instant' });
    toasts.success(
      `${dayMonth(o.option.startsAt, tz)} is on. ${plural(o.counts.in, 'person', 'people')} marked Yes.`,
    );
  }
  async function drop() {
    pendingDeletes.drop(e);
    await goto('/schedule');
  }
  async function nudge() {
    const names = v.unanswered.map((m) => m.displayName.split(' ')[0]).join(', ');
    const text = `${game ? 'Would you play?' : 'Are you in?'} ${title}: ${dates.join(' or ')}.${
      names ? ` Still need an answer from ${names}.` : ''
    } Answer on Phaseplay: ${location.origin}/events/${e.id}`;
    toasts.show(
      (await copyText(text)) ? 'Nudge copied. Paste it in the group chat' : "Couldn't copy",
    );
  }
  const pct = (n: number) => Math.min(100, Math.round((n / Math.max(1, v.target)) * 100));
</script>

<header class="hero">
  <p class="kind">
    <span class="chip">{v.kind === 'poll' ? 'Date poll' : 'Tentative'}</span>
    {EVENT_TYPE_LABELS[e.type]}{e.format && game ? ` · ${e.format}` : ''} · Not confirmed yet
  </p>
  <h1>{title}?</h1>
  <dl class="facts">
    {#if e.answerBy}
      <div>
        <dt><IconLock /><span>Answers by</span></dt>
        <dd>{longDay(e.answerBy, tz)}</dd>
      </div>
    {/if}
    {#if game}
      <div>
        <dt><IconCheck /><span>Need</span></dt>
        <dd>{plural(v.target, 'player')}</dd>
      </div>
    {/if}
    {#if e.locationName}
      <div>
        <dt><IconMapPin /><span>Where</span></dt>
        <dd>
          {e.locationName}{#if map}
            <span aria-hidden="true">&nbsp;·</span>
            <a href={map} target="_blank" rel="noopener noreferrer"
              >Map<span class="sr-only"> (opens in a new tab)</span></a
            >{/if}
        </dd>
      </div>
    {/if}
  </dl>
</header>

<section class="card pad" aria-labelledby="ans-h">
  <h2 id="ans-h" class="h">Your answer</h2>
  <ProposalCard event={e} variant="plain" />
</section>

<section class="card pad" aria-labelledby="dates-h">
  <h2 id="dates-h" class="h">{v.kind === 'poll' ? 'The dates' : 'Who can make it'}</h2>
  <ul class="dates">
    {#each v.options as o (o.option.id)}
      {@const best = v.best === o.option.id && v.options.length > 1}
      <li class:best>
        <div class="row1">
          <h3 class="tnum">
            {longDay(o.option.startsAt, tz)}<span class="t">, {eventTimeLabel(o.option, tz)}</span>
          </h3>
          {#if best}<span class="bestchip"><IconStar />Best date</span>{/if}
        </div>
        <div
          class="bar"
          role="meter"
          aria-valuemin="0"
          aria-valuemax={v.target}
          aria-valuenow={Math.min(o.counts.in, v.target)}
          aria-label="{o.counts.in} of {v.target} needed"
        >
          <span style:width="{pct(o.counts.in)}%" class:full={o.counts.in >= v.target}></span>
        </div>
        <p class="nums tnum">
          <strong>{o.counts.in} in</strong
          >{`${game ? ` of ${v.target} needed` : ''} · ${o.counts.cant} can't`}
        </p>
        {#if o.cover}
          <p class="cover" class:ok={o.cover.ok}>
            {#if o.cover.ok}
              Front row ✓ ({plural(o.cover.props, 'prop')}, {plural(o.cover.hookers, 'hooker')})
            {:else}
              ⚠ {o.cover.short}
            {/if}
          </p>
        {/if}
        {#if manage}
          {#if confirming === o.option.id}
            <div class="confirm" role="group" aria-labelledby="cf-{o.option.id}">
              <p id="cf-{o.option.id}">
                <strong>Confirm {dayMonth(o.option.startsAt, tz)}?</strong>
                {plural(o.counts.in, 'person is', 'people are')} in. They'll be marked Yes and asked to
                reconfirm.
              </p>
              {#if isTimeTbd(o.option)}
                <Field
                  label="{game ? 'Kickoff' : 'Start'} time (optional)"
                  hint="Leave blank to keep it Time TBD · {tzName(tz, o.option.startsAt)}"
                >
                  {#snippet children({ id, describedby })}
                    <input {id} type="time" aria-describedby={describedby} bind:value={start} />
                  {/snippet}
                </Field>
              {/if}
              {#if game && !o.option.meetAt && (!isTimeTbd(o.option) || start)}
                <Field label="Meet time (optional)" hint={tzName(tz, o.option.startsAt)}>
                  {#snippet children({ id, describedby })}
                    <input {id} type="time" aria-describedby={describedby} bind:value={meet} />
                  {/snippet}
                </Field>
              {/if}
              <div class="row wrap">
                <Button size="sm" variant="ghost" onclick={() => (confirming = null)}
                  >Not yet</Button
                >
                <Button size="sm" variant="primary" onclick={() => confirm(o.option.id)}
                  >Confirm {dayMonth(o.option.startsAt, tz)}</Button
                >
              </div>
            </div>
          {:else}
            <Button
              size="sm"
              variant={best || v.options.length === 1 ? 'primary' : 'secondary'}
              onclick={() => askConfirm(o.option.id)}
              >Confirm {dayMonth(o.option.startsAt, tz)}<span class="sr-only"
                >{`, ${longDay(o.option.startsAt, tz)}`}</span
              ></Button
            >
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
  {#if !v.names && v.unanswered.length}
    <p class="subtle">
      {plural(v.unanswered.length, 'person hasn’t', 'people haven’t')} answered yet.
    </p>
  {/if}
</section>

{#if v.names}
  <section class="card pad" aria-labelledby="who-h">
    <h2 id="who-h" class="h">Who answered what</h2>
    {#if answered.length}
      <div class="tablewrap">
        <table class="answers">
          <caption class="sr-only">Each person's answer for each date</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              {#each v.options as o, i (o.option.id)}
                <th scope="col" class="tnum">{dates[i]}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each answered as r (r.m.id)}
              <tr>
                <th scope="row">
                  {r.m.displayName}{#if pos(r.m)}<small class="pos"> {pos(r.m)}</small>{/if}
                </th>
                {#each v.options as o (o.option.id)}
                  {@const a = r.by[o.option.id]}
                  <td class="ans {a ?? 'none'}">
                    {#if a === 'in'}<span aria-hidden="true">✓</span> In{:else if a === 'cant'}<span
                        aria-hidden="true">✕</span
                      > Can't{:else}<span class="sr-only">No answer</span><span aria-hidden="true"
                        >–</span
                      >{/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="muted">Nobody has answered yet.</p>
    {/if}
    {#if v.unanswered.length}
      <p class="none-yet">
        <strong>{plural(v.unanswered.length, 'person hasn’t', 'people haven’t')} answered:</strong>
        {v.unanswered.map((m) => m.displayName).join(', ')}
      </p>
    {/if}
  </section>
{/if}

{#if notes}
  <section class="card pad" aria-labelledby="pn-h">
    <h2 id="pn-h" class="h">Notes</h2>
    <p class="notes">{notes}</p>
  </section>
{/if}

{#if manage}
  <div class="row wrap actions">
    <Button onclick={onedit}>{#snippet icon()}<IconEdit />{/snippet}Edit</Button>
    <Button onclick={nudge}>{#snippet icon()}<IconCopy />{/snippet}Copy a nudge</Button>
    {#if dropping}
      <div class="row wrap drop" role="group" aria-label="Drop this proposal">
        <span>Not going ahead? Everyone who answered hears it's off.</span>
        <Button size="sm" variant="ghost" onclick={() => (dropping = false)}>Keep it</Button>
        <Button size="sm" variant="danger" onclick={drop}>Drop it</Button>
      </div>
    {:else}
      <Button variant="ghost" onclick={() => ((dropping = true), (confirming = null))}
        >{#snippet icon()}<IconTrash />{/snippet}Drop</Button
      >
    {/if}
  </div>
{/if}

<style>
  .tablewrap {
    overflow-x: auto;
    margin-top: var(--s-3);
  }
  .answers {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--t-14);
  }
  .answers th,
  .answers td {
    padding: var(--s-2) var(--s-2);
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }
  .answers thead th {
    color: var(--text-2);
    font-weight: 650;
  }
  .answers tbody th {
    font-weight: 600;
  }
  .answers .pos {
    color: var(--text-3);
    font-weight: 600;
  }
  .ans.in {
    color: var(--ok-text, var(--ok));
    font-weight: 650;
  }
  .ans.cant {
    color: var(--text-2);
  }
  .ans.none {
    color: var(--text-3);
  }
  .none-yet {
    margin: var(--s-3) 0 0;
    font-size: var(--t-14);
  }
  .hero {
    padding: var(--s-5);
    border: 1.5px dashed var(--tent-line);
    border-radius: var(--r-lg);
    background: var(--tent-fill);
  }
  .kind {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-14);
    font-weight: 650;
    color: var(--text-2);
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
  }
  h1 {
    font-size: var(--t-32);
    letter-spacing: -0.02em;
    margin: var(--s-2) 0 var(--s-3);
  }
  .facts {
    display: grid;
    gap: var(--s-2);
    margin: 0;
  }
  .facts div {
    display: flex;
    gap: var(--s-3);
    align-items: baseline;
    font-size: var(--t-14);
  }
  dt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 110px;
    color: var(--text-2);
  }
  dt :global(svg) {
    width: 16px;
    height: 16px;
  }
  dd {
    margin: 0;
  }
  .pad {
    padding: var(--s-4) var(--s-5);
  }
  .h {
    font-size: var(--t-16);
    margin-bottom: var(--s-3);
  }
  .dates {
    display: grid;
    gap: var(--s-4);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .dates li {
    display: grid;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    justify-items: start;
  }
  .dates li.best {
    border-color: var(--ok);
    box-shadow: inset 4px 0 0 var(--ok);
  }
  .row1 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-2) var(--s-3);
  }
  h3 {
    margin: 0;
    font-size: var(--t-16);
  }
  .t {
    font-weight: 500;
    color: var(--text-2);
  }
  .bestchip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--s-2);
    border-radius: var(--r-full);
    background: var(--ok);
    color: var(--on-sel);
    font-size: var(--t-12);
    font-weight: 700;
  }
  .bestchip :global(svg) {
    width: 12px;
    height: 12px;
  }
  .bar {
    width: 100%;
    height: 8px;
    border-radius: 4px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--warn);
    border-radius: inherit;
  }
  .bar span.full {
    background: var(--ok);
  }
  .nums {
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .nums strong {
    color: var(--text);
  }
  .cover {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-14);
    font-weight: 650;
    color: var(--warn);
  }
  .cover.ok {
    color: var(--ok);
  }
  .cover :global(svg) {
    width: 16px;
    height: 16px;
    flex: none;
  }
  .who {
    font-size: var(--t-14);
  }
  .who summary {
    cursor: pointer;
    min-height: 32px;
    display: flex;
    align-items: center;
    color: var(--accent-text);
    font-weight: 650;
  }
  .who p {
    margin-top: var(--s-1);
    color: var(--text-2);
  }
  .confirm {
    display: grid;
    gap: var(--s-3);
    width: 100%;
    padding: var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .confirm p {
    font-size: var(--t-14);
  }
  .notes {
    white-space: pre-wrap;
  }
  .actions {
    gap: var(--s-2);
  }
  .drop {
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-14);
  }
</style>
