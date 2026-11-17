<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { CONTACT_LABELS, DRILL_CATEGORY_LABELS, type DrillFull } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import Button from '#lib/components/Button.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import { shareOrDownload } from '#lib/share';
  import { toasts } from '#lib/stores/toast.svelte';
  import {
    IconBack,
    IconEdit,
    IconCopy,
    IconTrash,
    IconPrint,
    IconCalendarPlus,
    IconClock,
    IconUsers,
    IconZap,
  } from '#lib/icons';
  import DiagramPlayer from '#lib/features/plays/DiagramPlayer.svelte';
  import { loadDrill } from '#lib/features/plays/persist';
  import { describeFrame } from '#lib/features/plays/describe';
  import { deleteDrill, duplicateDrill, hidden } from '#lib/features/plays/actions.svelte';
  import {
    drillFacts,
    equipmentLines,
    mergedEquipment,
    playersLabel,
  } from '#lib/features/drills/meta';

  const id = $derived(page.params.id ?? '');
  const s = $derived(app.snap);
  const coach = $derived(app.can('drills.manage'));
  const meta = $derived(s?.rows.drills[id]);
  let full = $state.raw<DrillFull | null>(null);
  let status = $state<'loading' | 'ready' | 'missing' | 'offline'>('loading');
  let printing = $state(false);
  let paper = $state<'a4' | 'letter'>('a4');
  let busy = $state(false);

  $effect(() => {
    const did = id;
    if (!app.teamId) return;
    void loadDrill(did, meta?.version).then((r) => {
      if (did !== id) return;
      if (r.value) {
        full = r.value;
        status = 'ready';
      } else status = r.error === 'not_found' ? 'missing' : full ? 'ready' : 'offline';
    });
  });

  const d = $derived(
    full
      ? {
          ...full,
          ...(meta ?? {}),
          diagram: (meta as Partial<DrillFull> | undefined)?.diagram ?? full.diagram,
        }
      : null,
  );
  /** The diagram titled like the drill, for the player's accessible name. */
  const diagram = $derived(d?.diagram ? { ...d.diagram, title: d.title } : null);
  const equipment = $derived(d ? equipmentLines(mergedEquipment(d.diagram, d.equipment)) : []);
  const steps = $derived(
    d?.diagram
      ? d.diagram.frames
          .map((f, i) => f.caption || (i === 0 ? '' : describeFrame(d.diagram!, i)))
          .filter(Boolean)
      : [],
  );
  const all = $derived(
    Object.values(s?.rows.drills ?? {}).filter((x) => !x.deletedAt && !hidden.has(x.id)),
  );
  const parent = $derived(d?.parentId ? all.find((x) => x.id === d.parentId) : undefined);
  const children = $derived(d ? all.filter((x) => x.parentId === d.id) : []);

  async function variation() {
    if (!d) return;
    const nid = await duplicateDrill(d);
    toasts.success('Variation created');
    await goto(`/drills/${nid}/edit`);
  }
  async function remove() {
    if (!d) return;
    deleteDrill(d);
    await goto('/playbook?tab=drills');
  }
  async function exportCard() {
    if (!d?.diagram || busy) return;
    busy = true;
    try {
      const { renderDrillCard } = await import('@phaseplay/diagram/export/png');
      const blob = await renderDrillCard({
        play: d.diagram,
        title: d.title,
        setup: d.setup || d.description,
        coachingPoints: d.coachingPoints,
        equipment: mergedEquipment(d.diagram, d.equipment),
        meta: drillFacts(d),
        paper,
        accent: app.team?.colors.primary,
      });
      const slug =
        d.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'drill';
      await shareOrDownload(blob, `${slug}-card.png`, d.title);
      printing = false;
    } catch (e) {
      toasts.error(`Couldn't make the card: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{d?.title ?? 'Drill'} · Playbook</title></svelte:head>

<div class="page">
  <a class="back" href="/playbook?tab=drills"><IconBack /> Drills</a>
  {#if d && !hidden.has(d.id)}
    <header class="page-head">
      <div class="grow">
        <p class="eyebrow">
          {DRILL_CATEGORY_LABELS[d.category]}{d.source === 'starter' ? ' · Starter pack' : ''}
        </p>
        <h1>{d.title}</h1>
        {#if parent}<p class="subtle">
            Variation of <a href="/drills/{parent.id}">{parent.title}</a>
          </p>{/if}
      </div>
      {#if coach}
        <div class="row wrap actions">
          <Button variant="primary" href="/practice/new?drill={d.id}"
            >{#snippet icon()}<IconCalendarPlus />{/snippet}Add to practice</Button
          >
          <Button href="/drills/{d.id}/edit">{#snippet icon()}<IconEdit />{/snippet}Edit</Button>
        </div>
      {/if}
    </header>

    <ul class="facts list" aria-label="Drill facts">
      <li><IconClock /> {d.defaultDurationMin} min</li>
      <li><IconUsers /> {playersLabel(d)}</li>
      <li class="contact c-{d.contactLevel}">{CONTACT_LABELS[d.contactLevel]}</li>
      <li><IconZap /> Intensity {d.intensity}/5</li>
      <li>{d.area.w}×{d.area.h} m</li>
    </ul>

    <div class="layout">
      <div class="main">
        {#if d.diagram}
          <DiagramPlayer play={diagram ?? d.diagram} autoplay loop />
        {:else}
          <div class="nodiagram card">
            <p class="subtle">No diagram yet.{coach ? ' Add one in the editor.' : ''}</p>
          </div>
        {/if}
        {#if d.description}<p class="desc">{d.description}</p>{/if}
      </div>
      <aside class="side">
        {#if d.coachingPoints.length}
          <section class="card block">
            <h2>Coaching points</h2>
            <ul class="points">
              {#each d.coachingPoints as p, i (i)}<li>{p}</li>{/each}
            </ul>
          </section>
        {/if}
        {#if d.setup}
          <section class="card block">
            <h2>Setup</h2>
            <p class="pre">{d.setup}</p>
          </section>
        {/if}
        {#if steps.length}
          <section class="card block">
            <h2>Steps</h2>
            <ol class="steps">
              {#each steps as st, i (i)}<li>{st}</li>{/each}
            </ol>
          </section>
        {/if}
        <section class="card block">
          <h2>Equipment</h2>
          {#if equipment.length}
            <ul class="equip list">
              {#each equipment as e (e.key)}<li>
                  <span>{e.label}</span><strong class="tnum">{e.n}</strong>
                </li>{/each}
            </ul>
          {:else}
            <p class="subtle">Nothing needed.</p>
          {/if}
        </section>
        {#if d.variations.length || children.length}
          <section class="card block">
            <h2>Variations</h2>
            {#if d.variations.length}<ul class="points">
                {#each d.variations as v, i (i)}<li>{v}</li>{/each}
              </ul>{/if}
            {#if children.length}
              <ul class="list kids">
                {#each children as c (c.id)}<li><a href="/drills/{c.id}">{c.title}</a></li>{/each}
              </ul>
            {/if}
          </section>
        {/if}
        <div class="row wrap more">
          {#if d.diagram}<Button variant="quiet" onclick={() => (printing = true)}
              >{#snippet icon()}<IconPrint />{/snippet}Drill card</Button
            >{/if}
          {#if coach}
            <Button variant="quiet" onclick={variation}
              >{#snippet icon()}<IconCopy />{/snippet}Duplicate as variation</Button
            >
            {#if d.source === 'team'}<Button variant="quiet" onclick={remove}
                >{#snippet icon()}<IconTrash />{/snippet}Delete</Button
              >{/if}
          {/if}
        </div>
      </aside>
    </div>

    <Sheet
      bind:open={printing}
      title="Drill card"
      description="A printable card with the diagram, setup, coaching points and equipment."
      size="sm"
    >
      <div class="stack">
        <Segmented
          label="Paper size"
          bind:value={paper}
          options={[
            { value: 'a4', label: 'A4' },
            { value: 'letter', label: 'Letter' },
          ]}
        />
        <Button variant="primary" block loading={busy} onclick={exportCard}
          >{#snippet icon()}<IconPrint />{/snippet}Make card (PNG)</Button
        >
      </div>
    </Sheet>
  {:else if status === 'loading'}
    <div class="skeleton" aria-busy="true" aria-label="Loading drill"></div>
  {:else if status === 'offline'}
    <EmptyState title="You're offline" body="This drill isn't saved on this device yet." />
  {:else}
    <EmptyState title="Drill not found" body="It may have been deleted, or it's for coaches only.">
      {#snippet action()}<Button href="/playbook?tab=drills">Back to drills</Button>{/snippet}
    </EmptyState>
  {/if}
</div>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    color: var(--text-2);
    text-decoration: none;
    font-weight: 600;
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
  }
  h1 {
    margin: 2px 0 0;
  }
  .actions {
    gap: var(--s-2);
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin: 0 0 var(--s-5);
  }
  .facts li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: var(--r-full);
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: var(--t-14);
    font-weight: 600;
  }
  .facts :global(svg) {
    width: 16px;
    height: 16px;
  }
  .c-full {
    background: var(--danger-soft) !important;
    color: var(--danger);
    border-color: transparent !important;
  }
  .c-shields {
    background: var(--warn-soft) !important;
    color: var(--warn);
    border-color: transparent !important;
  }
  .c-touch {
    background: var(--info-soft) !important;
    color: var(--info);
    border-color: transparent !important;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-5);
  }
  @media (min-width: 1000px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 340px;
      align-items: start;
    }
  }
  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .desc,
  .pre {
    white-space: pre-wrap;
    margin: 0;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  .block {
    padding: var(--s-4);
  }
  .block h2 {
    font-size: var(--t-16);
    margin: 0 0 var(--s-2);
  }
  .points,
  .steps {
    margin: 0;
    padding-left: 1.2em;
    display: flex;
    flex-direction: column;
    gap: 6px;
    line-height: 1.45;
  }
  .equip li {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }
  .equip li:last-child {
    border-bottom: 0;
  }
  .kids {
    margin-top: var(--s-2);
  }
  .kids a {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    color: var(--accent-text);
    font-weight: 600;
  }
  .nodiagram {
    padding: var(--s-8);
    text-align: center;
  }
  .skeleton {
    height: 60vh;
    border-radius: var(--r-lg);
    background: var(--surface-2);
  }
</style>
