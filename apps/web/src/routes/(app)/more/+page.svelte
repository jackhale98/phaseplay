<script lang="ts">
  import { app } from '#lib/data/app.svelte';
  import { theme, type ThemePref } from '#lib/stores/theme.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import {
    IconTimer,
    IconKey,
    IconSettings,
    IconShield,
    IconClipboard,
    IconCalendar,
    IconBell,
    IconChevronRight,
    IconInfo,
  } from '#lib/icons';

  let pref = $state<ThemePref>(theme.pref);
  $effect(() => theme.set(pref));
  const links = $derived([
    { href: '/practice', label: 'Practice plans', icon: IconTimer, show: true },
    { href: '/kit', label: 'Kit', icon: IconClipboard, show: true },
    { href: '/settings/calendar', label: 'Calendar feed', icon: IconCalendar, show: true },
    { href: '/settings/notifications', label: 'Notifications', icon: IconBell, show: true },
    { href: '/settings/account', label: 'Account and passkeys', icon: IconKey, show: true },
    { href: '/settings/team', label: 'Team settings', icon: IconSettings, show: true },
    { href: '/settings/roles', label: 'Roles and permissions', icon: IconShield, show: true },
    {
      href: '/settings/audit',
      label: 'Audit log',
      icon: IconClipboard,
      show: app.can('audit.view'),
    },
    { href: '/privacy', label: 'Privacy', icon: IconShield, show: true },
  ]);
</script>

<svelte:head><title>More · Phaseplay</title></svelte:head>

<div class="page narrow">
  <h1>More</h1>
  <ul class="list card menu">
    {#each links.filter((l) => l.show) as l (l.href)}
      <li>
        <a href={l.href}><l.icon /><span class="grow">{l.label}</span><IconChevronRight /></a>
      </li>
    {/each}
  </ul>
  <section class="card pad">
    <span class="lbl">Appearance</span>
    <Segmented
      label="Appearance"
      bind:value={pref}
      options={[
        { value: 'system', label: 'Auto' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ]}
    />
  </section>
  <p class="ver subtle">
    <IconInfo /> Phaseplay {__APP_VERSION__.slice(0, 7)} · built {__APP_BUILT_AT__.slice(0, 10)}
  </p>
</div>

<style>
  .narrow {
    max-width: 680px;
  }
  h1 {
    margin-bottom: var(--s-5);
  }
  .menu {
    overflow: hidden;
  }
  .menu a {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 56px;
    padding: 0 var(--s-4);
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
    border-bottom: 1px solid var(--border);
  }
  .menu li:last-child a {
    border-bottom: 0;
  }
  .menu a:hover {
    background: var(--surface-2);
  }
  .menu :global(svg) {
    width: 20px;
    height: 20px;
    color: var(--text-2);
  }
  .pad {
    margin-top: var(--s-4);
    padding: var(--s-4);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  .lbl {
    font-weight: 600;
  }
  .ver {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: var(--s-6);
  }
  .ver :global(svg) {
    width: 14px;
    height: 14px;
  }
</style>
