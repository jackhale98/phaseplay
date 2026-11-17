<!-- Names by reply, for players when the team lets them see who's going (team setting). No notes. -->
<script lang="ts">
  import type { TeamEvent } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { availability } from '#lib/data/selectors';

  let { event }: { event: TeamEvent } = $props();
  const a = $derived(availability(app.snap, event));
  const groups = $derived([
    { key: 'yes', label: 'In', people: a.yes },
    { key: 'maybe', label: 'Maybe', people: a.maybe },
    { key: 'no', label: 'Out', people: a.no },
  ]);
</script>

<section class="who" aria-labelledby="who-h">
  <h2 class="section-title" id="who-h">Who's going</h2>
  {#each groups as g (g.key)}
    {#if g.people.length}
      <div class="grp {g.key}">
        <h3>
          <span class="dot" aria-hidden="true"></span>{g.label}
          <span class="n tnum">{g.people.length}</span>
        </h3>
        <ul>
          {#each g.people as m (m.id)}<li>{m.displayName}</li>{/each}
        </ul>
      </div>
    {/if}
  {/each}
  {#if !a.yes.length && !a.maybe.length && !a.no.length}
    <p class="subtle">Nobody has replied yet.</p>
  {/if}
</section>

<style>
  .who {
    display: grid;
    gap: var(--s-3);
    margin-top: var(--s-5);
  }
  .grp h3 {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--t-14);
    margin: 0 0 var(--s-2);
  }
  .n {
    color: var(--text-2);
    font-weight: 600;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-2);
  }
  .yes .dot {
    background: var(--ok);
  }
  .maybe .dot {
    background: var(--warn);
  }
  .no .dot {
    background: var(--danger);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  li {
    padding: 4px var(--s-3);
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    font-size: var(--t-14);
  }
</style>
