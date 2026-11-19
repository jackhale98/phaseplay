import type { Context, Hono } from 'hono';
import {
  AttendancePut,
  PROPOSAL_REMIND_BEFORE_MS,
  byStart,
  defaultAnswerBy,
  type ProposalOption,
  EventCreate,
  EventUpdate,
  RSVP_NOTE_TTL_MS,
  RecurrenceCreate,
  RecurrenceUpdate,
  dateInTz,
  type Recurrence,
  type RecurrenceRule,
  RsvpPut,
  SeasonInput,
  can,
  canPropose,
  canTimeTbd,
  stillToCome,
  tbdStartsAt,
  timeChangeText,
  type EventType,
  uuidv7,
  weeklyDates,
  zonedToUtc,
  type EventCreate as EventCreateT,
  type TeamEvent,
} from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, forbidden, ifMatch, notFound, now, parseJson } from '../lib/http';
import { EVENT_COLS, eventFromRow } from '../db/rows';
import { auditStmt } from '../lib/audit';
import { flushNotifications, localeOf, notifyStmt } from '../lib/notify';
import {
  eventCancelled,
  eventChanged,
  eventCreated,
  eventRestored,
  proposalCreated,
  proposalDropped,
  seriesChanged,
  seriesCreated,
  seriesRemoved,
  type EventInfo,
} from '../lib/push/messages';

type EventFields = Omit<EventCreateT, 'id' | 'status' | 'options'> & { id: string };
/** Proposal columns for a new event (confirmed events keep the defaults). */
type ProposalCols = { answerBy: number; remindedAt: number | null };

export function insertEventStmt(
  db: D1Database,
  teamId: string,
  userId: string | null,
  e: EventFields,
  recurrenceId: string | null,
  t: number,
  returning = '',
  proposal: ProposalCols | null = null,
) {
  return db
    .prepare(
      `INSERT INTO events (id, team_id, season_id, type, format, title, starts_at, meet_at, ends_at, location_name,
        location_url, opponent, notes, rsvp_deadline, recurrence_id, settings, version, created_by, updated_at,
        status, answer_by, target, check_positions, proposal_reminded_at, time_tbd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING ${returning}`,
    )
    .bind(
      e.id,
      teamId,
      e.seasonId ?? null,
      e.type,
      e.format ?? null,
      e.title,
      e.startsAt,
      e.meetAt ?? null,
      e.endsAt ?? null,
      e.locationName ?? null,
      e.locationUrl ?? null,
      e.opponent ?? null,
      e.notes ?? null,
      e.rsvpDeadline ?? null,
      recurrenceId,
      e.settings ? JSON.stringify(e.settings) : null,
      userId,
      t,
      proposal ? 'proposed' : 'confirmed',
      proposal?.answerBy ?? null,
      proposal ? (e.target ?? null) : null,
      e.checkPositions === false ? 0 : 1,
      proposal?.remindedAt ?? null,
      e.timeTbd ? 1 : 0,
    );
}

/**
 * Upsert a proposal's dates and retire the ones no longer listed, in one statement. Kept ids keep
 * their answers; the caller deletes answers on retired dates in the same batch.
 */
export function putOptionsStmt(
  db: D1Database,
  teamId: string,
  eventId: string,
  options: ProposalOption[],
  t: number,
) {
  return db
    .prepare(
      `INSERT INTO event_options (id, team_id, event_id, starts_at, meet_at, ends_at, time_tbd, updated_at, deleted_at)
       SELECT j.value->>'id', e.team_id, e.id, j.value->>'startsAt', j.value->>'meetAt', j.value->>'endsAt',
           CASE WHEN j.value->>'timeTbd' THEN 1 ELSE 0 END, ?1, NULL
         FROM json_each(?2) j JOIN events e ON e.id = ?3 AND e.team_id = ?4
       UNION ALL
       SELECT o.id, o.team_id, o.event_id, o.starts_at, o.meet_at, o.ends_at, o.time_tbd, ?1, ?1 FROM event_options o
         WHERE o.event_id = ?3 AND o.team_id = ?4 AND o.deleted_at IS NULL
           AND o.id NOT IN (SELECT value->>'id' FROM json_each(?2))
       ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at, meet_at = excluded.meet_at,
         ends_at = excluded.ends_at, time_tbd = excluded.time_tbd, deleted_at = excluded.deleted_at,
         updated_at = excluded.updated_at
       WHERE event_options.team_id = excluded.team_id AND event_options.event_id = excluded.event_id
         AND (event_options.starts_at IS NOT excluded.starts_at OR event_options.meet_at IS NOT excluded.meet_at
           OR event_options.ends_at IS NOT excluded.ends_at OR event_options.time_tbd IS NOT excluded.time_tbd
           OR event_options.deleted_at IS NOT excluded.deleted_at)`,
    )
    .bind(t, JSON.stringify(options), eventId, teamId);
}

