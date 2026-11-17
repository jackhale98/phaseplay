/**
 * Web Push message encryption (RFC 8291, `aes128gcm` content coding from RFC 8188) with WebCrypto
 * only: the `web-push` npm package needs Node's crypto, which Workers don't have.
 */
import { bytesToBase64Url } from '@phaseplay/shared';

export const b64u = bytesToBase64Url;

export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  let t = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const b = atob(t);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const enc = new TextEncoder();
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

export type EncryptOptions = {
  /** Fixed sender key pair and salt, for the RFC test vector only. A fresh pair is the rule. */
  senderKeys?: CryptoKeyPair;
  salt?: Uint8Array;
  recordSize?: number;
};

/**
 * Encrypt one push message for a subscription (`keys.p256dh`, `keys.auth`, both base64url).
 * Returns the request body: the RFC 8188 header (salt, record size, sender public key) followed by
 * a single AES-128-GCM record.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  opts: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('Bad p256dh key');
  if (authSecret.length < 16) throw new Error('Bad auth secret');
  const rs = opts.recordSize ?? 4096;
  // One record only: plaintext + delimiter (0x02) + 16-byte tag must fit in rs.
  if (plaintext.length + 17 > rs) throw new Error('Push payload too large');

  const sender =
    opts.senderKeys ??
    ((await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey('raw', sender.publicKey)) as ArrayBuffer,
  );
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, P256, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      // workers-types spells `public` as `$public`; the runtime takes the standard name.
      { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      sender.privateKey,
      256,
    ),
  );

  // IKM = HKDF(salt = auth_secret, ikm = ecdh_secret, info = "WebPush: info" 0x00 ua_public as_public)
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record),
  );

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}
