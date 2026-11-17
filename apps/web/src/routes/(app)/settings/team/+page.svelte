<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import TeamForm, { type TeamFormValue } from '#lib/components/TeamForm.svelte';
  import Crest from '#lib/components/Crest.svelte';
  import Button from '#lib/components/Button.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import {
    ROLE_LABELS,
    RSVP_VISIBILITY,
    RSVP_VISIBILITY_LABELS,
    liveNominee,
    type RsvpVisibility,
  } from '@phaseplay/shared';
  import Segmented from '#lib/components/Segmented.svelte';
  import { crestUrl } from '#lib/crest';
  import CrestUploadSheet from '#lib/components/CrestUploadSheet.svelte';
  import { IconBack, IconTrash } from '#lib/icons';

  const team = $derived(app.team);
  const owner = $derived(app.role === 'owner');
  const manage = $derived(app.can('team.manage'));
  const members = $derived(Object.values(app.snap?.rows.members ?? {}));
  const currentOwner = $derived(members.find((m) => m.role === 'owner'));
  const nominee = $derived(team ? liveNominee(team, members) : null);
  const eligible = $derived(
    members
      .filter((m) => m.status === 'active' && m.userId && m.role !== 'owner')
      .sort((a, b) => (a.role === 'admin' ? -1 : 0) - (b.role === 'admin' ? -1 : 0)),
  );
  let handOver = $state(false);
  let claim = $state(false);
  let pick = $state('');

  let fileInput = $state<HTMLInputElement>();
  let crestFile = $state<File | null>(null);
  let crestSheet = $state(false);
  function pickCrest(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    crestFile = file;
    crestSheet = true;
  }
  async function removeCrest() {
    busy = true;
    try {
      await api(teamPath('/crest'), { method: 'DELETE' });
      await app.sync();
      await app.refreshMe();
      toasts.show('Back to the initials crest');
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : 'Could not remove');
    } finally {
      busy = false;
    }
  }

  const visOptions = RSVP_VISIBILITY.map((v) => ({
    value: v,
    label: RSVP_VISIBILITY_LABELS[v].label,
  }));
  async function setVisibility(v: RsvpVisibility) {
    if (!team || v === (team.rsvpVisibility ?? 'counts')) return;
    busy = true;
    try {
      await api(teamPath(''), { method: 'PATCH', body: { rsvpVisibility: v } });
      await app.sync();
      toasts.success('Saved');
    } catch (err) {
      toasts.error(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      busy = false;
    }
  }

  async function post(path: string, body: unknown, done: string) {
    busy = true;
    try {
      await api(teamPath(path), { method: 'POST', body });
      await app.sync();
      toasts.success(done);
      handOver = claim = false;
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      busy = false;
    }
  }
  let busy = $state(false);
  let confirmDelete = $state(false);
  let confirmName = $state('');

  async function save(v: TeamFormValue) {
    busy = true;
    try {
      await api(teamPath(''), { method: 'PATCH', body: v });
      await app.sync();
      await app.refreshMe();
      toasts.success('Team updated');
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      busy = false;
    }
  }
  async function del() {
    try {
      await api(teamPath(''), { method: 'DELETE', body: { confirmName } });
      toasts.show(`${team?.name} deleted`);
      await app.refreshMe();
      await goto('/home');
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : 'Could not delete');
    }
  }
</script>