/** The event row mirrors a proposal's earliest date, so it sorts and syncs like any event. */
const firstOption = (options: ProposalOption[]) => [...options].sort(byStart)[0]!;
/** An event's times from one of its proposal dates. */
const optionTimes = (o: ProposalOption) => ({
  startsAt: o.startsAt,
  meetAt: o.meetAt,
  endsAt: o.endsAt,
  timeTbd: o.timeTbd,
});

const FIELD_COLS: Record<string, string> = {
  seasonId: 'season_id',
  type: 'type',
  format: 'format',
  title: 'title',
  startsAt: 'starts_at',
  meetAt: 'meet_at',
  endsAt: 'ends_at',
  locationName: 'location_name',
  locationUrl: 'location_url',
  opponent: 'opponent',
  notes: 'notes',
  rsvpDeadline: 'rsvp_deadline',
};

/**
 * SQL: how long a "Time TBD" event (stored at local noon) runs after its start, i.e. to about the
 * end of its day (`eventEndsAt`; ±1 h on a DST day). 0 for timed events.
 */
const TBD_DAY_LEFT_SQL = `CASE WHEN e.time_tbd = 1 THEN ${12 * 3600e3} ELSE 0 END`;

/** RETURNING / SELECT columns: the team's timezone and short name, for notification text. */
const TEAM_INFO = `(SELECT timezone FROM teams WHERE id = events.team_id) AS timezone,
  (SELECT short_name FROM teams WHERE id = events.team_id) AS short_name`;

const eventSnake = (e: EventFields) => ({
  starts_at: e.startsAt,
  time_tbd: e.timeTbd ? 1 : 0,
  location_name: e.locationName ?? null,
  opponent: e.opponent ?? null,
});

type CurrentEvent = EventInfo & {
  ends_at: number | null;
  meet_at: number | null;
  cancelled_at: number | null;
  time_tbd: number;
};

/** What the squad hears about an edit: cancelled, back on, or a new time or place. */
function changeMessage(teamId: string, cur: CurrentEvent, ev: TeamEvent) {
  const next: EventInfo = {
    ...cur,
    title: ev.title,
    type: ev.type,
    opponent: ev.opponent,
    starts_at: ev.startsAt,
    time_tbd: ev.timeTbd ? 1 : 0,
    location_name: ev.locationName,
  };
  const was = { startsAt: cur.starts_at, timeTbd: !!cur.time_tbd };
  const t = now();
  if (!stillToCome(was, cur.timezone, t) && !stillToCome(ev, cur.timezone, t)) return null;
  if (!cur.cancelled_at && ev.cancelledAt) return eventCancelled(teamId, next);
  if (cur.cancelled_at && !ev.cancelledAt) return eventRestored(teamId, next);
  if (ev.cancelledAt) return null;
  if (
    cur.starts_at !== ev.startsAt ||
    !!cur.time_tbd !== ev.timeTbd ||
    cur.meet_at !== ev.meetAt ||
    (cur.location_name ?? null) !== (ev.locationName ?? null)
  )
    // "Time set: 2:30 PM" / "Time now TBD" when the time was decided or taken back.
    return eventChanged(
      teamId,
      next,
      timeChangeText(was, ev, cur.timezone, localeOf(cur.timezone)),
    );
  return null;
}

