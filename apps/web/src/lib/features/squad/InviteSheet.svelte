<script lang="ts">
  import {
    canRevokeInvite,
    invitableRoles,
    isCustomised,
    roleSummary,
    uuidv7,
    type Invite,
    type Role,
    ROLE_LABELS,
  } from '@phaseplay/shared';
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import Sheet from '#lib/components/Sheet.svelte';
  import Button from '#lib/components/Button.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import QrCode from '#lib/components/QrCode.svelte';
  import { shareLink, copyText } from '#lib/share';
  import { toasts } from '#lib/stores/toast.svelte';
  import { ago, plural } from '#lib/format';
  import { IconShare, IconCopy, IconTrash } from '#lib/icons';

  let { open = $bindable() }: { open: boolean } = $props();
  const roles = $derived(app.role ? invitableRoles(app.role) : []);
  let role = $state<Role>('player');
  let expiresIn = $state<'1h' | '1d' | '7d' | '30d'>('7d');
  let maxUses = $state(40);
  let busy = $state(false);
  let link = $state<string | null>(null);
  let invites = $state<Invite[]>([]);

  async function load() {
    try {
      invites = (await api<{ invites: Invite[] }>(teamPath('/invites'))).invites;
    } catch {}
  }
  $effect(() => {
    if (open) {
      link = null;
      void load();
    }
  });

  async function create() {
    busy = true;
    try {
      const r = await api<{ path: string }>(teamPath('/invites'), {
        method: 'POST',
        body: { id: uuidv7(), role, expiresIn, maxUses },
      });
      link = `${location.origin}${r.path}`;
      void load();
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : 'Could not create an invite');
    } finally {
      busy = false;
    }
  }
  async function revoke(id: string) {
    try {
      await api(teamPath(`/invites/${id}`), { method: 'DELETE' });
      toasts.show('Invite revoked');
      void load();
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : 'Could not revoke');
    }
  }
  const active = $derived(
    invites.filter((i) => !i.revokedAt && i.expiresAt > Date.now() && i.uses < i.maxUses),
  );
  const canRevoke = (r: Role) => !!app.perms && canRevokeInvite(app.perms, r);
</script>

<Sheet
  bind:open
  title="Invite to {app.team?.shortName ?? 'the team'}"
  description="Anyone with the link can join until it expires or is used up."
  size="md"
>
  {#if link}
    <div class="made">
      <QrCode text={link} label="QR code for the invite link" />
      <p class="url">{link.replace(/#.*/, '#…')}</p>
      <div class="row wrap center">
        <Button
          variant="primary"
          onclick={async () => {
            const r = await shareLink(
              link!,
              `Join ${app.team?.name} on Phaseplay`,
              `Join ${app.team?.name} on Phaseplay`,
            );
            if (r === 'copied') toasts.show('Link copied. Paste it in the group chat');
          }}>{#snippet icon()}<IconShare />{/snippet}Share link</Button
        >
        <Button
          onclick={async () =>
            toasts.show((await copyText(link!)) ? 'Link copied' : "Couldn't copy")}
          >{#snippet icon()}<IconCopy />{/snippet}Copy</Button
        >
      </div>
      <Button variant="ghost" onclick={() => (link = null)}>Back to invites</Button>
    </div>
  {:else}
    <div class="stack">
      <div class="opt">
        <span class="lbl">Joins as</span>
        <Segmented
          label="Role"
          bind:value={role}
          options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        />
      </div>
      {#if isCustomised(role, app.team?.rolePermissions)}
        <p class="subtle role-note" aria-live="polite">
          {roleSummary(role, app.team?.rolePermissions)}
          <a href="/settings/roles">What each role can do</a>
        </p>
      {/if}
      <div class="opt">
        <span class="lbl">Expires after</span>
        <Segmented
          label="Expiry"
          bind:value={expiresIn}
          options={[
            { value: '1h', label: '1 hour' },
            { value: '1d', label: '1 day' },
            { value: '7d', label: '7 days' },
            { value: '30d', label: '30 days' },
          ]}
          size="sm"
        />
      </div>
      <label class="opt">
        <span class="lbl">Up to</span>
        <span class="row"
          ><input type="number" min="1" max="100" bind:value={maxUses} class="num" /> people</span
        >
      </label>
      <Button variant="primary" size="lg" block loading={busy} onclick={create}
        >Create invite link</Button
      >
    </div>
  {/if}

  {#if active.length && !link}
    <h3 class="section-title">Active invites</h3>
    {#if active.some((i) => !i.path)}
      <p class="subtle">
        Links made before this update can't be shown again. Make a new one to share.
      </p>
    {/if}
    <ul class="list inv">
      {#each active as i (i.id)}
        <li>
          <span class="grow"
            ><strong>{ROLE_LABELS[i.role]}</strong> · {plural(i.uses, 'use')} of {i.maxUses}<small
              class="muted"
            >
              · made {ago(i.createdAt)}</small
            ></span
          >
          {#if i.path}
            <Button
              size="sm"
              onclick={async () =>
                toasts.show(
                  (await copyText(`${location.origin}${i.path}`)) ? 'Link copied' : "Couldn't copy",
                )}
              >{#snippet icon()}<IconCopy />{/snippet}Copy<span class="sr-only">
                {ROLE_LABELS[i.role]} invite link</span
              ></Button
            >
            <Button size="sm" variant="ghost" onclick={() => (link = `${location.origin}${i.path}`)}
              >Show<span class="sr-only">
                {ROLE_LABELS[i.role]} invite link and QR code</span
              ></Button
            >
          {/if}
          {#if canRevoke(i.role)}<Button size="sm" variant="ghost" onclick={() => revoke(i.id)}
              >{#snippet icon()}<IconTrash />{/snippet}Revoke</Button
            >{/if}
        </li>
      {/each}
    </ul>
  {/if}
</Sheet>

<style>
  .role-note {
    margin: calc(-1 * var(--s-2)) 0 0;
    font-size: var(--t-14);
  }
  .made {
    display: grid;
    justify-items: center;
    gap: var(--s-4);
    padding: var(--s-2) 0;
  }
  .url {
    font-size: var(--t-14);
    color: var(--text-3);
    word-break: break-all;
  }
  .center {
    justify-content: center;
  }
  .opt {
    display: grid;
    gap: 6px;
    justify-items: start;
  }
  .lbl {
    font-weight: 650;
    font-size: var(--t-14);
  }
  .num {
    width: 88px;
    min-height: 44px;
    padding: 0 var(--s-3);
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
  }
  .inv li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--border);
    font-size: var(--t-14);
  }
</style>
