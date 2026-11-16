<script lang="ts">
  import { onMount } from 'svelte';
  import { isStaff } from '@phaseplay/shared';
  import { api, ApiError, v1 } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import Button from '#lib/components/Button.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { copyText } from '#lib/share';
  import { ago } from '#lib/format';
  import {
    IconBack,
    IconCalendar,
    IconCopy,
    IconTrash,
    IconUsers,
    IconUser,
    IconLock,
  } from '#lib/icons';
  import IconExternal from '@lucide/svelte/icons/external-link';

  type Feed = { id: string; team_id: string | null; scope: 'me' | 'team'; created_at: number };
  type Created = { scope: 'me' | 'team'; https: string; webcal: string };

  const staff = $derived(isStaff(app.role));
  const team = $derived(app.team);
  let feeds = $state<Feed[] | null>(null);
  let created = $state<Created | null>(null);
  let busy = $state<'me' | 'team' | null>(null);
  let revoking = $state<Feed | null>(null);
  let confirmOpen = $state(false);

  async function load() {
    try {
      feeds = (await api<{ feeds: Feed[] }>(v1('/me/calendar-feeds'))).feeds.sort(
        (a, b) => b.created_at - a.created_at,
      );
    } catch (e) {
      feeds = feeds ?? [];
      toasts.error(e instanceof ApiError ? e.message : "Couldn't load your feeds");
    }
  }
  onMount(load);

  async function create(scope: 'me' | 'team') {
    busy = scope;
    try {
      const r = await api<{ id: string; path: string }>(v1('/me/calendar-feeds'), {
        method: 'POST',
        body: { teamId: app.teamId, scope },
      });
      const https = `${location.origin}${r.path}`;
      created = { scope, https, webcal: https.replace(/^https?:/, 'webcal:') };
      await load();
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : "Couldn't create the feed");
    } finally {
      busy = null;
    }
  }
  async function revoke() {
    const f = revoking;
    confirmOpen = false;
    if (!f) return;
    try {
      await api(v1(`/me/calendar-feeds/${f.id}`), { method: 'DELETE' });
      toasts.show('Feed turned off. Calendars using it stop updating.');
      if (created && feeds?.[0]?.id === f.id) created = null;
      await load();
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : "Couldn't turn it off");
    }
  }
  const teamName = (id: string | null) =>
    id
      ? (app.me?.memberships.find((m) => m.team.id === id)?.team.name ?? 'A former team')
      : 'All your teams';
  const google = (webcal: string) =>
    `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
  async function copy(url: string) {
    toasts.show(
      (await copyText(url)) ? 'Link copied' : "Couldn't copy, select the link and copy it",
    );
  }
</script>

<svelte:head><title>Calendar feed · Phaseplay</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/more"><IconBack /> More</a>
  <header class="page-head">
    <div>
      <h1>Calendar feed</h1>
      <p class="muted lead">
        Get {team?.shortName ?? 'the team'}'s practices, games and events in Apple, Google or
        Outlook Calendar. Changes and cancellations show up on their own, usually within a few
        hours.
      </p>
    </div>
  </header>

  {#if created}
    <section class="card pad made" aria-labelledby="made-h" aria-live="polite">
      <h2 id="made-h" class="h">
        Your {created.scope === 'team' ? 'team' : 'personal'} feed is ready
      </h2>
      <p class="muted">Add it now. For your privacy we only show this link once.</p>
      <div class="actions">
        <Button variant="primary" href={created.webcal}
          >{#snippet icon()}<IconCalendar />{/snippet}Add to Apple Calendar</Button
        >
        <a class="btnlike" href={google(created.webcal)} target="_blank" rel="noopener noreferrer"
          >Add to Google Calendar<IconExternal /><span class="sr-only">(opens in a new tab)</span
          ></a
        >
      </div>
      <div class="url">
        <label for="feed-url">Subscription link (for Outlook and others)</label>
        <span class="row">
          <input
            id="feed-url"
            readonly
            value={created.https}
            onfocus={(e) => e.currentTarget.select()}
          />
          <Button onclick={() => copy(created!.https)}
            >{#snippet icon()}<IconCopy />{/snippet}Copy</Button
          >
        </span>
      </div>
      <p class="subtle warn">
        <IconLock /> Anyone with this link can see the schedule. If it gets shared, turn it off below
        and make a new one.
      </p>
    </section>
  {/if}

  <section class="card pad" aria-labelledby="me-h">
    <div class="opt">
      <span class="ic"><IconUser /></span>
      <div class="grow">
        <h2 id="me-h" class="h">Just my schedule</h2>
        <p class="muted">Everything at {team?.name ?? 'your team'} that you can reply to.</p>
      </div>
    </div>
    <Button loading={busy === 'me'} onclick={() => create('me')}>Create my feed</Button>
  </section>

  {#if staff}
    <section class="card pad" aria-labelledby="team-h">
      <div class="opt">
        <span class="ic"><IconUsers /></span>
        <div class="grow">
          <h2 id="team-h" class="h">Team feed for coaches</h2>
          <p class="muted">
            For a shared coaches' calendar. Only works for staff, and stops if you leave the team.
          </p>
        </div>
      </div>
      <Button loading={busy === 'team'} onclick={() => create('team')}>Create a team feed</Button>
    </section>
  {/if}

  <h2 class="section-title">Your feeds</h2>
  {#if feeds === null}
    <p class="subtle">Loading…</p>
  {:else if !feeds.length}
    <p class="subtle">No feeds yet.</p>
  {:else}
    <ul class="list card feeds">
      {#each feeds as f (f.id)}
        <li>
          <span class="grow">
            <strong>{f.scope === 'team' ? 'Team feed' : 'Personal feed'}</strong>
            <small class="muted">{teamName(f.team_id)} · made {ago(f.created_at)}</small>
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Turn off {f.scope === 'team' ? 'team' : 'personal'} feed made {ago(
              f.created_at,
            )}"
            onclick={() => ((revoking = f), (confirmOpen = true))}
            >{#snippet icon()}<IconTrash />{/snippet}Turn off</Button
          >
        </li>
      {/each}
    </ul>
  {/if}
</div>

<Sheet
  bind:open={confirmOpen}
  title="Turn off this feed?"
  description="Calendars subscribed to it stop updating. You can make a new one any time."
  size="sm"
>
  <p class="muted">Anyone already subscribed keeps the events they have, but gets no updates.</p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmOpen = false)}>Keep it</Button>
    <Button variant="danger" onclick={revoke}>Turn off</Button>
  {/snippet}
</Sheet>

<style>
  .narrow {
    max-width: 680px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    font-weight: 600;
    text-decoration: none;
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
  }
  .lead {
    margin-top: var(--s-2);
    max-width: 60ch;
  }
  .pad {
    display: grid;
    gap: var(--s-3);
    justify-items: start;
    padding: var(--s-5);
    margin-bottom: var(--s-4);
  }
  .h {
    font-size: var(--t-16);
  }
  .opt {
    display: flex;
    gap: var(--s-3);
    align-items: flex-start;
  }
  .opt p {
    font-size: var(--t-14);
    margin-top: 2px;
  }
  .ic {
    display: grid;
    place-items: center;
    flex: none;
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
  .made {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: linear-gradient(160deg, var(--accent-softer), var(--surface) 60%);
    justify-items: stretch;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .btnlike {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 44px;
    padding: 0 var(--s-4);
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
    font-weight: 650;
    text-decoration: none;
  }
  .btnlike:hover {
    background: var(--surface-2);
  }
  .btnlike :global(svg) {
    width: 16px;
    height: 16px;
  }
  .url {
    display: grid;
    gap: 6px;
    font-size: var(--t-14);
    font-weight: 650;
  }
  .url input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 0 12px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    font-size: var(--t-14);
    font-family: ui-monospace, monospace;
  }
  .warn {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    font-size: var(--t-12);
  }
  .warn :global(svg) {
    width: 14px;
    height: 14px;
    flex: none;
    margin-top: 2px;
  }
  .feeds {
    overflow: hidden;
  }
  .feeds li {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 60px;
    padding: var(--s-2) var(--s-2) var(--s-2) var(--s-4);
    border-bottom: 1px solid var(--border);
  }
  .feeds li:last-child {
    border-bottom: 0;
  }
  .feeds small {
    display: block;
    font-size: var(--t-12);
  }
  .feeds :global(.ghost) {
    color: var(--danger);
  }
</style>
