/** Web Push crypto against the RFC test vectors (no network, WebCrypto only). */
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { b64u, encryptPayload, fromB64u } from '../src/lib/push/encrypt';
import { resetVapidCache, vapidAuth, vapidKeys } from '../src/lib/push/vapid';
import { isPushEndpoint } from '../src/lib/push/send';

// RFC 8291 §5 and Appendix A.
const V = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  message:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

async function keyPair(pub: string, priv: string, usages: string[]): Promise<CryptoKeyPair> {
  const raw = fromB64u(pub);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64u(raw.slice(1, 33)),
    y: b64u(raw.slice(33, 65)),
  };
  const alg = { name: 'ECDH', namedCurve: 'P-256' };
  return {
    publicKey: await crypto.subtle.importKey('jwk', jwk, alg, true, []),
    privateKey: await crypto.subtle.importKey('jwk', { ...jwk, d: priv }, alg, true, usages),
  };
}

/** The receiving side of RFC 8291, to round-trip random messages. */
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, uaPublic: string, auth: string) {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const asKey = await crypto.subtle.importKey(
    'raw',
    asPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const secret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
    ua.privateKey,
    256,
  );
  const enc = new TextEncoder();
  const hk = async (s: Uint8Array, ikm: ArrayBuffer | Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: s, info },
        await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
        n * 8,
      ),
    );
  const info = new Uint8Array([
    ...enc.encode('WebPush: info\0'),
    ...fromB64u(uaPublic),
    ...asPublic,
  ]);
  const ikm = await hk(fromB64u(auth), secret, info, 32);
  const cek = await hk(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hk(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)),
  );
  expect(plain.at(-1)).toBe(2); // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe('RFC 8291 aes128gcm', () => {
  it('matches the RFC 8291 §5 example exactly', async () => {
    const body = await encryptPayload(fromB64u(V.plaintext), V.uaPublic, V.auth, {
      senderKeys: await keyPair(V.asPublic, V.asPrivate, ['deriveBits']),
      salt: fromB64u(V.salt),
    });
    expect(b64u(body)).toBe(V.message);
    // 86-octet header + 41 + 1 delimiter + 16 tag (the RFC's "Content-Length: 145" is off by one).
    expect(body.length).toBe(144);
  });

  it('round-trips a fresh message with a random key and salt', async () => {
    const ua = await keyPair(V.uaPublic, V.uaPrivate, ['deriveBits']);
    const text = JSON.stringify({ title: 'Team sheet: PRFC v Rivals', body: 'See who’s playing' });
    const a = await encryptPayload(new TextEncoder().encode(text), V.uaPublic, V.auth);
    const b = await encryptPayload(new TextEncoder().encode(text), V.uaPublic, V.auth);
    expect(b64u(a)).not.toBe(b64u(b)); // new sender key and salt every time
    expect(await decrypt(a, ua, V.uaPublic, V.auth)).toBe(text);
  });

  it('rejects bad keys and oversized payloads', async () => {
    await expect(encryptPayload(new Uint8Array(4), 'AAAA', V.auth)).rejects.toThrow();
    await expect(encryptPayload(new Uint8Array(5000), V.uaPublic, V.auth)).rejects.toThrow(
      /too large/,
    );
  });
});

describe('RFC 8292 VAPID', () => {
  it('makes the key pair once, stores it, and signs a verifiable ES256 JWT', async () => {
    resetVapidCache();
    const k1 = await vapidKeys(env.DB);
    resetVapidCache();
    const k2 = await vapidKeys(env.DB);
    expect(k2.publicKey).toBe(k1.publicKey);
    expect(fromB64u(k1.publicKey)).toHaveLength(65);

    const t = Date.UTC(2026, 10, 17, 12);
    const h = await vapidAuth(k1, 'https://fcm.googleapis.com/fcm/send/abc', 'https://x.test', t);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m[4]).toBe(k1.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(fromB64u(m[2]!)));
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Math.floor(t / 1000) + 12 * 3600,
      sub: 'https://x.test',
    });
    const pub = await crypto.subtle.importKey(
      'raw',
      fromB64u(k1.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      fromB64u(m[3]!),
      new TextEncoder().encode(`${m[1]}.${m[2]}`),
    );
    expect(ok).toBe(true);
    // Cached per push-service origin.
    expect(
      await vapidAuth(k1, 'https://fcm.googleapis.com/fcm/send/other', 'https://x.test', t + 1000),
    ).toBe(h);
  });

  it('only delivers to known push services', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/QH')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    expect(isPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
    expect(isPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(isPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isPushEndpoint('https://localhost:8787/x')).toBe(false);
  });
});
