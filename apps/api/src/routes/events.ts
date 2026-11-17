import type { Context, Hono } from 'hono';
import {
  AttendancePut,
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
  uuidv7,
  weeklyDates,
  zonedToUtc,
  type EventCreate as EventCreateT,
} from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, forbidden, ifMatch, notFound, now } from '../lib/http';
import { EVENT_COLS, eventFromRow } from '../db/rows';
import { auditStmt } from '../lib/audit';

type EventFields = Omit<EventCreateT, 'id'> & { id: string };

export function insertEventStmt(
  db: D1Database,
  teamId: string,
  userId: string | null,
  e: EventFields,
  recurrenceId: string | null,
  t: number,
) {
  return db
    .prepare(
      `INSERT INTO events (id, team_id, season_id, type, format, title, starts_at, meet_at, ends_at, location_name,
        location_url, opponent, notes, rsvp_deadline, recurrence_id, settings, version, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT DO NOTHING`,
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
    );
}

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
    const r = await insertEventStmt(c.var.db, me.teamId, me.userId, input, null, t).run();
    if (!r.meta.changes) {
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
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, col] of Object.entries(FIELD_COLS)) {
      const val = (input as Record<string, unknown>)[k];
      if (val !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(val);
      }
    }
    if (input.settings !== undefined) {
      sets.push('settings = ?');
      vals.push(input.settings ? JSON.stringify(input.settings) : null);
    }
    if (input.cancelled !== undefined) {
      sets.push('cancelled_at = ?');
      vals.push(input.cancelled ? now() : null);
    }
    const version = ifMatch(c);
    if (input.startsAt !== undefined || input.endsAt !== undefined || input.meetAt !== undefined) {
      const cur = await c.var.db
        .prepare('SELECT starts_at, ends_at, meet_at FROM events WHERE id = ? AND team_id = ?')
        .bind(id, me.teamId)
        .first<{ starts_at: number; ends_at: number | null; meet_at: number | null }>();
      if (cur) {
        const start = input.startsAt ?? cur.starts_at;
        const end = input.endsAt === undefined ? cur.ends_at : input.endsAt;
        const meet = input.meetAt === undefined ? cur.meet_at : input.meetAt;
        if (end !== null && end < start)
          throw new HttpError(400, 'bad_request', 'Finish must be after the start');
        if (meet !== null && meet > start)
          throw new HttpError(400, 'bad_request', 'Meet time must be before the start');
      }
    }
    const row = await c.var.db
      .prepare(
        `UPDATE events SET ${[...sets, 'version = version + 1', 'updated_at = ?'].join(', ')}
         WHERE id = ? AND team_id = ? AND deleted_at IS NULL AND (? IS NULL OR version = ?) RETURNING ${EVENT_COLS}`,
      )
      .bind(...vals, now(), id, me.teamId, version, version)
      .first();
    if (row) {
      const ev = eventFromRow(row);
      if (input.cancelled !== undefined)
        await auditStmt(c.var.db, {
          teamId: me.teamId,
          actorId: me.userId,
          action: input.cancelled ? 'event.cancelled' : 'event.restored',
          targetType: 'event',
          targetId: id,
          meta: { title: ev.title },
        }).run();
      return c.json({ event: ev });
    }
    const current = await c.var.db
      .prepare(
        `SELECT ${EVENT_COLS} FROM events WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
      )
      .bind(id, me.teamId)
      .first();
    if (!current) throw notFound('Event not found');
    throw new HttpError(409, 'conflict', 'Someone else changed this event', {
      latest: eventFromRow(current),
    });
  });

  route(app, 'events.delete', async (c) => {
    const me = c.var.member;
    const t = now();
    const row = await c.var.db
      .prepare(
        'UPDATE events SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND team_id = ? AND deleted_at IS NULL RETURNING title',
      )
      .bind(t, t, c.req.param('eventId'), me.teamId)
      .first<{ title: string }>();
    if (!row) throw notFound('Event not found');
    await auditStmt(c.var.db, {
      teamId: me.teamId,
      actorId: me.userId,
      action: 'event.deleted',
      targetType: 'event',
      targetId: c.req.param('eventId')!,
      meta: { title: row.title },
    }).run();
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
    ]);
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
    await c.var.db.batch([
      c.var.db
        .prepare('UPDATE recurrences SET rule = ?, template = ? WHERE id = ? AND team_id = ?')
        .bind(JSON.stringify(rule), JSON.stringify(template), id, me.teamId),
      c.var.db
        .prepare(
          `UPDATE events SET
             deleted_at = CASE WHEN j.value->>'del' = 1 THEN ?1 ELSE events.deleted_at END,
             starts_at = coalesce(j.value->>'starts_at', events.starts_at),
             meet_at = CASE WHEN j.value->>'del' = 1 THEN events.meet_at ELSE j.value->>'meet_at' END,
             ends_at = coalesce(j.value->>'ends_at', events.ends_at),
             type = CASE WHEN j.value->>'del' = 1 THEN events.type ELSE ?2 END,
             title = CASE WHEN j.value->>'del' = 1 THEN events.title ELSE ?3 END,
             location_name = CASE WHEN j.value->>'del' = 1 THEN events.location_name ELSE ?4 END,
             location_url = CASE WHEN j.value->>'del' = 1 THEN events.location_url ELSE ?5 END,
             notes = CASE WHEN j.value->>'del' = 1 THEN events.notes ELSE ?6 END,
             version = events.version + 1, updated_at = ?1
           FROM json_each(?7) j
           WHERE events.id = j.value->>'id' AND events.team_id = ?8 AND events.recurrence_id = ?9`,
        )
        .bind(
          t,
          input.type,
          input.title,
          template.locationName,
          template.locationUrl,
          template.notes,
          JSON.stringify(changes),
          me.teamId,
          id,
        ),
      c.var.db
        .prepare(
          `INSERT INTO events (id, team_id, type, title, starts_at, meet_at, ends_at, location_name, location_url, notes,
             recurrence_id, version, created_by, updated_at)
           SELECT j.value->>'id', ?, ?, ?, j.value->>'starts_at', j.value->>'meet_at', j.value->>'ends_at', ?, ?, ?, ?, 1, ?, ?
           FROM json_each(?) j WHERE true ON CONFLICT DO NOTHING`,
        )
        .bind(
          me.teamId,
          input.type,
          input.title,
          template.locationName,
          template.locationUrl,
          template.notes,
          id,
          me.userId,
          t,
          JSON.stringify(added),
        ),
    ]);
    const kept = changes.filter((x) => !x.del).length;
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
    const [r] = await c.var.db.batch([
      c.var.db
        .prepare(
          'UPDATE recurrences SET deleted_at = ? WHERE id = ? AND team_id = ? AND deleted_at IS NULL',
        )
        .bind(t, id, me.teamId),
      c.var.db
        .prepare(
          'UPDATE events SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE recurrence_id = ? AND team_id = ? AND starts_at > ? AND deleted_at IS NULL',
        )
        .bind(t, t, id, me.teamId, t),
    ]);
    if (!r?.meta.changes) throw notFound();
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
        `INSERT INTO rsvps (event_id, member_id, team_id, status, note, note_expires_at, updated_at)
         SELECT e.id, m.id, e.team_id, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE coalesce(e.ends_at, e.starts_at) + ? END, ?
         FROM events e JOIN memberships m ON m.team_id = e.team_id AND m.id = ? AND m.status != 'removed'
         WHERE e.id = ? AND e.team_id = ? AND e.deleted_at IS NULL
         ON CONFLICT(event_id, member_id) DO UPDATE SET status = excluded.status, note = excluded.note,
           note_expires_at = excluded.note_expires_at, updated_at = excluded.updated_at
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
         JOIN events e ON e.id = ? AND e.team_id = ? AND e.deleted_at IS NULL
         WHERE true
         ON CONFLICT(event_id, member_id) DO UPDATE SET attended = excluded.attended, updated_at = excluded.updated_at`,
      )
      .bind(t, JSON.stringify(input.entries), me.teamId, c.req.param('eventId'), me.teamId)
      .run();
    return c.json({ ok: true });
  });
}
