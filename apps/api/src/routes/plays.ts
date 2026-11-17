import type { Hono } from 'hono';
import { PlayCreate, PlayUpdate, can, dateInTz, type Perms, type SeenBy } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, notFound, now } from '../lib/http';
import { PLAY_META_COLS, playFullFromRow } from '../db/rows';
import { auditStmt } from '../lib/audit';
import { setsFrom, versionedUpdate } from '../lib/versioned';

const visibleTo = (perms: Perms) =>
  can(perms, 'plays.view_private') ? '' : `AND visibility = 'team'`;

export function playRoutes(app: Hono<AppEnv>) {
  route(app, 'plays.get', async (c) => {
    const me = c.var.member;
    const row = await c.var.db
      .prepare(
        `SELECT ${PLAY_META_COLS}, data FROM plays WHERE id = ? AND team_id = ? AND deleted_at IS NULL ${visibleTo(c.var.perms)}`,
      )
      .bind(c.req.param('playId'), me.teamId)
      .first();
    if (!row) throw notFound('Play not found');
    return c.json({ play: playFullFromRow(row) });
  });

  route(app, 'plays.create', async (c) => {
    const me = c.var.member;
    const input = await body(c, PlayCreate);
    const t = now();
    const r = await c.var.db
      .prepare(
        `INSERT INTO plays (id, team_id, title, category, tags, format, visibility, description, data, frame_count, version, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .bind(
        input.id,
        me.teamId,
        input.title,
        input.category,
        JSON.stringify(input.tags),
        input.format,
        input.visibility,
        input.description,
        JSON.stringify(input.data),
        input.data.frames.length,
        me.userId,
        t,
        t,
      )
      .run();
    if (!r.meta.changes) {
      const owner = await c.var.db
        .prepare('SELECT team_id FROM plays WHERE id = ?')
        .bind(input.id)
        .first<{ team_id: string }>();
      if (owner?.team_id !== me.teamId)
        throw new HttpError(409, 'conflict', 'Play id already used');
    }
    return c.json({ ok: true, id: input.id }, 201);
  });

  route(app, 'plays.update', async (c) => {
    const input = await body(c, PlayUpdate);
    const { sets, vals } = setsFrom(
      input as Record<string, unknown>,
      {
        title: 'title',
        category: 'category',
        tags: 'tags',
        format: 'format',
        visibility: 'visibility',
        description: 'description',
        data: 'data',
      },
      ['tags', 'data'],
    );
    if (input.data) {
      sets.push('frame_count = ?');
      vals.push(input.data.frames.length);
    }
    const play = await versionedUpdate(c, {
      table: 'plays',
      cols: `${PLAY_META_COLS}, data`,
      id: c.req.param('playId')!,
      sets,
      vals,
      map: playFullFromRow,
      what: 'Play',
    });
    return c.json({ play });
  });

  route(app, 'plays.delete', async (c) => {
    const me = c.var.member;
    const t = now();
    const row = await c.var.db
      .prepare(
        'UPDATE plays SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND team_id = ? AND deleted_at IS NULL RETURNING title',
      )
      .bind(t, t, c.req.param('playId'), me.teamId)
      .first<{ title: string }>();
    if (!row) throw notFound('Play not found');
    await auditStmt(c.var.db, {
      teamId: me.teamId,
      actorId: me.userId,
      action: 'play.deleted',
      targetType: 'play',
      targetId: c.req.param('playId')!,
      meta: { title: row.title },
    }).run();
    return c.json({ ok: true });
  });

  route(app, 'plays.view', async (c) => {
    const me = c.var.member;
    const team = await c.var.db
      .prepare('SELECT timezone FROM teams WHERE id = ?')
      .bind(me.teamId)
      .first<{ timezone: string }>();
    const t = now();
    const r = await c.var.db
      .prepare(
        `INSERT INTO play_views (play_id, member_id, team_id, day, first_viewed_at)
         SELECT p.id, ?, p.team_id, ?, ? FROM plays p WHERE p.id = ? AND p.team_id = ? AND p.deleted_at IS NULL ${visibleTo(c.var.perms).replace('visibility', 'p.visibility')}
         ON CONFLICT DO NOTHING`,
      )
      .bind(me.id, dateInTz(t, team?.timezone ?? 'UTC'), t, c.req.param('playId'), me.teamId)
      .run();
    if (!r.meta.changes) {
      const exists = await c.var.db
        .prepare(
          `SELECT 1 FROM plays WHERE id = ? AND team_id = ? AND deleted_at IS NULL ${visibleTo(c.var.perms)}`,
        )
        .bind(c.req.param('playId'), me.teamId)
        .first();
      if (!exists) throw notFound('Play not found');
    }
    return c.json({ ok: true, recorded: r.meta.changes > 0 });
  });

  route(app, 'plays.seen', async (c) => {
    const me = c.var.member;
    const [play, seen, total] = await c.var.db.batch([
      c.var.db
        .prepare('SELECT id FROM plays WHERE id = ? AND team_id = ? AND deleted_at IS NULL')
        .bind(c.req.param('playId'), me.teamId),
      c.var.db
        .prepare(
          `SELECT v.member_id, min(v.first_viewed_at) AS first FROM play_views v JOIN plays p ON p.id = v.play_id
           WHERE v.play_id = ? AND p.team_id = ? GROUP BY v.member_id`,
        )
        .bind(c.req.param('playId'), me.teamId),
      c.var.db
        .prepare(
          `SELECT count(*) AS n FROM memberships WHERE team_id = ? AND status = 'active' AND role = 'player'`,
        )
        .bind(me.teamId),
    ]);
    if (!play?.results.length) throw notFound('Play not found');
    const res: SeenBy = {
      seen: (seen!.results as { member_id: string; first: number }[]).map((r) => ({
        memberId: r.member_id,
        firstViewedAt: r.first,
      })),
      total: (total!.results[0] as { n: number }).n,
    };
    return c.json(res);
  });
}
