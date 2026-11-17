<!--
  One group's drill during a live session: its coaching points and an on-demand diagram.
  Split slots render one of these per group, so every group's diagram is a tap away.
-->
<script lang="ts">
  import type { DrillFull, DrillMeta } from '@phaseplay/shared';
  import Button from '#lib/components/Button.svelte';
  import { IconImage } from '#lib/icons';
  import { app } from '#lib/data/app.svelte';
  import DrillPreview from './DrillPreview.svelte';
  import { fetchDrill } from './store';

  type Props = {
    drill: DrillMeta;
    /** Group name when the slot is split ("Forwards"); omitted for the whole squad. */
    group?: string;
    mine?: boolean;
  };
  let { drill, group, mine = false }: Props = $props();

  let show = $state(false);
  let full = $state.raw<DrillFull | null>(null);
  $effect(() => {
    const d = drill;
    full = null;
    if (!d.hasDiagram || !show || !app.teamId) return;
    let alive = true;
    void fetchDrill(app.teamId, d.id, d.version).then((x) => alive && (full = x));
    return () => {
      alive = false;
    };
  });
  const what = $derived(group ? `${group}: ${drill.title}` : drill.title);
</script>

<section class="rd" class:grouped={!!group} aria-label={what}>
  {#if group}
    <h2 class="gh">
      {group}{#if mine}<span class="you"> · You</span>{/if}<span class="dt"> · {drill.title}</span>
    </h2>
  {/if}
  {#if drill.coachingPoints.length}
    {#if !group}<h2 class="cp-h">Coaching points</h2>{/if}
    <ul class="cp" aria-label="Coaching points{group ? ` for ${group}` : ''}">
      {#each drill.coachingPoints.slice(0, 5) as p (p)}<li>{p}</li>{/each}
    </ul>
  {/if}
  {#if drill.hasDiagram}
    <Button variant="ghost" aria-pressed={show} onclick={() => (show = !show)}
      >{#snippet icon()}<IconImage />{/snippet}{show ? 'Hide diagram' : 'Show diagram'}<span
        class="sr-only">{group ? ` for ${group}` : ''}</span
      ></Button
    >
    {#if show}
      {#if full?.diagram}
        <DrillPreview play={full.diagram} playing label="Diagram: {what}" height="240px" />
      {:else}
        <div class="dg-sk" aria-busy="true"></div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .rd {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-2);
  }
  .rd > :global(*:not(button)) {
    align-self: stretch;
  }
  .grouped {
    padding-top: var(--s-3);
    border-top: 1px solid var(--border);
  }
  .gh {
    font-size: var(--t-16);
    margin: 0;
  }
  .you {
    color: var(--accent);
  }
  .dt {
    color: var(--text-2);
    font-weight: 600;
  }
  .cp-h {
    font-size: var(--t-16);
    margin: var(--s-2) 0 0;
  }
  .cp {
    margin: 0;
    padding-left: var(--s-5);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: var(--t-16);
  }
  .dg-sk {
    height: 240px;
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
</style>
