<script lang="ts">
  import '#lib/styles/base.css';
  import { onMount } from 'svelte';
  import { onNavigate } from '$app/navigation';
  import { browser } from '$app/env';
  import Toasts from '#lib/components/Toasts.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { app } from '#lib/data/app.svelte';

  let { children } = $props();

  // View Transitions for route changes where supported; reduced motion gets instant swaps.
  onNavigate((nav) => {
    if (!browser || !document.startViewTransition) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (nav.from?.url.pathname === nav.to?.url.pathname) return;
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await nav.complete;
      });
    });
  });

  onMount(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    const offer = (reg: ServiceWorkerRegistration) => {
      const waiting = reg.waiting;
      if (!waiting || !navigator.serviceWorker.controller) return;
      const show = () =>
        toasts.show('Update available', {
          timeout: 0,
          action: { label: 'Refresh', run: () => waiting.postMessage({ type: 'SKIP_WAITING' }) },
        });
      // Never interrupt a live match or practice session.
      if (app.busy) {
        const stop = $effect.root(() => {
          $effect(() => {
            if (!app.busy) {
              show();
              stop();
            }
          });
        });
      } else show();
    };
    navigator.serviceWorker
      .register('/service-worker.js', { type: 'module' })
      .then((reg) => {
        offer(reg);
        reg.addEventListener('updatefound', () => {
          reg.installing?.addEventListener('statechange', () => offer(reg));
        });
        setInterval(() => reg.update().catch(() => {}), 30 * 60e3);
      })
      .catch(() => {});
  });
</script>

{@render children()}
<Toasts />
