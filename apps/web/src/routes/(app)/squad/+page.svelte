<script lang="ts">
  import { page } from '$app/state';
  import {
    GROUP_LABELS,
    RULES,
    groupOf,
    positionsFor,
    uuidv7,
    type Member,
    type PositionGroup,
    ROLE_LABELS,
    playsForTeam,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { squad } from '#lib/data/selectors';
  import { teamPath } from '#lib/data/actions';
  import Avatar from '#lib/components/Avatar.svelte';
  import Button from '#lib/components/Button.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import Chip from '#lib/components/Chip.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import InviteSheet from '#lib/features/squad/InviteSheet.svelte';
  import { IconUserPlus, IconPlus, IconChevronRight } from '#lib/icons';

  const s = $derived(app.snap);
  const inviter = $derived(app.can('invites.create'));
  const addNames = $derived(app.can('members.manage'));
  const staff = $derived(inviter || addNames);
  const fmt = $derived(s?.team.defaultFormat ?? '15s');
  let view = $state<'position' | 'name'>('position');
  let invite = $state(page.url.searchParams.get('invite') === '1');
  let addName = $state(false);
  let newName = $state('');

  const members = $derived(squad(s));
  const pending = $derived(members.filter((m) => m.status === 'pending'));
  const active = $derived(members.filter((m) => m.status === 'active'));
  // Player-coaches are listed under coaches & staff and under their positions.
  const staffMembers = $derived(active.filter((m) => m.role !== 'player'));
  const groups = $derived.by(() => {
    const out: { g: PositionGroup | 'unassigned'; label: string; list: Member[] }[] = RULES[
      fmt
    ].groups.map((g) => ({ g, label: GROUP_LABELS[g], list: [] as Member[] }));
    const unassigned: Member[] = [];
    for (const m of active.filter(playsForTeam)) {
      const g = m.positions[0] !== undefined ? groupOf(fmt, m.positions[0]) : undefined;
      const bucket = out.find((x) => x.g === g);
      (bucket ? bucket.list : unassigned).push(m);
    }
    for (const b of out)
      b.list.sort(
        (a, b) =>
          (a.positions[0] ?? 99) - (b.positions[0] ?? 99) ||
          a.displayName.localeCompare(b.displayName),
      );
    if (unassigned.length)
      out.push({ g: 'unassigned', label: 'Positions not set', list: unassigned });
    return out.filter((b) => b.list.length);
  });
  const short = (m: Member) =>
    m.positions.map((n) => positionsFor('15s').find((p) => p.n === n)?.short ?? n).join(' · ');

  async function addPending(e: SubmitEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const id = uuidv7();
    await app.mutate({
      method: 'POST',
      path: teamPath('/members'),
      body: { id, displayName: name, positions: [] },
      label: 'Add name',
      optimistic: [
        {
          op: 'put',
          entity: 'members',
          key: id,
          value: {
            id,
            teamId: app.teamId!,
            userId: null,
            displayName: name,
            role: 'player',
            jersey: null,
            positions: [],
            roleIds: [],
            status: 'pending',
            joinedAt: null,
            updatedAt: Date.now(),
          } satisfies Member,
        },
      ],
    });
    newName = '';
  }
</script>

<svelte:head><title>Squad · {s?.team.shortName ?? ''}</title></svelte:head>

{#snippet row(m: Member)}
  <li>
    <a href="/squad/{m.id}" class="mrow">
      <Avatar name={m.displayName} jersey={m.jersey} muted={m.status === 'pending'} />
      <span class="grow">
        <strong>{m.displayName}{m.id === s?.me.id ? ' (you)' : ''}</strong>
        <small class="muted">{short(m) || (m.role === 'player' ? 'No positions yet' : '')}</small>
      </span>
      {#if m.status === 'pending'}<Chip tone="warn">Not joined</Chip
        >{:else if m.role !== 'player'}<Chip tone="accent">{ROLE_LABELS[m.role]}</Chip>{/if}
      <IconChevronRight />
    </a>
  </li>
{/snippet}

<div class="page">
  <header class="page-head">
    <div>
      <h1>Squad</h1>
      <p class="muted">
        {active.length} members{pending.length ? ` · ${pending.length} not joined yet` : ''}
      </p>
    </div>
    {#if staff}
      <div class="row">
        {#if addNames}<Button onclick={() => (addName = true)}
            >{#snippet icon()}<IconPlus />{/snippet}Add name</Button
          >{/if}
        {#if inviter}<Button variant="primary" onclick={() => (invite = true)}
            >{#snippet icon()}<IconUserPlus />{/snippet}Invite</Button
          >{/if}
      </div>
    {/if}
  </header>

  <Segmented
    label="Sort squad"
    bind:value={view}
    options={[
      { value: 'position', label: 'By position' },
      { value: 'name', label: 'A–Z' },
    ]}
  />

  {#if view === 'position'}
    {#if staffMembers.length}
      <h2 class="section-title">Coaches & staff</h2>
      <ul class="list card">
        {#each staffMembers as m (m.id)}{@render row(m)}{/each}
      </ul>
    {/if}
    {#each groups as g (g.g)}
      <h2 class="section-title">{g.label} <span class="subtle">{g.list.length}</span></h2>
      <ul class="list card">
        {#each g.list as m (m.id)}{@render row(m)}{/each}
      </ul>
    {/each}
  {:else}
    <ul class="list card top">
      {#each active as m (m.id)}{@render row(m)}{/each}
    </ul>
  {/if}

  {#if staff && pending.length}
    <h2 class="section-title">Not joined yet <span class="subtle">{pending.length}</span></h2>
    <p class="subtle hint">
      These names were imported or added by hand. They're claimed when the player joins with an
      invite.
    </p>
    <ul class="list card">
      {#each pending as m (m.id)}{@render row(m)}{/each}
    </ul>
  {/if}
</div>

{#if staff}
  <InviteSheet bind:open={invite} />
  <Sheet
    bind:open={addName}
    title="Add a name"
    description="Add players who haven't joined yet so you can pick them on team sheets and mark their availability."
    size="sm"
  >
    <form class="stack" onsubmit={addPending}>
      <Field label="Name">
        {#snippet children({ id })}<input
            {id}
            bind:value={newName}
            maxlength="40"
            autocomplete="off"
          />{/snippet}
      </Field>
      <Button type="submit" variant="primary" block>Add</Button>
    </form>
  </Sheet>
{/if}

<style>
  .top {
    margin-top: var(--s-4);
  }
  .card {
    overflow: hidden;
  }
  .mrow {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 60px;
    padding: var(--s-2) var(--s-4);
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px solid var(--border);
  }
  li:last-child .mrow {
    border-bottom: 0;
  }
  .mrow:hover {
    background: var(--surface-2);
  }
  .mrow small {
    display: block;
  }
  .mrow > :global(svg:last-child) {
    width: 18px;
    height: 18px;
    color: var(--text-3);
  }
  .hint {
    margin: -6px 0 var(--s-3);
  }
</style>
