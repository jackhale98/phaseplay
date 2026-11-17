<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { app } from '#lib/data/app.svelte';
  import Crest from '#lib/components/Crest.svelte';
  import { crestUrl } from '#lib/crest';
  import { liveNominee } from '@phaseplay/shared';
  import SyncDot from '#lib/components/SyncDot.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import DemoBanner from './DemoBanner.svelte';
  import OwnershipBanner from './OwnershipBanner.svelte';
  import { NAV, DESKTOP_EXTRA } from './nav';
  import { IconChevronDown, IconPlus, IconCheck, IconSearch, IconMore } from '#lib/icons';

  let { children }: { children: Snippet } = $props();
  let switcher = $state(false);
  let palette = $state(false);
  let shortcuts = $state(false);

  const path = $derived(page.url.pathname);
  const team = $derived(
    app.team ?? app.me?.memberships.find((m) => m.team.id === app.teamId)?.team ?? null,
  );
  const teams = $derived(app.me?.memberships ?? []);
  const mobileNav = $derived(NAV.filter((n) => !n.desktopOnly));
  /** Full-screen modes hide navigation (match mode, practice runner, editors). */
  const immersive = $derived(/\/(match|run|edit)(\/|$)/.test(path));

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      palette = !palette;
    } else if (!typing && e.key === '?' && !immersive) {
      shortcuts = true;
    } else if (
      !typing &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !immersive &&
      /^[1-7]$/.test(e.key) &&
      !e.shiftKey
    ) {
      const n = NAV[Number(e.key) - 1];
      if (n) void goto(n.href);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<a class="skip" href="#main">Skip to content</a>
<div class="shell" class:immersive>
  {#if !immersive}
    <aside class="side" aria-label="Main">
      <button
        class="team"
        onclick={() => (switcher = true)}
        aria-label="Switch team, current {team?.name ?? 'none'}"
      >
        {#if team}<Crest
            colors={team.colors}
            text={team.shortName}
            src={crestUrl(team)}
            size={32}
          />{/if}
        <span class="tn truncate">{team?.name ?? 'Phaseplay'}</span>
        <IconChevronDown />
      </button>
      <button class="search" onclick={() => (palette = true)}>
        <IconSearch /><span>Search</span><kbd>⌘K</kbd>
      </button>
      <nav>
        <ul>
          {#each [...NAV.filter((n) => n.href !== '/more'), ...DESKTOP_EXTRA] as n (n.href)}
            <li class:rail-hide={n.href === '/settings'}>
              <a href={n.href} aria-current={n.match.test(path) ? 'page' : undefined}>
                <n.icon /><span>{n.label}</span>
              </a>
            </li>
          {/each}
          <li class="rail-only">
            <a href="/more" aria-current={/^\/(more|settings)/.test(path) ? 'page' : undefined}>
              <IconMore /><span>More</span>
            </a>
          </li>
        </ul>
      </nav>
      <div class="foot">
        <SyncDot />
        <span class="me truncate">{app.me?.user.displayName ?? ''}</span>
      </div>
    </aside>

    <header class="top">
      <button
        class="team-m"
        onclick={() => (switcher = true)}
        aria-label="Switch team, current {team?.name ?? 'none'}"
      >
        {#if team}<Crest
            colors={team.colors}
            text={team.shortName}
            src={crestUrl(team)}
            size={28}
          />{/if}
        <span class="truncate">{team?.shortName ?? 'Phaseplay'}</span>
        <IconChevronDown />
      </button>
      <SyncDot />
    </header>
  {/if}

  <main id="main" tabindex="-1">
    {#if app.demo && !immersive}<DemoBanner />{/if}
    {#if !immersive && app.team && app.member && liveNominee( app.team, [app.member] )}<OwnershipBanner
      />{/if}
    {@render children()}
  </main>

  {#if !immersive}
    <nav class="tabs" aria-label="Main">
      {#each mobileNav as n (n.href)}
        <a href={n.href} aria-current={n.match.test(path) ? 'page' : undefined}>
          <n.icon /><span>{n.label}</span>
        </a>
      {/each}
    </nav>
  {/if}
</div>

<Sheet bind:open={switcher} title="Your teams" size="sm">
  <ul class="list teams">
    {#each teams as m (m.team.id)}
      <li>
        <button
          class="trow"
          onclick={async () => {
            switcher = false;
            await app.selectTeam(m.team.id);
            await goto('/home');
          }}
        >
          <Crest colors={m.team.colors} text={m.team.shortName} src={crestUrl(m.team)} size={36} />
          <span class="grow"
            ><strong>{m.team.name}</strong><small class="muted">{m.member.role}</small></span
          >
          {#if m.team.id === app.teamId}<IconCheck />{/if}
        </button>
      </li>
    {/each}
    <li>
      <a class="trow" href="/welcome" onclick={() => (switcher = false)}>
        <span class="plus"><IconPlus /></span><span class="grow"
          ><strong>Create a team</strong></span
        >
      </a>
    </li>
  </ul>
</Sheet>

<CommandPalette bind:open={palette} />

<Sheet bind:open={shortcuts} title="Keyboard shortcuts" size="sm">
  <dl class="keys">
    <dt><kbd>⌘</kbd> <kbd>K</kbd></dt>
    <dd>Search and jump anywhere</dd>
    <dt><kbd>1</kbd>–<kbd>7</kbd></dt>
    <dd>Home, Schedule, Squad, Playbook, Practice, Kit, Stats</dd>
    <dt><kbd>?</kbd></dt>
    <dd>This list</dd>
    <dt><kbd>Esc</kbd></dt>
    <dd>Close a sheet or dialog</dd>
  </dl>
  <p class="subtle">The play editor has its own shortcuts. Press <kbd>?</kbd> inside it.</p>
</Sheet>

<style>
  .skip {
    position: absolute;
    left: -9999px;
    top: 8px;
    z-index: 100;
    padding: 8px 12px;
    background: var(--surface);
    border-radius: var(--r-md);
  }
  .skip:focus {
    left: 8px;
  }
  .shell {
    min-height: 100dvh;
  }
  main {
    outline: none;
    padding-bottom: calc(var(--tabbar-h) + var(--safe-b));
  }
  .immersive main {
    padding-bottom: 0;
  }
  /* ---------- Mobile ---------- */
  .side {
    display: none;
  }
  .top {
    position: sticky;
    top: 0;
    z-index: var(--z-nav);
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: calc(var(--appbar-h) + var(--safe-t));
    padding: var(--safe-t) var(--s-4) 0 var(--s-2);
    background: color-mix(in srgb, var(--bg) 86%, transparent);
    backdrop-filter: saturate(1.4) blur(14px);
    -webkit-backdrop-filter: saturate(1.4) blur(14px);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  .team-m {
    display: inline-flex;
    align-items: center;
    gap: var(--s-2);
    min-height: 44px;
    padding: 0 var(--s-2);
    border: 0;
    background: transparent;
    font-weight: 800;
    font-size: 1.0625rem;
    letter-spacing: -0.01em;
    border-radius: var(--r-md);
  }
  .team-m :global(svg:last-child) {
    width: 16px;
    height: 16px;
    color: var(--text-3);
  }
  .tabs {
    position: fixed;
    z-index: var(--z-nav);
    left: 0;
    right: 0;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    height: calc(var(--tabbar-h) + var(--safe-b));
    padding-bottom: var(--safe-b);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: saturate(1.4) blur(14px);
    -webkit-backdrop-filter: saturate(1.4) blur(14px);
    border-top: 1px solid var(--border);
  }
  .tabs a {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 5px;
    padding-top: 10px;
    color: var(--text-3);
    text-decoration: none;
    font-size: 0.6875rem;
    font-weight: 650;
    letter-spacing: 0.01em;
  }
  /* Selected tab: a solid pill behind the icon (tokens.css --sel) plus a bolder, full-contrast label. */
  .tabs a::before {
    content: '';
    position: absolute;
    top: 6px;
    left: 50%;
    width: 56px;
    height: 32px;
    margin-left: -28px;
    border-radius: var(--r-full);
    background: transparent;
    transition: background-color var(--m-fast) var(--ease);
  }
  .tabs a :global(svg) {
    position: relative;
    width: 24px;
    height: 24px;
  }
  .tabs a:not([aria-current='page']):hover {
    color: var(--text);
  }
  .tabs a[aria-current='page'] {
    color: var(--text);
    font-weight: 800;
  }
  .tabs a[aria-current='page']::before {
    background: var(--sel);
  }
  .tabs a[aria-current='page'] :global(svg) {
    color: var(--on-sel);
  }
  /* ---------- Tablet rail & desktop sidebar ---------- */
  @media (min-width: 768px) {
    .top,
    .tabs {
      display: none;
    }
    main {
      padding-bottom: 0;
      margin-left: 88px;
    }
    .immersive main {
      margin-left: 0;
    }
    .side {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: var(--z-nav);
      display: flex;
      flex-direction: column;
      width: 88px;
      padding: var(--s-4) var(--s-2);
      background: var(--surface);
      border-right: 1px solid var(--border);
    }
    .team {
      display: grid;
      place-items: center;
      height: 56px;
      border: 0;
      background: transparent;
      border-radius: var(--r-md);
    }
    .team .tn,
    .team > :global(svg:last-child),
    .search,
    .foot .me {
      display: none;
    }
    nav ul {
      list-style: none;
      margin: var(--s-4) 0 0;
      padding: 0;
      display: grid;
      gap: var(--s-1);
    }
    nav a {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: var(--s-2) 0;
      border-radius: var(--r-md);
      color: var(--text-2);
      text-decoration: none;
      font-size: 0.6875rem;
      font-weight: 650;
    }
    nav a :global(svg) {
      width: 22px;
      height: 22px;
    }
    nav a:not([aria-current='page']):hover {
      background: var(--surface-2);
      color: var(--text);
    }
    /* Selected: solid fill (tokens.css --sel), unlike the hover tint. */
    nav a[aria-current='page'] {
      background: var(--sel);
      color: var(--on-sel);
      font-weight: 750;
    }
    .rail-hide {
      display: none;
    }
    .foot {
      margin-top: auto;
      display: grid;
      place-items: center;
    }
  }
  @media (min-width: 1200px) {
    main {
      margin-left: 256px;
    }
    .side {
      width: 256px;
      padding: var(--s-4);
    }
    .team {
      display: flex;
      align-items: center;
      gap: var(--s-3);
      height: auto;
      padding: var(--s-2);
      text-align: left;
    }
    .team:hover {
      background: var(--surface-2);
    }
    .team .tn {
      display: block;
      flex: 1;
      font-weight: 800;
      letter-spacing: -0.01em;
    }
    .team > :global(svg:last-child) {
      display: block;
      width: 16px;
      height: 16px;
      color: var(--text-3);
    }
    .search {
      display: flex;
      align-items: center;
      gap: var(--s-2);
      margin-top: var(--s-4);
      height: 40px;
      padding: 0 var(--s-3);
      border-radius: var(--r-md);
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--text-3);
      font-size: var(--t-14);
    }
    .search span {
      flex: 1;
      text-align: left;
    }
    .search :global(svg) {
      width: 16px;
      height: 16px;
    }
    nav a {
      flex-direction: row;
      gap: var(--s-3);
      padding: 0 var(--s-3);
      min-height: 44px;
      font-size: 0.9375rem;
    }
    nav a :global(svg) {
      width: 20px;
      height: 20px;
    }
    .rail-hide {
      display: list-item;
    }
    .rail-only {
      display: none;
    }
    .foot {
      display: flex;
      align-items: center;
      gap: var(--s-3);
      padding: var(--s-3);
      border-top: 1px solid var(--border);
    }
    .foot .me {
      display: block;
      font-size: var(--t-14);
      font-weight: 600;
    }
  }
  kbd {
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 5px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text-2);
  }
  .teams {
    display: grid;
    gap: var(--s-1);
  }
  .trow {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    width: 100%;
    min-height: 56px;
    padding: var(--s-2);
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    text-align: left;
    color: var(--text);
    text-decoration: none;
  }
  .trow:hover {
    background: var(--surface-2);
  }
  .trow small {
    display: block;
    text-transform: capitalize;
  }
  .trow :global(svg) {
    width: 20px;
    height: 20px;
    color: var(--accent-text);
  }
  .plus {
    display: grid;
    place-items: center;
    width: 36px;
    height: 40px;
  }
  .keys {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--s-3) var(--s-4);
    margin: 0 0 var(--s-4);
  }
  .keys dd {
    margin: 0;
    color: var(--text-2);
  }
</style>
