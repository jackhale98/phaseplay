<!--
  Staff availability board: counts by position group, coverage warnings, who's in/maybe/out/no reply
  (with coach-only notes), reply on someone's behalf, and "Copy a nudge" for the group chat.
-->
<script lang="ts">
  import {
    GROUP_LABELS,
    isGame,
    type Member,
    type RsvpStatus,
    type TeamEvent,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { availability, rsvpOf } from '#lib/data/selectors';
  import { setRsvp } from '#lib/data/actions';
  import Avatar from '#lib/components/Avatar.svelte';
  import Button from '#lib/components/Button.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import { copyText } from '#lib/share';
  import { toasts } from '#lib/stores/toast.svelte';
  import { relDay, time, plural } from '#lib/format';
  import { IconCopy, IconWarn, IconCheck, IconX, IconHelp } from '#lib/icons';
  import { displayTitle } from './schedule';

  type Props = { event: TeamEvent };
  let { event: e }: Props = $props();
  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const a = $derived(availability(s, e));
  const showGroups = $derived(e.type === 'training' || isGame(e.type));
  let target = $state<Member | null>(null);
  let sheetOpen = $state(false);

  const cols = $derived([
    { k: 'yes' as const, label: 'In', list: a.yes },
    { k: 'maybe' as const, label: 'Maybe', list: a.maybe },
    { k: 'no' as const, label: 'Out', list: a.no },
    { k: 'none' as const, label: 'No reply', list: a.none },
  ]);

  function choose(m: Member) {
    target = m;
    sheetOpen = true;
  }
  async function reply(st: RsvpStatus) {
    if (!target) return;
    const name = target.displayName.split(' ')[0];
    await setRsvp(e.id, target.id, st, null, { undo: false });
    toasts.show(`${name} marked ${st === 'yes' ? 'in' : st === 'no' ? 'out' : 'maybe'}`);
    sheetOpen = false;
  }
  async function nudge() {
    const names = a.none.map((m) => m.displayName.split(' ')[0]).join(', ');
    const text = `${displayTitle(e, s?.team.shortName)}, ${relDay(e.startsAt, tz)} ${time(e.startsAt, tz)}. Still need a reply from ${names}. Tap in on Phaseplay: ${location.origin}/events/${e.id}`;
    toasts.show(
      (await copyText(text)) ? 'Nudge copied. Paste it in the group chat' : "Couldn't copy",
    );
  }
  const status = (m: Member) => rsvpOf(s, e.id, m.id)?.status ?? null;
  const note = (m: Member) => rsvpOf(s, e.id, m.id)?.note ?? null;
</script>

<section class="board card" aria-labelledby="board-h">
  <div class="head">
    <h2 id="board-h">Who's in?</h2>
    <p class="tnum totals">
      <strong>{a.yes.length}</strong> in · {a.maybe.length} maybe · {a.no.length} out ·
      {a.none.length} to reply
    </p>
  </div>

  {#if a.warnings.length}
    <ul class="list warns">
      {#each a.warnings as w (w)}
        <li class="warn"><IconWarn />{w}</li>
      {/each}
    </ul>
  {/if}

  {#if showGroups && a.byGroup.some((g) => g.total)}
    <ul class="list groups" aria-label="Available by position group">
      {#each a.byGroup as g (g.group)}
        <li class:low={g.total > 0 && g.yes === 0}>
          <span class="gl">{GROUP_LABELS[g.group]}</span>
          <span class="tnum"
            ><strong>{g.yes}</strong>{#if g.maybe}<small> +{g.maybe}?</small>{/if}<small>
              / {g.total}</small
            ></span
          >
        </li>
      {/each}
    </ul>
  {/if}

  {#if a.none.length}
    <div class="row nudge">
      <span class="grow muted">{plural(a.none.length, 'player')} still to reply</span>
      <Button size="sm" onclick={nudge}>{#snippet icon()}<IconCopy />{/snippet}Copy a nudge</Button>
    </div>
  {/if}

  <div class="cols">
    {#each cols as c (c.k)}
      <div class="col {c.k}">
        <h3>
          <span class="dot" aria-hidden="true"></span>{c.label}
          <span class="subtle">{c.list.length}</span>
        </h3>
        {#if c.list.length}
          <ul class="list people">
            {#each c.list as m (m.id)}
              <li>
                <button
                  type="button"
                  class="person"
                  onclick={() => choose(m)}
                  aria-label="{m.displayName}, {c.label}{note(m)
                    ? `, note: ${note(m)}`
                    : ''}. Change reply"
                >
                  <Avatar name={m.displayName} jersey={m.jersey} size={32} />
                  <span class="grow">
                    <span class="nm">{m.displayName}</span>
                    {#if note(m)}<small class="note">“{note(m)}”</small>{/if}
                    {#if m.status === 'pending'}<small class="muted">Not joined yet</small>{/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="subtle empty">Nobody</p>
        {/if}
      </div>
    {/each}
  </div>
  <p class="subtle foot">
    Tap a name to reply for them. Notes are only shown to coaches and managers.
  </p>
</section>

<Sheet
  bind:open={sheetOpen}
  title="Reply for {target?.displayName ?? ''}"
  description="For when someone tells you in person or in the group chat."
  size="sm"
>
  {#if target}
    <div class="pickst" role="group" aria-label="Reply for {target.displayName}">
      <button
        type="button"
        class="yes"
        aria-pressed={status(target) === 'yes'}
        onclick={() => reply('yes')}><IconCheck />In</button
      >
      <button
        type="button"
        class="maybe"
        aria-pressed={status(target) === 'maybe'}
        onclick={() => reply('maybe')}><IconHelp />Maybe</button
      >
      <button
        type="button"
        class="no"
        aria-pressed={status(target) === 'no'}
        onclick={() => reply('no')}><IconX />Out</button
      >
    </div>
  {/if}
</Sheet>

<style>
  .board {
    padding: var(--s-5);
    display: grid;
    gap: var(--s-4);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-2);
  }
  h2 {
    font-size: var(--t-20);
  }
  .totals {
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .warns {
    display: grid;
    gap: var(--s-2);
  }
  .warn {
    display: flex;
    gap: var(--s-2);
    align-items: center;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: var(--t-14);
    font-weight: 650;
  }
  .warn :global(svg) {
    width: 16px;
    height: 16px;
    flex: none;
  }
  .groups {
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
  .groups li.low {
    background: var(--warn-soft);
  }
  .gl {
    color: var(--text-2);
  }
  small {
    color: var(--text-3);
  }
  .nudge {
    padding: var(--s-2) 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    font-size: var(--t-14);
  }
  .cols {
    display: grid;
    gap: var(--s-4);
  }
  @media (min-width: 640px) {
    .cols {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
  h3 {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-14);
    font-weight: 700;
    margin-bottom: var(--s-2);
  }
  .dot {
    width: 10px;
    height: 10px;
    flex: none;
  }
  /* Shapes as well as colours: in = filled circle, maybe = ring, out = square, no reply = dash. */
  .yes .dot {
    border-radius: 50%;
    background: var(--ok);
  }
  .maybe .dot {
    border-radius: 50%;
    border: 2px solid var(--maybe);
  }
  .no .dot {
    border-radius: 2px;
    background: var(--no);
  }
  .none .dot {
    height: 3px;
    border-radius: 2px;
    background: var(--text-3);
  }
  .people {
    display: grid;
    gap: 2px;
  }
  .person {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    min-height: 44px;
    padding: 4px var(--s-2);
    border: 0;
    border-radius: var(--r-md);
    background: none;
    text-align: left;
  }
  .person:hover {
    background: var(--surface-2);
  }
  .nm {
    display: block;
    font-weight: 600;
    font-size: var(--t-14);
  }
  .person small {
    display: block;
    font-size: var(--t-12);
  }
  .note {
    color: var(--text-2);
    font-style: italic;
  }
  .empty {
    padding: 0 var(--s-2);
  }
  .foot {
    font-size: var(--t-12);
  }
  .pickst {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s-2);
    padding-bottom: var(--s-2);
  }
  .pickst button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 52px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-weight: 700;
  }
  .pickst :global(svg) {
    width: 18px;
    height: 18px;
  }
  .pickst .yes[aria-pressed='true'] {
    background: var(--ok);
    border-color: var(--ok);
    color: light-dark(#fff, #08140c);
  }
  .pickst .maybe[aria-pressed='true'] {
    background: var(--warn-soft);
    border-color: var(--maybe);
    color: var(--warn);
  }
  .pickst .no[aria-pressed='true'] {
    background: var(--danger-soft);
    border-color: var(--no);
    color: var(--danger);
  }
</style>
