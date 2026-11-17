<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { page } from '$app/state';
  import { beforeNavigate, goto } from '$app/navigation';
  import {
    ALL_LANE,
    CONTACT_LABELS,
    blockMinutes,
    laneLabel,
    timeline,
    type Block,
    type BlockKind,
    type DrillMeta,
    type PlanData,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import { memberName } from '#lib/data/selectors';
  import Button from '#lib/components/Button.svelte';
  import IconButton from '#lib/components/IconButton.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { buzz } from '#lib/haptics';
  import { day, time } from '#lib/format';
  import Stepper from '#lib/features/practice/Stepper.svelte';
  import DrillPicker from '#lib/features/practice/DrillPicker.svelte';
  import BlockSheet from '#lib/features/practice/BlockSheet.svelte';
  import {
    SPLIT_LANES,
    addSlot,
    blockTitle,
    findBlock,
    fmtMin,
    insertWater,
    isSplitSlot,
    laneMode,
    makeBlock,
    moveSlot,
    overview,
    removeBlock,
    rotationRounds,
    sanitize,
    setLaneBlock,
    setLanes,
    splitSlot,
    updateBlock,
    type LaneMode,
  } from '#lib/features/practice/model';
  import {
    createPlan,
    deletePlan,
    hiddenPlans,
    loadTicks,
    saveTicks,
  } from '#lib/features/practice/ui.svelte';
  import {
    IconPlay,
    IconWater,
    IconDrill,
    IconMegaphone,
    IconGoal,
    IconSparkles,
    IconGrip,
    IconPlus,
    IconWarn,
    IconChecklist,
    IconTrash,
    IconRepeat,
    IconMore,
    IconChevronLeft,
  } from '#lib/icons';
  import IconArrowUp from '@lucide/svelte/icons/arrow-up';
  import IconArrowDown from '@lucide/svelte/icons/arrow-down';
  import IconBookmarkPlus from '@lucide/svelte/icons/bookmark-plus';
  import IconSplit from '@lucide/svelte/icons/split';

  const id = $derived(page.params.id ?? '');
  const s = $derived(app.snap);
  const plan = $derived(hiddenPlans.ids.includes(id) ? undefined : s?.rows.plans[id]);
  const event = $derived(plan?.eventId ? s?.rows.events[plan.eventId] : undefined);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const canEdit = $derived(app.can('practice.manage'));
  const canRun = $derived(app.can('practice.run'));
  const drills = $derived((s?.rows.drills ?? {}) as Record<string, DrillMeta>);
  const drillList = $derived(Object.values(drills).filter((d) => !d.deletedAt && !d.archivedAt));
  const staff = $derived(
    Object.values(s?.rows.members ?? {})
      .filter((m) => m.status === 'active' && m.role !== 'player')
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  const plays = $derived(
    Object.values(s?.rows.plays ?? {})
      .filter((p) => !p.deletedAt && !p.archivedAt)
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  /* ------------------------------ Draft + autosave ------------------------------ */
  let draft = $state.raw<PlanData | null>(null);
  let title = $state('');
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSent = '';
  /** Plan version the current burst of edits started from (pinned before the debounce). */
  let base: number | undefined;

  $effect(() => {
    const p = plan;
    if (!p || dirty) return;
    const json = JSON.stringify(p.data);
    if (json === lastSent && draft) return;
    draft = p.data;
    title = p.title;
  });

  $effect(() =>
    app.onConflict((entity, latest) => {
      if (entity === 'plans' && latest.id === id) {
        dirty = false;
        lastSent = '';
      }
    }),
  );

  function edit(fn: (p: PlanData) => PlanData) {
    if (!draft || !canEdit) return;
    draft = fn(draft);
    schedule();
  }
  function schedule() {
    if (!dirty) base = plan?.version;
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), 800);
  }
  async function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!dirty || !draft || !plan) return;
    dirty = false;
    const data = sanitize(draft);
    const t = title.trim().slice(0, 80) || plan.title;
    lastSent = JSON.stringify(data);
    await app.mutate({
      method: 'PATCH',
      path: teamPath(`/plans/${id}`),
      body: { data, title: t },
      label: 'Practice plan',
      versionOf: { entity: 'plans', id },
      ...(base !== undefined ? { baseVersion: base } : {}),
      optimistic: [
        {
          op: 'patch',
          entity: 'plans',
          key: id,
          value: {
            data,
            title: t,
            plannedTotalMin: timeline(data).at(-1)?.endMin ?? 0,
            updatedAt: Date.now(),
          },
        },
      ],
    });
  }
  beforeNavigate(() => void flush());
  onDestroy(() => void flush());
  $effect(() => {
    const hide = () => document.visibilityState === 'hidden' && void flush();
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  });

  function setVisibility(team: boolean) {
    if (!plan) return;
    void app.mutate({
      method: 'PATCH',
      path: teamPath(`/plans/${id}`),
      body: { visibility: team ? 'team' : 'coaches' },
      label: 'Plan visibility',
      versionOf: { entity: 'plans', id },
      optimistic: [
        { op: 'patch', entity: 'plans', key: id, value: { visibility: team ? 'team' : 'coaches' } },
      ],
    });
  }

  /* ---------------------------------- Derived ---------------------------------- */
  const tl = $derived(draft ? timeline(draft) : []);
  const ov = $derived(draft ? overview(draft, drills, event) : null);
  const mode = $derived(draft ? laneMode(draft.lanes) : 'all');
  const split = $derived(mode !== 'all');
  const slotLabel = (startMin: number) =>
    event ? time(event.startsAt + startMin * 60e3, tz) : `${startMin}′`;
  const finishAt = $derived(event && ov ? event.startsAt + ov.totalMin * 60e3 : null);

  function applyMode(m: LaneMode) {
    if (!draft || m === mode) return;
    edit((p) =>
      setLanes(p, m === 'all' ? [ALL_LANE] : m === 'split' ? SPLIT_LANES : ['Group A', 'Group B']),
    );
  }
  function renameLane(i: number, name: string) {
    edit((p) =>
      setLanes(
        p,
        p.lanes.map((l, j) => (j === i ? name || l : l)),
      ),
    );
  }

  /* ---------------------------------- Adding ---------------------------------- */
  let addOpen = $state(false);
  let addTarget = $state<{ slotId?: string; lane: string }>({ lane: ALL_LANE });
  let newLane = $state<string>(ALL_LANE);
  const laneOptions = $derived([
    { value: ALL_LANE, label: 'Everyone' },
    ...(draft?.lanes ?? [])
      .filter((l) => l !== ALL_LANE)
      .map((l) => ({ value: l, label: laneLabel(l) })),
  ]);

  function openAdd(target?: { slotId: string; lane: string }) {
    addTarget = target ?? { lane: newLane };
    addOpen = true;
  }
  async function add(block: Block, target = addTarget) {
    if (!draft) return;
    const lane = target.slotId
      ? target.lane
      : target.lane === ALL_LANE || draft.lanes.includes(target.lane)
        ? target.lane
        : ALL_LANE;
    const b = { ...block, lane };
    edit((p) => (target.slotId ? setLaneBlock(p, target.slotId, b) : addSlot(p, b)));
    addOpen = false;
    buzz();
    await tick();
    document.querySelector(`[data-block="${b.id}"]`)?.scrollIntoView({
      block: 'nearest',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }
  const pickDrill = (d: DrillMeta, target = addTarget) =>
    add(makeBlock('drill', target.lane, d), target);
  const addKind = (k: BlockKind, target = addTarget) => add(makeBlock(k, target.lane), target);

  /* ---------------------------------- Editing ---------------------------------- */
  let editId = $state<string | null>(null);
  let editOpen = $state(false);
  const editing = $derived(draft && editId ? (findBlock(draft, editId)?.block ?? null) : null);
  function openEdit(b: Block) {
    editId = b.id;
    editOpen = true;
  }
  function remove(blockId: string) {
    if (!draft) return;
    const prev = draft;
    const found = findBlock(draft, blockId);
    edit((p) => removeBlock(p, blockId));
    editOpen = false;
    if (found)
      toasts.undo(`Removed ${blockTitle(found.block, drills)}`, () => {
        draft = prev;
        schedule();
      });
  }

  /* ---------------------------------- Reorder ---------------------------------- */
  let listEl: HTMLOListElement | undefined = $state();
  let drag = $state<{ from: number; to: number; dy: number } | null>(null);
  let press: {
    timer: ReturnType<typeof setTimeout>;
    startY: number;
    index: number;
    pointerId: number;
    el: HTMLElement;
  } | null = null;

  async function move(from: number, to: number, focusSlot?: string) {
    if (!draft || to < 0 || to >= draft.slots.length) return;
    edit((p) => moveSlot(p, from, to));
    if (focusSlot) {
      await tick();
      document.querySelector<HTMLElement>(`[data-handle="${focusSlot}"]`)?.focus();
    }
  }
  function onHandleKey(e: KeyboardEvent, index: number, slotId: string) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      void move(index, index + (e.key === 'ArrowUp' ? -1 : 1), slotId);
    }
  }
  function startDrag(index: number, startY: number) {
    drag = { from: index, to: index, dy: 0 };
    buzz(8);
    press && (press.startY = startY);
  }
  function onHandleDown(e: PointerEvent, index: number) {
    if (!canEdit || e.button > 0) return;
    const el = e.currentTarget as HTMLElement;
    const p = {
      timer: setTimeout(() => startDrag(index, e.clientY), e.pointerType === 'mouse' ? 0 : 320),
      startY: e.clientY,
      index,
      pointerId: e.pointerId,
      el,
    };
    press = p;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
  }
  function onHandleMove(e: PointerEvent) {
    if (!press) return;
    if (!drag) {
      // Moving before the long-press fires cancels it (lets the page scroll on touch).
      if (Math.abs(e.clientY - press.startY) > 8 && e.pointerType !== 'mouse') cancelPress();
      return;
    }
    const dy = e.clientY - press.startY;
    const els = [...(listEl?.querySelectorAll<HTMLElement>('[data-slot]') ?? [])];
    let to = 0;
    els.forEach((el, i) => {
      if (i === drag!.from) return;
      const r = el.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) to++;
    });
    drag = { ...drag, dy, to };
  }
  function onHandleUp() {
    if (drag && drag.to !== drag.from) void move(drag.from, drag.to);
    cancelPress();
  }
  function cancelPress() {
    if (press) {
      clearTimeout(press.timer);
      try {
        press.el.releasePointerCapture(press.pointerId);
      } catch {}
    }
    press = null;
    drag = null;
  }
  const dropClass = (i: number) => {
    if (!drag || drag.to === drag.from) return '';
    const others = draft!.slots.map((_, j) => j).filter((j) => j !== drag!.from);
    if (drag.to < others.length && others[drag.to] === i) return 'drop-above';
    if (drag.to === others.length && others.at(-1) === i) return 'drop-below';
    return '';
  };

  /* -------------------------------- Equipment -------------------------------- */
  let ticks = $derived(loadTicks(id));
  function toggleTick(k: string) {
    ticks = ticks.includes(k) ? ticks.filter((x) => x !== k) : [...ticks, k];
    saveTicks(id, ticks);
  }

  /* --------------------------------- Actions --------------------------------- */
  let moreOpen = $state(false);
  async function saveTemplate() {
    if (!draft) return;
    await flush();
    await createPlan({
      title: `${title.replace(/^Template:\s*/i, '')}`.slice(0, 70) + ' (template)',
      eventId: null,
      data: draft,
      isTemplate: true,
    });
    moreOpen = false;
    toasts.success('Saved as a template');
  }
  async function del() {
    if (!plan) return;
    moreOpen = false;
    dirty = false;
    if (timer) clearTimeout(timer);
    deletePlan(plan);
    await goto('/practice');
  }

  const KIND_ICON = {
    drill: IconDrill,
    water: IconWater,
    talk: IconMegaphone,
    game: IconGoal,
    custom: IconSparkles,
  } as const;

  function blockMeta(b: Block): string {
    const parts: string[] = [];
    const d = b.drillId ? drills[b.drillId] : undefined;
    if (d) parts.push(CONTACT_LABELS[d.contactLevel]);
    if (b.coachId) parts.push(memberName(s, b.coachId));
    if (b.playId && s?.rows.plays[b.playId]) parts.push(`Play: ${s.rows.plays[b.playId]!.title}`);
    if (b.rotation)
      parts.push(`${b.rotation.groups} groups × ${b.rotation.stations.length} stations`);
    return parts.join(' · ');
  }
