<!--
  Team sheet builder for coaches (PLAN.md M3). Edits apply locally at once and autosave as one
  optimistic PUT after ~800 ms of quiet; a 409 adopts the other coach's version.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import {
    RULES,
    scaledFrontRowCover,
    sheetSlots,
    sheetWarnings,
    uuidv7,
    type Format,
    type Member,
    type SheetMemberInfo,
    type SheetPut,
    type TeamEvent,
    type TeamSheet,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import { players, rsvpOf } from '#lib/data/selectors';
  import type { Optimistic } from '#lib/data/idb';
  import { api } from '#lib/api';
  import { toasts } from '#lib/stores/toast.svelte';
  import { buzz } from '#lib/haptics';
  import { ago, dateTime } from '#lib/format';
  import Button from '#lib/components/Button.svelte';
  import IconButton from '#lib/components/IconButton.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import Badge from './Badge.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import {
    IconMinus,
    IconPlus,
    IconCopy,
    IconLayers,
    IconImage,
    IconMegaphone,
    IconCheck,
  } from '#lib/icons';
  import SheetHead from './SheetHead.svelte';
  import PitchView from './PitchView.svelte';
  import ListView from './ListView.svelte';
  import PlayerPicker from './PlayerPicker.svelte';
  import PlayerPanel from './PlayerPanel.svelte';
  import WarningsTray from './WarningsTray.svelte';
  import ExportSheet from './ExportSheet.svelte';
  import VersionsSheet from './VersionsSheet.svelte';
  import {
    assign,
    clear,
    copyFrom,
    draftFrom,
    droppedBy,
    emptyDraft,
    eventLabel,
    exportInput,
    exportMeta,
    fileSlug,
    nextEmpty,
    previousSheet,
    setReplacements,
    slotFlags,
    slotLabel,
    swap,
    toggleCaptain,
    toggleVice,
    warningLines,
    type Avail,
    type Draft,
    type SheetVersion,
  } from './model';

  type Props = { event: TeamEvent; sheet: TeamSheet | undefined; format: Format };
  let { event, sheet, format }: Props = $props();

  const s = $derived(app.snap!);
  const tz = $derived(s.team.timezone);
  const members = $derived(players(s));
  const nameOf = (id: string) => s.rows.members[id]?.displayName ?? 'Former player';
  const availOf = (id: string): Avail => rsvpOf(s, event.id, id)?.status ?? 'none';

  const newId = uuidv7();
  const sheetId = $derived(sheet?.id ?? newId);
  let local = $state.raw<Draft | null>(null);
  const base = $derived(
    sheet ? draftFrom(sheet) : emptyDraft(format, event.settings?.replacements ?? null),
  );
  const draft = $derived(local ?? base);

  const infos = $derived.by(() => {
    const out: Record<string, SheetMemberInfo> = {};
    for (const m of Object.values(s.rows.members) as Member[]) {
      const r = rsvpOf(s, event.id, m.id)?.status ?? null;
      out[m.id] = { positions: m.positions, rsvp: r };
    }
    return out;
  });
  const frontRowCover = $derived(event.settings?.frontRowCover ?? undefined);
  const warnings = $derived(
    sheetWarnings(draft.format, draft.replacements, draft.slots, infos, {
      frontRowCover,
      captainId: draft.captainId,
    }),
  );
  const lines = $derived(warningLines(warnings, draft.format, nameOf));
  const flags = $derived(slotFlags(warnings));
  const coverNote = $derived(
    frontRowCover !== undefined
      ? `Front-row cover is set to ${frontRowCover} for this match.`
      : `Front-row cover follows Law 3: ${scaledFrontRowCover(draft.format, draft.replacements)} for a squad of ${RULES[draft.format].starters + draft.replacements}.`,
  );

  let view = $state<'pitch' | 'list'>('pitch');
  let trayOpen = $state(false);
  let pickerOpen = $state(false);
  let pickerSlot = $state(1);
  let target = $state<number | null>(null);
  let over = $state<number | null>(null);
  let announce = $state('');
  let pickAnnounce = $state('');
  let confirmOpen = $state(false);
  let exportOpen = $state(false);
  let versionsOpen = $state(false);
  let root: HTMLElement | undefined = $state();
  const hintId = `sh-hint-${Math.random().toString(36).slice(2, 7)}`;
  const panelSlot = $derived(target ?? nextEmpty(draft) ?? 1);

  const prev = $derived(
    previousSheet(Object.values(s.rows.sheets), s.rows.events, event, draft.format),
  );
  const filled = $derived(Object.keys(draft.slots).length);
  const saving = $derived(local !== null);
  const status = $derived.by(() => {
    if (saving) return { text: 'Saving…', tone: 'default' as const };
    if (!sheet) return { text: 'Not started', tone: 'default' as const };
    if (sheet.status === 'published')
      return { text: `Published ${ago(sheet.publishedAt ?? Date.now())}`, tone: 'ok' as const };
    if (sheet.publishedAt) return { text: 'Unpublished changes', tone: 'warn' as const };
    return { text: 'Draft · coaches only', tone: 'info' as const };
  });
  const upToDate = $derived(!saving && sheet?.status === 'published');

  // ---- Editing and autosave ----
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The sheet version the on-screen edits started from (pinned when editing begins, not when the
   * debounced save fires, so a sync landing in between can't turn a conflict into an overwrite). */
  let editBase: number | null = null;

  function edit(next: Draft, undo?: string) {
    const before = draft;
    if (local === null) editBase = sheet?.version ?? 0;
    local = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), 800);
    if (undo) toasts.undo(undo, () => edit(before));
  }

  async function save() {
    if (timer) clearTimeout(timer);
    timer = null;
    const d = local;
    if (!d) return;
    const id = sheetId;
    const now = Date.now();
    const body: SheetPut = { eventId: event.id, ...d };
    const optimistic: Optimistic[] = sheet
      ? [
          {
            op: 'patch',
            entity: 'sheets',
            key: id,
            value: { ...d, status: 'draft', updatedAt: now },
          },
        ]
      : [
          {
            op: 'put',
            entity: 'sheets',
            key: id,
            value: {
              id,
              eventId: event.id,
              teamId: event.teamId,
              ...d,
              status: 'draft',
              version: 0,
              publishedAt: null,
              updatedAt: now,
            } satisfies TeamSheet,
          },
        ];
    await app.mutate({
      method: 'PUT',
      path: teamPath(`/sheets/${id}`),
      body,
      label: 'Team sheet',
      optimistic,
      versionOf: { entity: 'sheets', id },
      baseVersion: editBase ?? sheet?.version ?? 0,
    });
    if (local === d) {
      local = null;
      editBase = null;
    }
  }

  onMount(() =>
    app.onConflict((entity, latest) => {
      if (entity !== 'sheets' || (latest as TeamSheet).eventId !== event.id) return;
      if (timer) clearTimeout(timer);
      timer = null;
      local = null;
      editBase = null;
    }),
  );
  onDestroy(() => {
    if (timer) void save();
  });

  // ---- Slots ----
  function focusSlot(n: number | undefined) {
    if (n === undefined) return;
    root?.querySelector<HTMLElement>(`[data-slot="${n}"]`)?.focus();
  }

  function openPicker(n: number) {
    pickerSlot = n;
    target = n;
    pickAnnounce = '';
    pickerOpen = true;
  }

  function put(n: number, id: string): number | null {
    const wasEmpty = !draft.slots[String(n)];
    const next = assign(draft, n, id);
    edit(next);
    buzz();
    return wasEmpty ? nextEmpty(next, n) : null;
  }

  function pick(id: string) {
    const n = pickerSlot;
    const after = put(n, id);
    if (after !== null) {
      pickerSlot = after;
      target = after;
      pickAnnounce = `${nameOf(id)} at ${n}. Now picking ${after}, ${slotLabel(draft.format, after)}.`;
    } else {
      pickerOpen = false;
      announce = `${nameOf(id)} at ${n}.`;
    }
  }

  function panelAdd(id: string) {
    const n = panelSlot;
    const after = put(n, id);
    announce = `${nameOf(id)} at ${n}, ${slotLabel(draft.format, n)}.`;
    if (after !== null) target = after;
  }

  function clearSlot(n: number) {
    const id = draft.slots[String(n)];
    if (!id) return;
    edit(clear(draft, n), `${nameOf(id)} taken off`);
  }

  function captain(id: string | null | undefined) {
    if (!id) return;
    const on = draft.captainId !== id;
    edit(toggleCaptain(draft, id));
    announce = on ? `${nameOf(id)} is captain` : 'Captain cleared';
  }
  function vice(id: string | null | undefined) {
    if (!id) return;
    const on = draft.viceId !== id;
    edit(toggleVice(draft, id));
    announce = on ? `${nameOf(id)} is vice-captain` : 'Vice-captain cleared';
  }

  function slotKey(e: KeyboardEvent, n: number) {
    const all = sheetSlots(draft.format, draft.replacements);
    const i = all.indexOf(n);
    const id = draft.slots[String(n)];
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      clearSlot(n);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusSlot(all[Math.min(all.length - 1, i + 1)]);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusSlot(all[Math.max(0, i - 1)]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusSlot(all[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusSlot(all[all.length - 1]);
    } else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c' && id) {
      e.preventDefault();
      captain(id);
    } else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v' && id) {
      e.preventDefault();
      vice(id);
    }
  }

  function drop(n: number, data: string) {
    if (data.startsWith('slot:')) {
      const from = Number(data.slice(5));
      if (from && from !== n) {
        edit(swap(draft, from, n));
        announce = `Swapped ${from} and ${n}.`;
      }
    } else if (data.startsWith('member:')) {
      const id = data.slice(7);
      if (!s.rows.members[id]) return;
      put(n, id);
      announce = `${nameOf(id)} at ${n}, ${slotLabel(draft.format, n)}.`;
    }
  }

  function slotProps(n: number): HTMLButtonAttributes {
    return {
      'aria-describedby': hintId,
      onclick: () => openPicker(n),
      onfocus: () => (target = n),
      onkeydown: (e) => slotKey(e, n),
      ondragstart: (e) => {
        e.dataTransfer?.setData('text/plain', `slot:${n}`);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      },
      ondragover: (e) => {
        e.preventDefault();
        over = n;
      },
      ondragleave: () => {
        if (over === n) over = null;
      },
      ondrop: (e) => {
        e.preventDefault();
        over = null;
        drop(n, e.dataTransfer?.getData('text/plain') ?? '');
      },
      ondragend: () => (over = null),
    };
  }

  function bench(d: number) {
    const n = Math.max(0, Math.min(RULES[draft.format].maxReplacements, draft.replacements + d));
    if (n === draft.replacements) return;
    const gone = droppedBy(draft, n);
    edit(
      setReplacements(draft, n),
      gone.length ? `${gone.map(nameOf).join(', ')} taken off the bench` : undefined,
    );
    announce = `${n} replacements`;
  }

  // ---- Copy, versions, publish ----
  async function copyPrevious() {
    if (!prev) return;
    let src: Pick<TeamSheet, 'replacements' | 'slots' | 'captainId' | 'viceId'> = prev;
    try {
      const r = await api<{ versions: SheetVersion[] }>(teamPath(`/sheets/${prev.id}/versions`));
      if (r.versions[0]) src = r.versions[0];
    } catch {
      // Offline: the cached copy is close enough.
    }
    const active = new Set(
      (Object.values(s.rows.members) as Member[])
        .filter((m) => m.status !== 'removed')
        .map((m) => m.id),
    );
    const { draft: next, dropped } = copyFrom(src, draft.format, active);
    const pe = s.rows.events[prev.eventId];
    edit(
      next,
      `Copied the team ${pe ? eventLabel(pe) : 'from last match'}${dropped ? `. ${dropped} no longer in the squad` : ''}`,
    );
  }

  function restore(v: SheetVersion) {
    versionsOpen = false;
    edit(
      draftFrom({ ...v, format: v.format ?? draft.format }),
      `Restored the version from ${dateTime(v.publishedAt ?? v.createdAt, tz)}`,
    );
  }

  async function publishNow() {
    confirmOpen = false;
    if (!sheet && !local) local = draft;
    await save();
    await app.mutate({
      method: 'POST',
      path: teamPath(`/sheets/${sheetId}/publish`),
      label: 'Publish team sheet',
      optimistic: [
        {
          op: 'patch',
          entity: 'sheets',
          key: sheetId,
          value: { status: 'published', publishedAt: Date.now() },
        },
      ],
    });
    buzz([10, 40, 10]);
    toasts.success("Team's out. It's on everyone's Home now.");
  }

  function publish() {
    if (lines.length) confirmOpen = true;
    else void publishNow();
  }

  const exportData = $derived(exportInput(draft, nameOf, exportMeta(s.team, event)));
