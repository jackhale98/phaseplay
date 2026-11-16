<script lang="ts">
  import { app } from '#lib/data/app.svelte';
  const label = $derived(
    app.status === 'offline'
      ? `Offline${app.pending ? ` · ${app.pending} change${app.pending === 1 ? '' : 's'} waiting` : ''}`
      : app.status === 'pending'
        ? 'Saving changes…'
        : app.status === 'syncing'
          ? 'Syncing…'
          : app.status === 'error'
            ? 'Sync problem, retrying'
            : 'All changes saved',
  );
</script>

<span class="sync {app.status}" title={label}>
  <span class="dot" aria-hidden="true"></span>
  <span class="sr-only" aria-live="polite">{label}</span>
  {#if app.status === 'offline'}<span class="txt">Offline</span>{/if}
</span>

<style>
  .sync {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-12);
    font-weight: 650;
    color: var(--text-3);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ok);
    transition: background var(--m-med) var(--ease);
  }
  .pending .dot,
  .syncing .dot {
    background: var(--warn);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .offline .dot {
    background: var(--text-3);
  }
  .error .dot {
    background: var(--danger);
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
</style>
