import type { Hono } from 'hono';
import * as v from 'valibot';
import { Id, randomToken, sha256Base64Url, text, uuidv7, type MeResponse, type Passkey } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, notFound, now } from '../lib/http';
import { MEMBER_COLS, TEAM_COLS, memberFromRow, teamFromRow } from '../db/rows';
import { clearSessionCookie, recoveryCodeStatements, requireUser } from '../auth/session';
import { insertCredential, registrationOptions, takeChallenge, verifyRegistration } from '../auth/webauthn';
import { bool } from '../lib/db';

const prefixed = (cols: string, p: string) => cols.split(', ').map((x) => `${p}.${x} AS ${p}_${x}`).join(', ');
const strip = (row: Record<string, unknown>, p: string) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => k.startsWith(p + '_')).map(([k, val]) => [k.slice(p.length + 1), val]));

export function meRoutes(app: Hono<AppEnv>) {
  route(app, 'me.get', async (c) => {
    const u = requireUser(c);
    const { results } = await c.var.db
      .prepare(
        `SELECT ${prefixed(MEMBER_COLS, 'm')}, ${prefixed(TEAM_COLS, 't')} FROM memberships m
         JOIN teams t ON t.id = m.team_id
         WHERE m.user_id = ? AND m.status = 'active' AND t.deleted_at IS NULL ORDER BY m.joined_at`,
      )
      .bind(u.id)
      .all<Record<string, unknown>>();
    const res: MeResponse = {
      user: { id: u.id, displayName: u.displayName, createdAt: 0 },
      memberships: results.map((r) => ({ member: memberFromRow(strip(r, 'm')), team: teamFromRow(strip(r, 't')) })),
      env: c.env.ENV,
    };
    return c.json(res);
  });

  route(app, 'me.update', async (c) => {
    const u = requireUser(c);
    const { displayName } = await body(c, v.object({ displayName: text(40, 1) }));
    const t = now();
    await c.var.db.batch([
      c.var.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(displayName, u.id),
      c.var.db.prepare('UPDATE memberships SET display_name = ?, updated_at = ? WHERE user_id = ?').bind(displayName, t, u.id),
    ]);
    return c.json({ ok: true });
  });

  route(app, 'me.delete', async (c) => {
    const u = requireUser(c);
    const owns = await c.var.db
      .prepare('SELECT name FROM teams WHERE owner_id = ? AND deleted_at IS NULL LIMIT 1')
      .bind(u.id)
      .first<{ name: string }>();
    if (owns)
      throw new HttpError(409, 'conflict', `Transfer or delete ${owns.name} before deleting your account.`);
    const t = now();
    await c.var.db.batch([
      c.var.db
        .prepare(`UPDATE memberships SET status = 'removed', removed_at = ?, updated_at = ?, display_name = 'Former member', user_id = NULL WHERE user_id = ?`)
        .bind(t, t, u.id),
      c.var.db.prepare('DELETE FROM credentials WHERE user_id = ?').bind(u.id),
      c.var.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
      c.var.db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(u.id),
      c.var.db.prepare('DELETE FROM calendar_tokens WHERE user_id = ?').bind(u.id),
      c.var.db.prepare(`UPDATE users SET display_name = 'Deleted user', deleted_at = ? WHERE id = ?`).bind(t, u.id),
    ]);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  route(app, 'me.export', async (c) => {
    const u = requireUser(c);
    const [user, members, rsvps, creds] = await c.var.db.batch([
      c.var.db.prepare('SELECT id, display_name, created_at FROM users WHERE id = ?').bind(u.id),
      c.var.db
        .prepare(`SELECT m.id, m.role, m.jersey, m.positions, m.status, m.joined_at, t.name AS team FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ?`)
        .bind(u.id),
      c.var.db
        .prepare(`SELECT r.event_id, e.title, e.starts_at, r.status, r.note, r.attended, r.updated_at FROM rsvps r JOIN memberships m ON m.id = r.member_id JOIN events e ON e.id = r.event_id WHERE m.user_id = ?`)
        .bind(u.id),
      c.var.db.prepare('SELECT nickname, created_at, last_used_at, backed_up FROM credentials WHERE user_id = ?').bind(u.id),
    ]);
    c.header('Content-Disposition', 'attachment; filename="phaseplay-export.json"');
    return c.json({
      exportedAt: new Date().toISOString(),
      user: user!.results[0],
      memberships: members!.results,
      rsvps: rsvps!.results,
      passkeys: creds!.results,
    });
  });

  route(app, 'me.signout_all', async (c) => {
    const u = requireUser(c);
    await c.var.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run();
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  route(app, 'me.passkeys.list', async (c) => {
    const u = requireUser(c);
    const { results } = await c.var.db
      .prepare('SELECT id, nickname, created_at, last_used_at, backed_up FROM credentials WHERE user_id = ? ORDER BY created_at')
      .bind(u.id)
      .all<Record<string, unknown>>();
    const out: Passkey[] = results.map((r) => ({
      id: r.id as string,
      nickname: (r.nickname as string | null) ?? null,
      createdAt: r.created_at as number,
      lastUsedAt: (r.last_used_at as number | null) ?? null,
      backedUp: bool(r.backed_up),
    }));
    return c.json({ passkeys: out });
  });

  route(app, 'me.passkeys.options', async (c) => {
    const u = requireUser(c);
    const { results } = await c.var.db
      .prepare('SELECT id, transports FROM credentials WHERE user_id = ?')
      .bind(u.id)
      .all<{ id: string; transports: string | null }>();
    return c.json(await registrationOptions(c, 'add', u, results));
  });

  route(app, 'me.passkeys.add', async (c) => {
    const u = requireUser(c);
    const input = await body(c, v.object({ challengeId: Id, response: v.record(v.string(), v.unknown()), nickname: v.optional(v.nullable(text(40))) }));
    const ch = await takeChallenge(c, input.challengeId, 'add');
    if (ch.userId !== u.id) throw new HttpError(400, 'bad_request', 'Mismatched challenge');
    const cred = await verifyRegistration(c, ch.challenge, input.response);
    await insertCredential(c.var.db, u.id, cred, input.nickname ?? null).run();
    return c.json({ ok: true, id: cred.id }, 201);
  });

  route(app, 'me.passkeys.rename', async (c) => {
    const u = requireUser(c);
    const { nickname } = await body(c, v.object({ nickname: text(40, 1) }));
    const r = await c.var.db
      .prepare('UPDATE credentials SET nickname = ? WHERE id = ? AND user_id = ?')
      .bind(nickname, c.req.param('credentialId'), u.id)
      .run();
    if (!r.meta.changes) throw notFound();
    return c.json({ ok: true });
  });

  route(app, 'me.passkeys.remove', async (c) => {
    const u = requireUser(c);
    // Never remove the last passkey: the account would be locked unless recovery codes remain.
    const r = await c.var.db
      .prepare(
        'DELETE FROM credentials WHERE id = ? AND user_id = ? AND (SELECT count(*) FROM credentials WHERE user_id = ?) > 1',
      )
      .bind(c.req.param('credentialId'), u.id, u.id)
      .run();
    if (!r.meta.changes)
      throw new HttpError(409, 'conflict', "You can't remove your only passkey. Add another first.");
    return c.json({ ok: true });
  });

  route(app, 'me.recovery.regenerate', async (c) => {
    const u = requireUser(c);
    const { codes, stmts } = await recoveryCodeStatements(c, u.id);
    await c.var.db.batch(stmts);
    return c.json({ recoveryCodes: codes });
  });

  route(app, 'me.calendar.create', async (c) => {
    const u = requireUser(c);
    const input = await body(c, v.object({ teamId: v.nullable(Id), scope: v.picklist(['me', 'team']) }));
    if (input.teamId) {
      const m = await c.var.db
        .prepare(`SELECT role FROM memberships WHERE team_id = ? AND user_id = ? AND status = 'active'`)
        .bind(input.teamId, u.id)
        .first<{ role: string }>();
      if (!m) throw notFound();
      if (input.scope === 'team' && m.role === 'player') throw new HttpError(403, 'forbidden', 'Team feeds are for staff');
    }
    const token = randomToken(16);
    const id = uuidv7();
    await c.var.db
      .prepare('INSERT INTO calendar_tokens (id, token_hash, user_id, team_id, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, await sha256Base64Url(token), u.id, input.teamId, input.scope, now())
      .run();
    return c.json({ id, token, path: `/cal/${token}.ics` }, 201);
  });

  route(app, 'me.calendar.list', async (c) => {
    const u = requireUser(c);
    const { results } = await c.var.db
      .prepare('SELECT id, team_id, scope, created_at FROM calendar_tokens WHERE user_id = ? AND revoked_at IS NULL')
      .bind(u.id)
      .all();
    return c.json({ feeds: results });
  });

  route(app, 'me.calendar.revoke', async (c) => {
    const u = requireUser(c);
    await c.var.db
      .prepare('UPDATE calendar_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?')
      .bind(now(), c.req.param('feedId'), u.id)
      .run();
    return c.json({ ok: true });
  });
}
