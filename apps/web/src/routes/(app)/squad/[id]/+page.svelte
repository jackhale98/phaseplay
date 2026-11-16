<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { canChangeRole, canRemove, isCoach, uuidv7, type Member, type Role } from '@phaseplay/shared';
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import Avatar from '#lib/components/Avatar.svelte';
  import Button from '#lib/components/Button.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Chip from '#lib/components/Chip.svelte';
  import QrCode from '#lib/components/QrCode.svelte';
  import PositionPicker from '#lib/features/squad/PositionPicker.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { copyText } from '#lib/share';
  import { IconBack, IconKey, IconTrash, IconCopy, IconLogOut } from '#lib/icons';

  const s = $derived(app.snap);
  const m = $derived(s?.rows.members[page.params.id ?? '']);
  const me = $derived(s?.me);
  const self = $derived(m?.id === me?.id);
  const canEdit = $derived(!!m && !!me && (self || isCoach(me.role) || (m.status === 'pending' && me.role === 'manager')));
  let positions = $state<number[]>([]);
  let jersey = $state<number | null>(null);
  let dirty = $state(false);
  let confirmRemove = $state(false);
  let relinkUrl = $state<string | null>(null);
  let confirmTransfer = $state(false);

  $effect(() => {
    if (m && !dirty) {
      positions = [...m.positions];
      jersey = m.jersey;
    }
  });

  async function save() {
    if (!m) return;
    await app.mutate({
      method: 'PATCH',
      path: teamPath(`/members/${m.id}`),
      body: { positions, jersey },
      label: 'Positions',
      optimistic: [{ op: 'patch', entity: 'members', key: m.id, value: { positions, jersey } }],
    });
    dirty = false;
    toasts.success('Saved');
  }
  async function setRole(role: Role) {
    if (!m) return;
    await app.mutate({ method: 'PATCH', path: teamPath(`/members/${m.id}`), body: { role }, label: 'Role change', optimistic: [{ op: 'patch', entity: 'members', key: m.id, value: { role } }] });
  }
  async function remove() {
    if (!m) return;
    confirmRemove = false;
    await app.mutate({ method: 'DELETE', path: teamPath(`/members/${m.id}`), label: `Remove ${m.displayName}`, optimistic: [{ op: 'delete', entity: 'members', key: m.id }] });
    toasts.show(`${m.displayName} removed`);
    await goto('/squad');
  }
  async function relink() {
    if (!m) return;
    try {
      const r = await api<{ path: string }>(teamPath(`/members/${m.id}/relink`), { method: 'POST', body: { id: uuidv7(), memberId: m.id } });
      relinkUrl = `${location.origin}${r.path}`;
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : 'Could not create link');
    }
  }
  async function transfer() {
    if (!m) return;
    try {
      await api(teamPath('/transfer'), { method: 'POST', body: { memberId: m.id } });
      confirmTransfer = false;
      toasts.success(`${m.displayName} now owns the team`);
      await app.sync();
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : 'Could not transfer');
    }
  }
  async function leave() {
    try {
      await api(teamPath('/leave'), { method: 'POST', body: {} });
      toasts.show(`You left ${s?.team.name}`);
      await app.refreshMe();
      await goto('/home');
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : 'Could not leave');
    }
  }
  const roles: Role[] = ['coach', 'manager', 'player'];
</script>

