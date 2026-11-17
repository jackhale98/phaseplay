<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { EVENT_TYPE_LABELS, RSVP_NOTE_TTL_MS, eventCategory, isGame } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { rsvpOf, sheetFor, planFor } from '#lib/data/selectors';
  import { setRsvp } from '#lib/data/actions';
  import RsvpButtons from '#lib/components/RsvpButtons.svelte';
  import Button from '#lib/components/Button.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { relDay, longDay, time, tzName, dateTime, plural } from '#lib/format';
  import {
    IconBack,
    IconClock,
    IconMapPin,
    IconShirt,
    IconMatch,
    IconTimer,
    IconChecklist,
    IconChevronRight,
    IconEdit,
    IconTrash,
    IconAlert,
    IconRepeat,
    IconUndo,
    IconLock,
  } from '#lib/icons';
  import IconExternal from '@lucide/svelte/icons/external-link';
  import IconBan from '@lucide/svelte/icons/ban';
  import EventForm from '#lib/features/schedule/EventForm.svelte';
  import AvailabilityBoard from '#lib/features/schedule/AvailabilityBoard.svelte';
  import { TYPE_ICON } from '#lib/features/schedule/category';
  import { pendingDeletes, setCancelled } from '#lib/features/schedule/actions.svelte';
  import {
    attendanceOpen,
    displayTitle,
    mapLink,
    movedFrom,
    notesBody,
  } from '#lib/features/schedule/schedule';

  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const id = $derived(page.params.id ?? '');
  const e = $derived(pendingDeletes.hidden(id) ? undefined : s?.rows.events[id]);
  const me = $derived(s?.me);
  const manage = $derived(app.can('events.manage'));
  const seeAvail = $derived(app.can('availability.view'));
  const mine = $derived(e && me ? rsvpOf(s, e.id, me.id) : undefined);
  const counts = $derived(e ? (s?.rows.counts[e.id] ?? { yes: 0, no: 0, maybe: 0 }) : null);
  const finished = $derived(!!e && (e.endsAt ?? e.startsAt + 3 * 3600e3) <= Date.now());
  const cat = $derived(e ? eventCategory(e.type) : 'events');
  const moved = $derived(e ? movedFrom(e.notes) : null);
  const notes = $derived(e ? notesBody(e.notes) : '');
  const sheet = $derived(e ? sheetFor(s, e.id) : undefined);
  const plan = $derived(e ? planFor(s, e.id) : undefined);
  const map = $derived(e ? mapLink(e) : null);
  const deadlinePassed = $derived(!!e?.rsvpDeadline && e.rsvpDeadline < Date.now());

  let editOpen = $state(false);
  let noteOpen = $state(false);
  let noteText = $state('');

  function openNote() {
    noteText = mine?.note ?? '';
    noteOpen = true;
  }
  async function saveNote(ev: SubmitEvent) {
    ev.preventDefault();
    if (!e || !me || !mine?.status) return;
    await setRsvp(e.id, me.id, mine.status, noteText.trim(), { undo: false });
    noteOpen = false;
    toasts.success(noteText.trim() ? 'Note sent to the coaches' : 'Note removed');
  }
  async function remove() {
    if (!e) return;
    pendingDeletes.remove(e);
    await goto('/schedule');
  }
  const Icon = $derived(e ? TYPE_ICON[e.type] : TYPE_ICON.other);
</script>

<svelte:head
  ><title
    >{e ? displayTitle(e, s?.team.shortName) : 'Event'} · {s?.team.shortName ?? 'Phaseplay'}</title
  ></svelte:head
>