</script>

<svelte:document
  onvisibilitychange={() => {
    if (document.visibilityState === 'hidden' && timer) void save();
  }}
/>

<SheetHead {event} {tz} format={draft.format} teamShort={s.team.shortName}>
  <Badge size="md" tone={status.tone}>{status.text}</Badge>
  <Button variant="primary" disabled={upToDate || filled === 0} onclick={publish}>
    {#snippet icon()}{#if upToDate}<IconCheck />{:else}<IconMegaphone />{/if}{/snippet}
    {upToDate ? 'Published' : sheet?.publishedAt ? 'Publish changes' : 'Publish'}
  </Button>
</SheetHead>

<div class="builder" bind:this={root}>
  <div class="main">
    <div class="bar">
      <Segmented
        label="Sheet view"
        bind:value={view}
        options={[
          { value: 'pitch', label: 'Pitch' },
          { value: 'list', label: 'List' },
        ]}
      />
      <div class="stepper" role="group" aria-labelledby="{hintId}-rep">
        <span id="{hintId}-rep" class="sl">Replacements</span>
        <IconButton
          label="Fewer replacements"
          disabled={draft.replacements <= 0}
          onclick={() => bench(-1)}
        >
          <IconMinus />
        </IconButton>
        <output class="tnum" aria-label="Replacements">{draft.replacements}</output>
        <IconButton
          label="More replacements"
          disabled={draft.replacements >= RULES[draft.format].maxReplacements}
          onclick={() => bench(1)}
        >
          <IconPlus />
        </IconButton>
      </div>
    </div>

    <WarningsTray {lines} note={coverNote} bind:open={trayOpen} onslot={openPicker} />

    <div class="board">
      {#if view === 'pitch'}
        <PitchView {draft} {nameOf} {flags} editable {over} {slotProps} />
      {:else}
        <ListView {draft} {nameOf} {availOf} {flags} editable {over} {slotProps} />
      {/if}
    </div>
    <p id={hintId} class="subtle hint">
      <span class="touch">Tap a slot to pick a player.</span>
      <span class="keys"
        >Enter to pick, arrow keys to move, Delete to clear, C for captain, V for vice.</span
      >
    </p>

    <div class="tools">
      <Button onclick={copyPrevious} disabled={!prev}>
        {#snippet icon()}<IconCopy />{/snippet}Copy from last match
      </Button>
      <Button onclick={() => (versionsOpen = true)} disabled={!sheet?.publishedAt}>
        {#snippet icon()}<IconLayers />{/snippet}Versions
      </Button>
      <Button onclick={() => (exportOpen = true)} disabled={filled === 0}>
        {#snippet icon()}<IconImage />{/snippet}Export image
      </Button>
    </div>
    {#if !prev}<p class="subtle">
        Copy from last match appears once a previous {draft.format} sheet is published.
      </p>{/if}
  </div>

  <div class="side">
    <PlayerPanel {draft} slot={panelSlot} {members} {availOf} onadd={panelAdd} />
  </div>
</div>

<p class="sr-only" aria-live="polite">{announce}</p>

<PlayerPicker
  bind:open={pickerOpen}
  slot={pickerSlot}
  {draft}
  {members}
  {availOf}
  {nameOf}
  announce={pickAnnounce}
  onpick={pick}
  onclear={() => {
    clearSlot(pickerSlot);
    pickerOpen = false;
  }}
  oncaptain={() => captain(draft.slots[String(pickerSlot)])}
  onvice={() => vice(draft.slots[String(pickerSlot)])}
/>

<Sheet
  bind:open={confirmOpen}
  title="Publish with warnings?"
  description="The squad sees it on Home as soon as it's out."
  size="sm"
>
  <ul class="list cl">
    {#each lines.slice(0, 6) as l (l.key)}<li>{l.text}</li>{/each}
    {#if lines.length > 6}<li>…and {lines.length - 6} more</li>{/if}
  </ul>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (confirmOpen = false)}>Keep editing</Button>
    <Button variant="primary" onclick={publishNow}>Publish anyway</Button>
  {/snippet}
</Sheet>

<ExportSheet
  bind:open={exportOpen}
  input={exportData}
  filename="team-sheet-{fileSlug(eventLabel(event))}"
/>
<VersionsSheet
  bind:open={versionsOpen}
  sheetId={sheet?.id ?? null}
  {tz}
  {nameOf}
  onrestore={restore}
/>

<style>
  .builder {
    display: grid;
    gap: var(--s-6);
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    min-width: 0;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 0 0 var(--s-3);
    border-radius: var(--r-full);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .sl {
    margin-right: var(--s-1);
    font-size: var(--t-14);
    font-weight: 600;
    color: var(--text-2);
  }
  output {
    min-width: 2ch;
    text-align: center;
    font-weight: 800;
    font-size: var(--t-16);
  }
  .hint {
    margin-top: calc(-1 * var(--s-2));
  }
  .keys {
    display: none;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .side {
    display: none;
  }
  .cl {
    display: grid;
    gap: var(--s-2);
    font-size: var(--t-14);
  }
  .cl li {
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--warn-soft);
  }
  @media (pointer: fine) {
    .keys {
      display: inline;
    }
    .touch {
      display: none;
    }
  }
  @media (min-width: 1200px) {
    .builder {
      grid-template-columns: minmax(0, 1fr) 340px;
      align-items: start;
    }
    .side {
      display: block;
      position: sticky;
      top: var(--s-6);
    }
  }
</style>
