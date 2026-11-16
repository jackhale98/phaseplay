<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import {
    EVENT_TYPE_LABELS,
    IMPORT_CHUNK,
    isStaff,
    positionsFor,
    uuidv7,
  } from '@phaseplay/shared';
  import { api, ApiError } from '#lib/api';
  import { app } from '#lib/data/app.svelte';
  import { teamPath } from '#lib/data/actions';
  import { events as allEvents, squad } from '#lib/data/selectors';
  import Button from '#lib/components/Button.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import { toasts } from '#lib/stores/toast.svelte';
  import { day, time, tzName } from '#lib/format';
  import { IconBack, IconUpload, IconCheck, IconWarn, IconChevronDown } from '#lib/icons';
  import IconSheet from '@lucide/svelte/icons/file-spreadsheet';
  import { parseTable, type CsvTable } from '#lib/features/schedule/csv';
  import {
    ROSTER_FIELDS,
    SCHEDULE_FIELDS,
    chunk,
    detectDateOrder,
    detectKind,
    mapRoster,
    mapSchedule,
    mappingComplete,
    rosterRows,
    scheduleRows,
    type DateOrder,
    type ImportKind,
    type Mapping,
  } from '#lib/features/schedule/teamsnap';

  const MAX_ROWS = 1000;
  const s = $derived(app.snap);
  const tz = $derived(s?.team.timezone ?? 'UTC');
  const staff = $derived(isStaff(app.role));

  let fileName = $state('');
  let table = $state.raw<CsvTable | null>(null);
  let kind = $state<ImportKind>('schedule');
  let smap = $state<Mapping<string>>({});
  let rmap = $state<Mapping<string>>({});
  let order = $state<DateOrder>('dmy');
  const excluded = new SvelteSet<number>();
  let phase = $state<'pick' | 'review' | 'sending' | 'done'>('pick');
  let progress = $state(0);
  let total = $state(0);
  let result = $state<{ events: number; members: number } | null>(null);
  let columnsOpen = $state(false);

  async function onFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > 2_000_000)
      return toasts.error('That file is too big. Exports are usually under 1 MB.');
    const text = await f.text();
    const t = parseTable(text);
    if (!t.headers.length || !t.rows.length)
      return toasts.error("We couldn't find any rows in that file.");
    if (t.rows.length > MAX_ROWS)
      return toasts.error(`That's ${t.rows.length} rows. Import up to ${MAX_ROWS} at a time.`);
    fileName = f.name;
    table = t;
    kind = detectKind(t.headers);
    smap = mapSchedule(t.headers);
    rmap = mapRoster(t.headers);
    const dates = smap.date !== undefined ? t.rows.map((r) => r[smap.date!] ?? '') : [];
    order = detectDateOrder(dates, tz.startsWith('America/') ? 'mdy' : 'dmy');
    excluded.clear();
    columnsOpen = !mappingComplete(kind, kind === 'schedule' ? smap : rmap);
    phase = 'review';
  }

  const ambiguousDates = $derived(
    !!table &&
      smap.date !== undefined &&
      table.rows.some((r) => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(r[smap.date!] ?? '')),
  );
  const complete = $derived(mappingComplete(kind, kind === 'schedule' ? smap : rmap));

  const existingEvents = $derived(allEvents(s));
  const existingNames = $derived(new Set(squad(s).map((m) => m.displayName.toLowerCase())));
  type Row = {
    line: number;
    ok: boolean;
    dup: boolean;
    cells: string[];
    note: string | null;
    event?: ReturnType<typeof scheduleRows>[number];
    member?: ReturnType<typeof rosterRows>[number];
  };
  const SHORT = positionsFor('15s');
  const rows = $derived.by((): Row[] => {
    if (!table || !complete) return [];
    if (kind === 'schedule') {
      return scheduleRows(table, smap, tz, order).map((r) => {
        if (!r.ok)
          return {
            line: r.line,
            ok: false,
            dup: false,
            cells: ['', '', table!.rows[r.line - 2]?.join(' · ') ?? '', ''],
            note: r.error,
            event: r,
          };
        const v = r.value;
        const dup = existingEvents.some(
          (e) =>
            e.startsAt === v.startsAt &&
            (e.title.toLowerCase() === v.title.toLowerCase() ||
              (!!v.opponent && e.opponent?.toLowerCase() === v.opponent.toLowerCase())),
        );
        return {
          line: r.line,
          ok: true,
          dup,
          cells: [
            `${day(v.startsAt, tz)}, ${time(v.startsAt, tz)}`,
            EVENT_TYPE_LABELS[v.type],
            v.title,
            v.locationName ?? '',
          ],
          note: dup ? 'Already on the schedule' : v.warning,
          event: r,
        };
      });
    }
    return rosterRows(table, rmap).map((r) => {
      if (!r.ok)
        return {
          line: r.line,
          ok: false,
          dup: false,
          cells: [table!.rows[r.line - 2]?.filter(Boolean).join(' ') ?? '', '', ''],
          note: r.error,
          member: r,
        };
      const v = r.value;
      const dup = existingNames.has(v.displayName.toLowerCase());
      return {
        line: r.line,
        ok: true,
        dup,
        cells: [
          v.displayName,
          v.jersey === null ? '' : String(v.jersey),
          v.positions.map((n) => SHORT.find((p) => p.n === n)?.short ?? n).join(' · '),
        ],
        note: dup ? 'Already in the squad' : null,
        member: r,
      };
    });
  });
  const chosen = $derived(rows.filter((r) => r.ok && !r.dup && !excluded.has(r.line)));
  const heads = $derived(
    kind === 'schedule' ? ['When', 'Type', 'Title', 'Where'] : ['Name', 'Shirt', 'Positions'],
  );

  function toggle(line: number) {
    if (excluded.has(line)) excluded.delete(line);
    else excluded.add(line);
  }

  async function run() {
    if (!chosen.length) return;
    phase = 'sending';
    progress = 0;
    total = chosen.length;
    const done = { events: 0, members: 0 };
    try {
      for (const part of chunk(chosen, IMPORT_CHUNK)) {
        const body = {
          events: part.flatMap((r) => {
            if (!r.event?.ok) return [];
            const { warning: _w, ...v } = r.event.value;
            return [{ id: uuidv7(), ...v }];
          }),
          members: part.flatMap((r) => (r.member?.ok ? [{ id: uuidv7(), ...r.member.value }] : [])),
        };
        const res = await api<{ events: number; members: number }>(teamPath('/import'), {
          method: 'POST',
          body,
        });
        done.events += res.events;
        done.members += res.members;
        progress += part.length;
      }
      await app.sync();
      result = done;
      phase = 'done';
    } catch (e) {
      toasts.error(
        e instanceof ApiError && e.code === 'network'
          ? `You went offline after ${progress} rows. Reconnect and import the file again; rows already in are skipped.`
          : `Import stopped after ${progress} rows: ${(e as Error).message}`,
      );
      await app.sync();
      phase = 'review';
    }
  }
  function reset() {
    table = null;
    fileName = '';
    result = null;
    phase = 'pick';
  }