</script>

<svelte:head><title>{plan?.title ?? 'Practice plan'} · Practice</title></svelte:head>

{#snippet blockCard(b: Block)}
  {@const Icon = KIND_ICON[b.kind]}
  {@const name = blockTitle(b, drills)}
  {@const d = b.drillId ? drills[b.drillId] : undefined}
  <article class="block k-{b.kind}" data-block={b.id} aria-label={name}>
    <div class="b-top">
      <span class="kic" aria-hidden="true"><Icon /></span>
      {#if canEdit}
        <button type="button" class="b-title" onclick={() => openEdit(b)} aria-label="Edit {name}">
          <strong>{name}</strong>
          {#if blockMeta(b)}<small>{blockMeta(b)}</small>{/if}
        </button>
      {:else}
        <div class="b-title">
          <strong>{name}</strong>
          {#if blockMeta(b)}<small>{blockMeta(b)}</small>{/if}
        </div>
      {/if}
      {#if d && d.intensity >= 4}<span class="hi" title="High intensity">HI</span>{/if}
    </div>
    <div class="b-bot">
      {#if canEdit && !b.rotation}
        <Stepper
          size="sm"
          label="{name} minutes"
          value={b.durationMin}
          onchange={(v) => edit((p) => updateBlock(p, b.id, { durationMin: v }))}
        />
      {:else}
        <span class="mins tnum">{blockMinutes(b)} min</span>
      {/if}
      {#if d}
        <a class="drill-link" href="/drills/{d.id}" aria-label="View drill: {d.title}"
          >{d.hasDiagram ? 'Drill & diagram' : 'View drill'}</a
        >
      {/if}
    </div>
    {#if b.notes}<p class="notes">{b.notes}</p>{/if}
    {#if b.rotation}
      <ol class="rounds">
        {#each rotationRounds(b) as r (r.round)}
          <li>
            <span class="rt tnum">+{r.startMin}′</span>
            <span class="rg"
              >{#each r.groups as g (g.group)}<span><b>G{g.group}</b> {g.station}</span
                >{/each}</span
            >
          </li>
        {/each}
      </ol>
    {/if}
  </article>
{/snippet}

{#if !s}
  <div class="page"><div class="sk" aria-busy="true"></div></div>
{:else if !plan || !draft}
  <div class="page">
    <EmptyState
      title="Plan not found"
      body="It may have been deleted, or it's only visible to coaches."
    >
      {#snippet action()}<Button href="/practice">Back to practice</Button>{/snippet}
    </EmptyState>
  </div>
{:else}
  <div class="planner" class:with-lib={canEdit}>
    {#if canEdit}
      <aside class="lib card" aria-labelledby="lib-h">
        <h2 id="lib-h" class="lib-h">Drill library</h2>
        {#if split}
          <Segmented label="Add for" size="sm" options={laneOptions} bind:value={newLane} />
        {/if}
        <div class="quick">
          <Button size="sm" onclick={() => addKind('water', { lane: ALL_LANE })}
            >{#snippet icon()}<IconWater />{/snippet}Water</Button
          >
          <Button size="sm" onclick={() => addKind('talk', { lane: newLane })}
            >{#snippet icon()}<IconMegaphone />{/snippet}Talk</Button
          >
          <Button size="sm" onclick={() => addKind('game', { lane: newLane })}
            >{#snippet icon()}<IconGoal />{/snippet}Game</Button
          >
          <Button size="sm" onclick={() => addKind('custom', { lane: newLane })}
            >{#snippet icon()}<IconSparkles />{/snippet}Custom</Button
          >
        </div>
        <DrillPicker drills={drillList} onpick={(d) => pickDrill(d, { lane: newLane })} />
      </aside>
    {/if}

    <div class="main">
      <header class="head">
        <a class="back" href="/practice"><IconChevronLeft />Practice</a>
        <div class="title-row">
          {#if canEdit}
            <label class="sr-only" for="plan-title">Plan title</label>
            <input
              id="plan-title"
              class="title-in"
              type="text"
              maxlength="80"
              bind:value={title}
              oninput={schedule}
            />
          {:else}
            <h1>{plan.title}</h1>
          {/if}
        </div>
        <p class="when muted">
          {#if event}
            {day(event.startsAt, tz)} · {time(event.startsAt, tz)}{event.endsAt
              ? `–${time(event.endsAt, tz)}`
              : ''}{event.locationName ? ` · ${event.locationName}` : ''}
          {:else if plan.isTemplate}
            Template
          {:else}
            Not attached to a session
          {/if}
        </p>
        <div class="actions">
          {#if canRun && draft.slots.length}
            <Button variant="primary" href="/practice/{id}/run"
              >{#snippet icon()}<IconPlay />{/snippet}Live session</Button
            >
          {/if}
          {#if canEdit}
            <Button variant="ghost" onclick={() => (moreOpen = true)}
              >{#snippet icon()}<IconMore />{/snippet}More</Button
            >
          {/if}
        </div>
      </header>

      {#if canEdit}
        <section class="settings card" aria-label="Session setup">
          <div class="set-row">
            <span class="set-l" id="groups-l">Groups</span>
            <Segmented
              label="Groups"
              size="sm"
              options={[
                { value: 'all', label: 'Everyone' },
                { value: 'split', label: 'Forwards / Backs' },
                { value: 'custom', label: 'Custom' },
              ]}
              bind:value={() => mode, (v) => applyMode(v)}
            />
          </div>
          {#if mode === 'custom'}
            <div class="lanes-edit">
              {#each draft.lanes as l, i (i)}
                <span class="lane-in">
                  <label class="sr-only" for="lane-{i}">Group {i + 1} name</label>
                  <input
                    id="lane-{i}"
                    type="text"
                    maxlength="24"
                    value={l}
                    onchange={(e) => renameLane(i, e.currentTarget.value.trim())}
                  />
                  {#if draft.lanes.length > 2}
                    <IconButton
                      label="Remove group {i + 1}"
                      onclick={() =>
                        edit((p) =>
                          setLanes(
                            p,
                            p.lanes.filter((_, j) => j !== i),
                          ),
                        )}><IconTrash /></IconButton
                    >
                  {/if}
                </span>
              {/each}
              {#if draft.lanes.length < 4}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() =>
                    edit((p) =>
                      setLanes(p, [
                        ...p.lanes,
                        `Group ${String.fromCharCode(65 + p.lanes.length)}`,
                      ]),
                    )}
                >
                  {#snippet icon()}<IconPlus />{/snippet}Add group
                </Button>
              {/if}
            </div>
          {/if}
          <div class="set-row">
            <span class="set-l">Water every</span>
            <Stepper
              size="sm"
              label="Water break every"
              min={10}
              max={60}
              value={draft.waterEveryMin ?? 22}
              onchange={(v) => edit((p) => ({ ...p, waterEveryMin: v }))}
            />
          </div>
          <label class="set-row check">
            <span class="set-l">Players can see this plan</span>
            <input
              type="checkbox"
              checked={plan.visibility === 'team'}
              onchange={(e) => setVisibility(e.currentTarget.checked)}
            />
          </label>
        </section>
      {/if}

      <h2 class="section-title">
        Timeline <span class="subtle"
          >{draft.slots.length} {draft.slots.length === 1 ? 'block' : 'blocks'}</span
        >
      </h2>
      {#if !draft.slots.length}
        <div class="empty card">
          <p><strong>Start with a warm-up.</strong></p>
          <p class="muted">
            Add drills from the library, then water breaks and games. Totals update as you go.
          </p>
        </div>
      {:else}
        <ol class="list timeline" bind:this={listEl} aria-label="Session timeline">
          {#each tl as t, i (t.slot.id)}
            {@const isSplit = isSplitSlot(t.slot)}
            <li
              class="slot {dropClass(i)}"
              class:dragging={drag?.from === i}
              data-slot={t.slot.id}
              style:--dy={drag?.from === i ? `${drag.dy}px` : undefined}
            >
              <div class="when-col">
                <span class="tnum t">{slotLabel(t.startMin)}</span>
                <small class="tnum">{t.endMin - t.startMin}′</small>
              </div>
              <div class="body">
                {#if isSplit}
                  <div class="lanes" style:--n={draft.lanes.length}>
                    {#each draft.lanes as lane (lane)}
                      {@const b = t.slot.blocks.find((x) => x.lane === lane)}
                      <div class="lane">
                        <span class="lane-name">{laneLabel(lane)}</span>
                        {#if b}{@render blockCard(b)}{/if}
                        {#if !b && canEdit}
                          <button
                            type="button"
                            class="add-lane"
                            onclick={() => openAdd({ slotId: t.slot.id, lane })}
                          >
                            <IconPlus />Add for {laneLabel(lane)}
                          </button>
                        {:else if t.fillers[lane]}
                          <span class="filler"
                            >{b
                              ? `then free ${t.fillers[lane]} min`
                              : `Free ${t.fillers[lane]} min`}</span
                          >
                        {/if}
                      </div>
                    {/each}
                  </div>
                {:else}
                  {@render blockCard(t.slot.blocks[0]!)}
                {/if}
              </div>
              {#if canEdit}
                <div class="tools">
                  <button
                    type="button"
                    class="grip"
                    data-handle={t.slot.id}
                    aria-label="Reorder {blockTitle(
                      t.slot.blocks[0]!,
                      drills,
                    )}. Use the up and down arrow keys"
                    onkeydown={(e) => onHandleKey(e, i, t.slot.id)}
                    onpointerdown={(e) => onHandleDown(e, i)}
                    onpointermove={onHandleMove}
                    onpointerup={onHandleUp}
                    onpointercancel={cancelPress}
                    oncontextmenu={(e) => e.preventDefault()}><IconGrip /></button
                  >
                  <span class="updown">
                    <IconButton label="Move up" disabled={i === 0} onclick={() => move(i, i - 1)}
                      ><IconArrowUp /></IconButton
                    >
                    <IconButton
                      label="Move down"
                      disabled={i === tl.length - 1}
                      onclick={() => move(i, i + 1)}><IconArrowDown /></IconButton
                    >
                  </span>
                  {#if split && !isSplit && t.slot.blocks[0]?.kind !== 'water' && !t.slot.blocks[0]?.rotation}
                    <IconButton
                      label="Split {blockTitle(t.slot.blocks[0]!, drills)} into groups"
                      onclick={() => edit((p) => splitSlot(p, t.slot.id))}><IconSplit /></IconButton
                    >
                  {/if}
                </div>
              {/if}
            </li>
            {#if ov?.waterAfter.includes(i)}
              <li class="water-hint">
                <IconWater />
                <span class="grow">Water break due · {t.endMin} min of work</span>
                {#if canEdit}
                  <Button size="sm" onclick={() => edit((p) => insertWater(p, i))}>Insert</Button>
                {/if}
              </li>
            {/if}
          {/each}
          {#if finishAt}
            <li class="finish"><span class="tnum">{time(finishAt, tz)}</span> Finish</li>
          {/if}
        </ol>
      {/if}

      {#if canEdit}
        <div class="adders">
          {#if split}
            <div class="row wrap">
              <span class="set-l" aria-hidden="true">New blocks for</span>
              <Segmented
                label="New blocks for"
                size="sm"
                options={laneOptions}
                bind:value={newLane}
              />
            </div>
          {/if}
          <div class="row wrap">
            <Button variant="primary" onclick={() => openAdd()}
              >{#snippet icon()}<IconPlus />{/snippet}Add drill</Button
            >
            <Button onclick={() => addKind('water', { lane: ALL_LANE })}
              >{#snippet icon()}<IconWater />{/snippet}Water break</Button
            >
          </div>
        </div>
      {/if}

      {#if ov && ov.equipment.length}
        <section class="card eq" aria-labelledby="eq-h">
          <h2 id="eq-h" class="eq-h">
            <IconChecklist />Equipment
            <span class="subtle"
              >{ticks.filter((k) => ov.equipment.some((e) => e.key === k)).length}/{ov.equipment
                .length} packed</span
            >
          </h2>
          <ul class="list eq-list">
            {#each ov.equipment as e (e.key)}
              <li>
                <label class:done={ticks.includes(e.key)}>
                  <input
                    type="checkbox"
                    checked={ticks.includes(e.key)}
                    onchange={() => toggleTick(e.key)}
                  />
                  <span class="grow">{e.label}</span>
                  <span class="tnum n">× {e.count}</span>
                </label>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if ov}
        <div class="totals" class:over={ov.overMin > 0} role="status" aria-label="Session totals">
          <div class="tot-main">
            <span class="big tnum">{fmtMin(ov.totalMin)}</span>
            {#if ov.slotMin !== null}
              <span class="of tnum">of {fmtMin(ov.slotMin)}</span>
            {:else}
              <span class="of">planned</span>
            {/if}
            {#if ov.overMin > 0}
              <span class="warn"><IconWarn />Over by {fmtMin(ov.overMin)}</span>
            {:else if ov.slotMin !== null && ov.slotMin - ov.totalMin > 0}
              <span class="left tnum">{fmtMin(ov.slotMin - ov.totalMin)} to fill</span>
            {/if}
          </div>
          {#if ov.slotMin}
            <div class="bar" aria-hidden="true">
              <i style:width="{Math.min(100, (ov.totalMin / ov.slotMin) * 100)}%"></i>
            </div>
          {/if}
          <div class="tot-sub">
            <span>Contact <b class="tnum">{ov.contactMin} min</b></span>
            <span>High intensity <b class="tnum">{ov.highIntensityMin} min</b></span>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <Sheet
    bind:open={addOpen}
    title={addTarget.slotId ? `Add for ${laneLabel(addTarget.lane)}` : 'Add to the session'}
    size="lg"
  >
    {#if !addTarget.slotId && split}
      <div class="sheet-lane">
        <Segmented label="For" size="sm" options={laneOptions} bind:value={addTarget.lane} />
      </div>
    {/if}
    <div class="quick">
      {#if !addTarget.slotId}
        <Button size="sm" onclick={() => addKind('water', { lane: ALL_LANE })}
          >{#snippet icon()}<IconWater />{/snippet}Water break</Button
        >
      {/if}
      <Button size="sm" onclick={() => addKind('talk')}
        >{#snippet icon()}<IconMegaphone />{/snippet}Talk</Button
      >
      <Button size="sm" onclick={() => addKind('game')}
        >{#snippet icon()}<IconGoal />{/snippet}Game</Button
      >
      <Button size="sm" onclick={() => addKind('custom')}
        >{#snippet icon()}<IconSparkles />{/snippet}Custom</Button
      >
    </div>
    <DrillPicker drills={drillList} onpick={(d) => pickDrill(d)} autofocus />
  </Sheet>

  <BlockSheet
    bind:open={editOpen}
    block={editing}
    lanes={draft.lanes}
    {drills}
    {staff}
    {plays}
    onchange={(patch) => editId && edit((p) => updateBlock(p, editId!, patch))}
    onremove={() => editId && remove(editId)}
  />

  <Sheet bind:open={moreOpen} title="Plan options" size="sm">
    <div class="opts">
      <button type="button" class="opt" onclick={saveTemplate}
        ><IconBookmarkPlus /><span
          ><strong>Save as template</strong><small class="muted"
            >Reuse this session for future practices</small
          ></span
        ></button
      >
      <a class="opt" href="/practice/new?copy={id}" onclick={() => (moreOpen = false)}
        ><IconRepeat /><span
          ><strong>Copy to another practice</strong><small class="muted"
            >Start a new plan from this one</small
          ></span
        ></a
      >
      <button type="button" class="opt danger" onclick={del}
        ><IconTrash /><span
          ><strong>Delete plan</strong><small class="muted">You can undo for a few seconds</small
          ></span
        ></button
      >
    </div>
  </Sheet>
{/if}

<style>
  .sk {
    height: 320px;
    border-radius: var(--r-lg);
    background: var(--surface-2);
  }
  .planner {
    width: 100%;
    max-width: 1080px;
    margin: 0 auto;
    padding: var(--s-4) var(--s-4) 0;
  }
  .lib {
    display: none;
  }
  .main {
    min-width: 0;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin-bottom: var(--s-4);
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    align-self: flex-start;
    min-height: 32px;
    font-size: var(--t-14);
    font-weight: 650;
    text-decoration: none;
  }
  .back :global(svg) {
    width: 18px;
    height: 18px;
  }
  .title-in {
    width: 100%;
    padding: 2px 6px;
    margin-left: -6px;
    border: 1px solid transparent;
    border-radius: var(--r-md);
    background: transparent;
    font-size: var(--t-24);
    font-weight: 750;
    letter-spacing: -0.02em;
  }
  .title-in:hover {
    border-color: var(--border);
  }
  .title-in:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--surface);
  }
  h1 {
    font-size: var(--t-24);
  }
  .when {
    font-size: var(--t-14);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-top: var(--s-2);
  }
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
  }
  .set-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2) var(--s-3);
    min-height: 44px;
  }
  .set-l {
    font-size: var(--t-14);
    font-weight: 650;
  }
  .check {
    cursor: pointer;
  }
  .check input,
  .eq input {
    width: 22px;
    height: 22px;
    accent-color: var(--accent);
    flex: none;
  }
  .lanes-edit {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .lane-in {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .lane-in input {
    width: 9em;
    min-height: 44px;
    padding: 8px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface);
  }
  .empty {
    padding: var(--s-5);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .timeline {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .slot {
    position: relative;
    display: grid;
    grid-template-columns: 58px minmax(0, 1fr) auto;
    gap: var(--s-2);
    align-items: start;
    transition: transform var(--m-fast) var(--ease);
  }
  .slot.dragging {
    z-index: 5;
    transform: translateY(var(--dy, 0));
    transition: none;
  }
  .slot.dragging .body {
    box-shadow: var(--e-3);
    border-radius: var(--r-lg);
  }
  .drop-above::before,
  .drop-below::after {
    content: '';
    position: absolute;
    left: 58px;
    right: 0;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .drop-above::before {
    top: -6px;
  }
  .drop-below::after {
    bottom: -6px;
  }
  .when-col {
    display: flex;
    flex-direction: column;
    padding-top: var(--s-3);
    text-align: right;
    line-height: 1.2;
  }
  .when-col .t {
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
  }
  .when-col small {
    font-size: var(--t-12);
    color: var(--text-3);
  }
  .body {
    min-width: 0;
  }
  .lanes {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    gap: var(--s-2);
  }
  .lane {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }
  .lane-name {
    font-size: var(--t-12);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3) var(--s-3);
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--e-1);
  }
  .k-water {
    border-left-color: var(--info);
    background: color-mix(in srgb, var(--info-soft) 60%, var(--surface));
  }
  .k-talk {
    border-left-color: var(--text-3);
  }
  .k-game {
    border-left-color: var(--secondary);
  }
  .k-custom {
    border-left-color: var(--border-strong);
  }
  .b-top {
    display: flex;
    gap: var(--s-2);
    align-items: flex-start;
  }
  .kic {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    margin-top: 6px;
    border-radius: var(--r-sm);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .k-water .kic {
    background: var(--info-soft);
    color: var(--info);
  }
  .kic :global(svg) {
    width: 16px;
    height: 16px;
  }
  .b-title {
    flex: 1;
    min-width: 0;
    min-height: 40px;
    padding: 4px 0;
    border: 0;
    background: transparent;
    text-align: left;
    line-height: 1.25;
  }
  button.b-title:hover strong {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .b-title strong {
    display: block;
    font-size: var(--t-16);
    overflow-wrap: anywhere;
  }
  .b-title small {
    display: block;
    margin-top: 2px;
    font-size: var(--t-12);
    color: var(--text-2);
  }
  .hi {
    flex: none;
    margin-top: 8px;
    padding: 1px 6px;
    border-radius: var(--r-full);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: 11px;
    font-weight: 800;
  }
  .b-bot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }
  .mins {
    font-weight: 700;
    font-size: var(--t-14);
  }
  .notes {
    font-size: var(--t-14);
    color: var(--text-2);
    white-space: pre-line;
  }
  .rounds {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--t-12);
  }
  .rounds li {
    display: flex;
    gap: var(--s-2);
  }
  .rt {
    flex: none;
    width: 2.5em;
    color: var(--text-3);
    font-weight: 700;
  }
  .rg {
    display: flex;
    flex-wrap: wrap;
    gap: 2px var(--s-3);
  }
  .add-lane {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-1);
    min-height: 56px;
    border: 1.5px dashed var(--border-strong);
    border-radius: var(--r-md);
    background: transparent;
    color: var(--accent-text);
    font-size: var(--t-14);
    font-weight: 650;
  }
  .add-lane :global(svg) {
    width: 16px;
    height: 16px;
  }
  .filler {
    padding: 4px var(--s-2);
    border-radius: var(--r-sm);
    background: repeating-linear-gradient(-45deg, var(--surface-2) 0 6px, transparent 6px 12px);
    font-size: var(--t-12);
    color: var(--text-2);
  }
  .tools {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .grip {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text-3);
    cursor: grab;
    touch-action: none;
    -webkit-touch-callout: none;
    user-select: none;
  }
  .grip:hover {
    background: var(--surface-2);
  }
  .grip :global(svg) {
    width: 20px;
    height: 20px;
  }
  .updown {
    display: none;
  }
  @media (max-width: 599px) {
    .lanes {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .water-hint {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-left: 60px;
    padding: var(--s-2) var(--s-3);
    border: 1.5px dashed color-mix(in srgb, var(--info) 50%, transparent);
    border-radius: var(--r-md);
    color: var(--info);
    font-size: var(--t-14);
    font-weight: 600;
  }
  .water-hint > :global(svg) {
    width: 18px;
    height: 18px;
    flex: none;
  }
  .finish {
    display: flex;
    gap: var(--s-3);
    padding-left: 8px;
    font-size: var(--t-14);
    font-weight: 700;
    color: var(--text-2);
  }
  .adders {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    margin-top: var(--s-4);
  }
  .eq {
    margin-top: var(--s-6);
    padding: var(--s-4);
  }
  .eq-h {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    margin-bottom: var(--s-2);
    font-size: var(--t-16);
  }
  .eq-h :global(svg) {
    width: 18px;
    height: 18px;
  }
  .eq-h .subtle {
    margin-left: auto;
    font-weight: 500;
  }
  .eq-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0 var(--s-4);
  }
  .eq label {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 44px;
    cursor: pointer;
  }
  .eq label.done .grow {
    color: var(--text-2);
    text-decoration: line-through;
  }
  .eq .n {
    font-weight: 700;
  }
  .totals {
    position: sticky;
    bottom: calc(var(--tabbar-h) + var(--safe-b) + var(--s-2));
    z-index: 4;
    margin: var(--s-6) 0 var(--s-4);
    padding: var(--s-3) var(--s-4);
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(10px);
    box-shadow: var(--e-2);
  }
  .tot-main {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-1) var(--s-2);
  }
  .big {
    font-size: var(--t-20);
    font-weight: 800;
  }
  .of,
  .left {
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .left {
    margin-left: auto;
  }
  .warn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    padding: 2px 8px;
    border-radius: var(--r-full);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: var(--t-14);
    font-weight: 700;
  }
  .warn :global(svg) {
    width: 14px;
    height: 14px;
  }
  .bar {
    height: 6px;
    margin: var(--s-2) 0;
    border-radius: 3px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
  }
  .over {
    border-color: color-mix(in srgb, var(--warn) 50%, var(--border));
  }
  .over .bar i {
    background: var(--warn);
  }
  .tot-sub {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-4);
    font-size: var(--t-12);
    color: var(--text-2);
  }
  .tot-sub b {
    color: var(--text);
  }
  .sheet-lane {
    margin-bottom: var(--s-3);
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-bottom: var(--s-3);
  }
  .opts {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 56px;
    padding: var(--s-2) var(--s-3);
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--text);
    text-align: left;
    text-decoration: none;
  }
  .opt:hover {
    background: var(--surface-2);
  }
  .opt > :global(svg) {
    width: 20px;
    height: 20px;
    flex: none;
  }
  .opt small {
    display: block;
    font-size: var(--t-12);
  }
  .opt.danger {
    color: var(--danger);
  }

  @media (min-width: 768px) {
    .planner {
      padding: var(--s-6) var(--s-8) 0;
    }
    .slot {
      grid-template-columns: 64px minmax(0, 1fr) auto;
    }
    .drop-above::before,
    .drop-below::after {
      left: 64px;
    }
    .water-hint {
      margin-left: 72px;
    }
    .block {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
    }
    .b-top {
      flex: 1 1 220px;
      min-width: 0;
    }
    .notes,
    .rounds {
      flex-basis: 100%;
    }
    .lanes .block {
      flex-direction: column;
      align-items: stretch;
    }
    .when-col .t {
      font-size: var(--t-14);
    }
    .tools {
      display: grid;
      grid-template-columns: repeat(2, 36px);
      gap: 2px;
    }
    .grip,
    .tools :global(.ib) {
      width: 36px;
      height: 36px;
      min-width: 36px;
      min-height: 36px;
    }
    .updown {
      display: contents;
    }
    .totals {
      bottom: var(--s-4);
    }
  }
  @media (min-width: 1200px) {
    .planner.with-lib {
      max-width: 1400px;
      display: grid;
      grid-template-columns: 340px minmax(0, 1fr);
      gap: var(--s-6);
      align-items: start;
    }
    .lib {
      position: sticky;
      top: var(--s-4);
      display: flex;
      flex-direction: column;
      gap: var(--s-3);
      max-height: calc(100dvh - var(--s-8));
      padding: var(--s-4);
      overflow: auto;
    }
    .lib-h {
      font-size: var(--t-16);
    }
    .with-lib .adders {
      display: none;
    }
    .lanes .block {
      flex-direction: row;
      align-items: center;
    }
  }
  .drill-link {
    order: -1;
    margin-right: auto;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 var(--s-2);
    font-size: var(--t-14);
    font-weight: 600;
  }
</style>
