<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { uuidv7 } from '@phaseplay/shared';
  import { api, ApiError, v1 } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import TeamForm, { type TeamFormValue } from '#lib/components/TeamForm.svelte';
  import { toasts } from '#lib/stores/toast.svelte';

  let busy = $state(false);
  onMount(async () => {
    if (!(await app.init())) void goto('/signin?next=/welcome', { replaceState: true });
  });

  async function create(v: TeamFormValue) {
    busy = true;
    const id = uuidv7();
    try {
      await api(v1('/teams'), { method: 'POST', body: { id, ...v } });
      await app.refreshMe();
      await app.selectTeam(id);
      toasts.success(`${v.name} is ready`);
      await goto('/squad?invite=1', { replaceState: true });
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : 'Could not create the team');
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Create your team · Phaseplay</title></svelte:head>

<h1>Set up your team</h1>
<p class="lede">You can change any of this later. Got an invite instead? Open the link your coach sent.</p>
<TeamForm submitLabel="Create team" {busy} onsubmit={create} />
