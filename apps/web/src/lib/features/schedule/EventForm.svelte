<!--
  Create / edit an event in a bottom sheet. Creating starts with a clear choice of Game, Practice or
  Event, then the form adapts: opponent, format and match settings for games, weekly repeat for
  practices. All times are entered in the team's timezone, which is always shown.
  Games and events can be "Not confirmed yet": one date (tentative) or up to four (a date poll),
  with sensible defaults for when answers are due and how many players are needed.
-->
<script lang="ts">
  import {
    EVENT_CATEGORY_LABELS,
    EVENT_TYPE_LABELS,
    RULES,
    eventCategory,
    isGame,
    isRepeatable,
    typesInCategory,
    addDays,
    weekdayOf,
    zonedToUtc,
    MAX_OPTIONS,
    canPropose,
    canTimeTbd,
    eventTimeLabel,
    isTimeTbd,
    tbdStartsAt,
    defaultAnswerBy,
    proposalTarget,
    uuidv7,
    type ProposalOption,
    type EventCategory,
    type EventType,
    type EventUpdate,
    type Format,
    type Recurrence,
    type RepeatableType,
    type TeamEvent,
  } from '@phaseplay/shared';
  import { app } from '#lib/data/app.svelte';
  import Sheet from '#lib/components/Sheet.svelte';
  import Field from '#lib/components/Field.svelte';
  import Button from '#lib/components/Button.svelte';
  import Chip from '#lib/components/Chip.svelte';
  import Segmented from '#lib/components/Segmented.svelte';
  import { fromLocalInput, toLocalInput, tzName, day, plural } from '#lib/format';
  import { toasts } from '#lib/stores/toast.svelte';
  import { IconChevronLeft, IconChevronRight, IconPlus, IconX } from '#lib/icons';
  import { events as schedule, optionsOf } from '#lib/data/selectors';
  import { CATEGORY_ICON, CATEGORY_BLURB, TYPE_ICON } from './category';
  import {
    createEvent,
    createSeries,
    deleteSeries,
    loadSeries,
    updateEvent,
    updateSeries,
  } from './actions.svelte';
  import {
    addMinutes,
    hhmm,
    isMove,
    minutesBetween,
    movedFrom,
    movedNote,
    nextWeekday,
    notesBody,
    usualStart,
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
  /** Editing a session that belongs to a weekly series: change just it, or every upcoming one. */
  let scope = $state<'one' | 'series'>('one');
  let series = $state<Recurrence | null>(null);
  let loadingSeries = $state(false);
  let confirmDeleteSeries = $state(false);
  const inSeries = $derived(!!event?.recurrenceId);

  /* "Not confirmed yet": the first date is the main date and time; extra dates add a poll. */
  type ExtraDate = {
    key: string;
    optionId: string | null;
    date: string;
    start: string;
    /** This date's time is still to be decided. */
    tbd: boolean;
  };
  let proposed = $state(false);
  let firstOptionId = $state<string | null>(null);
  let extra = $state<ExtraDate[]>([]);
  let moreOpen = $state(false);
  let answerBy = $state('');
  let answerByTouched = $state(false);
  let targetValue = $state(20);
  let targetTouched = $state(false);
  let checkPositions = $state(true);
  /** Saving would clear answers on dates that were removed or moved to another day. */
  let lossNote = $state<string | null>(null);
  const editingProposal = $derived(!!event && event.status === 'proposed');
  const seriesMode = $derived(inSeries && scope === 'series' && !!series);

  async function chooseScope(next: 'one' | 'series') {
    scope = next;
    if (next !== 'series' || !event?.recurrenceId) return;
    if (!series) {
      loadingSeries = true;
      series = await loadSeries(event.recurrenceId);
      loadingSeries = false;
      if (!series) {
        scope = 'one';
        return;
      }
    }
    // Show the series' own pattern: its days, times and end date.
    const r = series.rule;
    v.weekdays = [...r.weekdays];
    v.until = r.until;
    v.start = r.time;
    v.finish = addMinutes(r.time, r.durationMin);
    v.meet = r.meetBeforeMin ? addMinutes(r.time, -r.meetBeforeMin) : '';
    v.title = series.title;
    v.locationName = series.locationName ?? '';
    v.locationUrl = series.locationUrl ?? '';
    v.notes = series.notes ?? '';
    v.type = series.type;
    errors = {};
  }

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
      tbd: false,
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
      tbd: isTimeTbd(e),
      start: isTimeTbd(e) ? '' : hhmm(e.startsAt, tz),
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
      scope = 'one';
      series = null;
      confirmDeleteSeries = false;
      proposed = false;
      firstOptionId = null;
      extra = [];
      moreOpen = false;
      answerBy = '';
      answerByTouched = false;
      targetTouched = false;
      checkPositions = true;
      lossNote = null;
      stash = null;
      if (event) {
        v = fromEvent(event);
        if (event.status === 'proposed') loadProposal(event);
        step = 'form';
      } else if (category) {
        v = blank(category);
        step = 'form';
      } else step = 'pick';
    }
    wasOpen = open;
  });

  function loadProposal(e: TeamEvent) {
    proposed = true;
    const opts = optionsOf(app.snap, e.id);
    const [first, ...rest] = opts;
    if (first) {
      firstOptionId = first.id;
      v.date = dateInTz(first.startsAt, tz);
      v.tbd = isTimeTbd(first);
      v.start = isTimeTbd(first) ? '' : hhmm(first.startsAt, tz);
      v.meet = first.meetAt ? hhmm(first.meetAt, tz) : '';
      v.finish = first.endsAt ? hhmm(first.endsAt, tz) : '';
    }
    extra = rest.map((o) => ({
      key: o.id,
      optionId: o.id,
      date: dateInTz(o.startsAt, tz),
      start: isTimeTbd(o) ? '' : hhmm(o.startsAt, tz),
      tbd: isTimeTbd(o),
    }));
    if (e.answerBy) {
      answerBy = dateInTz(e.answerBy, tz);
      answerByTouched = true;
    }
    if (e.target !== null) {
      targetValue = e.target;
      targetTouched = true;
    }
    checkPositions = e.checkPositions !== false;
  }

  const cat = $derived(eventCategory(v.type));
  const game = $derived(isGame(v.type));
  const tzLabel = $derived(`${tzName(tz, Date.now())} (${tz.replace(/_/g, ' ')})`);
  /** "Time TBD" is offered for games and events (never practices or weekly series). */
  const tbdAllowed = $derived(
    canTimeTbd(v.type) && !seriesMode && !inSeries && !(v.repeat && !editing),
  );
  const tbd = $derived(tbdAllowed && v.tbd);
  /** When a date (and time) starts in UTC: local noon while the time is TBD. */
  const startOf = (date: string, start: string, isTbd: boolean) =>
    !date ? null : isTbd ? tbdStartsAt(date, tz) : start ? zonedToUtc(date, start, tz) : null;
  const newStart = $derived(startOf(v.date, v.start, tbd));
  const moved = $derived(
    !!event &&
      !editingProposal &&
      newStart !== null &&
      isMove(event, { startsAt: newStart, timeTbd: tbd }, tz),
  );
  const proposable = $derived(canPropose(v.type) && !seriesMode && (!editing || editingProposal));
  const asProposal = $derived(proposable && proposed);
  const teamTarget = $derived(proposalTarget(app.team?.proposalTargets, v.format, null));
  const target = $derived(targetTouched ? targetValue : teamTarget);
  const allStarts = $derived(
    [newStart, ...extra.map((x) => startOf(x.date, x.start, x.tbd))]
      .filter((x): x is number => x !== null)
      .sort((a, b) => a - b),
  );
  const answerByDefault = $derived(
    allStarts[0] ? dateInTz(defaultAnswerBy(Date.now(), allStarts[0]), tz) : '',
  );
  const answerByShown = $derived(answerByTouched && answerBy ? answerBy : answerByDefault);
  const dayLabel = (date: string) => (date ? day(zonedToUtc(date, '12:00', tz), tz) : '');
  const defaultsLine = $derived(
    [
      answerByShown ? `Answers by ${dayLabel(answerByShown)}` : '',
      game ? `need ${target}` : '',
      game && checkPositions ? 'checks front row' : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
  // Keep the default target in step with the format until someone changes it.
  $effect(() => {
    if (!targetTouched) targetValue = teamTarget;
  });

  /**
   * "Time TBD" on: the time, meet and finish fields go (kept here in case it's switched back off).
   * Off: they come back, or the team's usual start for this kind of event, else empty (required).
   */
  let stash: { start: string; meet: string; finish: string } | null = null;
  const usual = () => usualStart(schedule(app.snap), v.type, tz) ?? '';
  function setTbd(on: boolean) {
    if (on === v.tbd) return;
    v.tbd = on;
    if (on) {
      stash = { start: v.start, meet: v.meet, finish: v.finish };
      v.start = v.meet = v.finish = '';
      delete errors.start;
      delete errors.meet;
      delete errors.finish;
    } else {
      v.start = stash?.start || usual();
      v.meet = stash?.meet ?? '';
      v.finish = stash?.finish ?? '';
    }
  }
  function setExtraTbd(x: ExtraDate, on: boolean) {
    x.tbd = on;
    x.start = on ? '' : v.start || usual();
    lossNote = null;
  }

  function addDate() {
    if (extra.length + 1 >= MAX_OPTIONS) return;
    const last = extra.at(-1)?.date || v.date;
    extra = [
      ...extra,
      {
        key: crypto.randomUUID(),
        optionId: null,
        date: last ? addDays(last, 7) : '',
        start: extra.at(-1)?.start || v.start,
        tbd: extra.at(-1)?.tbd ?? tbd,
      },
    ];
    queueMicrotask(() =>
      document.querySelector<HTMLElement>(`#event-form .extra li:last-child input`)?.focus(),
    );
  }
  function removeDate(key: string) {
    extra = extra.filter((x) => x.key !== key);
    lossNote = null;
  }

  /** The dates as the API takes them. A date moved to another day is a new date (fresh answers). */
  function buildOptions(): ProposalOption[] {
    const prev = event ? optionsOf(app.snap, event.id) : [];
    const sameDay = (id: string | null, date: string) =>
      !!id && prev.some((o) => o.id === id && dateInTz(o.startsAt, tz) === date);
    const offset = (hm: string) => (hm ? minutesBetween(v.start, hm) * 60e3 : null);
    const meetOff = !tbd ? offset(v.meet) : null;
    const endOff = !tbd ? offset(v.finish) : null;
    const make = (
      id: string | null,
      date: string,
      start: string,
      isTbd: boolean,
    ): ProposalOption => {
      const startsAt = startOf(date, start, isTbd)!;
      return {
        id: sameDay(id, date) ? id! : uuidv7(),
        startsAt,
        meetAt: !isTbd && meetOff !== null ? startsAt + meetOff : null,
        endsAt: !isTbd && endOff !== null ? startsAt + endOff : null,
        timeTbd: isTbd,
      };
    };
    return [
      make(firstOptionId, v.date, v.start, tbd),
      ...extra.map((x) => make(x.optionId, x.date, x.start, canTimeTbd(v.type) && x.tbd)),
    ];
  }

  /** Answers that saving would clear (dates removed, or moved to another day). */
  function answersLost(next: ProposalOption[]): string | null {
    if (!event) return null;
    const keep = new Set(next.map((o) => o.id));
    const gone = optionsOf(app.snap, event.id)
      .filter((o) => !keep.has(o.id))
      .map((o) => {
        const c = app.snap?.rows.answerCounts?.[o.id];
        return { o, n: c ? c.in + c.cant : 0 };
      })
      .filter((x) => x.n > 0);
    if (!gone.length) return null;
    const n = gone.reduce((a, x) => a + x.n, 0);
    return `${gone.map((x) => day(x.o.startsAt, tz)).join(' and ')} ${
      gone.length === 1 ? 'has' : 'have'
    } ${plural(n, 'answer')}. Saving clears ${n === 1 ? 'it' : 'them'}.`;
  }

  function pick(c: EventCategory) {
    v = blank(c);
    step = 'form';
  }
  function setType(t: EventType) {
    const prevFmt = v.format;
    v.type = t;
    if (!canTimeTbd(t)) setTbd(false);
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
    if (!v.date && !seriesMode) e.date = 'Pick a date';
    if (!v.start && !tbd) e.start = 'Pick a start time';
    if (!game && !v.title.trim() && !DEFAULT_TITLE[v.type]) e.title = 'Give it a name';
    if (v.title.length > 80) e.title = 'At most 80 characters';
    if (v.opponent.length > 80) e.opponent = 'At most 80 characters';
    if (!tbd && v.start && v.meet && minutesBetween(v.meet, v.start) < 0)
      e.meet = 'Meet time must be before the start';
    if (!tbd && v.start && v.finish && minutesBetween(v.start, v.finish) <= 0)
      e.finish = 'Finish must be after the start';
    if (asProposal) {
      extra.forEach((x, i) => {
        if (!x.date) e[`extra${i}`] = 'Pick a date';
        else if (!x.start && !x.tbd) e[`extra${i}`] = 'Pick a time, or Time TBD';
      });
      const keys = [
        `${v.date} ${tbd ? 'tbd' : v.start}`,
        ...extra.map((x) => `${x.date} ${x.tbd ? 'tbd' : x.start}`),
      ];
      const dup = keys.findIndex((k, i) => keys.indexOf(k) !== i);
      if (dup > 0) e[`extra${dup - 1}`] = 'That date is already on the list';
      if (game && !(targetValue >= 1 && targetValue <= 99)) e.target = '1 to 99 players';
      if (answerByTouched && answerBy && allStarts[0] && answerBy > dateInTz(allStarts.at(-1)!, tz))
        e.answerBy = 'Answers are due before the last date';
    }
    if (v.locationUrl.trim() && !/^https?:\/\/\S+\.\S+/i.test(v.locationUrl.trim()))
      e.locationUrl = 'Paste a full link, starting with https://';
    if (game) {
      const r = RULES[v.format];
      if (!(v.halfMinutes >= 1 && v.halfMinutes <= 60)) e.halfMinutes = '1 to 60 minutes';
      if (!(v.sinBinMinutes >= 1 && v.sinBinMinutes <= 20)) e.sinBinMinutes = '1 to 20 minutes';
      if (!(v.replacements >= 0 && v.replacements <= r.maxReplacements))
        e.replacements = `0 to ${r.maxReplacements} for ${v.format}`;
    }
    if ((v.repeat && !editing) || seriesMode) {
      const first = seriesMode ? series!.rule.startsOn : v.date;
      if (!v.weekdays.length) e.weekdays = 'Pick at least one day';
      if (!v.until || v.until < first) e.until = 'End date must be after the first session';
      else if (Date.parse(v.until) - Date.parse(first) > 366 * 86400e3)
        e.until = 'A series can run for up to a year from its first session';
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
        : asProposal && v.type === 'match'
          ? 'v TBC'
          : DEFAULT_TITLE[v.type] || 'Team event');
    // "Time TBD": local noon of the date, no meet or finish (packages/shared event-time.ts).
    const startsAt = startOf(v.date, v.start, tbd)!;
    const fields = {
      type: v.type,
      title,
      format: game ? v.format : null,
      opponent: game ? orNull(v.opponent) : null,
      startsAt,
      timeTbd: tbd,
      meetAt: !tbd && v.meet ? zonedToUtc(v.date, v.meet, tz) : null,
      endsAt: !tbd && v.finish ? zonedToUtc(v.date, v.finish, tz) : null,
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
    // A proposal stays one until it's confirmed or dropped (never a practice, never via a plain edit).
    if (editingProposal && !asProposal) {
      toasts.error(
        'Confirm or drop it first: a game or event that is not confirmed yet can’t become a practice.',
      );
      busy = false;
      return;
    }
    // Proposal extras: the dates, when answers are due, players needed and the position check.
    const options = asProposal ? buildOptions() : null;
    if (options && editing && !lossNote) {
      const lost = answersLost(options);
      if (lost) {
        lossNote = lost;
        busy = false;
        return;
      }
    }
    const answerByMs =
      asProposal && answerByTouched && answerBy ? zonedToUtc(answerBy, '21:00', tz) : undefined;
    const proposal = options
      ? {
          options,
          ...(answerByMs !== undefined ? { answerBy: answerByMs } : {}),
          target: game && targetTouched && targetValue !== teamTarget ? targetValue : null,
          checkPositions: game ? checkPositions : true,
        }
      : null;
    if (proposal) {
      fields.rsvpDeadline = null;
      fields.startsAt = Math.min(...options!.map((o) => o.startsAt));
    }
    try {
      if (event && editingProposal && proposal) {
        const patch: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(fields)) {
          if (k === 'startsAt' || k === 'meetAt' || k === 'endsAt' || k === 'timeTbd') continue;
          const cur = (event as Record<string, unknown>)[k];
          if (JSON.stringify(cur ?? null) !== JSON.stringify(val ?? null)) patch[k] = val;
        }
        const prev = optionsOf(app.snap, event.id).map((o) => ({
          id: o.id,
          startsAt: o.startsAt,
          meetAt: o.meetAt,
          endsAt: o.endsAt,
          timeTbd: isTimeTbd(o),
        }));
        const sorted = [...proposal.options].sort((a, b) => a.startsAt - b.startsAt);
        if (JSON.stringify(prev) !== JSON.stringify(sorted)) patch.options = proposal.options;
        if (proposal.answerBy !== undefined && proposal.answerBy !== event.answerBy)
          patch.answerBy = proposal.answerBy;
        if (proposal.target !== event.target) patch.target = proposal.target;
        if (proposal.checkPositions !== event.checkPositions)
          patch.checkPositions = proposal.checkPositions;
        if (Object.keys(patch).length) await updateEvent(event.id, patch as EventUpdate);
        toasts.success('Saved');
        open = false;
        onsaved?.(event.id);
      } else if (proposal) {
        const id = await createEvent({
          ...fields,
          seasonId: null,
          status: 'proposed',
          ...proposal,
        });
        toasts.success(
          options!.length > 1
            ? `Date poll added: ${plural(options!.length, 'date')} to pick from`
            : 'Added as not confirmed yet',
        );
        open = false;
        onsaved?.(id);
      } else if (event?.recurrenceId && seriesMode && series) {
        const res = await updateSeries(event.recurrenceId, {
          type: v.type as RepeatableType,
          title,
          locationName: fields.locationName,
          locationUrl: fields.locationUrl,
          notes: fields.notes,
          rule: {
            weekdays: [...v.weekdays].sort(),
            time: v.start,
            durationMin: v.finish ? minutesBetween(v.start, v.finish) : series.rule.durationMin,
            meetBeforeMin: v.meet ? minutesBetween(v.meet, v.start) : 0,
            startsOn: series.rule.startsOn,
            until: v.until,
          },
        });
        if (res) {
          const bits = [
            `${res.updated} updated`,
            res.added ? `${res.added} added` : '',
            res.removed ? `${res.removed} removed` : '',
          ].filter(Boolean);
          toasts.success(`Series saved: ${bits.join(', ')}`);
          open = false;
          onsaved?.(res.updated ? event.id : null);
        }
      } else if (event) {
        const prevMoved = movedFrom(event.notes);
        if (moved && markMoved) fields.notes = movedNote(event, tz, fields.notes);
        else if (prevMoved)
          fields.notes = `Moved from ${prevMoved}.${fields.notes ? `\n${fields.notes}` : ''}`;
        const patch: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(fields)) {
          // Older cached rows have no timeTbd: that's "has a time".
          const cur = k === 'timeTbd' ? isTimeTbd(event) : (event as Record<string, unknown>)[k];
          if (JSON.stringify(cur ?? null) !== JSON.stringify(val ?? null)) patch[k] = val;
        }
        if (Object.keys(patch).length) await updateEvent(event.id, patch as EventUpdate);
        toasts.success('Saved');
        open = false;
        onsaved?.(event.id);
      } else if (v.repeat && isRepeatable(v.type)) {
        const count = await createSeries({
          type: v.type,
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
          const noun = v.type === 'training' ? 'practice' : 'event';
          toasts.success(`Added ${count} ${noun}${count === 1 ? '' : 's'}`);
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
    {seriesMode
      ? 'Save series'
      : editing
        ? lossNote
          ? 'Save anyway'
          : 'Save changes'
        : asProposal
          ? extra.length
            ? 'Add date poll'
            : 'Add as not confirmed'
          : v.repeat && isRepeatable(v.type)
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
      {#if inSeries}
        <div class="scope">
          <Segmented
            label="Change"
            bind:value={() => scope, (x) => void chooseScope(x)}
            options={[
              { value: 'one', label: 'This session' },
              { value: 'series', label: 'All upcoming' },
            ]}
          />
          <p class="subtle" aria-live="polite">
            {#if loadingSeries}Loading the series…{:else if seriesMode}Changes apply to every
              upcoming session in this weekly series. Past sessions stay as they were.{:else}Only
              this date changes; the rest of the series stays the same.{/if}
          </p>
        </div>
      {/if}
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

      {#if proposable && !editing}
        <div class="status">
          <Segmented
            label="Is it on?"
            bind:value={
              () => (proposed ? 'proposed' : 'confirmed'), (x) => (proposed = x === 'proposed')
            }
            options={[
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'proposed', label: 'Not confirmed yet' },
            ]}
          />
          {#if proposed}
            <p class="subtle">
              The squad says if they can make it. Add more dates to find the one that works best.
            </p>
          {/if}
        </div>
      {/if}

      <div class="grid2" class:has-tbd={tbdAllowed}>
        {#if !seriesMode}
          <Field label={asProposal && extra.length ? 'Date 1' : 'Date'} error={errors.date}>
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
        {/if}
        {#if !tbd}
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
        {/if}
        {#if tbdAllowed}
          <!-- One control, always in the same place so focus stays on it when it's toggled. -->
          <label class="check tbd" class:on={tbd}>
            <input
              type="checkbox"
              checked={tbd}
              onchange={(ev) => setTbd(ev.currentTarget.checked)}
            />
            <span
              ><strong>Time TBD</strong>{#if tbd}<br /><small class="muted"
                  >Set the {game ? 'kickoff' : 'time'} later</small
                >{/if}</span
            >
          </label>
        {/if}
        {#if !tbd}
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
        {/if}
      </div>

      {#if moved && event && !seriesMode}
        <label class="check">
          <input type="checkbox" bind:checked={markMoved} />
          <span
            >Show a “moved” banner (was {day(event.startsAt, tz)}, {eventTimeLabel(
              event,
              tz,
            )})</span
          >
        </label>
      {/if}

      {#if asProposal}
        {#if extra.length}
          <ol class="list extra" aria-label="More dates">
            {#each extra as x, i (x.key)}
              <li class:has-tbd={canTimeTbd(v.type)}>
                <Field label="Date {i + 2}" error={errors[`extra${i}`]}>
                  {#snippet children({ id, describedby })}
                    <input
                      {id}
                      type="date"
                      aria-describedby={describedby}
                      aria-invalid={!!errors[`extra${i}`]}
                      bind:value={x.date}
                      onchange={() => (lossNote = null)}
                    />
                  {/snippet}
                </Field>
                {#if !x.tbd}
                  <Field label={game ? 'Kickoff' : 'Starts'}>
                    {#snippet children({ id, describedby })}
                      <input {id} type="time" aria-describedby={describedby} bind:value={x.start} />
                    {/snippet}
                  </Field>
                {/if}
                {#if canTimeTbd(v.type)}
                  <label class="check tbd" class:on={x.tbd}>
                    <input
                      type="checkbox"
                      checked={x.tbd}
                      onchange={(ev) => setExtraTbd(x, ev.currentTarget.checked)}
                    />
                    <span>Time TBD<span class="sr-only">{` for date ${i + 2}`}</span></span>
                  </label>
                {/if}
                <button
                  type="button"
                  class="rm"
                  aria-label="Remove date {i + 2}{x.date ? `, ${dayLabel(x.date)}` : ''}"
                  onclick={() => removeDate(x.key)}><IconX /></button
                >
              </li>
            {/each}
          </ol>
        {/if}
        {#if extra.length + 1 < MAX_OPTIONS}
          <button type="button" class="change add" onclick={addDate}
            ><IconPlus />Add another date</button
          >
        {/if}
        <div class="defaults">
          <p>
            <span>{defaultsLine}</span>
            <button
              type="button"
              class="change"
              aria-expanded={moreOpen}
              aria-controls="prop-more"
              onclick={() => (moreOpen = !moreOpen)}>{moreOpen ? 'Done' : 'Change'}</button
            >
          </p>
          {#if moreOpen}
            <div class="grid2" id="prop-more">
              <Field
                label="Answers by"
                error={errors.answerBy}
                hint="We remind anyone who hasn't answered two days before"
              >
                {#snippet children({ id, describedby })}
                  <input
                    {id}
                    type="date"
                    aria-describedby={describedby}
                    aria-invalid={!!errors.answerBy}
                    value={answerByShown}
                    oninput={(ev) => {
                      answerBy = (ev.currentTarget as HTMLInputElement).value;
                      answerByTouched = true;
                    }}
                  />
                {/snippet}
              </Field>
              {#if game}
                <Field
                  label="Players needed"
                  error={errors.target}
                  hint="Team default for {v.format}: {teamTarget}"
                >
                  {#snippet children({ id, describedby })}
                    <input
                      {id}
                      type="number"
                      inputmode="numeric"
                      min="1"
                      max="99"
                      aria-describedby={describedby}
                      aria-invalid={!!errors.target}
                      bind:value={targetValue}
                      oninput={() => (targetTouched = true)}
                    />
                  {/snippet}
                </Field>
              {/if}
            </div>
            {#if game}
              <label class="check">
                <input type="checkbox" bind:checked={checkPositions} />
                <span
                  ><strong>Check the front row</strong><br /><small class="muted"
                    >Flags a date without enough props and hookers among those who are in</small
                  ></span
                >
              </label>
              <p class="subtle">No opponent yet? Leave it blank and it shows as “v TBC”.</p>
            {/if}
          {/if}
        </div>
        {#if lossNote}
          <p class="loss" role="alert">{lossNote}</p>
        {/if}
      {/if}

      {#if !asProposal && !tbd && ((isRepeatable(v.type) && !editing) || seriesMode)}
        <div class="repeat card">
          {#if seriesMode}
            <p class="series-h"><strong>Repeats every week</strong></p>
          {:else}
            <label class="check">
              <input type="checkbox" bind:checked={v.repeat} />
              <span
                ><strong>Repeat every week</strong><br /><small class="muted"
                  >Adds one on each chosen day until the end date</small
                ></span
              >
            </label>
          {/if}
          {#if v.repeat || seriesMode}
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
            <Field
              label="Ends on"
              error={errors.until}
              hint={seriesMode
                ? 'Pick an earlier date to stop the series, or a later one to extend it.'
                : 'The last week it repeats. You can change it later.'}
            >
              {#snippet children({ id, describedby })}
                <input
                  {id}
                  type="date"
                  aria-describedby={describedby}
                  aria-invalid={!!errors.until}
                  bind:value={v.until}
                  min={seriesMode ? undefined : v.date}
                />
              {/snippet}
            </Field>
            {#if seriesMode}
              {#if confirmDeleteSeries}
                <div class="row wrap del" role="group" aria-label="Delete the series">
                  <span>Remove all {series?.upcoming} upcoming sessions?</span>
                  <Button size="sm" variant="ghost" onclick={() => (confirmDeleteSeries = false)}
                    >Keep</Button
                  >
                  <Button
                    size="sm"
                    variant="danger"
                    onclick={async () => {
                      if (event?.recurrenceId && (await deleteSeries(event.recurrenceId))) {
                        toasts.show('Series removed');
                        open = false;
                        onsaved?.(null);
                      }
                    }}>Remove them</Button
                  >
                </div>
              {:else}
                <Button size="sm" variant="ghost" onclick={() => (confirmDeleteSeries = true)}
                  >Delete all upcoming sessions</Button
                >
              {/if}
            {/if}
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
      {#if !seriesMode && !asProposal}
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
      {/if}

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
  .scope,
  .status {
    display: grid;
    gap: var(--s-2);
  }
  .status p {
    margin: 0;
  }
  .extra {
    display: grid;
    gap: var(--s-3);
  }
  .extra li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 44px;
    gap: var(--s-1) var(--s-3);
    align-items: end;
  }
  /*
   * "Time TBD" sits under the date and time; once it's on, it takes the time's place. Explicit
   * placement keeps it the same element (and focus) either way.
   */
  .grid2.has-tbd > .tbd,
  .extra li.has-tbd > .tbd {
    grid-row: 2;
    grid-column: 1 / -1;
    margin-top: calc(-1 * var(--s-2));
  }
  .grid2.has-tbd > .tbd.on,
  .extra li.has-tbd > .tbd.on {
    grid-row: 1;
    grid-column: 2;
    align-self: end;
    margin-top: 0;
    padding: 11px 0 0;
  }
  .extra li.has-tbd > .rm {
    grid-row: 1;
    grid-column: 3;
  }
  .extra li.has-tbd > .tbd {
    margin-top: 0;
  }
  .rm {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    color: var(--text-2);
  }
  .rm :global(svg) {
    width: 18px;
    height: 18px;
  }
  .add {
    margin-top: calc(-1 * var(--s-2));
  }
  .defaults {
    display: grid;
    gap: var(--s-3);
    padding: var(--s-3) var(--s-4);
    border: 1.5px dashed var(--tent-line);
    border-radius: var(--r-md);
    background: var(--tent-fill);
  }
  .defaults > p {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-1) var(--s-3);
    margin: 0;
    font-size: var(--t-14);
    font-weight: 600;
  }
  .defaults .change {
    min-height: 44px;
  }
  .loss {
    margin: 0;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-md);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: var(--t-14);
    font-weight: 600;
  }
  .scope p,
  .series-h {
    margin: 0;
  }
  .del {
    align-items: center;
    gap: var(--s-2);
  }
  .grid2 {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--s-4) var(--s-3);
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s-3);
    margin-top: var(--s-3);
  }
  @media (max-width: 420px) {
    .grid3 {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
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
