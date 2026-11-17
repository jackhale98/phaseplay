<script lang="ts">
  import {
    GRANT_INFO,
    GRANTABLE,
    ROLE_DESCRIPTIONS,
    ROLE_LABELS,
    ROLES,
    uuidv7,
    type GrantableAction,
    type TeamRole,
  } from '@phaseplay/shared';
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import Button from '#lib/components/Button.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import RoleTag from '#lib/features/roles/RoleTag.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { IconBack, IconPlus, IconTrash } from '#lib/icons';

  const COLORS = [
    '#f2c230',
    '#1f6f43',
    '#2f6fb0',
    '#7b4fa0',
    '#c0392b',
    '#d9822b',
    '#2a9d8f',
    '#5c6b73',
  ];
  const SUGGESTIONS: { name: string; color: string; permissions: GrantableAction[] }[] = [
    {
      name: 'Captain',
      color: '#f2c230',
      permissions: ['practice.view_private', 'availability.view', 'sheets.view_draft'],
    },
    { name: 'Social sec', color: '#7b4fa0', permissions: ['events.manage'] },
    { name: 'Kit manager', color: '#2f6fb0', permissions: ['availability.view'] },
  ];
  const groups = [...new Set(GRANTABLE.map((g) => GRANT_INFO[g].group))].map((group) => ({
    group,
    items: GRANTABLE.filter((g) => GRANT_INFO[g].group === group),
  }));

  const manage = $derived(app.can('roles.manage'));
  const roles = $derived(app.teamRoles);
  const members = $derived(
    Object.values(app.snap?.rows.members ?? {})
      .filter((m) => m.status !== 'removed')
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  const holders = (id: string) => members.filter((m) => m.roleIds?.includes(id));

  let open = $state(false);
  let editing = $state<string | null>(null);
  let name = $state('');
  let color = $state(COLORS[0]!);
  let perms = $state<GrantableAction[]>([]);
  let assigned = $state<string[]>([]);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let confirmDelete = $state(false);

  function edit(r: TeamRole | null, preset?: (typeof SUGGESTIONS)[number]) {
    editing = r?.id ?? null;
    name = r?.name ?? preset?.name ?? '';
    color = r?.color ?? preset?.color ?? COLORS[roles.length % COLORS.length]!;
    perms = [...((r?.permissions as GrantableAction[]) ?? preset?.permissions ?? [])];
    assigned = r ? holders(r.id).map((m) => m.id) : [];
    error = null;
    open = true;
  }
  const toggle = <T,>(list: T[], x: T) =>
    list.includes(x) ? list.filter((y) => y !== x) : [...list, x];

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return void (error = 'Give the role a name');
    if (!perms.length) return void (error = 'Pick at least one thing this role can do');
    busy = true;
    const id = editing ?? uuidv7();
    try {
      await api(teamPath(`/roles/${id}`), {
        method: 'PUT',
        body: { name: name.trim(), color, permissions: perms },
      });
      // Assignments go through the outbox like any other member edit.
      for (const m of members) {
        const has = m.roleIds?.includes(id) ?? false;
        if (has === assigned.includes(m.id)) continue;
        const roleIds = has ? m.roleIds.filter((x) => x !== id) : [...(m.roleIds ?? []), id];
        await app.mutate({
          method: 'PATCH',
          path: teamPath(`/members/${m.id}`),
          body: { roleIds },
          label: 'Team roles',
          optimistic: [{ op: 'patch', entity: 'members', key: m.id, value: { roleIds } }],
        });
      }
      await app.sync();
      open = false;
      toasts.success(`${name.trim()} saved`);
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Could not save the role';
    } finally {
      busy = false;
    }
  }
  async function del() {
    if (!editing) return;
    busy = true;
    try {
      await api(teamPath(`/roles/${editing}`), { method: 'DELETE' });
      await app.sync();
      confirmDelete = open = false;
      toasts.show(`${name} deleted`);
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : 'Could not delete');
    } finally {
      busy = false;
    }
  }
  const summary = (r: TeamRole) =>
    r.permissions
      .map((p) => GRANT_INFO[p as GrantableAction]?.label)
      .filter(Boolean)
      .join(' · ');
</script>

