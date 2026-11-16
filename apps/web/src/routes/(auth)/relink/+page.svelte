<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { fragmentToken, friendlyWebAuthnError, relink } from '#lib/auth';
  import { ApiError } from '#lib/api';
  import Button from '#lib/components/Button.svelte';
  import { IconKey } from '#lib/icons';

  let token = $state<string | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  onMount(() => (token = fragmentToken()));

  async function go() {
    if (!token) return;
    busy = true;
    error = null;
    try {
      await relink(token);
      await goto('/home', { replaceState: true });
    } catch (e) {
      error = e instanceof ApiError ? e.message : friendlyWebAuthnError(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Add this device · Phaseplay</title></svelte:head>

<h1>Add this device</h1>
<p class="lede">
  Your coach sent you this link so you can create a new passkey and get back into your team. It
  works once, for 24 hours.
</p>
{#if !token}
  <p class="err">This link looks incomplete. Ask your coach for a new one.</p>
{:else}
  <div class="stack">
    <Button variant="primary" size="lg" block loading={busy} onclick={go}
      >{#snippet icon()}<IconKey />{/snippet}Create passkey</Button
    >
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </div>
{/if}

<style>
  .err {
    color: var(--danger);
    font-weight: 600;
  }
</style>
