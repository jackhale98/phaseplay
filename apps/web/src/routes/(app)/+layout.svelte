<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { app } from '#lib/data/app.svelte';
  import AppShell from '#lib/shell/AppShell.svelte';

  let { children } = $props();
  let checked = $state(false);

  onMount(async () => {
    const ok = await app.init();
    if (!ok) {
      await goto(`/signin?next=${encodeURIComponent(page.url.pathname + page.url.search)}`, { replaceState: true });
      return;
    }
    // Deep links can pick the team: /events/x?team=<id>
    const want = page.url.searchParams.get('team');
    if (want && want !== app.teamId && app.me?.memberships.some((m) => m.team.id === want)) await app.selectTeam(want);
    checked = true;
  });

  $effect(() => {
    if (checked && app.me && app.me.memberships.length === 0) void goto('/welcome', { replaceState: true });
  });
</script>

{#if app.ready && app.me}
  <AppShell>{@render children()}</AppShell>
{:else}
  <div class="boot" aria-busy="true" aria-label="Loading Phaseplay"></div>
{/if}

<style>
  .boot {
    min-height: 100dvh;
    background: var(--bg);
  }
</style>
