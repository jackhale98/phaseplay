<!-- ⌘/Ctrl-K: jump to any screen, event, play, drill or person. -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { app } from '#lib/data/app.svelte';
  import { upcoming, squad } from '#lib/data/selectors';
  import { day } from '#lib/format';
  import { NAV, DESKTOP_EXTRA } from './nav';

  let { open = $bindable() }: { open: boolean } = $props();
  let q = $state('');
  let active = $state(0);
  let dialog: HTMLDialogElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();

  type Item = { label: string; hint: string; href: string };
  const items = $derived.by<Item[]>(() => {
    const s = app.snap;
    const tz = s?.team.timezone ?? 'UTC';
    const list: Item[] = [
      ...[...NAV, ...DESKTOP_EXTRA].map((n) => ({ label: n.label, hint: 'Go to', href: n.href })),
      { label: 'Account & passkeys', hint: 'Settings', href: '/settings/account' },
      { label: 'Team settings', hint: 'Settings', href: '/settings/team' },
    ];
    if (app.can('events.manage'))
      list.push({ label: 'New event', hint: 'Action', href: '/schedule?new=1' });
    if (app.can('invites.create'))
      list.push({ label: 'Invite players', hint: 'Action', href: '/squad?invite=1' });
    for (const e of upcoming(s).slice(0, 30))
      list.push({
        label: e.opponent ? `${e.title} v ${e.opponent}` : e.title,
        hint: day(e.startsAt, tz),
        href: `/events/${e.id}`,
      });
    for (const p of Object.values(s?.rows.plays ?? {}))
      list.push({ label: p.title, hint: 'Play', href: `/plays/${p.id}` });
    for (const d of Object.values(s?.rows.drills ?? {}))
      list.push({ label: d.title, hint: 'Drill', href: `/drills/${d.id}` });
    for (const m of squad(s))
      list.push({ label: m.displayName, hint: 'Squad', href: `/squad/${m.id}` });
    return list;
  });
  const results = $derived.by(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items.slice(0, 12);
    return items
      .map((i) => ({
        i,
        score: i.label.toLowerCase().startsWith(t)
          ? 0
          : i.label.toLowerCase().includes(t)
            ? 1
            : i.hint.toLowerCase().includes(t)
              ? 2
              : 9,
      }))
      .filter((x) => x.score < 9)
      .sort((a, b) => a.score - b.score)
      .slice(0, 20)
      .map((x) => x.i);
  });

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      q = '';
      active = 0;
      dialog.showModal();
      queueMicrotask(() => input?.focus());
    } else if (!open && dialog.open) dialog.close();
  });

  function pick(i: Item | undefined) {
    if (!i) return;
    open = false;
    void goto(i.href);
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(results.length - 1, active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[active]);
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="pal"
  aria-label="Search"
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialog && (open = false)}
>
  <div class="box">
    <input
      bind:this={input}
      bind:value={q}
      oninput={() => (active = 0)}
      onkeydown={key}
      placeholder="Search events, plays, drills, people…"
      role="combobox"
      aria-expanded="true"
      aria-controls="pal-list"
      aria-activedescendant={results[active] ? `pal-${active}` : undefined}
    />
    <ul id="pal-list" role="listbox">
      {#each results as r, i (r.href + r.label)}
        <li id="pal-{i}" role="option" aria-selected={i === active}>
          <button tabindex="-1" onclick={() => pick(r)} onmousemove={() => (active = i)}
            ><span>{r.label}</span><small>{r.hint}</small></button
          >
        </li>
      {:else}
        <li class="none">No matches</li>
      {/each}
    </ul>
  </div>
</dialog>

<style>
  .pal {
    margin: 12vh auto auto;
    padding: 0;
    border: 0;
    background: transparent;
    width: min(640px, calc(100vw - 24px));
  }
  .pal::backdrop {
    background: var(--scrim);
  }
  .box {
    background: var(--surface);
    border-radius: var(--r-lg);
    box-shadow: var(--e-3);
    overflow: hidden;
    border: 1px solid var(--border);
  }
  input {
    width: 100%;
    height: 56px;
    padding: 0 var(--s-5);
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    font-size: 1.0625rem;
    outline: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: var(--s-2);
    max-height: 50vh;
    overflow-x: hidden;
    overflow-y: auto;
  }
  button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    min-height: 44px;
    padding: 0 var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    text-align: left;
  }
  [aria-selected='true'] button {
    background: var(--accent-soft);
  }
  small {
    color: var(--text-3);
    font-size: var(--t-12);
    font-weight: 600;
  }
  .none {
    padding: var(--s-4);
    color: var(--text-3);
  }
</style>
