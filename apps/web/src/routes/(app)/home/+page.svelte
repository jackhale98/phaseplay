<script lang="ts">
  import { untrack } from 'svelte';
  import { cubicInOut, cubicOut } from 'svelte/easing';
  import { fade, fly, slide } from 'svelte/transition';
  import { GROUP_LABELS, isGame, type RsvpStatus } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import {
    upcoming,
    myRsvp,
    availability,
    sheetFor,
    memberName,
    needMyAnswer,
    toReconfirm,
  } from '#lib/data/selectors';
  import ProposalCard from '#lib/features/schedule/ProposalCard.svelte';
  import StillIn from '#lib/features/schedule/StillIn.svelte';
  import EventCard from '#lib/components/EventCard.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Button from '#lib/components/Button.svelte';
  import NotifyPrompt from '#lib/features/notify/NotifyPrompt.svelte';
  import { copyText } from '#lib/share';
  import KitHome from '#lib/features/kit/KitHome.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { relDay, time, ago } from '#lib/format';
  import {
    IconCalendarPlus,
    IconShirt,
    IconPlaybook,
    IconCopy,
    IconWarn,
    IconUserPlus,
    IconChevronRight,
    IconCheck,
  } from '#lib/icons';

  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const me = $derived(s?.me);
  const staff = $derived(app.can('events.manage'));
  const next = $derived(upcoming(s).filter((e) => !e.cancelledAt));
  const hero = $derived(next[0]);
  const awaiting = $derived(
    next
      .slice(1)
      .filter((e) => e.startsAt < Date.now() + 21 * 86400e3 && !myRsvp(s, e.id))
      .slice(0, 4),
  );
  /**
   * A reply takes the card out of "Waiting for your reply". Hold it for a moment with a clear
   * confirmation, then let it slide away so the next event visibly moves up (people tapping quickly
   * shouldn't answer for the wrong event without noticing).
   */
  const HOLD_MS = 1400;
  let held = $state<Record<string, RsvpStatus>>({});
  let caughtUp = $state(false);
  let said = $state('');
  let prevIds: string[] = [];
  const reduce =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const d = reduce ? 0 : 280;
  const REPLY_TEXT: Record<RsvpStatus, string> = {
    yes: "You're in",
    maybe: 'Marked maybe',
    no: "You're out",
  };
  $effect(() => {
    const ids = awaiting.map((e) => e.id);
    const snap = s;
    untrack(() => {
      for (const id of prevIds) {
        const status = myRsvp(snap, id);
        if (ids.includes(id) || !status || held[id]) continue;
        held = { ...held, [id]: status };
        const ev = snap?.rows.events[id];
        const nextEv = awaiting.find((e) => e.id !== id);
        said = `Saved: ${REPLY_TEXT[status]} for ${ev?.title ?? 'that event'}.${nextEv ? ` Next: ${nextEv.title}, ${relDay(nextEv.startsAt, tz)}.` : ''}`;
        if (!ids.length) caughtUp = true;
        setTimeout(() => {
          const { [id]: _, ...rest } = held;
          held = rest;
        }, HOLD_MS);
      }
      prevIds = ids;
    });
  });
  const waiting = $derived(
    next
      .slice(1)
      .filter((e) => awaiting.includes(e) || held[e.id])
      .sort((a, b) => a.startsAt - b.startsAt),
  );

  /**
   * "Would you play?": one proposal at a time. Once every date has an answer its card folds to one
   * line; it stays a moment so the answer is visible, then the next one slides up.
   */
  const asks = $derived(needMyAnswer(s));
  let heldAsk = $state<string | null>(null);
  let prevAsk: string | null = null;
  $effect(() => {
    const first = asks[0]?.id ?? null;
    const list = asks;
    untrack(() => {
      if (prevAsk && prevAsk !== first && !list.some((e) => e.id === prevAsk)) {
        const id = prevAsk;
        heldAsk = id;
        setTimeout(() => {
          if (heldAsk === id) heldAsk = null;
        }, HOLD_MS);
      }
      prevAsk = first;
    });
  });
  const askNow = $derived(
    (heldAsk ? s?.rows.events[heldAsk] : undefined) ??
      (asks[0] as (typeof asks)[number] | undefined),
  );
  const askMore = $derived(asks.filter((e) => e.id !== askNow?.id).length);
  const stillIn = $derived(toReconfirm(s));

  const later = $derived(
    next
      .slice(1)
      .filter((e) => !awaiting.includes(e))
      .slice(0, 3),
  );
  const nextMatch = $derived(next.find((e) => e.type === 'match' || e.type === 'tournament'));
  const sheet = $derived(nextMatch ? sheetFor(s, nextMatch.id) : undefined);
  const showSheet = $derived(sheet && (sheet.publishedAt || app.can('sheets.view_draft')));
  const newPlays = $derived(
    Object.values(s?.rows.plays ?? {})
      .filter((p) => !p.archivedAt && p.updatedAt > Date.now() - 14 * 86400e3)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3),
  );
  const avail = $derived(app.can('availability.view') && hero ? availability(s, hero) : null);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  const firstName = $derived((app.me?.user.displayName ?? '').split(' ')[0]);

  async function nudge() {
    if (!hero || !avail) return;
    const names = avail.none.map((m) => m.displayName.split(' ')[0]).join(', ');
    const text = `${hero.type === 'match' && hero.opponent ? `${s?.team.shortName} v ${hero.opponent}` : hero.title}, ${relDay(hero.startsAt, tz)} ${time(hero.startsAt, tz)}. Still need a reply from ${names}. Tap in on Phaseplay: https://phaseplay.app/events/${hero.id}`;
    toasts.show(
      (await copyText(text)) ? 'Nudge copied. Paste it in the group chat' : "Couldn't copy",
    );
  }
