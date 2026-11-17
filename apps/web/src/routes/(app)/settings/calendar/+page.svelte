<!--
  The team calendar: one link per team that every member subscribes to in their calendar app.
  Staff can reset it if it ends up somewhere it shouldn't. Older per-person links still work and
  can be turned off here.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { TeamCalendar } from '@phaseplay/shared';
  import { api, ApiError, v1 } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import Button from '#lib/components/Button.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Loader from '#lib/components/Loader.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { copyText } from '#lib/share';
  import { ago } from '#lib/format';
  import { IconBack, IconCalendar, IconCopy, IconTrash, IconLock } from '#lib/icons';
  import IconExternal from '@lucide/svelte/icons/external-link';

  type Feed = { id: string; team_id: string | null; scope: 'me' | 'team'; created_at: number };

  const team = $derived(app.team);
  const canReset = $derived(app.can('events.manage'));
  let path = $state<string | null>(null);
  let error = $state<string | null>(null);
  let feeds = $state<Feed[]>([]);
  let resetOpen = $state(false);
  let resetting = $state(false);
  let revoking = $state<Feed | null>(null);
  let revokeOpen = $state(false);

  const https = $derived(path ? `${location.origin}${path}` : '');
  const webcal = $derived(https.replace(/^https?:/, 'webcal:'));
  const google = $derived(
    `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
  );

  // Once the open team is known (on a fresh load it arrives after the first render).
  $effect(() => {
    const id = app.teamId;
    if (!id) return;
    let alive = true;
    path = null;
    error = null;
    api<TeamCalendar>(v1(`/teams/${id}/calendar`))
      .then((r) => alive && (path = r.path))
      .catch(
        (e: unknown) =>
          alive && (error = e instanceof ApiError ? e.message : "Couldn't load the calendar link"),
      );
    return () => {
      alive = false;
    };
  });
  onMount(async () => {
    try {
      feeds = (await api<{ feeds: Feed[] }>(v1('/me/calendar-feeds'))).feeds.sort(
        (a, b) => b.created_at - a.created_at,
      );
    } catch {}
  });

  async function reset() {
    resetting = true;
    try {
      path = (await api<TeamCalendar>(teamPath('/calendar'), { method: 'POST', body: {} })).path;
      resetOpen = false;
      toasts.success('New link made. Share it with the team; the old one has stopped working.');
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : "Couldn't reset the link");
    } finally {
      resetting = false;
    }
  }
  async function revoke() {
    const f = revoking;
    revokeOpen = false;
    if (!f) return;
    try {
      await api(v1(`/me/calendar-feeds/${f.id}`), { method: 'DELETE' });
      feeds = feeds.filter((x) => x.id !== f.id);
      toasts.show('Old link turned off.');
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : "Couldn't turn it off");
    }
  }
  const teamName = (id: string | null) =>
    id
      ? (app.me?.memberships.find((m) => m.team.id === id)?.team.name ?? 'A former team')
      : 'All your teams';
  async function copy() {
    toasts.show(
      (await copyText(https)) ? 'Link copied' : "Couldn't copy, select the link and copy it",
    );
  }
</script>

<svelte:head><title>Team calendar · Phaseplay</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/more"><IconBack /> More</a>
  <header class="page-head">
    <div>
      <h1>Team calendar</h1>
      <p class="muted lead">
        Subscribe once and {team?.name ?? 'the team'}'s practices, games and events show up in your
        calendar app. New events, time changes and cancellations follow on their own.
      </p>
    </div>
  </header>

  <section class="card pad made" aria-labelledby="sub-h">
    <h2 id="sub-h" class="h">Add it to your calendar</h2>
    {#if error}
      <p class="err" role="alert">{error}</p>
    {:else if !path}
      <Loader label="Getting the link" size={48} />
    {:else}
      <div class="actions">
        <Button variant="primary" href={webcal}
          >{#snippet icon()}<IconCalendar />{/snippet}Add to Apple Calendar</Button
        >
        <a class="btnlike" href={google} target="_blank" rel="noopener noreferrer"
          >Add to Google Calendar<IconExternal /><span class="sr-only">(opens in a new tab)</span
          ></a
        >
      </div>
      <div class="url">
        <label for="feed-url">Calendar link (for Outlook and others, or to share)</label>
        <span class="row">
          <input id="feed-url" readonly value={https} onfocus={(e) => e.currentTarget.select()} />
          <Button onclick={copy}>{#snippet icon()}<IconCopy />{/snippet}Copy</Button>
        </span>
      </div>
      <p class="subtle small">
        Apple Calendar and Outlook check for changes every 30 minutes or so. Google Calendar
        refreshes on its own schedule, which can take several hours.
      </p>
    {/if}
  </section>

  {#if canReset && path}
    <section class="card pad" aria-labelledby="reset-h">
      <h2 id="reset-h" class="h">Reset the link</h2>
      <p class="muted warn">
        <IconLock /> Anyone with the link can see the schedule. If it's been shared somewhere it shouldn't
        be, make a new one: calendars on the old link stop updating.
      </p>
      <Button onclick={() => (resetOpen = true)}>Reset link</Button>
    </section>
  {/if}

  {#if feeds.length}
    <h2 class="section-title">Your older links</h2>
    <p class="subtle small">
      Personal links made before the team calendar. They still work; turn them off if you've
      switched to the team calendar.
    </p>
    <ul class="list card feeds">
      {#each feeds as f (f.id)}
        <li>
          <span class="grow">
            <strong>{f.scope === 'team' ? 'Coaches feed' : 'Personal feed'}</strong>
            <small class="muted">{teamName(f.team_id)} · made {ago(f.created_at)}</small>
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Turn off {f.scope === 'team' ? 'coaches' : 'personal'} feed made {ago(
              f.created_at,
            )}"
            onclick={() => ((revoking = f), (revokeOpen = true))}
            >{#snippet icon()}<IconTrash />{/snippet}Turn off</Button
          >
        </li>
      {/each}
    </ul>
  {/if}
</div>

<Sheet
  bind:open={resetOpen}
  title="Reset the team calendar link?"
  description="Everyone will need to subscribe again with the new link."
  size="sm"
>
  <p class="muted">
    Calendars on the old link keep the events they have but stop getting updates. Share the new link
    with the team afterwards.
  </p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (resetOpen = false)}>Keep it</Button>
    <Button variant="danger" loading={resetting} onclick={reset}>Reset link</Button>
  {/snippet}
</Sheet>

<Sheet
  bind:open={revokeOpen}
  title="Turn off this link?"
  description="Calendars subscribed to it stop updating."
  size="sm"
>
  <p class="muted">They keep the events they have. The team calendar isn't affected.</p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (revokeOpen = false)}>Keep it</Button>
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
  .err {
    color: var(--danger);
    font-weight: 600;
  }
  .small {
    font-size: var(--t-14);
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