</script>

<svelte:head><title>Import from TeamSnap · Phaseplay</title></svelte:head>

<div class="page narrow">
  <a class="back" href="/more"><IconBack /> More</a>
  <header class="page-head">
    <div>
      <h1>Import from TeamSnap</h1>
      <p class="muted lead">
        Bring your schedule and squad list across in a minute. Imported players show up as names
        waiting to join, and they're claimed when each player joins with your invite.
      </p>
    </div>
  </header>

  {#if !staff}
    <p class="muted">Only coaches and managers can import.</p>
  {:else if phase === 'done' && result}
    <section class="card pad done" aria-live="polite">
      <span class="ok-ic"><IconCheck /></span>
      <h2 class="h">All in</h2>
      <p>
        {#if result.events}Added {result.events} event{result.events === 1 ? '' : 's'} to the schedule.{/if}
        {#if result.members}Added {result.members} name{result.members === 1 ? '' : 's'} to the squad.{/if}
      </p>
      <div class="row wrap">
        {#if result.events}<Button variant="primary" href="/schedule">Open the schedule</Button
          >{/if}
        {#if result.members}<Button variant="primary" href="/squad">Open the squad</Button>{/if}
        <Button variant="ghost" onclick={reset}>Import another file</Button>
      </div>
    </section>
  {:else}
    <section class="card pad steps">
      <ol>
        <li>
          In TeamSnap on the web, open <strong>Schedule</strong> or <strong>Roster</strong> and
          choose <strong>Export</strong> (CSV).
        </li>
        <li>Pick the file here. Nothing is uploaded until you press Import.</li>
      </ol>
      <label class="drop" class:has={!!fileName}>
        <input
          type="file"
          accept=".csv,text/csv"
          onchange={onFile}
          disabled={phase === 'sending'}
        />
        <span class="ic"
          >{#if fileName}<IconSheet />{:else}<IconUpload />{/if}</span
        >
        <span class="grow">
          <strong>{fileName || 'Choose a CSV file'}</strong>
          <small class="muted"
            >{table
              ? `${table.rows.length} rows · tap to pick another`
              : 'Schedule or roster export'}</small
          >
        </span>
      </label>
    </section>

    {#if table && phase !== 'pick'}
      <section class="card pad" aria-labelledby="what-h">
        <div class="row wrap between">
          <h2 id="what-h" class="h">This file is a</h2>
          <Segmented
            label="This file is a"
            bind:value={
              () => kind,
              (k) => (
                (kind = k),
                excluded.clear(),
                (columnsOpen = !mappingComplete(k, k === 'schedule' ? smap : rmap))
              )
            }
            options={[
              { value: 'schedule', label: 'Schedule' },
              { value: 'roster', label: 'Roster' },
            ]}
          />
        </div>
        {#if kind === 'schedule' && ambiguousDates}
          <label class="inline">
            <span>Dates are written</span>
            <select bind:value={order}>
              <option value="dmy">Day / month / year</option>
              <option value="mdy">Month / day / year</option>
            </select>
          </label>
        {/if}
        <details class="cols" bind:open={columnsOpen}>
          <summary
            ><IconChevronDown class="chev" />Match columns {#if !complete}<span class="need"
                >needed</span
              >{/if}</summary
          >
          {#if !complete}
            <p class="subtle">
              {kind === 'schedule'
                ? 'Tell us which column has the date.'
                : 'Tell us which column has the names.'}
            </p>
          {/if}
          <div class="grid">
            {#each kind === 'schedule' ? SCHEDULE_FIELDS : ROSTER_FIELDS as f (f.key)}
              {@const m = kind === 'schedule' ? smap : rmap}
              <label class="inline">
                <span>{f.label}{f.required ? ' *' : ''}</span>
                <select
                  value={m[f.key] ?? -1}
                  onchange={(e) => {
                    const i = Number(e.currentTarget.value);
                    const next = { ...m, [f.key]: i < 0 ? undefined : i };
                    if (kind === 'schedule') smap = next;
                    else rmap = next;
                  }}
                >
                  <option value={-1}>Not in this file</option>
                  {#each table.headers as h, i (i)}<option value={i}
                      >{h || `Column ${i + 1}`}</option
                    >{/each}
                </select>
              </label>
            {/each}
          </div>
        </details>
      </section>

      {#if complete}
        <section aria-labelledby="prev-h">
          <h2 id="prev-h" class="section-title">
            Preview <span class="subtle"
              >{chosen.length} of {rows.length} will be added{kind === 'schedule'
                ? ` · times in ${tzName(tz)}`
                : ''}</span
            >
          </h2>
          <div class="card scroller">
            <table>
              <thead>
                <tr>
                  <th scope="col"><span class="sr-only">Include</span></th>
                  {#each heads as h (h)}<th scope="col">{h}</th>{/each}
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {#each rows as r (r.line)}
                  <tr class:skip={!r.ok || r.dup || excluded.has(r.line)}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label="Include row {r.line}"
                        checked={r.ok && !r.dup && !excluded.has(r.line)}
                        disabled={!r.ok || r.dup}
                        onchange={() => toggle(r.line)}
                      />
                    </td>
                    {#each r.cells as c, i (i)}<td class:wide={i === (kind === 'schedule' ? 2 : 0)}
                        >{c}</td
                      >{/each}
                    <td class="st">
                      {#if !r.ok}<span class="bad"><IconWarn />{r.note}</span>
                      {:else if r.note}<span class="meh">{r.note}</span>
                      {:else}<span class="good"><IconCheck />Ready</span>{/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>

        <div class="go card">
          {#if phase === 'sending'}
            <label class="prog" for="imp-prog">Importing {progress} of {total}…</label>
            <progress id="imp-prog" max={total} value={progress}></progress>
          {:else}
            <p class="grow">
              <strong>{chosen.length}</strong>
              {kind === 'schedule'
                ? chosen.length === 1
                  ? 'event'
                  : 'events'
                : chosen.length === 1
                  ? 'name'
                  : 'names'} ready
            </p>
            <Button variant="primary" disabled={!chosen.length} onclick={run}>
              {#snippet icon()}<IconUpload />{/snippet}Import {chosen.length}
              {kind === 'schedule'
                ? chosen.length === 1
                  ? 'event'
                  : 'events'
                : chosen.length === 1
                  ? 'name'
                  : 'names'}
            </Button>
          {/if}
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .narrow {
    max-width: 860px;
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
  .lead {
    margin-top: var(--s-2);
    max-width: 62ch;
  }
  .pad {
    display: grid;
    gap: var(--s-3);
    padding: var(--s-5);
    margin-bottom: var(--s-4);
  }
  .h {
    font-size: var(--t-16);
  }
  .between {
    justify-content: space-between;
  }
  ol {
    margin: 0;
    padding-left: 1.25em;
    display: grid;
    gap: var(--s-1);
    font-size: var(--t-14);
    color: var(--text-2);
  }
  .drop {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-height: 72px;
    padding: var(--s-3) var(--s-4);
    border: 2px dashed var(--border-strong);
    border-radius: var(--r-lg);
    background: var(--surface-sunken);
    cursor: pointer;
  }
  .drop:hover,
  .drop:focus-within {
    border-color: var(--accent);
  }
  .drop:focus-within {
    outline: 3px solid color-mix(in srgb, var(--accent) 70%, var(--text));
    outline-offset: 2px;
  }
  .drop.has {
    border-style: solid;
    background: var(--surface);
  }
  .drop input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .drop small {
    display: block;
    font-size: var(--t-12);
  }
  .ic,
  .ok-ic {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: var(--r-md);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .ic :global(svg),
  .ok-ic :global(svg) {
    width: 22px;
    height: 22px;
  }
  .ok-ic {
    border-radius: 50%;
    background: var(--ok-soft);
    color: var(--ok);
  }
  .inline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    font-size: var(--t-14);
    font-weight: 600;
  }
  select {
    min-height: 44px;
    min-width: 200px;
    padding: 0 10px;
    border-radius: var(--r-md);
    border: 1px solid var(--border-strong);
    background: var(--surface);
    font-size: var(--t-14);
  }
  .cols summary {
    cursor: pointer;
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-weight: 650;
  }
  .cols summary::-webkit-details-marker {
    display: none;
  }
  .cols summary :global(.chev) {
    width: 18px;
    height: 18px;
    transition: transform var(--m-fast) var(--ease);
    transform: rotate(-90deg);
  }
  .cols[open] summary :global(.chev) {
    transform: none;
  }
  .need {
    padding: 2px 8px;
    border-radius: var(--r-full);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: var(--t-12);
  }
  .grid {
    display: grid;
    gap: var(--s-2) var(--s-5);
    margin-top: var(--s-2);
  }
  @media (min-width: 760px) {
    .grid {
      grid-template-columns: 1fr 1fr;
    }
  }
  .scroller {
    overflow: auto;
    max-height: 60vh;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--t-14);
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: var(--s-2) var(--s-3);
    background: var(--surface-2);
    text-align: left;
    font-size: var(--t-12);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-2);
    white-space: nowrap;
  }
  td {
    padding: var(--s-2) var(--s-3);
    border-top: 1px solid var(--border);
    vertical-align: top;
  }
  td.wide {
    min-width: 160px;
    font-weight: 600;
  }
  td input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  tr.skip td:not(.st) {
    color: var(--text-3);
  }
  .st span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--t-12);
    font-weight: 650;
    white-space: nowrap;
  }
  .st :global(svg) {
    width: 14px;
    height: 14px;
  }
  .good {
    color: var(--ok);
  }
  .meh {
    color: var(--warn);
  }
  .bad {
    color: var(--danger);
  }
  .go {
    position: sticky;
    bottom: calc(var(--tabbar-h) + var(--safe-b) + var(--s-3));
    display: flex;
    align-items: center;
    gap: var(--s-3);
    flex-wrap: wrap;
    margin-top: var(--s-4);
    padding: var(--s-3) var(--s-4);
    box-shadow: var(--e-2);
  }
  @media (min-width: 768px) {
    .go {
      bottom: var(--s-4);
    }
  }
  .prog {
    font-weight: 650;
  }
  progress {
    flex: 1 1 200px;
    height: 10px;
    accent-color: var(--accent);
  }
  .done {
    justify-items: start;
  }
</style>
