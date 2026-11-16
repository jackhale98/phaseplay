<!--
  phaseplay.app/demo: opens the public demo team. A plain link (works before the landing page has
  hydrated, and can be shared). Signs the visitor in as the read-only demo coach, then goes Home.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { startDemo } from '#lib/auth';
  import { app } from '#lib/data/app.svelte';
  import Logo from '#lib/marketing/Logo.svelte';
  import Button from '#lib/components/Button.svelte';

  let failed = $state(false);

  async function open() {
    failed = false;
    try {
      // Someone with a real account who opens the demo link just goes to their own team.
      if ((await app.init()) && !app.demo) return void goto('/home', { replaceState: true });
      if (!app.demo) await startDemo();
      await goto('/home', { replaceState: true });
    } catch {
      failed = true;
    }
  }
  onMount(open);
</script>

<svelte:head><title>Demo · Phaseplay</title></svelte:head>

<main class="demo" aria-busy={!failed}>
  <Logo size={48} />
  {#if failed}
    <h1>Couldn't open the demo</h1>
    <p class="muted">Check your connection and try again.</p>
    <div class="row"><Button variant="primary" onclick={open}>Try again</Button><Button href="/">Back</Button></div>
  {:else}
    <h1>Opening Phaseplay RFC…</h1>
    <p class="muted">A demo squad with a full season. Nothing you do is saved.</p>
    <div class="spin" aria-hidden="true"></div>
  {/if}
</main>

<style>
  .demo {
    min-height: 100dvh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--s-3);
    padding: var(--s-6);
    text-align: center;
  }
  h1 {
    font-size: var(--t-24);
    margin-top: var(--s-3);
  }
  .spin {
    width: 28px;
    height: 28px;
    margin-top: var(--s-4);
    border-radius: 50%;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
