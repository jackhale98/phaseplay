/** Send one encrypted Web Push message (RFC 8030) to a push service. */
import { encryptPayload } from './encrypt';
import { vapidAuth, type Vapid } from './vapid';

/**
 * Push services we deliver to. Subscriptions name the URL the server will POST to, so anything
 * else is refused (no server-side requests to arbitrary hosts).
 */
const PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge (Android), Samsung Internet
  'push.services.mozilla.com', // Firefox
  'notify.windows.com', // Edge on Windows
  'push.apple.com', // Safari, iOS home-screen apps
];

export function isPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type SendOptions = {
  vapid: Vapid;
  subject: string;
  /** Seconds the push service may hold the message for an offline device. */
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  fetch?: typeof fetch;
};

/** Returns the push service's HTTP status, or 0 when the request itself failed. */
export async function sendPush(target: PushTarget, payload: string, opts: SendOptions) {
  if (!isPushEndpoint(target.endpoint)) return 404;
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await encryptPayload(new TextEncoder().encode(payload), target.p256dh, target.auth);
  } catch {
    // Keys the browser gave us that don't decode: the subscription can never work.
    return 410;
  }
  try {
    const res = await (opts.fetch ?? fetch)(target.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuth(opts.vapid, target.endpoint, opts.subject),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(opts.ttl ?? 12 * 3600),
        urgency: opts.urgency ?? 'normal',
      },
      body,
      // Only the allowlisted push service: a redirect elsewhere is a failure, not followed.
      redirect: 'manual',
    });
    // Don't keep the connection busy reading a body we don't need.
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}
