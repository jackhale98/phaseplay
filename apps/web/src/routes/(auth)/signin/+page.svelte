<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Button from '#lib/components/Button.svelte';
  import { browserSupportsWebAuthnAutofill, cancelPasskey, friendlyWebAuthnError, signIn } from '#lib/auth';
  import { IconKey } from '#lib/icons';
  import { api, v1 } from '#lib/api';
  import { app } from '#lib/data/app.svelte';

  let busy = $state(false);
  let error = $state<string | null>(null);
  const next = $derived(page.url.searchParams.get('next'));

  // Local dev and e2e only: the API refuses this in production and the route is stripped from prod builds.
  let devEnv = $state(false);
  const DEV_USERS = [
    { id: 'b0000000-0000-7000-8000-000000000002', name: 'Sam Carter', role: 'owner' },
    { id: 'b0000000-0000-7000-8000-000000000008', name: 'Jess Taylor', role: 'player' },
  ];
  async function devLogin(u: (typeof DEV_USERS)[number]) {
    await api(v1('/test/login'), { method: 'POST', body: { userId: u.id, displayName: u.name } });
    await app.signedIn();
    await go();
  }

  const go = () => goto(next && next.startsWith('/') ? next : '/home', { replaceState: true });

  onMount(() => {
    void api<{ env: string }>('/api/health').then((h) => (devEnv = h.env !== 'production')).catch(() => {});
    // Passkey autofill (conditional mediation): the browser offers saved passkeys in the field.
    void browserSupportsWebAuthnAutofill().then(async (ok) => {
      if (!ok) return;
      try {
        await signIn(true);
        await go();
      } catch {
        /* user ignored autofill or used the button */
      }
    });
    return cancelPasskey;
  });

  async function withButton() {
    busy = true;
    error = null;
    try {
      cancelPasskey();
      await signIn(false);
      await go();
    } catch (e) {
      error = friendlyWebAuthnError(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Sign in · Phaseplay</title></svelte:head>

<h1>Welcome back</h1>
<p class="lede">Sign in with the passkey on this device, or one nearby.</p>
<div class="stack">
  <label class="sr-only" for="pk">Passkey</label>
  <input id="pk" class="autofill" autocomplete="username webauthn" placeholder="Choose a saved passkey" readonly />
  <Button variant="primary" size="lg" block loading={busy} onclick={withButton}>
    {#snippet icon()}<IconKey />{/snippet}Sign in with a passkey
  </Button>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
</div>
{#if devEnv}
  <div class="dev">
    <p class="eyebrow">Local dev: seeded users</p>
    {#each DEV_USERS as u (u.id)}<Button size="sm" onclick={() => devLogin(u)}>{u.name} ({u.role})</Button>{/each}
  </div>
{/if}
<div class="alt">
  <span>New to Phaseplay? <a href="/signup{next ? `?next=${encodeURIComponent(next)}` : ''}">Create an account</a></span>
  <span>Lost your device? <a href="/recover">Use a recovery code</a></span>
</div>

<style>
  .autofill {
    min-height: 46px;
    padding: 10px 12px;
    border-radius: var(--r-md);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-3);
  }
  .dev {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    align-items: center;
    margin-top: var(--s-6);
    padding: var(--s-3);
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-md);
  }
  .dev .eyebrow {
    width: 100%;
  }
  .err {
    color: var(--danger);
    font-weight: 600;
    font-size: var(--t-14);
  }
</style>
