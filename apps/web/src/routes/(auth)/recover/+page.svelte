<script lang="ts">
  import { goto } from '$app/navigation';
  import Button from '#lib/components/Button.svelte';
  import Field from '#lib/components/Field.svelte';
  import { addPasskey, friendlyWebAuthnError, recover } from '#lib/auth';
  import { ApiError } from '#lib/api';
  import { IconKey } from '#lib/icons';

  let code = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let step = $state<'code' | 'passkey'>('code');

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      await recover(code);
      step = 'passkey';
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Something went wrong';
    } finally {
      busy = false;
    }
  }
  async function add() {
    busy = true;
    error = null;
    try {
      await addPasskey();
      await goto('/home', { replaceState: true });
    } catch (err) {
      error = friendlyWebAuthnError(err);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Recover your account · Phaseplay</title></svelte:head>

{#if step === 'code'}
  <h1>Use a recovery code</h1>
  <p class="lede">Enter one of the codes you saved when you created your account.</p>
  <form class="stack" onsubmit={submit}>
    <Field label="Recovery code" {error}>
      {#snippet children({ id, describedby })}
        <input {id} aria-describedby={describedby} bind:value={code} autocomplete="one-time-code" autocapitalize="none" spellcheck="false" placeholder="xxxx-xxxx-xxxx" />
      {/snippet}
    </Field>
    <Button type="submit" variant="primary" size="lg" block loading={busy}>Continue</Button>
  </form>
  <div class="alt"><span>No codes? Ask your coach for a device link.</span></div>
{:else}
  <h1>You're in. Add a passkey</h1>
  <p class="lede">Create a passkey on this device so you don't need a recovery code next time.</p>
  <div class="stack">
    <Button variant="primary" size="lg" block loading={busy} onclick={add}>{#snippet icon()}<IconKey />{/snippet}Create passkey</Button>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <Button variant="ghost" href="/home">Skip for now</Button>
  </div>
{/if}

<style>
  .err {
    color: var(--danger);
    font-weight: 600;
  }
</style>
