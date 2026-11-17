import type { Hono } from 'hono';
import { DrillCreate, DrillUpdate, can } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, notFound, now } from '../lib/http';
import { DRILL_META_COLS, drillFullFromRow, drillMetaFromRow } from '../db/rows';
import { setsFrom, versionedUpdate } from '../lib/versioned';

const MAP = {
  title: 'title',
  category: 'category',
  contactLevel: 'contact_level',
  intensity: 'intensity',
  playersMin: 'players_min',
  playersMax: 'players_max',
  area: 'area',
  equipment: 'equipment',
  defaultDurationMin: 'default_duration_min',
  description: 'description',
  coachingPoints: 'coaching_points',
  setup: 'setup',
  variations: 'variations',
  diagram: 'diagram',
  visibility: 'visibility',
  parentId: 'parent_id',
};
const JSON_FIELDS = ['area', 'equipment', 'coachingPoints', 'variations', 'diagram'];

export function drillRoutes(app: Hono<AppEnv>) {
  route(app, 'drills.get', async (c) => {
    const me = c.var.member;
    const row = await c.var.db
      .prepare(
        `SELECT ${DRILL_META_COLS}, diagram FROM drills WHERE id = ? AND team_id = ? AND deleted_at IS NULL ${can(c.var.perms, 'drills.view_private') ? '' : `AND visibility = 'team'`}`,
      )
      .bind(c.req.param('drillId'), me.teamId)
      .first();
    if (!row) throw notFound('Drill not found');
    return c.json({ drill: drillFullFromRow(row) });
  });

  route(app, 'drills.create', async (c) => {
    const me = c.var.member;
    const d = await body(c, DrillCreate);
    const t = now();
    const r = await c.var.db
      .prepare(
        `INSERT INTO drills (id, team_id, title, category, contact_level, intensity, players_min, players_max, area, equipment,
          default_duration_min, description, coaching_points, setup, variations, diagram, visibility, source, parent_id, version,
          created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'team', ?, 1, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(
        d.id,
        me.teamId,
        d.title,
        d.category,
        d.contactLevel,
        d.intensity,
        d.playersMin,
        d.playersMax,
        JSON.stringify(d.area),
        JSON.stringify(d.equipment),
        d.defaultDurationMin,
        d.description,
        JSON.stringify(d.coachingPoints),
        d.setup,
        JSON.stringify(d.variations),
        d.diagram ? JSON.stringify(d.diagram) : null,
        d.visibility,
        d.parentId,
        me.userId,
        t,
        t,
      )
      .run();
    if (!r.meta.changes) {
      const owner = await c.var.db
        .prepare('SELECT team_id FROM drills WHERE id = ?')
        .bind(d.id)
        .first<{ team_id: string }>();
      if (owner?.team_id !== me.teamId)
        throw new HttpError(409, 'conflict', 'Drill id already used');
    }
    return c.json({ ok: true, id: d.id }, 201);
  });

  route(app, 'drills.update', async (c) => {
    const input = await body(c, DrillUpdate);
    const { sets, vals } = setsFrom(input as Record<string, unknown>, MAP, JSON_FIELDS);
    if (
      input.playersMin !== undefined &&
      input.playersMax !== undefined &&
      input.playersMax < input.playersMin
    )
      throw new HttpError(400, 'bad_request', 'Max players must be at least the minimum');
    const drill = await versionedUpdate(c, {
      table: 'drills',
      cols: `${DRILL_META_COLS}, diagram`,
      id: c.req.param('drillId')!,
      sets,
      vals,
      map: drillFullFromRow,
      what: 'Drill',
    });
    return c.json({ drill });
  });

  route(app, 'drills.delete', async (c) => {
    const t = now();
    const r = await c.var.db
      .prepare(
        'UPDATE drills SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND team_id = ? AND deleted_at IS NULL',
      )
      .bind(t, t, c.req.param('drillId'), c.var.member.teamId)
      .run();
    if (!r.meta.changes) throw notFound('Drill not found');
    return c.json({ ok: true });
  });
}
export { drillMetaFromRow };
