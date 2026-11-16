<!--
  Create / edit an event in a bottom sheet. Creating starts with a clear choice of Game, Practice or
  Event, then the form adapts: opponent, format and match settings for games, weekly repeat for
  practices. All times are entered in the team's timezone, which is always shown.
-->
<script lang="ts">
  import {
    EVENT_CATEGORY_LABELS,
    EVENT_TYPE_LABELS,
    RULES,
    eventCategory,
    isGame,
    typesInCategory,
    addDays,
    weekdayOf,
    zonedToUtc,
    type EventCategory,
    type EventType,
    type EventUpdate,
    type Format,
    type TeamEvent,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import Button from '#lib/components/Button.svelte';
  import Chip from '#lib/components/Chip.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import { fromLocalInput, toLocalInput, tzName, day, time } from '#lib/format';
  import { toasts } from '#lib/stores/toast.svelte';
  import { IconChevronLeft, IconChevronRight } from '#lib/icons';
  import { CATEGORY_ICON, CATEGORY_BLURB, TYPE_ICON } from './category';
  import { createEvent, createSeries, updateEvent } from './actions.svelte';
  import {
    hhmm,
    minutesBetween,
    movedFrom,
    movedNote,
    nextWeekday,
    notesBody,
    type FormValues,
  } from './schedule';
  import { dateInTz } from '@phaseplay/shared';

  type Props = {
    open: boolean;
    event?: TeamEvent | null;
    category?: EventCategory | null;
    onsaved?: (id: string | null) => void;
  };
  let { open = $bindable(), event = null, category = null, onsaved }: Props = $props();

  const tz = $derived(app.team?.timezone ?? 'UTC');
  const teamFormat = $derived<Format>(app.team?.defaultFormat ?? '15s');
  const editing = $derived(!!event);

  let step = $state<'pick' | 'form'>('pick');
  let v = $state<FormValues>(blank('practices'));
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let settingsTouched = $state(false);
  let markMoved = $state(true);
  let wasOpen = false;

  const DEFAULT_TITLE: Record<EventType, string> = {
    training: 'Practice',
    match: 'Game',
    tournament: '7s tournament',
    social: 'Social',
    fundraiser: 'Fundraiser',
    meeting: 'Team meeting',
    other: '',
  };
  const WEEKDAYS = [
    { n: 1, l: 'Mon' },
    { n: 2, l: 'Tue' },
    { n: 3, l: 'Wed' },
    { n: 4, l: 'Thu' },
    { n: 5, l: 'Fri' },
    { n: 6, l: 'Sat' },
    { n: 0, l: 'Sun' },
  ];

  function blank(c: EventCategory, type?: EventType): FormValues {
    const t = type ?? typesInCategory(c)[0]!;
    const fmt: Format = t === 'tournament' ? '7s' : (app.team?.defaultFormat ?? '15s');
    const zone = app.team?.timezone ?? 'UTC';
    const date = nextWeekday(c === 'games' ? 6 : c === 'practices' ? 2 : 5, zone);
    const times =
      t === 'tournament'
        ? { start: '09:00', meet: '08:15', finish: '17:00' }
        : c === 'games'
          ? { start: '15:00', meet: '13:45', finish: '' }
          : c === 'practices'
            ? { start: '19:00', meet: '', finish: '20:30' }
            : { start: '19:30', meet: '', finish: '' };
    return {
      type: t,
      title: '',
      opponent: '',
      format: fmt,
      date,
      ...times,
      locationName: '',
      locationUrl: '',
      notes: '',
      deadline: '',
      halfMinutes: RULES[fmt].halfMinutes,
      sinBinMinutes: RULES[fmt].sinBinMinutes,
      replacements: RULES[fmt].defaultReplacements,
      repeat: false,
      weekdays: [weekdayOf(date)],
      until: addDays(date, 7 * 12),
    };
  }

  function fromEvent(e: TeamEvent): FormValues {
    const fmt: Format = e.format ?? teamFormat;
    return {
      type: e.type,
      title: e.type === 'match' && e.opponent && e.title === `v ${e.opponent}` ? '' : e.title,
      opponent: e.opponent ?? '',
      format: fmt,
      date: dateInTz(e.startsAt, tz),
      start: hhmm(e.startsAt, tz),
      meet: e.meetAt ? hhmm(e.meetAt, tz) : '',
      finish: e.endsAt ? hhmm(e.endsAt, tz) : '',
      locationName: e.locationName ?? '',
      locationUrl: e.locationUrl ?? '',
      notes: notesBody(e.notes),
      deadline: e.rsvpDeadline ? toLocalInput(e.rsvpDeadline, tz) : '',
      halfMinutes: e.settings?.halfMinutes ?? RULES[fmt].halfMinutes,
      sinBinMinutes: e.settings?.sinBinMinutes ?? RULES[fmt].sinBinMinutes,
      replacements: e.settings?.replacements ?? RULES[fmt].defaultReplacements,
      repeat: false,
      weekdays: [],
      until: '',
    };
  }

  // Reset each time the sheet opens.
  $effect(() => {
    if (open && !wasOpen) {
      errors = {};
      busy = false;
      settingsTouched = false;
      markMoved = true;
      if (event) {
        v = fromEvent(event);
        step = 'form';
      } else if (category) {
        v = blank(category);
        step = 'form';
      } else step = 'pick';
    }
    wasOpen = open;
  });

  const cat = $derived(eventCategory(v.type));
  const game = $derived(isGame(v.type));
  const tzLabel = $derived(`${tzName(tz, Date.now())} (${tz.replace(/_/g, ' ')})`);
  const moved = $derived(
    !!event && v.date && v.start && zonedToUtc(v.date, v.start, tz) !== event.startsAt,
  );

  function pick(c: EventCategory) {
    v = blank(c);
    step = 'form';
  }
  function setType(t: EventType) {
    const prevFmt = v.format;
    v.type = t;
    if (t === 'tournament' && !editing) v.format = '7s';
    else if (t === 'match' && !editing) v.format = teamFormat;
    if (v.format !== prevFmt) setFormat(v.format);
  }
  function setFormat(f: Format) {
    v.format = f;
    if (!settingsTouched) {
      v.halfMinutes = RULES[f].halfMinutes;
      v.sinBinMinutes = RULES[f].sinBinMinutes;
      v.replacements = RULES[f].defaultReplacements;
    }
  }
  function toggleDay(n: number) {
    v.weekdays = v.weekdays.includes(n) ? v.weekdays.filter((x) => x !== n) : [...v.weekdays, n];
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!v.date) e.date = 'Pick a date';
    if (!v.start) e.start = 'Pick a start time';
    if (!game && !v.title.trim() && !DEFAULT_TITLE[v.type]) e.title = 'Give it a name';
    if (v.title.length > 80) e.title = 'At most 80 characters';
    if (v.opponent.length > 80) e.opponent = 'At most 80 characters';
    if (v.start && v.meet && minutesBetween(v.meet, v.start) < 0)
      e.meet = 'Meet time must be before the start';
    if (v.start && v.finish && minutesBetween(v.start, v.finish) <= 0)
      e.finish = 'Finish must be after the start';
    if (v.locationUrl.trim() && !/^https?:\/\/\S+\.\S+/i.test(v.locationUrl.trim()))
      e.locationUrl = 'Paste a full link, starting with https://';
    if (game) {
      const r = RULES[v.format];
      if (!(v.halfMinutes >= 1 && v.halfMinutes <= 60)) e.halfMinutes = '1 to 60 minutes';
      if (!(v.sinBinMinutes >= 1 && v.sinBinMinutes <= 20)) e.sinBinMinutes = '1 to 20 minutes';
      if (!(v.replacements >= 0 && v.replacements <= r.maxReplacements))
        e.replacements = `0 to ${r.maxReplacements} for ${v.format}`;
    }
    if (v.repeat && !editing) {
      if (!v.weekdays.length) e.weekdays = 'Pick at least one day';
      if (!v.until || v.until < v.date) e.until = 'End date must be after the first session';
      else if (Date.parse(v.until) - Date.parse(v.date) > 366 * 86400e3)
        e.until = 'A series can run for up to a year';
      const dur = v.finish ? minutesBetween(v.start, v.finish) : 90;
      if (dur < 15 || dur > 300) e.finish = 'Sessions run 15 minutes to 5 hours';
    }
    errors = e;
    if (Object.keys(e).length) {
      queueMicrotask(() =>
        document.querySelector<HTMLElement>('#event-form [aria-invalid="true"]')?.focus(),
      );
      return false;
    }
    return true;
  }

  const orNull = (s: string) => (s.trim() ? s.trim() : null);

  async function submit(ev: SubmitEvent) {
    ev.preventDefault();
    if (busy || !validate()) return;
    busy = true;
    const title =
      v.title.trim() ||
      (game && v.opponent.trim() && v.type === 'match'
        ? `v ${v.opponent.trim()}`
        : DEFAULT_TITLE[v.type] || 'Team event');
    const startsAt = zonedToUtc(v.date, v.start, tz);
    const fields = {
      type: v.type,
      title,
      format: game ? v.format : null,
      opponent: game ? orNull(v.opponent) : null,
      startsAt,
      meetAt: v.meet ? zonedToUtc(v.date, v.meet, tz) : null,
      endsAt: v.finish ? zonedToUtc(v.date, v.finish, tz) : null,
      locationName: orNull(v.locationName),
      locationUrl: orNull(v.locationUrl),
      notes: orNull(v.notes),
      rsvpDeadline: v.deadline ? fromLocalInput(v.deadline, tz) : null,
      settings: game
        ? {
            ...(event?.settings ?? {}),
            halfMinutes: v.halfMinutes,
            sinBinMinutes: v.sinBinMinutes,
            replacements: v.replacements,
          }
        : null,
    };
    try {
      if (event) {
        const prevMoved = movedFrom(event.notes);
        if (moved && markMoved) fields.notes = movedNote(event.startsAt, tz, fields.notes);
        else if (prevMoved)
          fields.notes = `Moved from ${prevMoved}.${fields.notes ? `\n${fields.notes}` : ''}`;
        const patch: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(fields)) {
          const cur = (event as Record<string, unknown>)[k];
          if (JSON.stringify(cur ?? null) !== JSON.stringify(val ?? null)) patch[k] = val;
        }
        if (Object.keys(patch).length) await updateEvent(event.id, patch as EventUpdate);
        toasts.success('Saved');
        open = false;
        onsaved?.(event.id);
      } else if (v.repeat && v.type === 'training') {
        const count = await createSeries({
          title,
          locationName: fields.locationName,
          locationUrl: fields.locationUrl,
          notes: fields.notes,
          seasonId: null,
          rule: {
            weekdays: [...v.weekdays].sort(),
            time: v.start,
            durationMin: v.finish ? minutesBetween(v.start, v.finish) : 90,
            meetBeforeMin: v.meet ? minutesBetween(v.meet, v.start) : 0,
            startsOn: v.date,
            until: v.until,
          },
        });
        if (count !== null) {
          toasts.success(`Added ${count} practice${count === 1 ? '' : 's'}`);
          open = false;
          onsaved?.(null);
        }
      } else {
        const id = await createEvent({ ...fields, seasonId: null });
        toasts.success(`${EVENT_TYPE_LABELS[v.type]} added`);
        open = false;
        onsaved?.(id);
      }
    } finally {
      busy = false;
    }
  }

  const typeLabel = (t: EventType) => (t === 'tournament' ? '7s tournament' : EVENT_TYPE_LABELS[t]);
  const sheetTitle = $derived(
    editing
      ? `Edit ${EVENT_TYPE_LABELS[v.type].toLowerCase()}`
      : step === 'pick'
        ? 'Add to schedule'
        : `New ${cat === 'games' ? 'game' : cat === 'practices' ? 'practice' : 'event'}`,
  );