<svelte:head><title>Team settings · Phaseplay</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/more"><IconBack /> More</a>
  <h1>Team settings</h1>
  {#if team}
    {#if manage}
      {#key team.id}
        <TeamForm value={team} submitLabel="Save changes" {busy} onsubmit={save} />
      {/key}
    {:else}
      <div class="card ro">
        <Crest colors={team.colors} text={team.shortName} src={crestUrl(team)} size={56} />
        <div>
          <strong>{team.name}</strong>
          <p class="muted">{team.defaultFormat} · {team.timezone}</p>
          <p class="subtle">Only the owner and admins can change these.</p>
        </div>
      </div>
    {/if}

    {#if manage}
      <section class="card sect" aria-labelledby="crest-h">
        <h2 class="h" id="crest-h">Emblem</h2>
        <div class="crest-row">
          <Crest colors={team.colors} text={team.shortName} src={crestUrl(team)} size={72} />
          <p class="muted">
            Upload your club badge to use it across the app and on shared team sheets. PNG, SVG,
            JPEG or WebP. If it has a plain background, we can take it out so it looks right in
            light and dark mode.
          </p>
        </div>
        <div class="row wrap">
          <input
            bind:this={fileInput}
            class="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            tabindex="-1"
            aria-hidden="true"
            onchange={pickCrest}
          />
          <Button disabled={busy} onclick={() => fileInput?.click()}
            >{team.crestVersion ? 'Replace emblem' : 'Upload emblem'}</Button
          >
          {#if team.crestVersion}
            <Button variant="ghost" disabled={busy} onclick={removeCrest}
              >Use initials instead</Button
            >
          {/if}
        </div>
      </section>
    {/if}

    {#if manage}
      <section class="card sect" aria-labelledby="vis-h">
        <h2 class="h" id="vis-h">What players see of replies</h2>
        <Segmented
          label="What players see of replies"
          size="sm"
          options={visOptions}
          bind:value={() => team.rsvpVisibility ?? 'counts', (v) => setVisibility(v)}
        />
        <p class="muted">
          {RSVP_VISIBILITY_LABELS[team.rsvpVisibility ?? 'counts'].hint} Staff always see everyone's replies,
          and only staff see the reasons people add to a reply.
        </p>
      </section>
    {/if}

    <section class="card sect" aria-labelledby="own-h">
      <h2 class="h" id="own-h">Ownership</h2>
      <p>
        <strong>{currentOwner?.displayName ?? 'Nobody'}</strong> owns the team.
        <span class="muted"
          >Admins can do everything else, so when the e-board changes, hand over to the new chair.</span
        >
      </p>
      {#if nominee}
        <p class="pending" role="status">
          Waiting for <strong>{nominee.displayName}</strong> to accept.
        </p>
      {/if}
      <div class="row wrap">
        {#if owner && nominee}
          <Button disabled={busy} onclick={() => post('/transfer/cancel', {}, 'Handover cancelled')}
            >Cancel handover</Button
          >
        {:else if owner}
          <Button onclick={() => ((pick = eligible[0]?.id ?? ''), (handOver = true))}
            >Hand over ownership</Button
          >
        {:else if app.role === 'admin'}
          <Button variant="ghost" onclick={() => (claim = true)}>Take over ownership</Button>
        {/if}
        <Button variant="ghost" href="/settings/roles">Roles and permissions</Button>
      </div>
    </section>

    {#if owner}
      <section class="danger card">
        <h2 class="h">Delete team</h2>
        <p class="muted">Removes the team for everyone. Members keep their accounts.</p>
        <div>
          <Button variant="ghost" onclick={() => (confirmDelete = true)}
            >{#snippet icon()}<IconTrash />{/snippet}Delete {team.shortName}</Button
          >
        </div>
      </section>
    {/if}
  {/if}
</div>

<Sheet
  bind:open={confirmDelete}
  title="Delete {team?.name}?"
  description="Type the team name to confirm. This can't be undone."
  size="sm"
>
  <Field label="Team name"
    >{#snippet children({ id })}<input
        {id}
        bind:value={confirmName}
        autocomplete="off"
      />{/snippet}</Field
  >
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmDelete = false)}>Cancel</Button>
    <Button
      variant="danger"
      disabled={confirmName.trim().toLowerCase() !== team?.name.toLowerCase()}
      onclick={del}>Delete team</Button
    >
  {/snippet}
</Sheet>

<Sheet
  bind:open={handOver}
  title="Hand over ownership"
  description="They'll be asked to accept. Until then nothing changes."
  size="sm"
>
  {#if eligible.length}
    <Field label="New owner">
      {#snippet children({ id })}<select {id} bind:value={pick}>
          {#each eligible as m (m.id)}<option value={m.id}
              >{m.displayName} · {ROLE_LABELS[m.role]}</option
            >{/each}
        </select>{/snippet}
    </Field>
    <p class="muted">When they accept you become an admin, so you can still help out.</p>
  {:else}
    <p class="muted">Only members who have joined with their own account can own the team.</p>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (handOver = false)}>Cancel</Button>
    <Button
      variant="primary"
      disabled={!pick || busy}
      onclick={() => post('/transfer', { memberId: pick }, 'Asked them to take over')}
      >Ask them</Button
    >
  {/snippet}
</Sheet>

<Sheet
  bind:open={claim}
  title="Take over ownership?"
  description="For when the owner has left and can't hand over."
  size="sm"
>
  <p class="muted">
    This only works if {currentOwner?.displayName ?? 'the owner'} hasn't used Phaseplay for 30 days. They'll
    stay on as an admin, and it's recorded in the audit log.
  </p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (claim = false)}>Cancel</Button>
    <Button
      variant="primary"
      disabled={busy}
      onclick={() => post('/claim-ownership', {}, `You now own ${team?.name}`)}>Take over</Button
    >
  {/snippet}
</Sheet>

<CrestUploadSheet bind:open={crestSheet} file={crestFile} />

<style>
  .sect {
    margin-top: var(--s-6);
    padding: var(--s-5);
    display: grid;
    gap: var(--s-3);
  }
  .sect p {
    margin: 0;
  }
  .crest-row {
    display: flex;
    gap: var(--s-4);
    align-items: center;
  }
  .crest-row p {
    margin: 0;
  }
  .pending {
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  }
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
  .danger {
    margin-top: var(--s-8);
    padding: var(--s-5);
    display: grid;
    gap: var(--s-2);
    border-color: color-mix(in srgb, var(--danger) 30%, var(--border));
  }
  .danger :global(.ghost) {
    color: var(--danger);
  }
  .h {
    font-size: var(--t-16);
  }
  .ro {
    display: flex;
    gap: var(--s-4);
    align-items: center;
    padding: var(--s-5);
  }
</style>
