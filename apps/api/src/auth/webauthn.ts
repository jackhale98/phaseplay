import type { Context } from 'hono';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { bytesToBase64Url, uuidv7 } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { HttpError } from '../lib/http';
import { origins } from '../app';

const CHALLENGE_TTL = 5 * 60e3;
export const RP_NAME = 'Phaseplay';

type ChallengeKind = 'register' | 'login' | 'add' | 'relink';

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function storeChallenge(
  c: Context<AppEnv>,
  kind: ChallengeKind,
  challenge: string,
  userId: string | null,
  data: Record<string, unknown> = {},
) {
  const id = uuidv7();
  await c.var.db
    .prepare(
      'INSERT INTO auth_challenges (id, challenge, kind, user_id, data, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(id, challenge, kind, userId, JSON.stringify(data), Date.now() + CHALLENGE_TTL)
    .run();
  return id;
}

/** Fetch and delete in one query: challenges are single use. */
export async function takeChallenge(c: Context<AppEnv>, id: string, kind: ChallengeKind) {
  const row = await c.var.db
    .prepare('DELETE FROM auth_challenges WHERE id = ? AND kind = ? AND expires_at > ? RETURNING *')
    .bind(id, kind, Date.now())
    .first<{ challenge: string; user_id: string | null; data: string }>();
  if (!row)
    throw new HttpError(400, 'bad_request', 'This sign-in attempt expired. Please try again.');
  return {
    challenge: row.challenge,
    userId: row.user_id,
    data: JSON.parse(row.data) as Record<string, unknown>,
  };
}

export async function registrationOptions(
  c: Context<AppEnv>,
  kind: 'register' | 'add' | 'relink',
  user: { id: string; displayName: string },
  exclude: { id: string; transports: string | null }[],
  data: Record<string, unknown> = {},
) {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: c.env.RP_ID,
    userName: user.displayName,
    userDisplayName: user.displayName,
    userID: new Uint8Array(new TextEncoder().encode(user.id)) as Uint8Array<ArrayBuffer>,
    attestationType: 'none',
    excludeCredentials: exclude.map((x) => ({
      id: x.id,
      transports: x.transports ? (JSON.parse(x.transports) as AuthenticatorTransport[]) : undefined,
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  const challengeId = await storeChallenge(c, kind, options.challenge, user.id, data);
  return { challengeId, options };
}

export async function verifyRegistration(c: Context<AppEnv>, challenge: string, response: unknown) {
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: origins(c.env),
      expectedRPID: c.env.RP_ID,
      requireUserVerification: false,
    });
  } catch (e) {
    throw new HttpError(
      400,
      'bad_request',
      `Passkey could not be verified: ${(e as Error).message}`,
    );
  }
  if (!result.verified) throw new HttpError(400, 'bad_request', 'Passkey could not be verified');
  const info = result.registrationInfo;
  return {
    id: info.credential.id,
    publicKey: bytesToBase64Url(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports ? JSON.stringify(info.credential.transports) : null,
    backedUp: info.credentialBackedUp,
    deviceType: info.credentialDeviceType,
  };
}

export function insertCredential(
  db: D1Database,
  userId: string,
  cred: Awaited<ReturnType<typeof verifyRegistration>>,
  nickname: string | null,
) {
  return db
    .prepare(
      `INSERT INTO credentials (id, user_id, public_key, counter, transports, backed_up, device_type, nickname, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      cred.id,
      userId,
      cred.publicKey,
      cred.counter,
      cred.transports,
      cred.backedUp ? 1 : 0,
      cred.deviceType,
      nickname,
      Date.now(),
      Date.now(),
    );
}

export async function authenticationOptions(c: Context<AppEnv>) {
  const options = await generateAuthenticationOptions({
    rpID: c.env.RP_ID,
    userVerification: 'preferred',
    allowCredentials: [],
  });
  const challengeId = await storeChallenge(c, 'login', options.challenge, null);
  return { challengeId, options };
}

export async function verifyAuthentication(
  c: Context<AppEnv>,
  challenge: string,
  response: unknown,
) {
  const r = response as AuthenticationResponseJSON;
  if (!r || typeof r.id !== 'string')
    throw new HttpError(400, 'bad_request', 'Invalid passkey response');
  const cred = await c.var.db
    .prepare(
      `SELECT c.id, c.user_id, c.public_key, c.counter, c.transports, u.display_name FROM credentials c
       JOIN users u ON u.id = c.user_id WHERE c.id = ? AND u.deleted_at IS NULL`,
    )
    .bind(r.id)
    .first<{
      id: string;
      user_id: string;
      public_key: string;
      counter: number;
      transports: string | null;
      display_name: string;
    }>();
  if (!cred)
    throw new HttpError(
      400,
      'bad_request',
      "We don't recognise that passkey. It may have been removed.",
    );
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: r,
      expectedChallenge: challenge,
      expectedOrigin: origins(c.env),
      expectedRPID: c.env.RP_ID,
      requireUserVerification: false,
      credential: {
        id: cred.id,
        publicKey: base64UrlToBytes(cred.public_key),
        counter: cred.counter,
        transports: cred.transports
          ? (JSON.parse(cred.transports) as AuthenticatorTransport[])
          : undefined,
      },
    });
  } catch (e) {
    throw new HttpError(
      400,
      'bad_request',
      `Passkey could not be verified: ${(e as Error).message}`,
    );
  }
  if (!result.verified) throw new HttpError(400, 'bad_request', 'Passkey could not be verified');
  return {
    userId: cred.user_id,
    displayName: cred.display_name,
    update: c.var.db
      .prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?')
      .bind(result.authenticationInfo.newCounter, Date.now(), cred.id),
  };
}