<svelte:head><title>{m?.displayName ?? 'Member'} · Squad</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/squad"><IconBack /> Squad</a>
  {#if !m}
    <p class="muted">This member isn't in the squad any more.</p>
  {:else}
    <header class="who">
      <Avatar name={m.displayName} jersey={m.jersey} size={64} muted={m.status === 'pending'} />
      <div>
        <h1>{m.displayName}</h1>
        <div class="row wrap">
          <Chip tone="accent">{m.role}</Chip>
          {#if m.status === 'pending'}<Chip tone="warn">Not joined yet</Chip>{/if}
        </div>
      </div>
    </header>

    <section class="card pad">
      <h2 class="h">Shirt and positions</h2>
      <label class="jersey">
        <span>Usual shirt number</span>
        <input type="number" min="0" max="99" value={jersey ?? ''} disabled={!canEdit} oninput={(e) => ((jersey = e.currentTarget.value === '' ? null : Number(e.currentTarget.value)), (dirty = true))} />
      </label>
      <PositionPicker bind:value={() => positions, (v) => ((positions = v), (dirty = true))} disabled={!canEdit} />
      {#if canEdit}
        <div class="actions"><Button variant="primary" disabled={!dirty} onclick={save}>Save</Button></div>
      {/if}
    </section>

    {#if me && !self && m.status === 'active' && canChangeRole(me.role, m.role, m.role === 'player' ? 'coach' : 'player')}
      <section class="card pad">
        <h2 class="h">Role</h2>
        <div class="row wrap">
          {#each roles as r (r)}
            <Chip selected={m.role === r} onclick={() => canChangeRole(me.role, m.role, r) && setRole(r)}>{r}</Chip>
          {/each}
        </div>
      </section>
    {/if}

    {#if me && !self && isCoach(me.role) && m.status === 'active' && m.userId}
      <section class="card pad">
        <h2 class="h">Lost her phone?</h2>
        <p class="muted">Make a one-time link (valid 24 hours) that lets {m.displayName.split(' ')[0]} add a passkey on a new device.</p>
        {#if relinkUrl}
          <div class="relink">
            <QrCode text={relinkUrl} size={180} label="Device link QR code" />
            <Button onclick={async () => toasts.show((await copyText(relinkUrl!)) ? 'Link copied' : "Couldn't copy")}>{#snippet icon()}<IconCopy />{/snippet}Copy link</Button>
          </div>
        {:else}
          <Button onclick={relink}>{#snippet icon()}<IconKey />{/snippet}Create device link</Button>
        {/if}
      </section>
    {/if}

    <div class="danger">
      {#if me && !self && canRemove(me.role, m.role)}
        <Button variant="ghost" onclick={() => (confirmRemove = true)}>{#snippet icon()}<IconTrash />{/snippet}Remove from team</Button>
      {/if}
      {#if me?.role === 'owner' && !self && m.status === 'active' && m.userId}
        <Button variant="ghost" onclick={() => (confirmTransfer = true)}>Make owner</Button>
      {/if}
      {#if self && m.role !== 'owner'}
        <Button variant="ghost" onclick={leave}>{#snippet icon()}<IconLogOut />{/snippet}Leave team</Button>
      {/if}
    </div>
  {/if}
</div>

<Sheet bind:open={confirmRemove} title="Remove {m?.displayName}?" description="They lose access straight away and see “You've been removed”. You can invite them again later." size="sm">
  {#snippet children()}<p class="muted">Their past replies and minutes stay in the team's history.</p>{/snippet}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmRemove = false)}>Cancel</Button>
    <Button variant="danger" onclick={remove}>Remove</Button>
  {/snippet}
</Sheet>
<Sheet bind:open={confirmTransfer} title="Transfer ownership?" description="{m?.displayName} becomes the owner and you become a coach. Only the owner can delete the team." size="sm">
  {#snippet children()}<span></span>{/snippet}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmTransfer = false)}>Cancel</Button>
    <Button variant="primary" onclick={transfer}>Transfer</Button>
  {/snippet}
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
  .who {
    display: flex;
    gap: var(--s-4);
    align-items: center;
    margin: var(--s-2) 0 var(--s-6);
  }
  .who h1 {
    margin-bottom: var(--s-2);
  }
  .pad {
    padding: var(--s-5);
    margin-bottom: var(--s-4);
    display: grid;
    gap: var(--s-4);
  }
  .h {
    font-size: var(--t-16);
  }
  .jersey {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    font-weight: 600;
  }
  .jersey input {
    width: 80px;
    min-height: 44px;
    padding: 0 var(--s-3);
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-weight: 700;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .relink {
    display: flex;
    gap: var(--s-4);
    align-items: center;
    flex-wrap: wrap;
  }
  .danger {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-top: var(--s-4);
  }
  .danger :global(.ghost) {
    color: var(--danger);
  }
</style>
