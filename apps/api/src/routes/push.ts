/** Web Push (PLAN.md M7). Contract only: handlers are being implemented. */
import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import { route } from '../lib/router';

// Until the handlers land, nothing exists yet: 404 keeps the tenancy matrix meaningful.
const notYet = (c: { json: (b: unknown, s: 404) => Response }) =>
  c.json({ error: { code: 'not_found', message: 'Coming soon' } }, 404);

export function pushRoutes(app: Hono<AppEnv>) {
  for (const id of [
    'push.key',
    'push.subscribe',
    'push.unsubscribe',
    'push.test',
    'me.notify',
  ] as const)
    route(app, id, (c) => notYet(c));
}