</script>

{#snippet wouldYouPlay()}
  {#if askNow && s}
    <h2 class="section-title">
      {isGame(askNow.type) ? 'Would you play?' : 'Can you make it?'}
      {#if askMore}<a href="/schedule">+{askMore} more</a>{/if}
    </h2>
    <div class="waits">
      {#key askNow.id}
        <div
          class="wait"
          in:fade={{ duration: d, delay: d / 2, easing: cubicOut }}
          out:slide={{ duration: d * 1.4, easing: cubicInOut }}
        >
          <ProposalCard event={askNow} />
        </div>
      {/key}
    </div>
  {/if}
{/snippet}

<svelte:head><title>Home · {s?.team.shortName ?? 'Phaseplay'}</title></svelte:head>

<div class="page">
  <header class="page-head">
    <div>
      <p class="eyebrow">{s?.team.name ?? ''}</p>
      <h1>{greet}{firstName ? `, ${firstName}` : ''}</h1>
    </div>
  </header>

  <KitHome />

  {#if !s}
    <div class="sk" aria-busy="true"></div>
  {:else if !hero}
    {@render wouldYouPlay()}
    <EmptyState
      title={staff ? 'Add your first training' : 'Nothing scheduled yet'}
      body={staff
        ? 'Set up a weekly training and your squad can start replying straight away.'
        : "When your coach adds sessions and matches, they'll show up here."}
    >
      {#snippet icon()}<IconCalendarPlus />{/snippet}
      {#snippet action()}
        {#if staff}<Button variant="primary" href="/schedule?new=1">Add an event</Button>{/if}
      {/snippet}
    </EmptyState>
  {:else}
    <section aria-label="Next up">
      <EventCard
        event={hero}
        {tz}
        variant="hero"
        counts={s.rows.counts[hero.id]}
        myStatus={myRsvp(s, hero.id)}
        memberId={me?.id}
        teamShort={s.team.shortName}
      />
    </section>
    <NotifyPrompt />

    {#if stillIn.length}
      <h2 class="section-title">Still in?</h2>
      <div class="waits">
        {#each stillIn as e (e.id)}
          <div class="wait" out:slide={{ duration: d * 1.4, easing: cubicInOut }}>
            <StillIn event={e} />
          </div>
        {/each}
      </div>
    {/if}

    {#if avail}
      <section class="card glance" aria-labelledby="glance-h">
        <div class="section-title" style="margin-top:0">
          <h2 id="glance-h" class="h">Who's in · {relDay(hero.startsAt, tz)}</h2>
          <a href="/events/{hero.id}">Board</a>
        </div>
        <ul class="groups">
          {#each avail.byGroup as g (g.group)}
            <li>
              <span class="gl">{GROUP_LABELS[g.group]}</span>
              <span class="tnum"
                ><strong>{g.yes}</strong>{#if g.maybe}<small> +{g.maybe}?</small>{/if}<small>
                  / {g.total}</small
                ></span
              >
            </li>
          {/each}
        </ul>
        {#each avail.warnings as w (w)}
          <p class="warn"><IconWarn />{w}</p>
        {/each}
        {#if avail.none.length}
          <div class="row nr">
            <span class="grow muted">{avail.none.length} still to reply</span>
            <Button size="sm" onclick={nudge}
              >{#snippet icon()}<IconCopy />{/snippet}Copy a nudge</Button
            >
          </div>
        {/if}
      </section>
    {/if}

    <p class="sr-only" role="status" aria-live="polite">{said}</p>
    {#if waiting.length}
      <h2 class="section-title">Waiting for your reply</h2>
      <div class="waits">
        {#each waiting as e (e.id)}
          <div
            class="wait"
            class:done={!!held[e.id]}
            in:fade={{ duration: d, delay: d / 2, easing: cubicOut }}
            out:slide={{ duration: d * 1.4, easing: cubicInOut }}
          >
            {#if held[e.id]}
              <p class="saved" aria-hidden="true">
                <IconCheck />{REPLY_TEXT[held[e.id]!]} · {e.title}
              </p>
            {/if}
            <EventCard
              event={e}
              {tz}
              counts={s.rows.counts[e.id]}
              myStatus={myRsvp(s, e.id)}
              memberId={me?.id}
              teamShort={s.team.shortName}
            />
          </div>
        {/each}
      </div>
    {:else if caughtUp}
      <p class="caught" in:fly={{ y: 12, duration: d }}>
        <IconCheck /> You're all caught up. Thanks!
      </p>
    {/if}

    {@render wouldYouPlay()}

    {#if showSheet && sheet && nextMatch}
      <h2 class="section-title">Team sheet</h2>
      <a class="card link" href="/events/{nextMatch.id}/sheet">
        <span class="ic"><IconShirt /></span>
        <span class="grow">
          <strong>{nextMatch.opponent ? `v ${nextMatch.opponent}` : nextMatch.title}</strong>
          <small class="muted"
            >{sheet.publishedAt
              ? `Published ${ago(sheet.publishedAt)}`
              : 'Draft, only coaches can see it'}{sheet.captainId
              ? ` · Captain ${memberName(s, sheet.captainId)}`
              : ''}</small
          >
        </span>
        <IconChevronRight />
      </a>
    {/if}

    {#if newPlays.length}
      <h2 class="section-title">New in the playbook <a href="/playbook">All</a></h2>
      <ul class="list stack plays">
        {#each newPlays as p (p.id)}
          <li>
            <a class="card link" href="/plays/{p.id}">
              <span class="ic"><IconPlaybook /></span>
              <span class="grow"
                ><strong>{p.title}</strong><small class="muted"
                  >{p.frameCount} frames · {ago(p.updatedAt)}</small
                ></span
              >
              <IconChevronRight />
            </a>
          </li>
        {/each}
      </ul>
    {/if}

    {#if later.length}
      <h2 class="section-title">Coming up <a href="/schedule">Schedule</a></h2>
      <div class="stack">
        {#each later as e (e.id)}
          <EventCard
            event={e}
            {tz}
            counts={s.rows.counts[e.id]}
            myStatus={myRsvp(s, e.id)}
            memberId={me?.id}
            teamShort={s.team.shortName}
          />
        {/each}
      </div>
    {/if}

    {#if app.can('invites.create') && Object.keys(s.rows.members).length < 3}
      <a class="card link invite" href="/squad?invite=1">
        <span class="ic"><IconUserPlus /></span>
        <span class="grow"
          ><strong>Invite your squad</strong><small class="muted"
            >Share a link or QR code in the group chat</small
          ></span
        >
        <IconChevronRight />
      </a>
    {/if}
  {/if}
</div>

<style>
  .sk {
    height: 260px;
    border-radius: var(--r-lg);
    background: var(--surface-2);
  }
  .glance {
    margin-top: var(--s-4);
    padding: var(--s-4) var(--s-5);
  }
  .h {
    font-size: var(--t-16);
  }
  .section-title a,
  .glance a {
    font-size: var(--t-14);
    font-weight: 600;
  }
  .groups {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--s-2);
  }
  .groups li {
    display: flex;
    justify-content: space-between;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--surface-2);
    font-size: var(--t-14);
  }
  .gl {
    color: var(--text-2);
  }
  small {
    color: var(--text-3);
  }
  .warn {
    display: flex;
    gap: var(--s-2);
    align-items: center;
    margin-top: var(--s-3);
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: var(--t-14);
    font-weight: 600;
  }
  .warn :global(svg) {
    width: 16px;
    height: 16px;
    flex: none;
  }
  .nr {
    margin-top: var(--s-3);
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
  .plays {
    gap: var(--s-2);
  }
  .invite {
    margin-top: var(--s-6);
  }
  .wait {
    position: relative;
    transition: transform 280ms var(--ease);
    /* Composite the card on its own layer so the collapse animates without repainting it. */
    will-change: transform;
  }
  .wait {
    /* Each card owns the space below it, so a leaving card's collapse animates that space too. */
    margin-bottom: var(--s-3);
    /* Room for the "saved" badge (above the card) and the ring, inside the box the collapse clips
       to, cancelled by negative margins so nothing moves. Clicks pass through the extra room. */
    padding: 16px 4px 0;
    margin-top: -16px;
    margin-inline: -4px;
    pointer-events: none;
  }
  .wait > :global(*) {
    pointer-events: auto;
  }
  .wait.done {
    transform: scale(0.985);
  }
  .wait > :global(*:not(.saved)) {
    border-radius: var(--r-lg);
    transition: box-shadow var(--m-fast) var(--ease);
  }
  .wait.done > :global(*:not(.saved)) {
    box-shadow: 0 0 0 2px var(--ok);
  }
  .wait.done :global(.card),
  .wait.done :global(article) {
    opacity: 0.75;
  }
  .saved {
    position: absolute;
    z-index: 1;
    top: 4px;
    left: 16px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--ok);
    color: #fff;
    font-size: var(--t-14);
    font-weight: 700;
    box-shadow: var(--e-2);
    animation: pop 320ms var(--ease) both;
  }
  .saved :global(svg) {
    width: 16px;
    height: 16px;
  }
  .caught {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin: var(--s-4) 0 0;
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-lg);
    background: var(--ok-soft);
    color: var(--ok);
    font-weight: 700;
  }
  .caught :global(svg) {
    width: 18px;
    height: 18px;
  }
  @keyframes pop {
    from {
      transform: scale(0.8);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .saved {
      animation: none;
    }
  }
</style>
