/**
 * VAPID (RFC 8292): the server's P-256 key pair identifies it to push services. The pair is made
 * on first use and kept in `server_keys`, so there is no secret to set up. Signed JWTs are cached
 * in memory per push-service origin for up to 12 h (signing costs CPU on every send otherwise).
 */
import { b64u } from './encrypt';

const KEY_ID = 'vapid';
const JWT_TTL = 12 * 3600e3;
/** Re-sign a little before expiry so a token never expires in flight. */
const JWT_MARGIN = 10 * 60e3;

export type Vapid = { publicKey: string; privateKey: CryptoKey };

let cached: Vapid | null = null;
const jwts = new Map<string, { token: string; exp: number }>();

/** Tests only: forget the in-memory key and tokens. */
export function resetVapidCache() {
  cached = null;
  jwts.clear();
}

const ES256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;

async function importPrivate(jwk: JsonWebKey) {
  return crypto.subtle.importKey('jwk', jwk, ES256, false, ['sign']);
}

/** Load (or create on first use) the server's VAPID key pair. One query once warm: zero. */
export async function vapidKeys(db: D1Database): Promise<Vapid> {
  if (cached) return cached;
  let row = await db
    .prepare('SELECT public_key, private_key FROM server_keys WHERE id = ?')
    .bind(KEY_ID)
    .first<{ public_key: string; private_key: string }>();
  if (!row) {
    const pair = (await crypto.subtle.generateKey(ES256, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const pub = b64u(
      new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
    );
    const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
    // Two isolates racing on first use: the first insert wins and both read it back.
    const [, read] = await db.batch([
      db
        .prepare(
          'INSERT INTO server_keys (id, public_key, private_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
        )
        .bind(KEY_ID, pub, JSON.stringify(jwk), Date.now()),
      db.prepare('SELECT public_key, private_key FROM server_keys WHERE id = ?').bind(KEY_ID),
    ]);
    row = read!.results[0] as { public_key: string; private_key: string };
  }
  cached = {
    publicKey: row.public_key,
    privateKey: await importPrivate(JSON.parse(row.private_key) as JsonWebKey),
  };
  return cached;
}

const enc = new TextEncoder();
const part = (o: object) => b64u(enc.encode(JSON.stringify(o)));

/** The `Authorization: vapid t=…, k=…` header value for a push endpoint. */
export async function vapidAuth(
  keys: Vapid,
  endpoint: string,
  subject: string,
  now = Date.now(),
): Promise<string> {
  const aud = new URL(endpoint).origin;
  let jwt = jwts.get(aud);
  if (!jwt || jwt.exp - JWT_MARGIN < now) {
    const exp = now + JWT_TTL;
    const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp: Math.floor(exp / 1000), sub: subject })}`;
    // WebCrypto ECDSA signatures are already JOSE's r || s form.
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keys.privateKey,
      enc.encode(unsigned),
    );
    jwt = { token: `${unsigned}.${b64u(new Uint8Array(sig))}`, exp };
    jwts.set(aud, jwt);
  }
  return `vapid t=${jwt.token}, k=${keys.publicKey}`;
}

/** Drop a cached token after a push service rejected it (401/403). */
export function forgetJwt(endpoint: string) {
  jwts.delete(new URL(endpoint).origin);
}
