<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Button from '#lib/components/Button.svelte';
  import Field from '#lib/components/Field.svelte';
  import RecoveryCodes from '#lib/components/RecoveryCodes.svelte';
  import { browserSupportsWebAuthn, friendlyWebAuthnError, signUp } from '#lib/auth';
  import { IconKey } from '#lib/icons';

  let name = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let codes = $state<string[] | null>(null);
  const next = $derived(page.url.searchParams.get('next'));
  const supported = typeof window !== 'undefined' && browserSupportsWebAuthn();

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return (error = 'Tell us what to call you');
    busy = true;
    error = null;
    try {
      codes = await signUp(name.trim());
    } catch (err) {
      error = friendlyWebAuthnError(err);
    } finally {
      busy = false;
    }
  }
  function done() {
    void goto(next && next.startsWith('/') ? next : '/welcome', { replaceState: true });
  }
</script>

<svelte:head><title>Create your account · Phaseplay</title></svelte:head>

{#if codes}
  <h1>Save your recovery codes</h1>
  <p class="lede">If you ever lose every device with your passkey, one of these codes gets you back in. Each works once.</p>
  <RecoveryCodes {codes} ondone={done} />
{:else}
  <h1>Create your account</h1>
  <p class="lede">Just your name. You'll sign in with a passkey (Face ID, fingerprint or your phone's screen lock), with no password to remember.</p>
  {#if !supported}
    <p class="warn" role="alert">This browser doesn't support passkeys. Try Safari on iPhone, or Chrome on Android or desktop.</p>
  {/if}
  <form onsubmit={submit} class="stack" novalidate>
    <Field label="Your name" hint="How your team will see you, e.g. Jess Taylor" {error}>
      {#snippet children({ id, describedby })}
        <input {id} aria-describedby={describedby} bind:value={name} autocomplete="name" maxlength="40" required />
      {/snippet}
    </Field>
    <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!supported}>
      {#snippet icon()}<IconKey />{/snippet}Create passkey
    </Button>
  </form>
  <div class="alt">
    <span>Already have an account? <a href="/signin{next ? `?next=${encodeURIComponent(next)}` : ''}">Sign in</a></span>
  </div>
{/if}

<style>
  .warn {
    padding: var(--s-3) var(--s-4);
    border-radius: var(--r-md);
    background: var(--warn-soft);
    color: var(--warn);
    font-weight: 600;
    margin-bottom: var(--s-4);
  }
</style>
