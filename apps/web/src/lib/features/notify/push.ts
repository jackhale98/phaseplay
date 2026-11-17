/**
 * Web Push on this device (docs/architecture.md §Push). The browser's subscription lives with the
 * service worker; the server keeps one row per device and the user's topic preferences.
 */
import type { NotifyPrefs, PushSubscriptionInput } from '@phaseplay/shared';
import { api, v1 } from '#lib/api';

export type PushDevice = {
  id: string;
  label: string | null;
  createdAt: number;
  lastOkAt: number | null;
};
export type KeyResponse = { publicKey: string; devices: PushDevice[] };

/**
 * What this device can do:
 * - `ready`: Web Push works here
 * - `ios-install`: iPhone/iPad in the browser, push needs the app on the Home Screen (iOS 16.4+)
 * - `denied`: the user blocked notifications for this site
 * - `unsupported`: no Web Push in this browser
 */
export type PushSupport = 'ready' | 'ios-install' | 'denied' | 'unsupported';

export function isIos() {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (isIos() && !isStandalone()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ready';
}

/** The active service worker registration, or null if none shows up in time. */
async function registration(timeoutMs = 8000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
  ]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('PushManager' in window)) return null;
  const reg = await registration(3000);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

function keyBytes(b64url: string) {
  const b = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

export function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || isIos()) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/CrOS/.test(ua)) return 'Chromebook';
  return 'This device';
}

export class PushError extends Error {}

/** Ask for permission, subscribe with the server's VAPID key and register this device. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new PushError(
      permission === 'denied'
        ? 'Notifications are blocked for Phaseplay. Allow them in your browser settings.'
        : 'Notifications were not turned on.',
    );
  const reg = await registration();
  if (!reg) throw new PushError('The app is still installing. Try again in a moment.');
  const { publicKey } = await api<KeyResponse>(v1('/push/key'));
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made for another server key can't receive our messages.
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const body: PushSubscriptionInput = {
    endpoint: json.endpoint ?? sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    label: deviceLabel(),
  };
  await api(v1('/push/subscriptions'), { method: 'POST', body });
}

/** Stop notifications on this device (server first, so a failure leaves nothing half-done). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api(v1('/push/subscriptions/remove'), { method: 'POST', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe().catch(() => {});
}

export const loadDevices = () => api<KeyResponse>(v1('/push/key'));
export const sendTest = () => api(v1('/push/test'), { method: 'POST', body: {} });
export const savePrefs = (prefs: NotifyPrefs) =>
  api<{ notify: NotifyPrefs }>(v1('/me/notifications'), { method: 'PUT', body: prefs });

/** The Home prompt shows once; dismissing (or visiting settings) hides it for good on this device. */
const PROMPT_KEY = 'pp:notify-prompt';
export function promptDismissed() {
  try {
    return localStorage.getItem(PROMPT_KEY) === '1';
  } catch {
    return true;
  }
}
export function dismissPrompt() {
  try {
    localStorage.setItem(PROMPT_KEY, '1');
  } catch {}
}
