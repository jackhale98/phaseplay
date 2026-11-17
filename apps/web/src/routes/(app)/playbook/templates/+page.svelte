<!-- Choose which built-in drill templates and play presets show in this team's pickers. -->
<script lang="ts">
  import { DRILL_TEMPLATES } from '@phaseplay/diagram/drill-templates';
  import { PRESETS } from '@phaseplay/diagram/presets';
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import { toasts } from '#lib/stores/toast.svelte';
  import { IconBack } from '#lib/icons';

  const hidden = $derived(new Set(app.team?.hiddenTemplates ?? []));
  const groups = $derived(
    [
      {
        key: 'drill',
        title: 'Drill templates',
        hint: 'Starting points in “New drill”.',
        allowed: app.can('drills.manage'),
        items: Object.entries(DRILL_TEMPLATES).map(([id, t]) => ({
          key: `drill:${id}`,
          label: t.label,
        })),
      },
      {
        key: 'preset',
        title: 'Play presets',
        hint: 'Set pieces and shapes in “New play” and the play designer.',
        allowed: app.can('plays.manage'),
        items: Object.entries(PRESETS).map(([id, p]) => ({ key: `preset:${id}`, label: p.label })),
      },
    ].filter((g) => g.allowed),
  );
  let busy = $state(false);

  async function toggle(key: string, show: boolean) {
    const next = show ? [...hidden].filter((k) => k !== key) : [...hidden, key];
    busy = true;
    try {
      await api(teamPath('/templates'), { method: 'PUT', body: { hidden: next } });
      await app.sync();
    } catch (e) {
      toasts.error(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Templates and presets · Playbook</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/playbook"><IconBack /> Playbook</a>
  <h1>Templates and presets</h1>
  <p class="muted lead">
    Hide the ones your team doesn't use to keep the pickers short. Hiding never changes drills or
    plays you've already made, and you can bring them back any time.
  </p>
  {#each groups as g (g.key)}
    <section class="card sect" aria-labelledby="{g.key}-h">
      <h2 class="h" id="{g.key}-h">{g.title}</h2>
      <p class="subtle">{g.hint}</p>
      <ul class="list">
        {#each g.items as it (it.key)}
          <li>
            <label class="row-label">
              <span>{it.label}</span>
              <input
                type="checkbox"
                role="switch"
                checked={!hidden.has(it.key)}
                disabled={busy}
                aria-label="Show {it.label}"
                onchange={(e) => toggle(it.key, e.currentTarget.checked)}
              />
            </label>
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="subtle">Only coaches can change these.</p>
  {/each}
</div>

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
    margin: var(--s-2) 0 var(--s-3);
  }
  .lead {
    margin: 0 0 var(--s-5);
  }
  .sect {
    padding: var(--s-5);
    margin-bottom: var(--s-4);
  }
  .sect .h {
    font-size: var(--t-16);
    margin: 0;
  }
  .sect .subtle {
    margin: var(--s-1) 0 var(--s-3);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li + li {
    border-top: 1px solid var(--border);
  }
  .row-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    min-height: 48px;
    cursor: pointer;
  }
  .row-label input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
  }
</style>