export function eventRoutes(app: Hono<AppEnv>) {
  route(app, 'seasons.put', async (c) => {
    const me = c.var.member;
    const input = await body(c, SeasonInput);
    if (input.id !== c.req.param('seasonId'))
      throw new HttpError(400, 'bad_request', 'Mismatched id');
    const r = await c.var.db
      .prepare(
        `INSERT INTO seasons (id, team_id, name, starts_on, ends_on, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, starts_on = excluded.starts_on, ends_on = excluded.ends_on,
           updated_at = excluded.updated_at WHERE seasons.team_id = excluded.team_id`,
      )
      .bind(input.id, me.teamId, input.name, input.startsOn, input.endsOn, now())
      .run();
    if (!r.meta.changes) throw notFound();
    return c.json({ ok: true });
  });

  route(app, 'events.create', async (c) => {
    const me = c.var.member;
    const input = await body(c, EventCreate);
    const t = now();
    const options = input.status === 'proposed' ? (input.options ?? []) : [];
    const first = options.length ? firstOption(options) : null;
    const fields: EventFields = first ? { ...input, ...optionTimes(first) } : input;
    let proposal: ProposalCols | null = null;
    if (first) {
      const answerBy = input.answerBy ?? defaultAnswerBy(t, first.startsAt);
      // Due within two days already: the proposal itself is the reminder.
      proposal = { answerBy, remindedAt: answerBy - PROPOSAL_REMIND_BEFORE_MS <= t ? t : null };
    }
    // Returns a row only when this request inserted it (a retried outbox write returns none).
    const insert = insertEventStmt(
      c.var.db,
      me.teamId,
      me.userId,
      fields,
      null,
      t,
      `RETURNING ${TEAM_INFO}`,
      proposal,
    );
    type TeamInfo = { timezone: string; short_name: string };
    let team: TeamInfo | null;
    if (first) {
      const [ins] = await c.var.db.batch([
        insert,
        putOptionsStmt(c.var.db, me.teamId, input.id, options, t),
      ]);
      team = (ins?.results[0] as TeamInfo | undefined) ?? null;
    } else team = await insert.first<TeamInfo>();
    if (team && stillToCome(fields, team.timezone, t)) {
      const info: EventInfo = { ...fields, ...team, ...eventSnake(fields) };
      await notifyStmt(
        c.var.db,
        me.teamId,
        { team: true },
        'events',
        first
          ? proposalCreated(
              me.teamId,
              info,
              options.map((o) => o.startsAt),
            )
          : eventCreated(me.teamId, info),
        me.userId,
      ).run();
      flushNotifications(c);
    }
    if (!team) {
      const owner = await c.var.db
        .prepare('SELECT team_id FROM events WHERE id = ?')
        .bind(input.id)
        .first<{ team_id: string }>();
      if (owner?.team_id !== me.teamId)
        throw new HttpError(409, 'conflict', 'Event id already used');
    }
    return c.json({ ok: true, id: input.id }, 201);
  });

  route(app, 'events.update', async (c) => {
    const me = c.var.member;
    const id = c.req.param('eventId')!;
    const input = await body(c, EventUpdate);
    const t = now();
    // A proposal's dates: the event mirrors the earliest one (its own times are ignored).
    const options = input.options;
    if (options) {
      const first = firstOption(options);
      Object.assign(input, optionTimes(first));
    }
    // A proposal's times come from its dates, it can't be cancelled (it's dropped instead), and it
    // can't become a practice: those changes only apply to confirmed events.
    const confirmedOnly =
      (!options &&
        (input.startsAt !== undefined ||
          input.meetAt !== undefined ||
          input.endsAt !== undefined ||
          input.timeTbd !== undefined ||
          input.cancelled !== undefined)) ||
      (input.type !== undefined && !canPropose(input.type));
    const version = ifMatch(c);
    // The current row: to check times, and to tell the team what changed (time, place, cancelled).
    let cur: CurrentEvent | null = null;
    // Proposals tell nobody about edits, and their dates are checked by the schema.
    if (
      !options &&
      (input.startsAt !== undefined ||
        input.endsAt !== undefined ||
        input.meetAt !== undefined ||
        input.timeTbd !== undefined ||
        input.type !== undefined ||
        input.locationName !== undefined ||
        input.cancelled !== undefined)
    ) {
      cur = await c.var.db
        .prepare(
          `SELECT e.id, e.title, e.type, e.opponent, e.starts_at, e.ends_at, e.meet_at, e.location_name, e.cancelled_at,
             e.time_tbd, t.timezone, t.short_name
           FROM events e JOIN teams t ON t.id = e.team_id WHERE e.id = ? AND e.team_id = ?`,
        )
        .bind(id, me.teamId)
        .first<CurrentEvent>();
      if (cur) {
        const tz = cur.timezone;
        let start = input.startsAt ?? cur.starts_at;
        const noonOf = (ms: number) => tbdStartsAt(dateInTz(ms, tz), tz);
        // A build from before "Time TBD" sets a time by sending only a start that isn't local noon.
        const timeSetByOldBuild =
          input.timeTbd === undefined &&
          !!cur.time_tbd &&
          input.startsAt !== undefined &&
          input.startsAt !== noonOf(input.startsAt);
        const tbd = timeSetByOldBuild ? false : (input.timeTbd ?? !!cur.time_tbd);
        if (timeSetByOldBuild || input.timeTbd !== undefined) input.timeTbd = tbd;
        // TBD is always stored at local noon of its date.
        if (tbd && start !== noonOf(start)) start = input.startsAt = noonOf(start);
        const end = input.endsAt === undefined ? cur.ends_at : input.endsAt;
        const meet = input.meetAt === undefined ? cur.meet_at : input.meetAt;
        if (end !== null && end < start)
          throw new HttpError(400, 'bad_request', 'Finish must be after the start');
        if (meet !== null && meet > start)
          throw new HttpError(400, 'bad_request', 'Meet time must be before the start');
        if (tbd && (end !== null || meet !== null))
          throw new HttpError(400, 'bad_request', 'No meet or finish time while the time is TBD');
        if (tbd && !canTimeTbd((input.type ?? cur.type) as EventType))
          throw new HttpError(400, 'bad_request', 'Practices need a time');
      }
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, col] of Object.entries(FIELD_COLS)) {
      const val = (input as Record<string, unknown>)[k];
      if (val !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(val);
      }
    }
    if (input.timeTbd !== undefined) {
      sets.push('time_tbd = ?');
      vals.push(input.timeTbd ? 1 : 0);
    }
    if (input.settings !== undefined) {
      sets.push('settings = ?');
      vals.push(input.settings ? JSON.stringify(input.settings) : null);
    }
    // Moved to another day: the reminder for the new date hasn't gone out yet. Setting the time
    // (or making it TBD) on the same day keeps it, so nobody is asked twice.
    if (input.startsAt !== undefined) {
      if (cur) {
        if (dateInTz(input.startsAt, cur.timezone) !== dateInTz(cur.starts_at, cur.timezone))
          sets.push('reminded_at = NULL');
      } else {
        sets.push('reminded_at = CASE WHEN starts_at = ? THEN reminded_at ELSE NULL END');
        vals.push(input.startsAt);
      }
    }
    if (input.cancelled !== undefined) {
      sets.push('cancelled_at = ?');
      vals.push(input.cancelled ? now() : null);
    }
    if (input.answerBy !== undefined) {
      // A new deadline gets its own reminder, unless it's already within the reminder window.
      sets.push(
        'proposal_reminded_at = CASE WHEN answer_by IS ? THEN proposal_reminded_at WHEN ? THEN ? ELSE NULL END',
        'answer_by = ?',
      );
      const soon = input.answerBy !== null && input.answerBy - PROPOSAL_REMIND_BEFORE_MS <= t;
      vals.push(input.answerBy, soon ? 1 : 0, t, input.answerBy);
    }
    if (input.target !== undefined) {
      sets.push('target = ?');
      vals.push(input.target);
    }
    if (input.checkPositions !== undefined) {
      sets.push('check_positions = ?');
      vals.push(input.checkPositions ? 1 : 0);
    }
    const row = await c.var.db
      .prepare(
        `UPDATE events SET ${[...sets, 'version = version + 1', 'updated_at = ?'].join(', ')}
         WHERE id = ? AND team_id = ? AND deleted_at IS NULL AND (? IS NULL OR version = ?)
           AND (? = 0 OR status = 'proposed') AND (? = 0 OR status = 'confirmed') RETURNING ${EVENT_COLS}`,
      )
      .bind(...vals, t, id, me.teamId, version, version, options ? 1 : 0, confirmedOnly ? 1 : 0)
      .first();
    if (row) {
      const ev = eventFromRow(row);
      const stmts: D1PreparedStatement[] = [];
      if (options)
        stmts.push(
          putOptionsStmt(c.var.db, me.teamId, id, options, t),
          // A removed date takes its answers with it.
          c.var.db
            .prepare(
              `DELETE FROM proposal_answers WHERE event_id = ? AND team_id = ?
               AND option_id NOT IN (SELECT value->>'id' FROM json_each(?))`,
            )
            .bind(id, me.teamId, JSON.stringify(options)),
        );
      if (input.cancelled !== undefined)
        stmts.push(
          auditStmt(c.var.db, {
            teamId: me.teamId,
            actorId: me.userId,
            action: input.cancelled ? 'event.cancelled' : 'event.restored',
            targetType: 'event',
            targetId: id,
            meta: { title: ev.title },
          }),
        );
      const msg = cur && ev.status === 'confirmed' && changeMessage(me.teamId, cur, ev);
      if (msg)
        stmts.push(notifyStmt(c.var.db, me.teamId, { team: true }, 'events', msg, me.userId));
      if (stmts.length) await c.var.db.batch(stmts);
      if (msg) flushNotifications(c);
      return c.json({ event: ev });
    }
    const current = await c.var.db
      .prepare(
        `SELECT ${EVENT_COLS} FROM events WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
      )
      .bind(id, me.teamId)
      .first();
    if (!current || current.status === 'dropped') throw notFound('Event not found');
    if (confirmedOnly && current.status !== 'confirmed')
      throw new HttpError(
        400,
        'bad_request',
        "Not confirmed yet: change its dates, or confirm it first. It can't become a practice.",
      );
    if (options && current.status !== 'proposed')
      throw new HttpError(400, 'bad_request', 'Only events that are not confirmed yet have dates');
    throw new HttpError(409, 'conflict', 'Someone else changed this event', {
      latest: eventFromRow(current),
    });
  });

  route(app, 'events.delete', async (c) => {
    const me = c.var.member;
    const t = now();
    const row = await c.var.db
      .prepare(
        `UPDATE events SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND team_id = ? AND deleted_at IS NULL
         RETURNING id, title, type, opponent, starts_at, time_tbd, location_name, cancelled_at, status, ${TEAM_INFO}`,
      )
      .bind(t, t, c.req.param('eventId'), me.teamId)
      .first<EventInfo & { cancelled_at: number | null; status: string }>();
    if (!row) throw notFound('Event not found');
    // Removing an upcoming event is a cancellation for the squad (unless it was already called
    // off). A proposal is "not going ahead" for the people who answered; a dropped one, for nobody.
    const proposal = row.status === 'proposed';
    const tell =
      stillToCome({ startsAt: row.starts_at, timeTbd: !!row.time_tbd }, row.timezone, t) &&
      !row.cancelled_at &&
      (row.status === 'confirmed' || proposal);
    await c.var.db.batch([
      auditStmt(c.var.db, {
        teamId: me.teamId,
        actorId: me.userId,
        action: 'event.deleted',
        targetType: 'event',
        targetId: c.req.param('eventId')!,
        meta: { title: row.title },
      }),
      ...(tell
        ? [
            proposal
              ? notifyStmt(
                  c.var.db,
                  me.teamId,
                  { team: true },
                  'events',
                  proposalDropped(me.teamId, row),
                  me.userId,
                  {
                    sql: 'm.id IN (SELECT member_id FROM proposal_answers WHERE event_id = ?8)',
                    params: [row.id],
                  },
                )
              : notifyStmt(
                  c.var.db,
                  me.teamId,
                  { team: true },
                  'events',
                  eventCancelled(me.teamId, row, true),
                  me.userId,
                ),
          ]
        : []),
    ]);
    if (tell) flushNotifications(c);
    return c.json({ ok: true });
  });

  route(app, 'recurrences.create', async (c) => {
    const me = c.var.member;
    const input = await body(c, RecurrenceCreate);
    const team = await c.var.db
      .prepare('SELECT timezone FROM teams WHERE id = ?')
      .bind(me.teamId)
      .first<{ timezone: string }>();
    const tz = team!.timezone;
    const dates = weeklyDates(input.rule.startsOn, input.rule.until, input.rule.weekdays);
    if (dates.length > 160)
      throw new HttpError(400, 'bad_request', 'That series has too many sessions');
    const t = now();
    const rows = dates.map((d, i) => {
      const startsAt = zonedToUtc(d, input.rule.time, tz);
      return {
        id: uuidv7(t + i),
        starts_at: startsAt,
        meet_at: input.rule.meetBeforeMin ? startsAt - input.rule.meetBeforeMin * 60e3 : null,
        ends_at: startsAt + input.rule.durationMin * 60e3,
      };
    });
    const template = {
      type: input.type,
      title: input.title,
      locationName: input.locationName,
      locationUrl: input.locationUrl,
      notes: input.notes,
    };
    // One statement for the whole series (D1 counts queries per invocation).
    await c.var.db.batch([
      c.var.db
        .prepare(
          'INSERT INTO recurrences (id, team_id, rule, template, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
        )
        .bind(input.id, me.teamId, JSON.stringify(input.rule), JSON.stringify(template), t),
      c.var.db
        .prepare(
          `INSERT INTO events (id, team_id, season_id, type, title, starts_at, meet_at, ends_at, location_name, location_url, notes,
             recurrence_id, version, created_by, updated_at)
           SELECT j.value->>'id', ?, ?, ?, ?, j.value->>'starts_at', j.value->>'meet_at', j.value->>'ends_at', ?, ?, ?, ?, 1, ?, ?
           FROM json_each(?) j WHERE true ON CONFLICT DO NOTHING`,
        )
        .bind(
          me.teamId,
          input.seasonId ?? null,
          input.type,
          input.title,
          input.locationName ?? null,
          input.locationUrl ?? null,
          input.notes ?? null,
          input.id,
          me.userId,
          t,
          JSON.stringify(rows),
        ),
      // Only when this request made the series (an outbox retry inserts nothing).
      notifyStmt(
        c.var.db,
        me.teamId,
        { team: true },
        'events',
        seriesCreated(me.teamId, { ...input, count: rows.length }),
        me.userId,
        {
          sql: '? > 0 AND EXISTS (SELECT 1 FROM recurrences WHERE id = ? AND team_id = ? AND created_at = ?)',
          params: [rows.length, input.id, me.teamId, t],
        },
      ),
    ]);
    if (rows.length) flushNotifications(c);
    return c.json({ ok: true, count: rows.length, ids: rows.map((r) => r.id) }, 201);
  });

  /** Load a live series with its team timezone and upcoming sessions, in one query. */
  async function loadSeries(c: Context<AppEnv>, at: number) {
    const row = await c.var.db
      .prepare(
        `SELECT r.rule, r.template, t.timezone,
           (SELECT json_group_array(json_object('id', e.id, 'starts_at', e.starts_at))
              FROM events e WHERE e.recurrence_id = r.id AND e.team_id = r.team_id
                AND e.deleted_at IS NULL AND e.starts_at > ?) AS upcoming
         FROM recurrences r JOIN teams t ON t.id = r.team_id
         WHERE r.id = ? AND r.team_id = ? AND r.deleted_at IS NULL`,
      )
      .bind(at, c.req.param('recurrenceId'), c.var.member.teamId)
      .first<{ rule: string; template: string; timezone: string; upcoming: string }>();
    if (!row) throw notFound('Series not found');
    const template = JSON.parse(row.template) as Partial<Recurrence>;
    return {
      tz: row.timezone,
      rule: JSON.parse(row.rule) as RecurrenceRule,
      template: { ...template, type: template.type ?? 'training' },
      upcoming: JSON.parse(row.upcoming) as { id: string; starts_at: number }[],
    };
  }

  route(app, 'recurrences.get', async (c) => {
    const s = await loadSeries(c, now());
    const recurrence: Recurrence = {
      id: c.req.param('recurrenceId')!,
      rule: s.rule,
      type: s.template.type,
      title: s.template.title ?? 'Practice',
      locationName: s.template.locationName ?? null,
      locationUrl: s.template.locationUrl ?? null,
      notes: s.template.notes ?? null,
      upcoming: s.upcoming.length,
    };
    return c.json({ recurrence });
  });

  route(app, 'recurrences.update', async (c) => {
    const me = c.var.member;
    const id = c.req.param('recurrenceId')!;
    const input = await body(c, RecurrenceUpdate);
    const t = now();
    const s = await loadSeries(c, t);
    const rule = input.rule;
    // Upcoming sessions only: from today (team time) to the new end date, still in the future.
    const today = dateInTz(t, s.tz);
    const from = rule.startsOn > today ? rule.startsOn : today;
    const wanted = new Map<
      string,
      { starts_at: number; meet_at: number | null; ends_at: number }
    >();
    for (const d of from <= rule.until ? weeklyDates(from, rule.until, rule.weekdays) : []) {
      const startsAt = zonedToUtc(d, rule.time, s.tz);
      if (startsAt <= t) continue;
      wanted.set(d, {
        starts_at: startsAt,
        meet_at: rule.meetBeforeMin ? startsAt - rule.meetBeforeMin * 60e3 : null,
        ends_at: startsAt + rule.durationMin * 60e3,
      });
    }
    if (wanted.size > 160)
      throw new HttpError(400, 'bad_request', 'That series has too many sessions');
    // Sessions keep their id (and replies) when their date stays in the series.
    const changes: Record<string, unknown>[] = [];
    for (const e of s.upcoming) {
      const d = dateInTz(e.starts_at, s.tz);
      const w = wanted.get(d);
      if (w) {
        changes.push({ id: e.id, del: 0, ...w });
        wanted.delete(d);
      } else changes.push({ id: e.id, del: 1 });
    }
    const added = [...wanted.values()].map((w, i) => ({ id: uuidv7(t + i), ...w }));
    const template = {
      type: input.type,
      title: input.title,
      locationName: input.locationName ?? null,
      locationUrl: input.locationUrl ?? null,
      notes: input.notes ?? null,
    };
    // Tell the squad when days, time or place change (or sessions go), not for a tweak to the notes.
    const notifySeries =
      s.upcoming.length + added.length > 0 &&
      (rule.time !== s.rule.time ||
        [...rule.weekdays].sort().join() !== [...s.rule.weekdays].sort().join() ||
        rule.until < s.rule.until ||
        (template.locationName ?? null) !== (s.template.locationName ?? null));
    await c.var.db.batch([
      ...(notifySeries
        ? [
            notifyStmt(
              c.var.db,
              me.teamId,
              { team: true },
              'events',
              seriesChanged(me.teamId, { ...template, rule }),
              me.userId,
            ),
          ]
        : []),
      c.var.db
        .prepare('UPDATE recurrences SET rule = ?, template = ? WHERE id = ? AND team_id = ?')
        .bind(JSON.stringify(rule), JSON.stringify(template), id, me.teamId),
      // Kept and dropped sessions are updated, new dates inserted: one upsert (query budget).
      c.var.db
        .prepare(
          `INSERT INTO events (id, team_id, type, title, starts_at, meet_at, ends_at, location_name, location_url, notes,
             recurrence_id, version, created_by, updated_at, deleted_at)
           SELECT j.value->>'id', ?8, ?2, ?3, coalesce(j.value->>'starts_at', 0), j.value->>'meet_at', j.value->>'ends_at',
             ?4, ?5, ?6, ?9, 1, ?10, ?1, CASE WHEN j.value->>'del' = 1 THEN ?1 END
           FROM json_each(?7) j
           WHERE coalesce(j.value->>'del', 0) = 0 OR EXISTS (SELECT 1 FROM events x WHERE x.id = j.value->>'id')
           ON CONFLICT(id) DO UPDATE SET
             deleted_at = coalesce(excluded.deleted_at, events.deleted_at),
             starts_at = CASE WHEN excluded.deleted_at IS NULL THEN excluded.starts_at ELSE events.starts_at END,
             meet_at = CASE WHEN excluded.deleted_at IS NULL THEN excluded.meet_at ELSE events.meet_at END,
             ends_at = coalesce(excluded.ends_at, events.ends_at),
             time_tbd = CASE WHEN excluded.deleted_at IS NULL THEN 0 ELSE events.time_tbd END,
             reminded_at = CASE WHEN excluded.deleted_at IS NULL AND excluded.starts_at != events.starts_at
               THEN NULL ELSE events.reminded_at END,
             type = CASE WHEN excluded.deleted_at IS NULL THEN excluded.type ELSE events.type END,
             title = CASE WHEN excluded.deleted_at IS NULL THEN excluded.title ELSE events.title END,
             location_name = CASE WHEN excluded.deleted_at IS NULL THEN excluded.location_name ELSE events.location_name END,
             location_url = CASE WHEN excluded.deleted_at IS NULL THEN excluded.location_url ELSE events.location_url END,
             notes = CASE WHEN excluded.deleted_at IS NULL THEN excluded.notes ELSE events.notes END,
             version = events.version + 1, updated_at = excluded.updated_at
           WHERE events.team_id = excluded.team_id AND events.recurrence_id = excluded.recurrence_id`,
        )
        .bind(
          t,
          input.type,
          input.title,
          template.locationName,
          template.locationUrl,
          template.notes,
          JSON.stringify([...changes, ...added.map((a) => ({ ...a, del: 0 }))]),
          me.teamId,
          id,
          me.userId,
        ),
    ]);
    const kept = changes.filter((x) => !x.del).length;
    if (notifySeries) flushNotifications(c);
    return c.json({
      ok: true,
      updated: kept,
      added: added.length,
      removed: changes.length - kept,
    });
  });

  route(app, 'recurrences.delete', async (c) => {
    const me = c.var.member;
    const id = c.req.param('recurrenceId');
    const t = now();
    const [r, ev] = await c.var.db.batch([
      c.var.db
        .prepare(
          'UPDATE recurrences SET deleted_at = ? WHERE id = ? AND team_id = ? AND deleted_at IS NULL RETURNING template',
        )
        .bind(t, id, me.teamId),
      c.var.db
        .prepare(
          'UPDATE events SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE recurrence_id = ? AND team_id = ? AND starts_at > ? AND deleted_at IS NULL',
        )
        .bind(t, t, id, me.teamId, t),
    ]);
    const rec = r?.results[0] as { template: string } | undefined;
    if (!rec) throw notFound();
    const removed = ev?.meta.changes ?? 0;
    if (removed) {
      const title = parseJson<{ title?: string }>(rec.template, {}).title ?? 'Practice';
      await notifyStmt(
        c.var.db,
        me.teamId,
        { team: true },
        'events',
        seriesRemoved(me.teamId, title, removed),
        me.userId,
      ).run();
      flushNotifications(c);
    }
    return c.json({ ok: true });
  });

  route(app, 'rsvps.put', async (c) => {
    const me = c.var.member;
    const memberId = c.req.param('memberId')!;
    if (memberId !== me.id && !can(c.var.perms, 'events.manage'))
      throw forbidden('You can only reply for yourself');
    const input = await body(c, RsvpPut);
    const t = now();
    const note = input.note?.trim() ? input.note.trim() : null;
    const row = await c.var.db
      .prepare(
        `INSERT INTO rsvps (event_id, member_id, team_id, status, note, note_expires_at, updated_at, reconfirm)
         SELECT e.id, m.id, e.team_id, ?, ?, CASE WHEN ? IS NULL THEN NULL
           ELSE coalesce(e.ends_at, e.starts_at + ${TBD_DAY_LEFT_SQL}) + ? END, ?, 0
         FROM events e JOIN memberships m ON m.team_id = e.team_id AND m.id = ? AND m.status != 'removed'
         WHERE e.id = ? AND e.team_id = ? AND e.deleted_at IS NULL AND e.status = 'confirmed'
         ON CONFLICT(event_id, member_id) DO UPDATE SET status = excluded.status, note = excluded.note,
           note_expires_at = excluded.note_expires_at, updated_at = excluded.updated_at, reconfirm = 0
         RETURNING event_id`,
      )
      .bind(
        input.status,
        note,
        note,
        RSVP_NOTE_TTL_MS,
        t,
        memberId,
        c.req.param('eventId'),
        me.teamId,
      )
      .first();
    if (!row) throw notFound('Event not found');
    return c.json({ ok: true, updatedAt: t });
  });

  route(app, 'attendance.put', async (c) => {
    const me = c.var.member;
    const input = await body(c, AttendancePut);
    const t = now();
    await c.var.db
      .prepare(
        `INSERT INTO rsvps (event_id, member_id, team_id, status, attended, updated_at)
         SELECT e.id, m.id, e.team_id, NULL, j.value->>'attended', ?
         FROM json_each(?) j
         JOIN memberships m ON m.id = j.value->>'memberId' AND m.team_id = ?
         JOIN events e ON e.id = ? AND e.team_id = ? AND e.deleted_at IS NULL AND e.status = 'confirmed'
         WHERE true
         ON CONFLICT(event_id, member_id) DO UPDATE SET attended = excluded.attended, updated_at = excluded.updated_at`,
      )
      .bind(t, JSON.stringify(input.entries), me.teamId, c.req.param('eventId'), me.teamId)
      .run();
    return c.json({ ok: true });
  });
}
