<script lang="ts">
  import Loader from '#lib/components/Loader.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { eventTimeLabel, type Rsvp } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { players, rsvpOf } from '#lib/data/selectors';
  import { teamPath } from '#lib/data/actions';
  import { rsvpKey } from '#lib/data/types';
  import Avatar from '#lib/components/Avatar.svelte';
  import Button from '#lib/components/Button.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { relDay } from '#lib/format';
  import { buzz } from '#lib/haptics';
  import { IconBack, IconCheck, IconClipboardCheck } from '#lib/icons';
  import { displayTitle } from '#lib/features/schedule/schedule';

  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const e = $derived(s?.rows.events[page.params.id ?? '']);
  const staff = $derived(app.can('events.manage'));
  const list = $derived(players(s));

  let marks = $state<Record<string, boolean>>({});
  let dirty = $state(false);
  let saving = $state(false);
  let order = $state<'reply' | 'name'>('reply');

  // Pre-fill from saved attendance, else from RSVPs (yes → present). Re-derives until edited.
  $effect(() => {
    if (!e || dirty) return;
    const next: Record<string, boolean> = {};
    for (const m of list) {
      const r = rsvpOf(s, e.id, m.id);
      next[m.id] = r?.attended ?? r?.status === 'yes';
    }
    marks = next;
  });

  const rank = (id: string) => {
    const st = e ? rsvpOf(s, e.id, id)?.status : null;
    return st === 'yes' ? 0 : st === 'maybe' ? 1 : st === null || st === undefined ? 2 : 3;
  };
  const sorted = $derived(
    order === 'name' ? list : [...list].sort((a, b) => rank(a.id) - rank(b.id)),
  );
  const present = $derived(list.filter((m) => marks[m.id]).length);
  const saved = $derived(
    !!e &&
      list.some(
        (m) =>
          rsvpOf(s, e.id, m.id)?.attended !== null && rsvpOf(s, e.id, m.id)?.attended !== undefined,
      ),
  );
  const replyLabel = (id: string) => {
    const st = e ? rsvpOf(s, e.id, id)?.status : null;
    return st === 'yes'
      ? 'Said in'
      : st === 'maybe'
        ? 'Said maybe'
        : st === 'no'
          ? 'Said out'
          : 'No reply';
  };

  function toggle(id: string) {
    marks = { ...marks, [id]: !marks[id] };
    dirty = true;
    buzz();
  }
  function all() {
    marks = Object.fromEntries(list.map((m) => [m.id, true]));
    dirty = true;
  }
  async function save() {
    if (!e || !s) return;
    saving = true;
    const entries = list.map((m) => ({ memberId: m.id, attended: !!marks[m.id] }));
    await app.mutate({
      method: 'PUT',
      path: teamPath(`/events/${e.id}/attendance`),
      body: { entries },
      label: 'Attendance',
      optimistic: entries.map(({ memberId, attended }) => {
        const prev = rsvpOf(s, e.id, memberId);
        const value: Rsvp = {
          eventId: e.id,
          memberId,
          teamId: s.teamId,
          status: prev?.status ?? null,
          note: prev?.note ?? null,
          attended,
          updatedAt: Date.now(),
        };
        return {
          op: 'put' as const,
          entity: 'rsvps' as const,
          key: rsvpKey(e.id, memberId),
          value,
        };
      }),
    });
    saving = false;
    dirty = false;
    toasts.success(`Attendance saved: ${present} of ${list.length}`);
    await goto(`/events/${e.id}`);
  }
</script>

<svelte:head><title>Attendance · {e ? displayTitle(e) : 'Event'}</title></svelte:head>

<div class="page narrow">
  <a class="back" href={e ? `/events/${e.id}` : '/schedule'}
    ><IconBack /> {e ? displayTitle(e) : 'Schedule'}</a
  >
  {#if !s}
    <Loader label="Loading attendance" />
  {:else if !e}
    <p class="muted">This event isn't on the schedule any more.</p>
  {:else if !staff}
    <p class="muted">Only coaches and managers take attendance.</p>
  {:else}
    <header class="page-head">
      <div>
        <h1>Who turned up?</h1>
        <p class="muted">
          {displayTitle(e, s.team.shortName)} · {relDay(e.startsAt, tz)}
          {eventTimeLabel(e, tz)}
        </p>
      </div>
    </header>

    <div class="bar card">
      <p class="tally tnum" aria-live="polite"><strong>{present}</strong> of {list.length} here</p>
      <Button size="sm" onclick={all}>{#snippet icon()}<IconCheck />{/snippet}All present</Button>
    </div>
    {#if !saved && !dirty}
      <p class="subtle hint">Pre-filled from replies. Tap anyone to change.</p>
    {/if}

    <div class="sort">
      <Segmented
        label="Order"
        size="sm"
        bind:value={order}
        options={[
          { value: 'reply', label: 'By reply' },
          { value: 'name', label: 'A–Z' },
        ]}
      />
    </div>

    <ul class="list card people" aria-label="Squad">
      {#each sorted as m (m.id)}
        <li>
          <button
            type="button"
            class="person"
            aria-pressed={!!marks[m.id]}
            onclick={() => toggle(m.id)}
          >
            <Avatar name={m.displayName} jersey={m.jersey} size={36} />
            <span class="grow">
              <span class="nm">{m.displayName}</span>
              <small>{replyLabel(m.id)}</small>
            </span>
            <span class="tick" aria-hidden="true"><IconCheck /></span>
          </button>
        </li>
      {/each}
    </ul>

    <div class="save">
      <Button variant="primary" size="lg" block loading={saving} onclick={save}>
        {#snippet icon()}<IconClipboardCheck />{/snippet}Save attendance
      </Button>
    </div>
  {/if}
</div>

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
  .page-head {
    margin-top: var(--s-2);
  }
  .page-head p {
    margin-top: var(--s-1);
  }
  .bar {
    position: sticky;
    top: calc(var(--safe-t) + var(--s-2));
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
  }
  .tally {
    font-size: 1.0625rem;
  }
  .tally strong {
    font-size: var(--t-24);
  }
  .hint {
    margin: var(--s-2) 0 0;
  }
  .sort {
    margin: var(--s-4) 0 var(--s-2);
  }
  .people {
    overflow: hidden;
  }
  .person {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    min-height: 60px;
    padding: var(--s-2) var(--s-4);
    border: 0;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    text-align: left;
    transition: background var(--m-fast) var(--ease);
  }
  li:last-child .person {
    border-bottom: 0;
  }
  .person:hover {
    background: var(--surface-2);
  }
  .nm {
    display: block;
    font-weight: 650;
  }
  small {
    color: var(--text-2);
    font-size: var(--t-12);
  }
  .tick {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--r-sm);
    border: 2px solid var(--border-strong);
    color: transparent;
    transition: all var(--m-fast) var(--ease);
  }
  .tick :global(svg) {
    width: 20px;
    height: 20px;
  }
  [aria-pressed='true'] {
    background: var(--ok-soft);
  }
  [aria-pressed='true']:hover {
    background: color-mix(in srgb, var(--ok-soft) 80%, var(--ok));
  }
  [aria-pressed='true'] .tick {
    background: var(--ok);
    border-color: var(--ok);
    color: light-dark(#fff, #08140c);
  }
  .save {
    position: sticky;
    bottom: calc(var(--tabbar-h) + var(--safe-b) + var(--s-3));
    margin-top: var(--s-4);
  }
  @media (min-width: 768px) {
    .save {
      bottom: var(--s-4);
    }
  }
</style>
