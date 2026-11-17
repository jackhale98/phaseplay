<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    GRANT_INFO,
    ROLE_DESCRIPTIONS,
    ROLE_LABELS,
    ROLES,
    can,
    canChangeRole,
    canRelink,
    canRemove,
    uuidv7,
    type GrantableAction,
    type Role,
  } from '@phaseplay/shared';
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import Avatar from '#lib/components/Avatar.svelte';
  import Button from '#lib/components/Button.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Chip from '#lib/components/Chip.svelte';
  import QrCode from '#lib/components/QrCode.svelte';
  import PositionPicker from '#lib/features/squad/PositionPicker.svelte';
  import RoleTag from '#lib/features/roles/RoleTag.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { copyText } from '#lib/share';
  import { IconBack, IconKey, IconTrash, IconCopy, IconLogOut } from '#lib/icons';

  const s = $derived(app.snap);
  const m = $derived(s?.rows.members[page.params.id ?? '']);
  const me = $derived(s?.me);
  const self = $derived(m?.id === me?.id);
  const canEdit = $derived(
    !!m &&
      !!me &&
      (self || app.can('members.manage') || (m.status === 'pending' && app.can('events.manage'))),
  );
  const manageRoles = $derived(app.can('roles.manage'));
  const teamRoles = $derived(app.teamRoles);
  const mine = $derived(teamRoles.filter((r) => m?.roleIds?.includes(r.id)));
  /** What team roles add on top of the base role, in plain words. */
  const extras = $derived.by(() => {
    if (!m) return [];
    const grants = [...new Set(mine.flatMap((r) => r.permissions))] as GrantableAction[];
    return grants.filter((g) => GRANT_INFO[g] && !can(m.role, g)).map((g) => GRANT_INFO[g].label);
  });
  const pendingOwner = $derived(s?.team.pendingOwnerMemberId === m?.id);
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
  async function toggleTeamRole(id: string) {
    if (!m) return;
    const cur = m.roleIds ?? [];
    const roleIds = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    await app.mutate({
      method: 'PATCH',
      path: teamPath(`/members/${m.id}`),
      body: { roleIds },
      label: 'Team roles',
      optimistic: [{ op: 'patch', entity: 'members', key: m.id, value: { roleIds } }],
    });
  }
  async function setRole(role: Role) {
    if (!m) return;
    await app.mutate({
      method: 'PATCH',
      path: teamPath(`/members/${m.id}`),
      body: { role },
      label: 'Role change',
      optimistic: [{ op: 'patch', entity: 'members', key: m.id, value: { role } }],
    });
  }
  async function remove() {
    if (!m) return;
    confirmRemove = false;
    await app.mutate({
      method: 'DELETE',
      path: teamPath(`/members/${m.id}`),
      label: `Remove ${m.displayName}`,
      optimistic: [{ op: 'delete', entity: 'members', key: m.id }],
    });
    toasts.show(`${m.displayName} removed`);
    await goto('/squad');
  }
  async function relink() {
    if (!m) return;
    try {
      const r = await api<{ path: string }>(teamPath(`/members/${m.id}/relink`), {
        method: 'POST',
        body: { id: uuidv7(), memberId: m.id },
      });
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
      toasts.success(`Asked ${m.displayName} to take over. Nothing changes until they accept.`);
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
  const roleChoices = $derived(
    me && m ? ROLES.filter((r) => r === m.role || canChangeRole(me.role, m.role, r)) : [],
  );
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
          <Chip tone="accent">{ROLE_LABELS[m.role]}</Chip>
          {#each mine as r (r.id)}<RoleTag name={r.name} color={r.color} />{/each}
          {#if pendingOwner}<Chip tone="info">Asked to take over</Chip>{/if}
          {#if m.status === 'pending'}<Chip tone="warn">Not joined yet</Chip>{/if}
        </div>
      </div>
    </header>

    <section class="card pad">
      <h2 class="h">Shirt and positions</h2>
      <label class="jersey">
        <span>Usual shirt number</span>
        <input
          type="number"
          min="0"
          max="99"
          value={jersey ?? ''}
          disabled={!canEdit}
          oninput={(e) => (
            (jersey = e.currentTarget.value === '' ? null : Number(e.currentTarget.value)),
            (dirty = true)
          )}
        />
      </label>
      <PositionPicker
        bind:value={() => positions, (v) => ((positions = v), (dirty = true))}
        disabled={!canEdit}
      />
      {#if canEdit}
        <div class="actions">
          <Button variant="primary" disabled={!dirty} onclick={save}>Save</Button>
        </div>
      {/if}
    </section>

    {#if me && !self && m.status === 'active' && roleChoices.length > 1}
      <section class="card pad">
        <h2 class="h" id="base-role">Role</h2>
        <div class="row wrap" role="group" aria-labelledby="base-role">
          {#each roleChoices as r (r)}
            <Chip selected={m.role === r} onclick={() => m.role !== r && setRole(r)}
              >{ROLE_LABELS[r]}</Chip
            >
          {/each}
        </div>
        <p class="subtle hint">{ROLE_DESCRIPTIONS[m.role]}</p>
      </section>
    {/if}

    {#if m.status !== 'removed' && (manageRoles || mine.length > 0) && (teamRoles.length > 0 || manageRoles)}
      <section class="card pad">
        <h2 class="h" id="team-roles">Team roles</h2>
        {#if manageRoles && teamRoles.length}
          <div class="row wrap" role="group" aria-labelledby="team-roles">
            {#each teamRoles as r (r.id)}
              <RoleTag
                name={r.name}
                color={r.color}
                selected={m.roleIds?.includes(r.id)}
                onclick={() => toggleTeamRole(r.id)}
              />
            {/each}
          </div>
        {:else if mine.length}
          <div class="row wrap">
            {#each mine as r (r.id)}<RoleTag name={r.name} color={r.color} />{/each}
          </div>
        {/if}
        {#if extras.length}
          <p class="subtle hint">
            On top of being {ROLE_LABELS[m.role].toLowerCase()}, they can: {extras
              .join(', ')
              .toLowerCase()}.
          </p>
        {:else if manageRoles && !teamRoles.length}
          <p class="subtle hint">
            Give people extra permissions, like captains seeing practice plans.
            <a href="/settings/roles">Set up team roles</a>
          </p>
        {/if}
      </section>
    {/if}

    {#if me && !self && canRelink(me.role, m.role) && m.status === 'active' && m.userId}
      <section class="card pad">
        <h2 class="h">Lost their phone?</h2>
        <p class="muted">
          Make a one-time link (valid 24 hours) that lets {m.displayName.split(' ')[0]} add a passkey
          on a new device.
        </p>
        {#if relinkUrl}
          <div class="relink">
            <QrCode text={relinkUrl} size={180} label="Device link QR code" />
            <Button
              onclick={async () =>
                toasts.show((await copyText(relinkUrl!)) ? 'Link copied' : "Couldn't copy")}
              >{#snippet icon()}<IconCopy />{/snippet}Copy link</Button
            >
          </div>
        {:else}
          <Button onclick={relink}>{#snippet icon()}<IconKey />{/snippet}Create device link</Button>
        {/if}
      </section>
    {/if}

    <div class="danger">
      {#if me && !self && canRemove(me.role, m.role)}
        <Button variant="ghost" onclick={() => (confirmRemove = true)}
          >{#snippet icon()}<IconTrash />{/snippet}Remove from team</Button
        >
      {/if}
      {#if me?.role === 'owner' && !self && m.status === 'active' && m.userId && !pendingOwner}
        <Button variant="ghost" onclick={() => (confirmTransfer = true)}>Hand over ownership</Button
        >
      {/if}
      {#if self && m.role !== 'owner'}
        <Button variant="ghost" onclick={leave}
          >{#snippet icon()}<IconLogOut />{/snippet}Leave team</Button
        >
      {/if}
    </div>
  {/if}
</div>

<Sheet
  bind:open={confirmRemove}
  title="Remove {m?.displayName}?"
  description="They lose access straight away and see “You've been removed”. You can invite them again later."
  size="sm"
>
  <p class="muted">Their past replies and minutes stay in the team's history.</p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmRemove = false)}>Cancel</Button>
    <Button variant="danger" onclick={remove}>Remove</Button>
  {/snippet}
</Sheet>
<Sheet
  bind:open={confirmTransfer}
  title="Hand over ownership?"
  description="We'll ask {m?.displayName} to take over. Nothing changes until they accept."
  size="sm"
>
  <p class="muted">
    When they accept they become the owner and you become an admin, so you can still help run the
    team. Only the owner can delete the team.
  </p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmTransfer = false)}>Cancel</Button>
    <Button variant="primary" onclick={transfer}>Ask them</Button>
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
  .hint {
    margin: var(--s-3) 0 0;
  }
</style>
