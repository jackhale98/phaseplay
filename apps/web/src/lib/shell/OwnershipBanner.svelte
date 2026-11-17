<!-- Shown to the member the owner has asked to take over the team (docs/architecture.md §Roles). -->
<script lang="ts">
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import { toasts } from '#lib/stores/toast.svelte';
  import { IconShield } from '#lib/icons';

  const owner = $derived(
    Object.values(app.snap?.rows.members ?? {}).find((m) => m.role === 'owner'),
  );
  let busy = $state(false);
  async function answer(accept: boolean) {
    busy = true;
    try {
      await api(teamPath(accept ? '/transfer/accept' : '/transfer/cancel'), {
        method: 'POST',
        body: {},
      });
      await app.sync();
      toasts.success(accept ? `You now own ${app.team?.name}` : 'Declined');
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : 'Could not answer');
    } finally {
      busy = false;
    }
  }
</script>

<aside class="own" aria-label="Ownership handover">
  <IconShield />
  <p>
    <strong>{owner?.displayName ?? 'The owner'} asked you to take over {app.team?.name}.</strong>
    <span>You'd become the owner; they'd stay on as an admin.</span>
  </p>
  <div class="acts">
    <button class="go" type="button" disabled={busy} onclick={() => answer(true)}>Accept</button>
    <button class="no" type="button" disabled={busy} onclick={() => answer(false)}>Decline</button>
  </div>
</aside>

<style>
  .own {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface));
    border-bottom: 1px solid var(--border);
    font-size: var(--t-14);
  }
  .own > :global(svg) {
    width: 20px;
    height: 20px;
    flex: none;
    color: var(--accent);
  }
  p {
    flex: 1;
    min-width: 12rem;
    display: grid;
    gap: 2px;
    margin: 0;
  }
  span {
    color: var(--text-2);
  }
  .acts {
    display: flex;
    gap: var(--s-2);
  }
  button {
    min-height: 44px;
    padding: 0 var(--s-4);
    border-radius: var(--r-md);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .go {
    border: 0;
    background: var(--accent);
    color: var(--on-accent, #fff);
  }
  .no {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }
</style>
