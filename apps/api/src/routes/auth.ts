import type { Hono } from 'hono';
import * as v from 'valibot';
import { Id, sha256Base64Url, text, uuidv7 } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, body, now } from '../lib/http';
import {
  clearSessionCookie,
  newSession,
  normalizeRecoveryCode,
  rateLimit,
  recoveryCodeStatements,
  requireUser,
} from '../auth/session';
import {
  authenticationOptions,
  insertCredential,
  registrationOptions,
  takeChallenge,
  verifyAuthentication,
  verifyRegistration,
} from '../auth/webauthn';
import { auditStmt } from '../lib/audit';

const Finish = v.object({ challengeId: Id, response: v.record(v.string(), v.unknown()), nickname: v.optional(v.nullable(text(40))) });

export function authRoutes(app: Hono<AppEnv>) {
  route(app, 'auth.register.options', async (c) => {
    await rateLimit(c, 'register');
    const { displayName } = await body(c, v.object({ displayName: text(40, 1) }));
    const userId = uuidv7();
    const r = await registrationOptions(c, 'register', { id: userId, displayName }, [], { displayName });
    return c.json(r);
  });

  route(app, 'auth.register.verify', async (c) => {
    await rateLimit(c, 'register');
    const input = await body(c, Finish);
    const ch = await takeChallenge(c, input.challengeId, 'register');
    const cred = await verifyRegistration(c, ch.challenge, input.response);
    const userId = ch.userId!;
    const displayName = String(ch.data.displayName ?? 'Player');
    const { codes, stmts } = await recoveryCodeStatements(c, userId);
    await c.var.db.batch([
      c.var.db.prepare('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)').bind(userId, displayName, now()),
      insertCredential(c.var.db, userId, cred, input.nickname ?? null),
      await newSession(c, userId),
      ...stmts,
    ]);
    return c.json({ user: { id: userId, displayName, createdAt: now() }, recoveryCodes: codes }, 201);
  });

  route(app, 'auth.login.options', async (c) => {
    await rateLimit(c, 'login');
    return c.json(await authenticationOptions(c));
  });

  route(app, 'auth.login.verify', async (c) => {
    await rateLimit(c, 'login');
    const input = await body(c, Finish);
    const ch = await takeChallenge(c, input.challengeId, 'login');
    const auth = await verifyAuthentication(c, ch.challenge, input.response);
    await c.var.db.batch([auth.update, await newSession(c, auth.userId)]);
    return c.json({ user: { id: auth.userId, displayName: auth.displayName } });
  });

  route(app, 'auth.recover', async (c) => {
    await rateLimit(c, 'recover');
    const { code } = await body(c, v.object({ code: text(40, 8) }));
    const hash = await sha256Base64Url(normalizeRecoveryCode(code));
    const row = await c.var.db
      .prepare(
        `UPDATE recovery_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL
         AND user_id IN (SELECT id FROM users WHERE deleted_at IS NULL) RETURNING user_id`,
      )
      .bind(now(), hash)
      .first<{ user_id: string }>();
    if (!row) throw new HttpError(400, 'bad_request', "That code isn't valid or has already been used.");
    await (await newSession(c, row.user_id)).run();
    return c.json({ ok: true, mustAddPasskey: true });
  });

  /** Device re-link: a coach-issued single-use 24h link lets a player add a new passkey. */
  const relinkInvite = async (c: Parameters<Parameters<typeof route>[2]>[0], token: string) => {
    const hash = await sha256Base64Url(token);
    const row = await c.var.db
      .prepare(
        `SELECT i.id, i.team_id, i.target_member_id, m.user_id, m.display_name FROM invites i
         JOIN memberships m ON m.id = i.target_member_id AND m.team_id = i.team_id
         WHERE i.token_hash = ? AND i.kind = 'relink' AND i.revoked_at IS NULL AND i.expires_at > ?
           AND i.uses < i.max_uses AND m.status = 'active' AND m.user_id IS NOT NULL`,
      )
      .bind(hash, now())
      .first<{ id: string; team_id: string; target_member_id: string; user_id: string; display_name: string }>();
    if (!row) throw new HttpError(410, 'gone', 'This link has expired or was already used. Ask your coach for a new one.');
    return row;
  };

  route(app, 'auth.relink.options', async (c) => {
    await rateLimit(c, 'relink');
    const { token } = await body(c, v.object({ token: v.pipe(v.string(), v.minLength(16), v.maxLength(64)) }));
    const inv = await relinkInvite(c, token);
    const { results } = await c.var.db
      .prepare('SELECT id, transports FROM credentials WHERE user_id = ?')
      .bind(inv.user_id)
      .all<{ id: string; transports: string | null }>();
    const r = await registrationOptions(c, 'relink', { id: inv.user_id, displayName: inv.display_name }, results, { inviteId: inv.id });
    return c.json({ ...r, displayName: inv.display_name });
  });

  route(app, 'auth.relink.verify', async (c) => {
    await rateLimit(c, 'relink');
    const input = await body(c, v.object({ ...Finish.entries, token: v.pipe(v.string(), v.minLength(16), v.maxLength(64)) }));
    const inv = await relinkInvite(c, input.token);
    const ch = await takeChallenge(c, input.challengeId, 'relink');
    if (ch.userId !== inv.user_id || ch.data.inviteId !== inv.id) throw new HttpError(400, 'bad_request', 'Mismatched link');
    const cred = await verifyRegistration(c, ch.challenge, input.response);
    const used = await c.var.db
      .prepare('UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses RETURNING id')
      .bind(inv.id)
      .first();
    if (!used) throw new HttpError(410, 'gone', 'This link was already used.');
    await c.var.db.batch([
      insertCredential(c.var.db, inv.user_id, cred, input.nickname ?? 'New device'),
      await newSession(c, inv.user_id),
      auditStmt(c.var.db, { teamId: inv.team_id, actorId: inv.user_id, action: 'member.relinked', targetType: 'member', targetId: inv.target_member_id }),
    ]);
    return c.json({ ok: true });
  });

  route(app, 'auth.logout', async (c) => {
    const u = requireUser(c);
    await c.var.db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(u.sessionHash).run();
    clearSessionCookie(c);
    return c.json({ ok: true });
  });
}
