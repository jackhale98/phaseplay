/**
 * VAPID (RFC 8292): the server's P-256 key pair identifies it to push services. The pair is made
 * on first use and kept in `server_keys`. Signed JWTs are cached in memory per push-service origin
 * for up to 12 h (signing costs CPU on every send otherwise).
 *
 * With the `PUSH_KEY_SECRET` Worker secret set, the private key is stored encrypted (AES-GCM with a
 * key derived from the secret by HKDF), so a copy of the database alone can't send pushes. A key
 * stored in plain text is encrypted the first time the secret is available. Never change the
 * secret once set: the stored key could no longer be read (recovery: delete the `vapid` row; a new
 * key is made and everyone turns notifications on again).
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

const ENC_PREFIX = 'enc:v1:';
const enc8 = new TextEncoder();
const fromB64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));

async function wrapKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc8.encode(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc8.encode('phaseplay'),
      info: enc8.encode('vapid-key v1'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt the private JWK for storage: `enc:v1:<iv>:<ciphertext>` (base64url). */
export async function sealPrivateKey(jwkJson: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc8.encode(KEY_ID) },
    await wrapKey(secret),
    enc8.encode(jwkJson),
  );
  return `${ENC_PREFIX}${b64u(iv)}:${b64u(new Uint8Array(ct))}`;
}

/** The stored private key as JWK JSON (decrypting it if it was sealed). */
export async function openPrivateKey(stored: string, secret: string | undefined): Promise<string> {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  if (!secret) throw new Error('The VAPID key is encrypted but PUSH_KEY_SECRET is not set');
  const [iv, ct] = stored.slice(ENC_PREFIX.length).split(':') as [string, string];
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64u(iv), additionalData: enc8.encode(KEY_ID) },
    await wrapKey(secret),
    fromB64u(ct),
  );
  return new TextDecoder().decode(pt);
}

/**
 * Load (or create on first use) the server's VAPID key pair. One query once warm: zero. `secret`
 * is the PUSH_KEY_SECRET Worker secret, if set.
 */
export async function vapidKeys(db: D1Database, secret?: string): Promise<Vapid> {
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
        .bind(
          KEY_ID,
          pub,
          secret ? await sealPrivateKey(JSON.stringify(jwk), secret) : JSON.stringify(jwk),
          Date.now(),
        ),
      db.prepare('SELECT public_key, private_key FROM server_keys WHERE id = ?').bind(KEY_ID),
    ]);
    row = read!.results[0] as { public_key: string; private_key: string };
  }
  const jwkJson = await openPrivateKey(row.private_key, secret);
  if (secret && !row.private_key.startsWith(ENC_PREFIX)) {
    // The secret was added after the key was made: store it encrypted from now on.
    await db
      .prepare('UPDATE server_keys SET private_key = ? WHERE id = ? AND private_key = ?')
      .bind(await sealPrivateKey(jwkJson, secret), KEY_ID, row.private_key)
      .run();
  }
  cached = {
    publicKey: row.public_key,
    privateKey: await importPrivate(JSON.parse(jwkJson) as JsonWebKey),
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
