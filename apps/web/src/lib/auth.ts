/** Passkey flows (docs/architecture.md §Auth and sessions). */
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api, v1 } from './api';
import { app } from './data/app.svelte';

export { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill };

type RegOpts = { challengeId: string; options: PublicKeyCredentialCreationOptionsJSON };
type AuthOpts = { challengeId: string; options: PublicKeyCredentialRequestOptionsJSON };

export function friendlyWebAuthnError(e: unknown): string {
  const name = (e as Error)?.name;
  if (name === 'NotAllowedError') return 'Passkey request was cancelled or timed out.';
  if (name === 'InvalidStateError') return 'This device already has a passkey for this account.';
  if (name === 'SecurityError')
    return "Passkeys only work on phaseplay.app. Check you're on the right site.";
  if (name === 'NotSupportedError')
    return "This browser doesn't support passkeys. Try Safari, Chrome or Edge.";
  return (e as Error)?.message ?? 'Something went wrong with the passkey.';
}

function deviceNickname() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'This device';
}

export async function signUp(displayName: string): Promise<string[]> {
  const o = await api<RegOpts>(v1('/auth/register/options'), {
    method: 'POST',
    body: { displayName },
  });
  const response = await startRegistration({ optionsJSON: o.options });
  const r = await api<{ recoveryCodes: string[] }>(v1('/auth/register/verify'), {
    method: 'POST',
    body: { challengeId: o.challengeId, response, nickname: deviceNickname() },
  });
  await app.signedIn();
  return r.recoveryCodes;
}

/** Sign in with a passkey. `autofill` uses conditional mediation and resolves when the user picks one. */
export async function signIn(autofill = false): Promise<void> {
  const o = await api<AuthOpts>(v1('/auth/login/options'), { method: 'POST', body: {} });
  const response = await startAuthentication({
    optionsJSON: o.options,
    useBrowserAutofill: autofill,
  });
  await api(v1('/auth/login/verify'), {
    method: 'POST',
    body: { challengeId: o.challengeId, response },
  });
  await app.signedIn();
}

export function cancelPasskey() {
  WebAuthnAbortService.cancelCeremony();
}

export async function addPasskey(nickname?: string) {
  const o = await api<RegOpts>(v1('/me/passkeys/options'), { method: 'POST', body: {} });
  const response = await startRegistration({ optionsJSON: o.options });
  await api(v1('/me/passkeys'), {
    method: 'POST',
    body: { challengeId: o.challengeId, response, nickname: nickname ?? deviceNickname() },
  });
}

export async function relink(token: string) {
  const o = await api<RegOpts & { displayName: string }>(v1('/auth/relink/options'), {
    method: 'POST',
    body: { token },
  });
  const response = await startRegistration({ optionsJSON: o.options });
  await api(v1('/auth/relink/verify'), {
    method: 'POST',
    body: { challengeId: o.challengeId, response, token, nickname: deviceNickname() },
  });
  await app.signedIn();
}

export async function recover(code: string) {
  await api(v1('/auth/recover'), { method: 'POST', body: { code } });
  await app.signedIn();
}

/** Look around the public demo team ("Phaseplay RFC") without an account. */
export async function startDemo() {
  await api(v1('/demo'), { method: 'POST', body: {} });
  await app.signedIn();
}

export async function signOut() {
  // Stop this device's notifications first (while still signed in), so a shared or borrowed phone
  // stops showing team news. Never let it hold up signing out.
  try {
    const { disablePush } = await import('#lib/features/notify/push');
    await Promise.race([disablePush(), new Promise((r) => setTimeout(r, 3000))]);
  } catch {}
  try {
    await api(v1('/auth/logout'), { method: 'POST', body: {} });
  } catch {}
  await app.signedOut();
}

/** Read `#t=<token>` from the URL fragment (tokens never reach server logs or referrers). */
export function fragmentToken(): string | null {
  const m = /[#&]t=([A-Za-z0-9_-]{16,64})/.exec(location.hash);
  return m?.[1] ?? null;
}