<div class="page">
  <a class="back" href="/schedule"><IconBack /> Schedule</a>

  {#if !s}
    <div class="sk" aria-busy="true"></div>
  {:else if !e}
    <div class="gone card">
      <h1>This event isn't on the schedule any more</h1>
      <p class="muted">It may have been deleted. Have a look at what's coming up instead.</p>
      <Button href="/schedule" variant="primary">Open the schedule</Button>
    </div>
  {:else}
    {#if e.cancelledAt}
      <div class="banner cx" role="status">
        <IconBan />
        <div class="grow">
          <strong>Cancelled</strong>
          <p>This {EVENT_TYPE_LABELS[e.type].toLowerCase()} is off. No need to reply.</p>
        </div>
        {#if manage}
          <Button size="sm" onclick={() => setCancelled(e!, false)}
            >{#snippet icon()}<IconUndo />{/snippet}Restore</Button
          >
        {/if}
      </div>
    {:else if moved}
      <div class="banner mv" role="status">
        <IconAlert />
        <div class="grow">
          <strong>Moved to {relDay(e.startsAt, tz)}, {time(e.startsAt, tz)}</strong>
          <p>It was {moved}. Check you can still make it.</p>
        </div>
      </div>
    {/if}

    <div class="layout">
      <div class="main stack">
        <header class="hero card {cat}" class:off={!!e.cancelledAt}>
          <p class="kind">
            <span class="ic" aria-hidden="true"><Icon /></span>
            {EVENT_TYPE_LABELS[e.type]}{e.format && isGame(e.type) ? ` · ${e.format}` : ''}
            {#if e.recurrenceId}<span class="series"><IconRepeat /> Weekly</span>{/if}
          </p>
          <h1>{displayTitle(e, s.team.shortName)}</h1>
          {#if e.type !== 'match' && e.opponent}<p class="muted opp">v {e.opponent}</p>{/if}
          <p class="when">
            <strong>{relDay(e.startsAt, tz)}</strong>
            {#if relDay(e.startsAt, tz) !== longDay(e.startsAt, tz)}<span class="muted"
                >· {longDay(e.startsAt, tz)}</span
              >{/if}
          </p>
          <dl class="facts">
            <div>
              <dt><IconClock /><span>{isGame(e.type) ? 'Kickoff' : 'Starts'}</span></dt>
              <dd class="tnum">
                {time(e.startsAt, tz)}{#if e.endsAt}<span class="muted"
                    >{` to ${time(e.endsAt, tz)}`}</span
                  >{/if}
                <span class="tz">{tzName(tz, e.startsAt)}</span>
              </dd>
            </div>
            {#if e.meetAt}
              <div>
                <dt><IconTimer /><span>Meet</span></dt>
                <dd class="tnum">
                  {time(e.meetAt, tz)} <span class="tz">{tzName(tz, e.meetAt)}</span>
                </dd>
              </div>
            {/if}
            {#if e.locationName || e.locationUrl}
              <div>
                <dt><IconMapPin /><span>Where</span></dt>
                <dd>
                  {e.locationName ?? 'Location'}
                  {#if map}
                    <a class="map" href={map} target="_blank" rel="noopener noreferrer"
                      >Map<IconExternal /><span class="sr-only">(opens in a new tab)</span></a
                    >
                  {/if}
                </dd>
              </div>
            {/if}
            {#if e.rsvpDeadline}
              <div>
                <dt><IconLock /><span>Reply by</span></dt>
                <dd class:late={deadlinePassed}>
                  {dateTime(e.rsvpDeadline, tz)}{deadlinePassed ? ' (passed)' : ''}
                </dd>
              </div>
            {/if}
          </dl>
        </header>

        {#if me && !e.cancelledAt}
          <section class="card pad" aria-labelledby="reply-h">
            <h2 id="reply-h" class="h">{finished ? 'Your reply' : 'Are you in?'}</h2>
            {#if finished}
              <p class="muted">
                {mine?.status === 'yes'
                  ? 'You said you were in.'
                  : mine?.status === 'no'
                    ? 'You said you were out.'
                    : mine?.status === 'maybe'
                      ? 'You said maybe.'
                      : "You didn't reply."}
                {#if mine?.attended !== null && mine?.attended !== undefined}{mine.attended
                    ? ' Marked present.'
                    : ' Marked absent.'}{/if}
              </p>
            {:else}
              <RsvpButtons
                eventId={e.id}
                memberId={me.id}
                status={mine?.status ?? null}
                size="lg"
              />
              {#if mine?.status}
                {#if noteOpen}
                  <form class="note" onsubmit={saveNote}>
                    <label for="rsvp-note">Note for the coaches</label>
                    <textarea
                      id="rsvp-note"
                      bind:value={noteText}
                      maxlength="280"
                      aria-describedby="note-h"
                      placeholder="e.g. Can't make warm-up, there by 2:30"></textarea>
                    <p id="note-h" class="subtle">
                      <IconLock /> Only coaches and managers see this. It's deleted {Math.round(
                        RSVP_NOTE_TTL_MS / 86400e3,
                      )} days after the event.
                    </p>
                    <div class="row end">
                      <Button size="sm" variant="ghost" onclick={() => (noteOpen = false)}
                        >Cancel</Button
                      >
                      <Button size="sm" variant="primary" type="submit">Send note</Button>
                    </div>
                  </form>
                {:else if mine.note}
                  <div class="mynote">
                    <p><span class="subtle">Your note:</span> “{mine.note}”</p>
                    <Button size="sm" variant="ghost" onclick={openNote}>Edit</Button>
                  </div>
                {:else}
                  <Button size="sm" variant="ghost" class="addnote" onclick={openNote}
                    >Add a note for the coaches</Button
                  >
                {/if}
              {/if}
            {/if}
            {#if counts && !seeAvail}
              <p class="counts tnum">
                <span class="c y"></span><strong>{counts.yes}</strong> in
                <span class="c m"></span>{counts.maybe} maybe
                <span class="c n"></span>{counts.no} out
              </p>
            {/if}
          </section>
        {/if}

        {#if notes}
          <section class="card pad" aria-labelledby="notes-h">
            <h2 id="notes-h" class="h">Notes</h2>
            <p class="notes">{notes}</p>
          </section>
        {/if}

        <nav class="links card" aria-label="For this event">
          <ul class="list">
            {#if isGame(e.type) && (app.can('sheets.view_draft') || sheet?.publishedAt)}
              <li>
                <a href="/events/{e.id}/sheet">
                  <span class="li-ic"><IconShirt /></span>
                  <span class="grow"
                    ><strong>Team sheet</strong><small
                      >{sheet
                        ? sheet.publishedAt
                          ? 'Published'
                          : 'Draft, only coaches can see it'
                        : 'Pick the XV and bench'}</small
                    ></span
                  >
                  <IconChevronRight />
                </a>
              </li>
            {/if}
            {#if isGame(e.type) && app.can('match.record')}
              <li>
                <a href="/events/{e.id}/match">
                  <span class="li-ic"><IconMatch /></span>
                  <span class="grow"
                    ><strong>Match mode</strong><small
                      >Clock, score, cards and subs on the sideline</small
                    ></span
                  >
                  <IconChevronRight />
                </a>
              </li>
            {/if}
            {#if e.type === 'training' && (app.can('practice.view_private') || plan)}
              <li>
                <a href="/practice?event={e.id}">
                  <span class="li-ic"><IconTimer /></span>
                  <span class="grow"
                    ><strong>Practice plan</strong><small
                      >{plan
                        ? `${plan.title} · ${plural(plan.plannedTotalMin, 'min')}`
                        : 'Plan the session'}</small
                    ></span
                  >
                  <IconChevronRight />
                </a>
              </li>
            {/if}
            {#if manage && attendanceOpen(e, tz)}
              <li>
                <a href="/events/{e.id}/attendance">
                  <span class="li-ic"><IconChecklist /></span>
                  <span class="grow"
                    ><strong>Attendance</strong><small>Tick off who turned up</small></span
                  >
                  <IconChevronRight />
                </a>
              </li>
            {/if}
          </ul>
        </nav>

        {#if manage}
          <div class="row wrap actions">
            <Button onclick={() => (editOpen = true)}
              >{#snippet icon()}<IconEdit />{/snippet}Edit</Button
            >
            {#if e.cancelledAt}
              <Button onclick={() => setCancelled(e!, false)}
                >{#snippet icon()}<IconUndo />{/snippet}Restore</Button
              >
            {:else}
              <Button onclick={() => setCancelled(e!, true)}
                >{#snippet icon()}<IconBan />{/snippet}Cancel event</Button
              >
            {/if}
            <Button variant="ghost" class="del" onclick={remove}
              >{#snippet icon()}<IconTrash />{/snippet}Delete</Button
            >
          </div>
        {/if}
      </div>

      {#if seeAvail}
        <aside class="side">
          <AvailabilityBoard event={e} />
        </aside>
      {/if}
    </div>
  {/if}
</div>

{#if manage && e}
  <EventForm bind:open={editOpen} event={e} />
{/if}

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    font-weight: 600;
    text-decoration: none;
    margin-bottom: var(--s-2);
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
  }
  .sk {
    height: 320px;
    border-radius: var(--r-lg);
    background: var(--surface-2);
  }
  .gone {
    padding: var(--s-6);
    display: grid;
    gap: var(--s-3);
    justify-items: start;
  }
  .gone h1 {
    font-size: var(--t-24);
  }
  .banner {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    margin-bottom: var(--s-4);
    border-radius: var(--r-lg);
    border: 1px solid;
  }
  .banner > :global(svg) {
    width: 22px;
    height: 22px;
    flex: none;
  }
  .banner p {
    font-size: var(--t-14);
  }
  .cx {
    background: var(--danger-soft);
    border-color: color-mix(in srgb, var(--danger) 35%, transparent);
    color: var(--danger);
  }
  .mv {
    background: var(--warn-soft);
    border-color: color-mix(in srgb, var(--warn) 35%, transparent);
    color: var(--warn);
  }
  .layout {
    display: grid;
    gap: var(--s-4);
  }
  .main {
    gap: var(--s-4);
    min-width: 0;
  }
  @media (min-width: 1024px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) minmax(360px, 440px);
      align-items: start;
    }
    .side {
      position: sticky;
      top: var(--s-6);
    }
  }
  .hero {
    padding: var(--s-5);
    background: linear-gradient(160deg, var(--cat-soft), var(--surface) 60%), var(--surface);
  }
  .games {
    --cat: light-dark(#a1480a, #f6b25e);
    --cat-soft: light-dark(#fdf0e1, #2c2010);
  }
  .practices {
    --cat: var(--accent-text);
    --cat-soft: var(--accent-softer);
  }
  .events {
    --cat: var(--info);
    --cat-soft: var(--info-soft);
  }
  .kind {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-14);
    font-weight: 700;
    color: var(--cat);
  }
  .ic {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid color-mix(in srgb, var(--cat) 30%, transparent);
  }
  .ic :global(svg) {
    width: 16px;
    height: 16px;
  }
  .series {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    font-weight: 600;
    color: var(--text-2);
  }
  .series :global(svg) {
    width: 14px;
    height: 14px;
  }
  h1 {
    margin: var(--s-3) 0 var(--s-1);
    font-size: clamp(1.75rem, 5vw, 2.5rem);
  }
  .off h1 {
    text-decoration: line-through;
    color: var(--text-3);
  }
  .opp {
    font-weight: 600;
  }
  .when {
    font-size: 1.0625rem;
    margin-bottom: var(--s-4);
  }
  .facts {
    display: grid;
    gap: var(--s-3);
    margin: 0;
  }
  .facts div {
    display: grid;
    grid-template-columns: 112px 1fr;
    gap: var(--s-3);
    align-items: baseline;
  }
  dt {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-14);
    color: var(--text-2);
  }
  dt :global(svg) {
    width: 16px;
    height: 16px;
    flex: none;
  }
  dd {
    margin: 0;
    font-weight: 650;
  }
  .tz {
    margin-left: 4px;
    font-size: var(--t-12);
    font-weight: 600;
    color: var(--text-3);
  }
  .late {
    color: var(--danger);
  }
  .map {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: var(--s-2);
    font-size: var(--t-14);
    min-height: 24px;
  }
  .map :global(svg) {
    width: 14px;
    height: 14px;
  }
  .pad {
    padding: var(--s-5);
    display: grid;
    gap: var(--s-3);
  }
  .h {
    font-size: var(--t-16);
  }
  .note {
    display: grid;
    gap: var(--s-2);
  }
  .note label {
    font-weight: 650;
    font-size: var(--t-14);
  }
  .note textarea {
    width: 100%;
    min-height: 80px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    resize: vertical;
  }
  .note .subtle {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: var(--t-12);
  }
  .note .subtle :global(svg) {
    width: 14px;
    height: 14px;
    flex: none;
  }
  .end {
    justify-content: flex-end;
  }
  .mynote {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    font-size: var(--t-14);
  }
  :global(.addnote) {
    justify-self: start;
  }
  .counts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .c {
    width: 10px;
    height: 10px;
    margin-left: var(--s-2);
  }
  .c:first-child {
    margin-left: 0;
  }
  .c.y {
    border-radius: 50%;
    background: var(--ok);
  }
  .c.m {
    border-radius: 50%;
    border: 2px solid var(--maybe);
  }
  .c.n {
    border-radius: 2px;
    background: var(--no);
  }
  .notes {
    white-space: pre-line;
  }
  .links {
    overflow: hidden;
  }
  .links:not(:has(li)) {
    display: none;
  }
  .links a {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 60px;
    padding: var(--s-2) var(--s-4);
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px solid var(--border);
  }
  .links li:last-child a {
    border-bottom: 0;
  }
  .links a:hover {
    background: var(--surface-2);
  }
  .links small {
    display: block;
    color: var(--text-2);
    font-size: var(--t-12);
  }
  .links a > :global(svg:last-child) {
    width: 18px;
    height: 18px;
    color: var(--text-3);
  }
  .li-ic {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--r-md);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .li-ic :global(svg) {
    width: 20px;
    height: 20px;
  }
  .actions :global(.del) {
    color: var(--danger);
  }
</style>
