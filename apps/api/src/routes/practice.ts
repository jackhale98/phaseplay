import type { Hono } from 'hono';
import { PlanCreate, PlanUpdate, RunAppend, can, timeline } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, notFound, now, parseJson } from '../lib/http';
import { PLAN_COLS, planFromRow } from '../db/rows';
import { setsFrom, versionedUpdate } from '../lib/versioned';
import { flushNotifications, notifyStmt } from '../lib/notify';
import { planShared } from '../lib/push/messages';

const total = (data: Parameters<typeof timeline>[0]) => timeline(data).at(-1)?.endMin ?? 0;

export function practiceRoutes(app: Hono<AppEnv>) {
  route(app, 'plans.create', async (c) => {
    const me = c.var.member;
    const p = await body(c, PlanCreate);
    const t = now();
    const r = await c.var.db
      .prepare(
        `INSERT INTO practice_plans (id, team_id, event_id, title, is_template, visibility, blocks, planned_total_min, version, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(
        p.id,
        me.teamId,
        p.eventId,
        p.title,
        p.isTemplate ? 1 : 0,
        p.visibility,
        JSON.stringify(p.data),
        total(p.data),
        me.userId,
        t,
        t,
      )
      .run();
    if (!r.meta.changes) {
      const owner = await c.var.db
        .prepare('SELECT team_id FROM practice_plans WHERE id = ?')
        .bind(p.id)
        .first<{ team_id: string }>();
      if (owner?.team_id !== me.teamId)
        throw new HttpError(409, 'conflict', 'Plan id already used');
    } else if (p.visibility === 'team' && !p.isTemplate) {
      await notifyStmt(
        c.var.db,
        me.teamId,
        { team: true },
        'plays',
        planShared(me.teamId, p.id, p.title),
        me.userId,
      ).run();
      flushNotifications(c);
    }
    return c.json({ ok: true, id: p.id }, 201);
  });

  route(app, 'plans.update', async (c) => {
    const me = c.var.member;
    const input = await body(c, PlanUpdate);
    // Shared with the team just now? Then the squad hears about it.
    const before =
      input.visibility === 'team'
        ? await c.var.db
            .prepare(
              'SELECT visibility FROM practice_plans WHERE id = ? AND team_id = ? AND deleted_at IS NULL',
            )
            .bind(c.req.param('planId'), me.teamId)
            .first<{ visibility: string }>()
        : null;
    const { sets, vals } = setsFrom(
      input as Record<string, unknown>,
      {
        eventId: 'event_id',
        title: 'title',
        isTemplate: 'is_template',
        visibility: 'visibility',
        data: 'blocks',
      },
      ['data'],
    );
    if (input.data) {
      sets.push('planned_total_min = ?');
      vals.push(total(input.data));
    }
    const plan = await versionedUpdate(c, {
      table: 'practice_plans',
      cols: PLAN_COLS,
      id: c.req.param('planId')!,
      sets,
      vals,
      map: planFromRow,
      what: 'Plan',
    });
    if (before && before.visibility !== 'team' && !plan.isTemplate) {
      await notifyStmt(
        c.var.db,
        me.teamId,
        { team: true },
        'plays',
        planShared(me.teamId, plan.id, plan.title),
        me.userId,
      ).run();
      flushNotifications(c);
    }
    return c.json({ plan });
  });

  route(app, 'plans.delete', async (c) => {
    const t = now();
    const r = await c.var.db
      .prepare(
        'UPDATE practice_plans SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND team_id = ? AND deleted_at IS NULL',
      )
      .bind(t, t, c.req.param('planId'), c.var.member.teamId)
      .run();
    if (!r.meta.changes) throw notFound('Plan not found');
    return c.json({ ok: true });
  });

  route(app, 'runs.list', async (c) => {
    const me = c.var.member;
    const vis = can(c.var.perms, 'practice.view_private') ? '' : `AND visibility = 'team'`;
    const [plan, rows] = await c.var.db.batch([
      c.var.db
        .prepare(
          `SELECT id FROM practice_plans WHERE id = ? AND team_id = ? AND deleted_at IS NULL ${vis}`,
        )
        .bind(c.req.param('planId'), me.teamId),
      c.var.db
        .prepare(
          `SELECT r.id, r.kind, r.payload, r.at FROM practice_runs r WHERE r.plan_id = ? AND r.team_id = ? ORDER BY r.at LIMIT 1000`,
        )
        .bind(c.req.param('planId'), me.teamId),
    ]);
    if (!plan?.results.length) throw notFound('Plan not found');
    const results = rows!.results as { id: string; kind: string; payload: string; at: number }[];
    return c.json({
      events: results.map((r) => ({
        id: r.id,
        kind: r.kind,
        at: r.at,
        payload: parseJson(r.payload, {}),
      })),
    });
  });

  route(app, 'runs.append', async (c) => {
    const me = c.var.member;
    const { events } = await body(c, RunAppend);
    const r = await c.var.db
      .prepare(
        `INSERT INTO practice_runs (id, plan_id, team_id, kind, payload, at, created_by)
         SELECT j.value->>'id', p.id, p.team_id, j.value->>'kind', json(coalesce(j.value->'payload', '{}')), j.value->>'at', ?
         FROM json_each(?) j JOIN practice_plans p ON p.id = ? AND p.team_id = ? AND p.deleted_at IS NULL
         WHERE true ON CONFLICT(id) DO NOTHING`,
      )
      .bind(me.userId, JSON.stringify(events), c.req.param('planId'), me.teamId)
      .run();
    if (r.meta.changes === 0) {
      const exists = await c.var.db
        .prepare('SELECT 1 FROM practice_plans WHERE id = ? AND team_id = ? AND deleted_at IS NULL')
        .bind(c.req.param('planId'), me.teamId)
        .first();
      if (!exists) throw notFound('Plan not found');
    }
    return c.json({ ok: true, inserted: r.meta.changes });
  });
}