</script>

{#snippet formFooter()}
  <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
  <Button variant="primary" type="submit" form="event-form" loading={busy}>
    {editing
      ? 'Save changes'
      : v.repeat && v.type === 'training'
        ? 'Add series'
        : 'Add to schedule'}
  </Button>
{/snippet}

<Sheet
  bind:open
  footer={step === 'form' ? formFooter : undefined}
  title={sheetTitle}
  description={step === 'pick' ? 'What are you adding?' : `Times are in team time, ${tzLabel}`}
  size="md"
>
  {#if step === 'pick'}
    <ul class="list picks">
      {#each ['games', 'practices', 'events'] as const as c (c)}
        {@const Icon = CATEGORY_ICON[c]}
        <li>
          <button type="button" class="pick {c}" onclick={() => pick(c)}>
            <span class="pi" aria-hidden="true"><Icon /></span>
            <span class="grow">
              <strong>{c === 'games' ? 'Game' : c === 'practices' ? 'Practice' : 'Event'}</strong>
              <small>{CATEGORY_BLURB[c]}</small>
            </span>
            <IconChevronRight />
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <form id="event-form" class="stack form" onsubmit={submit} novalidate>
      {#if !editing}
        <button type="button" class="change" onclick={() => (step = 'pick')}>
          <IconChevronLeft />{EVENT_CATEGORY_LABELS[cat]} · change
        </button>
      {/if}
      {#if typesInCategory(cat).length > 1}
        <fieldset class="kinds">
          <legend>{cat === 'games' ? 'Kind of game' : 'Kind of event'}</legend>
          <div class="row wrap">
            {#each typesInCategory(cat) as t (t)}
              {@const Icon = TYPE_ICON[t]}
              <Chip selected={v.type === t} onclick={() => setType(t)}><Icon />{typeLabel(t)}</Chip>
            {/each}
          </div>
        </fieldset>
      {/if}

      {#if game}
        <Field label="Opponent" error={errors.opponent}>
          {#snippet children({ id, describedby })}
            <input
              {id}
              aria-describedby={describedby}
              aria-invalid={!!errors.opponent}
              bind:value={v.opponent}
              maxlength="80"
              autocomplete="off"
              placeholder={v.type === 'tournament' ? 'Optional' : 'e.g. Old Albanians'}
            />
          {/snippet}
        </Field>
      {/if}
      <Field
        label={game ? 'Title (optional)' : 'Title'}
        error={errors.title}
        hint={game && v.type === 'match' ? 'Leave blank to show “v Opponent”' : undefined}
      >
        {#snippet children({ id, describedby })}
          <input
            {id}
            aria-describedby={describedby}
            aria-invalid={!!errors.title}
            bind:value={v.title}
            maxlength="80"
            autocomplete="off"
            placeholder={game && v.type === 'match'
              ? v.opponent
                ? `v ${v.opponent}`
                : 'v Opponent'
              : DEFAULT_TITLE[v.type] || 'e.g. Kit collection'}
          />
        {/snippet}
      </Field>
      {#if game}
        <div class="fmt">
          <span class="lbl" id="fmt-l">Format</span>
          <Segmented
            label="Format"
            bind:value={() => v.format, (f) => setFormat(f)}
            options={[
              { value: '15s', label: '15s' },
              { value: '7s', label: '7s' },
            ]}
          />
        </div>
      {/if}

      <div class="grid2">
        <Field label="Date" error={errors.date}>
          {#snippet children({ id, describedby })}
            <input
              {id}
              type="date"
              aria-describedby={describedby}
              aria-invalid={!!errors.date}
              bind:value={v.date}
              required
            />
          {/snippet}
        </Field>
        <Field label={game ? 'Kickoff' : 'Starts'} error={errors.start} hint={tzName(tz)}>
          {#snippet children({ id, describedby })}
            <input
              {id}
              type="time"
              aria-describedby={describedby}
              aria-invalid={!!errors.start}
              bind:value={v.start}
              required
            />
          {/snippet}
        </Field>
        <Field label="Meet (optional)" error={errors.meet} hint={tzName(tz)}>
          {#snippet children({ id, describedby })}
            <input
              {id}
              type="time"
              aria-describedby={describedby}
              aria-invalid={!!errors.meet}
              bind:value={v.meet}
            />
          {/snippet}
        </Field>
        <Field label="Finish (optional)" error={errors.finish} hint={tzName(tz)}>
          {#snippet children({ id, describedby })}
            <input
              {id}
              type="time"
              aria-describedby={describedby}
              aria-invalid={!!errors.finish}
              bind:value={v.finish}
            />
          {/snippet}
        </Field>
      </div>

      {#if moved && event}
        <label class="check">
          <input type="checkbox" bind:checked={markMoved} />
          <span
            >Show a “moved” banner (was {day(event.startsAt, tz)}, {time(event.startsAt, tz)})</span
          >
        </label>
      {/if}

      {#if v.type === 'training' && !editing}
        <div class="repeat card">
          <label class="check">
            <input type="checkbox" bind:checked={v.repeat} />
            <span
              ><strong>Repeat every week</strong><br /><small class="muted"
                >Adds a session on each chosen day until the end date</small
              ></span
            >
          </label>
          {#if v.repeat}
            <fieldset class="kinds">
              <legend>On</legend>
              <div class="row wrap days">
                {#each WEEKDAYS as d (d.n)}
                  <Chip selected={v.weekdays.includes(d.n)} onclick={() => toggleDay(d.n)}
                    >{d.l}</Chip
                  >
                {/each}
              </div>
              {#if errors.weekdays}<p class="err" role="alert">{errors.weekdays}</p>{/if}
            </fieldset>
            <Field label="Until" error={errors.until}>
              {#snippet children({ id, describedby })}
                <input
                  {id}
                  type="date"
                  aria-describedby={describedby}
                  aria-invalid={!!errors.until}
                  bind:value={v.until}
                  min={v.date}
                />
              {/snippet}
            </Field>
          {/if}
        </div>
      {/if}

      <Field label="Location (optional)">
        {#snippet children({ id, describedby })}
          <input
            {id}
            aria-describedby={describedby}
            bind:value={v.locationName}
            maxlength="120"
            placeholder="e.g. Woollams Playing Fields"
          />
        {/snippet}
      </Field>
      <Field
        label="Map link (optional)"
        error={errors.locationUrl}
        hint="Paste a Google or Apple Maps link. Without one we search the location name."
      >
        {#snippet children({ id, describedby })}
          <input
            {id}
            type="url"
            inputmode="url"
            aria-describedby={describedby}
            aria-invalid={!!errors.locationUrl}
            bind:value={v.locationUrl}
            placeholder="https://maps.app.goo.gl/…"
          />
        {/snippet}
      </Field>
      <Field label="Notes (optional)" hint="Everyone in the team can see these">
        {#snippet children({ id, describedby })}
          <textarea
            {id}
            aria-describedby={describedby}
            bind:value={v.notes}
            maxlength="1900"
            placeholder={game
              ? 'Kit, bus time, who brings the water…'
              : 'Anything the squad should know'}></textarea>
        {/snippet}
      </Field>
      <Field label="Reply by (optional)" hint="We'll show a deadline on the event · {tzName(tz)}">
        {#snippet children({ id, describedby })}
          <input
            {id}
            type="datetime-local"
            aria-describedby={describedby}
            bind:value={v.deadline}
          />
        {/snippet}
      </Field>

      {#if game}
        <details class="settings card" open={editing}>
          <summary
            >Match settings <small class="muted"
              >{v.halfMinutes} min halves · {v.sinBinMinutes} min sin-bin · {v.replacements} reps</small
            ></summary
          >
          <div class="grid3">
            <Field label="Half length (min)" error={errors.halfMinutes}>
              {#snippet children({ id, describedby })}
                <input
                  {id}
                  type="number"
                  inputmode="numeric"
                  min="1"
                  max="60"
                  aria-describedby={describedby}
                  aria-invalid={!!errors.halfMinutes}
                  bind:value={v.halfMinutes}
                  oninput={() => (settingsTouched = true)}
                />
              {/snippet}
            </Field>
            <Field label="Sin-bin (min)" error={errors.sinBinMinutes}>
              {#snippet children({ id, describedby })}
                <input
                  {id}
                  type="number"
                  inputmode="numeric"
                  min="1"
                  max="20"
                  aria-describedby={describedby}
                  aria-invalid={!!errors.sinBinMinutes}
                  bind:value={v.sinBinMinutes}
                  oninput={() => (settingsTouched = true)}
                />
              {/snippet}
            </Field>
            <Field label="Replacements" error={errors.replacements}>
              {#snippet children({ id, describedby })}
                <input
                  {id}
                  type="number"
                  inputmode="numeric"
                  min="0"
                  max={RULES[v.format].maxReplacements}
                  aria-describedby={describedby}
                  aria-invalid={!!errors.replacements}
                  bind:value={v.replacements}
                  oninput={() => (settingsTouched = true)}
                />
              {/snippet}
            </Field>
          </div>
        </details>
      {/if}
    </form>
  {/if}
</Sheet>

<style>
  .picks {
    display: grid;
    gap: var(--s-3);
  }
  .pick {
    display: flex;
    align-items: center;
    gap: var(--s-4);
    width: 100%;
    min-height: 76px;
    padding: var(--s-4);
    text-align: left;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-lg);
    background: var(--surface);
    transition:
      border-color var(--m-fast) var(--ease),
      background var(--m-fast) var(--ease);
  }
  .pick:hover {
    background: var(--surface-2);
    border-color: var(--cat);
  }
  .pick strong {
    display: block;
    font-size: 1.0625rem;
  }
  .pick small {
    color: var(--text-2);
    font-size: var(--t-14);
  }
  .pick > :global(svg) {
    width: 18px;
    height: 18px;
    color: var(--text-3);
  }
  .pi {
    display: grid;
    place-items: center;
    flex: none;
    width: 48px;
    height: 48px;
    background: var(--cat-soft);
    color: var(--cat);
  }
  .pi :global(svg) {
    width: 24px;
    height: 24px;
  }
  /* Shape carries meaning too: games square-ish, practices round, events diamond-cut. */
  .games {
    --cat: light-dark(#a1480a, #f6b25e);
    --cat-soft: light-dark(#fdf0e1, #3a2a14);
  }
  .games .pi {
    border-radius: var(--r-md);
  }
  .practices {
    --cat: var(--accent-text);
    --cat-soft: var(--accent-soft);
  }
  .practices .pi {
    border-radius: 50%;
  }
  .events {
    --cat: var(--info);
    --cat-soft: var(--info-soft);
  }
  .events .pi {
    border-radius: 50% 50% 50% var(--r-sm);
  }
  .form {
    gap: var(--s-4);
  }
  .change {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    align-self: flex-start;
    min-height: 44px;
    padding: 0 var(--s-2) 0 0;
    border: 0;
    background: none;
    font-weight: 650;
    color: var(--accent-text);
  }
  .change :global(svg) {
    width: 18px;
    height: 18px;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  legend,
  .lbl {
    font-size: var(--t-14);
    font-weight: 650;
    margin-bottom: 6px;
    padding: 0;
  }
  .fmt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--s-4) var(--s-3);
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--s-3);
    margin-top: var(--s-3);
  }
  @media (max-width: 420px) {
    .grid3 {
      grid-template-columns: 1fr 1fr;
    }
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: var(--s-3);
    font-size: var(--t-14);
    min-height: 44px;
    cursor: pointer;
  }
  .check input {
    width: 22px;
    height: 22px;
    margin: 2px 0 0;
    accent-color: var(--accent);
    flex: none;
  }
  .repeat,
  .settings {
    padding: var(--s-4);
    display: grid;
    gap: var(--s-3);
    box-shadow: none;
    background: var(--surface-2);
  }
  .days :global(button) {
    min-width: 52px;
  }
  .err {
    margin-top: 6px;
    font-size: var(--t-12);
    color: var(--danger);
    font-weight: 600;
  }
  summary {
    cursor: pointer;
    font-weight: 650;
    min-height: 32px;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-2);
  }
  summary small {
    font-weight: 500;
    font-size: var(--t-12);
  }
</style>
