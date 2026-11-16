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
  import { IconBack, IconTrash } from '#lib/icons';

  const team = $derived(app.team);
  const owner = $derived(app.role === 'owner');
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
    {#if owner}
      {#key team.id}
        <TeamForm value={team} submitLabel="Save changes" {busy} onsubmit={save} />
      {/key}
      <section class="danger card">
        <h2 class="h">Delete team</h2>
        <p class="muted">Removes the team for everyone. Members keep their accounts.</p>
        <div><Button variant="ghost" onclick={() => (confirmDelete = true)}>{#snippet icon()}<IconTrash />{/snippet}Delete {team.shortName}</Button></div>
      </section>
    {:else}
      <div class="card ro">
        <Crest colors={team.colors} text={team.shortName} size={56} />
        <div>
          <strong>{team.name}</strong>
          <p class="muted">{team.defaultFormat} · {team.timezone}</p>
          <p class="subtle">Only the team owner can change these.</p>
        </div>
      </div>
    {/if}
  {/if}
</div>

<Sheet bind:open={confirmDelete} title="Delete {team?.name}?" description="Type the team name to confirm. This can't be undone." size="sm">
  <Field label="Team name">{#snippet children({ id })}<input {id} bind:value={confirmName} autocomplete="off" />{/snippet}</Field>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmDelete = false)}>Cancel</Button>
    <Button variant="danger" disabled={confirmName.trim().toLowerCase() !== team?.name.toLowerCase()} onclick={del}>Delete team</Button>
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
