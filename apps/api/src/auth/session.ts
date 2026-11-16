import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { randomToken, sha256Base64Url } from '@phaseplay/shared';
import type { AppEnv, SessionUser } from '../env';
import { HttpError } from '../lib/http';

export const SESSION_TTL = 30 * 86400e3;
const HALF_LIFE = SESSION_TTL / 2;

export const cookieName = (c: Context<AppEnv>) =>
  c.env.ENV === 'production' ? '__Host-pp_session' : 'pp_session';

function writeCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, cookieName(c), token, {
    httpOnly: true,
    secure: c.env.ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL / 1000,
  });
}

/** Load the session (1 query); slide expiry at half-life (1 more query, rarely). */
export async function loadSession(c: Context<AppEnv>): Promise<SessionUser | null> {
  const raw = getCookie(c, cookieName(c));
  if (!raw || raw.length > 100) return null;
  const hash = await sha256Base64Url(raw);
  const t = Date.now();
  const row = await c.var.db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id_hash = ? AND s.expires_at > ? AND u.deleted_at IS NULL`,
    )
    .bind(hash, t)
    .first<{ user_id: string; expires_at: number; display_name: string }>();
  if (!row) return null;
  let expiresAt = row.expires_at;
  if (expiresAt - t < HALF_LIFE) {
    expiresAt = t + SESSION_TTL;
    await c.var.db
      .prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id_hash = ?')
      .bind(expiresAt, t, hash)
      .run();
    writeCookie(c, raw);
  }
  return { id: row.user_id, displayName: row.display_name, sessionHash: hash, expiresAt };
}

/** Returns the statement that creates the session, so callers can batch it with other writes. */
export async function newSession(c: Context<AppEnv>, userId: string) {
  const token = randomToken(32);
  const hash = await sha256Base64Url(token);
  const t = Date.now();
  writeCookie(c, token);
  return c.var.db
    .prepare(
      'INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(hash, userId, t, t + SESSION_TTL, t);
}

export function clearSessionCookie(c: Context<AppEnv>) {
  deleteCookie(c, cookieName(c), { path: '/', secure: c.env.ENV === 'production' });
}

export function requireUser(c: Context<AppEnv>): SessionUser {
  const u = c.var.user;
  if (!u) throw new HttpError(401, 'unauthenticated', 'Please sign in');
  return u;
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** 10 single-use recovery codes like `k7mq-x2vp-9hts` (≈59 bits each). */
export function generateRecoveryCodes(count = 10): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    const chars = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
    out.push(`${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`);
  }
  return out;
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function recoveryCodeStatements(c: Context<AppEnv>, userId: string) {
  const codes = generateRecoveryCodes();
  const t = Date.now();
  const stmts = [c.var.db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(userId)];
  for (const code of codes) {
    const hash = await sha256Base64Url(normalizeRecoveryCode(code));
    stmts.push(
      c.var.db
        .prepare('INSERT INTO recovery_codes (code_hash, user_id, created_at) VALUES (?, ?, ?)')
        .bind(hash, userId, t),
    );
  }
  return { codes, stmts };
}

export async function rateLimit(c: Context<AppEnv>, scope: string, key?: string) {
  const rl = c.env.RL_AUTH;
  if (!rl) return;
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const { success } = await rl.limit({ key: `${scope}:${key ?? ip}` });
  if (!success)
    throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in a minute.');
}
