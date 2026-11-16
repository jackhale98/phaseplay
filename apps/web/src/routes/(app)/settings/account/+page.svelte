<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { Passkey } from '@phaseplay/shared';
  import { api, ApiError, v1 } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { addPasskey, friendlyWebAuthnError, signOut } from '#lib/auth';
  import Button from '#lib/components/Button.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import RecoveryCodes from '#lib/components/RecoveryCodes.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { ago } from '#lib/format';
  import { IconBack, IconKey, IconPlus, IconTrash, IconEdit, IconDownload, IconLogOut } from '#lib/icons';

  let passkeys = $state<Passkey[]>([]);
  let name = $state(app.me?.user.displayName ?? '');
  let codes = $state<string[] | null>(null);
  let confirmDelete = $state(false);
  let renaming = $state<Passkey | null>(null);
  let nick = $state('');

  const load = async () => {
    try {
      passkeys = (await api<{ passkeys: Passkey[] }>(v1('/me/passkeys'))).passkeys;
    } catch {}
  };
  onMount(load);

  const err = (e: unknown, fallback: string) => toasts.error(e instanceof ApiError ? e.message : fallback);

  async function saveName() {
    try {
      await api(v1('/me'), { method: 'PATCH', body: { displayName: name } });
      await app.refreshMe();
      await app.sync();
      toasts.success('Name updated');
    } catch (e) {
      err(e, 'Could not update your name');
    }
  }
  async function add() {
    try {
      await addPasskey();
      toasts.success('Passkey added');
      await load();
    } catch (e) {
      toasts.error(friendlyWebAuthnError(e));
    }
  }
  async function remove(p: Passkey) {
    try {
      await api(v1(`/me/passkeys/${encodeURIComponent(p.id)}`), { method: 'DELETE' });
      await load();
    } catch (e) {
      err(e, 'Could not remove');
    }
  }
  async function rename() {
    if (!renaming) return;
    try {
      await api(v1(`/me/passkeys/${encodeURIComponent(renaming.id)}`), { method: 'PATCH', body: { nickname: nick } });
      renaming = null;
      await load();
    } catch (e) {
      err(e, 'Could not rename');
    }
  }
  async function regen() {
    try {
      codes = (await api<{ recoveryCodes: string[] }>(v1('/me/recovery-codes'), { method: 'POST', body: {} })).recoveryCodes;
    } catch (e) {
      err(e, 'Could not create codes');
    }
  }
  async function everywhere() {
    await api(v1('/me/sessions/revoke'), { method: 'POST', body: {} }).catch(() => {});
    await app.signedOut();
    await goto('/signin');
  }
  async function exportData() {
    const res = await fetch(v1('/me/export'), { credentials: 'same-origin' });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: 'phaseplay-export.json' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  async function deleteAccount() {
    try {
      await api(v1('/me'), { method: 'DELETE' });
      await app.signedOut();
      await goto('/');
    } catch (e) {
      confirmDelete = false;
      err(e, 'Could not delete your account');
    }
  }
</script>

<svelte:head><title>Account · Phaseplay</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/more"><IconBack /> More</a>
  <h1>Account</h1>

  <section class="card pad">
    <Field label="Your name" hint="Shown to your teams">
      {#snippet children({ id, describedby })}<input {id} aria-describedby={describedby} bind:value={name} maxlength="40" />{/snippet}
    </Field>
    <div class="end"><Button disabled={!name.trim() || name === app.me?.user.displayName} onclick={saveName}>Save</Button></div>
  </section>

  <section class="card pad">
    <div class="hd"><h2 class="h">Passkeys</h2><Button size="sm" onclick={add}>{#snippet icon()}<IconPlus />{/snippet}Add</Button></div>
    <ul class="list">
      {#each passkeys as p (p.id)}
        <li class="pk">
          <IconKey />
          <span class="grow"><strong>{p.nickname ?? 'Passkey'}</strong><small class="muted">Added {ago(p.createdAt)}{p.lastUsedAt ? ` · used ${ago(p.lastUsedAt)}` : ''}{p.backedUp ? ' · synced' : ''}</small></span>
          <button class="ib" aria-label="Rename {p.nickname ?? 'passkey'}" onclick={() => ((renaming = p), (nick = p.nickname ?? ''))}><IconEdit /></button>
          <button class="ib" aria-label="Remove {p.nickname ?? 'passkey'}" disabled={passkeys.length < 2} onclick={() => remove(p)}><IconTrash /></button>
        </li>
      {/each}
    </ul>
  </section>

  <section class="card pad">
    <h2 class="h">Recovery codes</h2>
    {#if codes}
      <RecoveryCodes {codes} ondone={() => (codes = null)} />
    {:else}
      <p class="muted">Lost all your devices? A recovery code gets you back in. Making new codes cancels the old ones.</p>
      <div><Button onclick={regen}>Make new recovery codes</Button></div>
    {/if}
  </section>

  <section class="card pad">
    <h2 class="h">Your data</h2>
    <div class="row wrap">
      <Button onclick={exportData}>{#snippet icon()}<IconDownload />{/snippet}Export my data</Button>
      <Button onclick={async () => (await signOut(), goto('/'))}>{#snippet icon()}<IconLogOut />{/snippet}Sign out</Button>
      <Button variant="ghost" onclick={everywhere}>Sign out everywhere</Button>
    </div>
    <div><Button variant="ghost" class="dz" onclick={() => (confirmDelete = true)}>{#snippet icon()}<IconTrash />{/snippet}Delete account</Button></div>
  </section>
</div>

<Sheet bind:open={confirmDelete} title="Delete your account?" description="This can't be undone. You'll be removed from every team and your passkeys will stop working." size="sm">
  {#snippet children()}<p class="muted">If you own a team, transfer it to another coach first.</p>{/snippet}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmDelete = false)}>Cancel</Button>
    <Button variant="danger" onclick={deleteAccount}>Delete account</Button>
  {/snippet}
</Sheet>
<Sheet open={!!renaming} onclose={() => (renaming = null)} title="Rename passkey" size="sm">
  <form class="stack" onsubmit={(e) => (e.preventDefault(), rename())}>
    <Field label="Name">{#snippet children({ id })}<input {id} bind:value={nick} maxlength="40" />{/snippet}</Field>
    <Button type="submit" variant="primary" block>Save</Button>
  </form>
</Sheet>

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
  h1 {
    margin: var(--s-2) 0 var(--s-5);
  }
  .pad {
    padding: var(--s-5);
    margin-bottom: var(--s-4);
    display: grid;
    gap: var(--s-3);
  }
  .h {
    font-size: var(--t-16);
  }
  .hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .end {
    display: flex;
    justify-content: flex-end;
  }
  .pk {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 56px;
    border-bottom: 1px solid var(--border);
  }
  .pk:last-child {
    border-bottom: 0;
  }
  .pk > :global(svg) {
    width: 20px;
    height: 20px;
    color: var(--accent-text);
  }
  .pk small {
    display: block;
  }
  .ib {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-2);
  }
  .ib :global(svg) {
    width: 18px;
    height: 18px;
  }
  .ib:disabled {
    opacity: 0.35;
  }
  :global(.dz) {
    color: var(--danger) !important;
  }
</style>
