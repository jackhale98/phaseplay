/** Web Push (PLAN.md M7): per-device subscriptions, per-user topics. See docs/architecture.md §Push. */
import type { Hono } from 'hono';
import * as v from 'valibot';
import {
  NotifyPrefs,
  PushSubscriptionInput,
  PushUnsubscribe,
  sha256Base64Url,
} from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { HttpError, badRequest, body, now } from '../lib/http';
import { requireUser } from '../auth/session';
import { vapidKeys } from '../lib/push/vapid';
import { isPushEndpoint } from '../lib/push/send';
import { flushNotifications, payloadJson } from '../lib/notify';

/** Devices kept per user; the oldest beyond this is dropped. */
const MAX_DEVICES = 10;

export type PushDevice = {
  id: string;
  label: string | null;
  createdAt: number;
  lastOkAt: number | null;
};

export function pushRoutes(app: Hono<AppEnv>) {
  route(app, 'push.key', async (c) => {
    const u = requireUser(c);
    const [keys, { results }] = await Promise.all([
      vapidKeys(c.var.db),
      c.var.db
        .prepare(
          'SELECT id, label, created_at, last_ok_at FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC',
        )
        .bind(u.id)
        .all<{ id: string; label: string | null; created_at: number; last_ok_at: number | null }>(),
    ]);
    const devices: PushDevice[] = results.map((r) => ({
      id: r.id,
      label: r.label,
      createdAt: r.created_at,
      lastOkAt: r.last_ok_at,
    }));
    return c.json({ publicKey: keys.publicKey, devices });
  });

  route(app, 'push.subscribe', async (c) => {
    const u = requireUser(c);
    const input = await body(c, PushSubscriptionInput);
    if (!isPushEndpoint(input.endpoint))
      throw badRequest("This browser's push service isn't supported");
    const id = await sha256Base64Url(input.endpoint);
    const t = now();
    // The same browser signing in as someone else moves the device to them.
    await c.var.db.batch([
      c.var.db
        .prepare(
          `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, label, created_at, failures)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
             auth = excluded.auth, label = excluded.label, failures = 0`,
        )
        .bind(id, u.id, input.endpoint, input.keys.p256dh, input.keys.auth, input.label, t),
      c.var.db
        .prepare(
          `DELETE FROM push_subscriptions WHERE user_id = ?1 AND id NOT IN
             (SELECT id FROM push_subscriptions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2)`,
        )
        .bind(u.id, MAX_DEVICES),
    ]);
    return c.json({ ok: true, id }, 201);
  });

  route(app, 'push.unsubscribe', async (c) => {
    const u = requireUser(c);
    const { endpoint } = await body(c, PushUnsubscribe);
    const r = await c.var.db
      .prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
      .bind(endpoint, u.id)
      .run();
    return c.json({ ok: true, removed: r.meta.changes });
  });

  route(app, 'push.test', async (c) => {
    const u = requireUser(c);
    await body(c, v.object({}));
    const t = now();
    const payload = payloadJson('test', null, {
      title: 'Phaseplay notifications are on',
      body: "This is how you'll hear about schedule changes and team sheets.",
      url: '/settings/notifications',
      tag: 'test',
    });
    const r = await c.var.db
      .prepare(
        `INSERT INTO push_queue (id, user_id, payload, created_at, attempts, next_at)
         SELECT lower(hex(randomblob(16))), u.id, ?, ?, 0, ? FROM users u
         WHERE u.id = ? AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)`,
      )
      .bind(payload, t, t, u.id)
      .run();
    if (!r.meta.changes)
      throw new HttpError(409, 'conflict', 'Turn on notifications on this device first');
    flushNotifications(c);
    return c.json({ ok: true });
  });

  route(app, 'me.notify', async (c) => {
    const u = requireUser(c);
    const notify = await body(c, NotifyPrefs);
    await c.var.db
      .prepare('UPDATE users SET notify_prefs = ? WHERE id = ?')
      .bind(JSON.stringify(notify), u.id)
      .run();
    return c.json({ notify });
  });
}
