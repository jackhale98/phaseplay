<script lang="ts">
  import {
    CONTACT_LABELS,
    DRILL_CATEGORY_LABELS,
    type DrillMeta,
    type Play,
  } from '@phaseplay/shared';
  import { IconLock, IconClock, IconUsers } from '#lib/icons';
  import PlayThumb from '#lib/features/plays/PlayThumb.svelte';
  import { enqueue, loadDrill } from '#lib/features/plays/persist';
  import { onVisible } from '#lib/features/plays/visible';
  import { playersLabel } from './meta';

  let { drill, coach }: { drill: DrillMeta; coach: boolean } = $props();
  let data = $state.raw<Play | null>(null);
  let hover = $state(false);
  let focus = $state(false);

  function load() {
    if (!drill.hasDiagram) return;
    void enqueue(() => loadDrill(drill.id, drill.version)).then(
      (r) => (data = r.value?.diagram ?? null),
    );
  }
</script>

<a
  class="dcard card"
  href="/drills/{drill.id}"
  use:onVisible={load}
  onpointerenter={() => (hover = true)}
  onpointerleave={() => (hover = false)}
  onfocus={() => (focus = true)}
  onblur={() => (focus = false)}
>
  <div class="thumb"><PlayThumb play={data} active={hover || focus} /></div>
  <div class="body">
    <span class="eyebrow">{DRILL_CATEGORY_LABELS[drill.category]}</span>
    <strong class="title">{drill.title}</strong>
    <span class="facts">
      <span><IconClock /> {drill.defaultDurationMin} min</span>
      <span><IconUsers /> {playersLabel(drill)}</span>
    </span>
    <span class="foot">
      <span class="contact c-{drill.contactLevel}">{CONTACT_LABELS[drill.contactLevel]}</span>
      <span class="intensity" aria-label="Intensity {drill.intensity} of 5" role="img">
        {#each [1, 2, 3, 4, 5] as i (i)}<span class="dot" class:on={i <= drill.intensity}
          ></span>{/each}
      </span>
      {#if coach && drill.visibility === 'coaches'}<span class="lock"
          ><IconLock /><span class="sr-only">Coaches only</span></span
        >{/if}
    </span>
  </div>
</a>

<style>
  .dcard {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--text);
    text-decoration: none;
    transition:
      transform var(--m-fast) var(--ease),
      box-shadow var(--m-fast) var(--ease);
  }
  .dcard:hover {
    box-shadow: var(--e-2);
    transform: translateY(-1px);
  }
  .thumb {
    border-bottom: 1px solid var(--border);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: var(--s-3) var(--s-4) var(--s-4);
  }
  .title {
    font-size: var(--t-16);
    line-height: 1.3;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-3);
    color: var(--text-2);
    font-size: var(--t-14);
  }
  .facts span,
  .lock {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .facts :global(svg),
  .lock :global(svg) {
    width: 14px;
    height: 14px;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin-top: var(--s-2);
  }
  .contact {
    font-size: var(--t-12);
    font-weight: 650;
    border-radius: var(--r-full);
    padding: 3px 10px;
    background: var(--surface-2);
    color: var(--text-2);
  }
  .c-full {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .c-shields {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .c-touch {
    background: var(--info-soft);
    color: var(--info);
  }
  .intensity {
    display: inline-flex;
    gap: 3px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--surface-3);
  }
  .dot.on {
    background: var(--accent);
  }
  .lock {
    margin-left: auto;
    color: var(--text-3);
  }
</style>