<svelte:head><title>Roles and permissions · Phaseplay</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/settings/team"><IconBack /> Team settings</a>
  <header class="top">
    <h1>Roles and permissions</h1>
    {#if manage}
      <Button variant="primary" onclick={() => edit(null)}
        >{#snippet icon()}<IconPlus />{/snippet}New role</Button
      >
    {/if}
  </header>

  <section aria-labelledby="tr-h">
    <h2 class="section-title" id="tr-h">Team roles</h2>
    <p class="muted lead">
      Extra permissions on top of someone's main role, like a captain seeing the practice plans.
      Change who holds them each season.
    </p>
    {#if roles.length}
      <ul class="list card">
        {#each roles as r (r.id)}
          {@const who = holders(r.id)}
          <li>
            <div class="info">
              <RoleTag name={r.name} color={r.color} />
              <p class="subtle">{summary(r)}</p>
              <p class="who">
                {who.length ? who.map((m) => m.displayName).join(', ') : 'Nobody yet'}
              </p>
            </div>
            {#if manage}<Button size="sm" onclick={() => edit(r)}
                >Edit<span class="sr-only"> {r.name}</span></Button
              >{/if}
          </li>
        {/each}
      </ul>
    {:else if manage}
      <div class="card empty">
        <p>No team roles yet. Start from one of these:</p>
        <div class="row wrap">
          {#each SUGGESTIONS as sug (sug.name)}
            <RoleTag name={sug.name} color={sug.color} onclick={() => edit(null, sug)} />
          {/each}
        </div>
      </div>
    {:else}
      <p class="subtle">This team doesn't use any team roles yet.</p>
    {/if}
  </section>

  <section aria-labelledby="br-h">
    <h2 class="section-title" id="br-h">Main roles</h2>
    <dl class="card base">
      {#each ROLES as r (r)}
        <div>
          <dt>{ROLE_LABELS[r]}</dt>
          <dd class="muted">{ROLE_DESCRIPTIONS[r]}</dd>
        </div>
      {/each}
    </dl>
    <p class="subtle">
      Change someone's main role from their page in the squad. There's one owner; hand over from
      <a href="/settings/team">team settings</a>.
    </p>
  </section>
</div>

<Sheet bind:open title={editing ? `Edit ${name || 'role'}` : 'New team role'} size="md">
  <form id="role-form" class="stack" onsubmit={save} novalidate>
    <Field label="Name" {error}>
      {#snippet children({ id, describedby })}<input
          {id}
          aria-describedby={describedby}
          bind:value={name}
          maxlength="30"
          autocomplete="off"
        />{/snippet}
    </Field>
    <fieldset class="swatches">
      <legend>Colour</legend>
      {#each COLORS as c (c)}
        <label class="sw" style:background={c}>
          <input type="radio" name="color" value={c} bind:group={color} />
          <span class="sr-only">{c}</span>
        </label>
      {/each}
    </fieldset>
    {#each groups as g (g.group)}
      <fieldset class="perms">
        <legend>{g.group}</legend>
        {#each g.items as p (p)}
          <label class="perm">
            <input
              type="checkbox"
              checked={perms.includes(p)}
              onchange={() => (perms = toggle(perms, p))}
            />
            <span>
              <strong>{GRANT_INFO[p].label}</strong>
              {#if GRANT_INFO[p].hint}<small class="subtle">{GRANT_INFO[p].hint}</small>{/if}
            </span>
          </label>
        {/each}
      </fieldset>
    {/each}
    <fieldset class="perms">
      <legend>Who has it</legend>
      <div class="members">
        {#each members as m (m.id)}
          <label class="perm">
            <input
              type="checkbox"
              checked={assigned.includes(m.id)}
              onchange={() => (assigned = toggle(assigned, m.id))}
            />
            <span>{m.displayName} <small class="subtle">{ROLE_LABELS[m.role]}</small></span>
          </label>
        {/each}
      </div>
    </fieldset>
  </form>
  {#snippet footer()}
    {#if editing}
      <Button variant="ghost" onclick={() => (confirmDelete = true)}
        >{#snippet icon()}<IconTrash />{/snippet}Delete</Button
      >
    {/if}
    <span class="grow"></span>
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="role-form" disabled={busy}>Save role</Button>
  {/snippet}
</Sheet>

<Sheet bind:open={confirmDelete} title="Delete {name}?" size="sm">
  <p class="muted">Everyone who holds it loses its permissions straight away.</p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmDelete = false)}>Cancel</Button>
    <Button variant="danger" disabled={busy} onclick={del}>Delete role</Button>
  {/snippet}
</Sheet>

<style>
  .narrow {
    max-width: 720px;
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
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    margin: var(--s-2) 0 var(--s-5);
  }
  section {
    margin-bottom: var(--s-8);
  }
  .lead {
    margin: 0 0 var(--s-4);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-4);
  }
  .list li + li {
    border-top: 1px solid var(--border);
  }
  .info {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: var(--s-1);
    justify-items: start;
  }
  .info p {
    margin: 0;
  }
  .who {
    font-size: var(--t-14);
  }
  .empty {
    padding: var(--s-5);
    display: grid;
    gap: var(--s-3);
  }
  .empty p {
    margin: 0;
  }
  .base {
    margin: 0 0 var(--s-3);
    padding: var(--s-2) var(--s-4);
  }
  .base div {
    padding: var(--s-3) 0;
  }
  .base div + div {
    border-top: 1px solid var(--border);
  }
  dt {
    font-weight: 700;
  }
  dd {
    margin: 2px 0 0;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  legend {
    font-weight: 700;
    font-size: var(--t-14);
    margin-bottom: var(--s-2);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .swatches legend {
    width: 100%;
  }
  .sw {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 25%, transparent);
  }
  .sw input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .sw:has(input:checked) {
    outline: 3px solid var(--text);
    outline-offset: 2px;
  }
  .sw:has(input:focus-visible) {
    outline: 3px solid color-mix(in srgb, var(--accent) 70%, var(--text));
    outline-offset: 4px;
  }
  .perms {
    display: grid;
    gap: var(--s-1);
  }
  .perm {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    min-height: 44px;
    padding: var(--s-2) 0;
    cursor: pointer;
  }
  .perm input {
    width: 20px;
    height: 20px;
    margin-top: 2px;
    flex: none;
    accent-color: var(--accent);
  }
  .perm span {
    display: grid;
    gap: 2px;
  }
  .members {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    column-gap: var(--s-4);
  }
  .grow {
    flex: 1;
  }
</style>
