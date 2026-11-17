/** Kit and inventory (PLAN.md M9). Contract only: handlers are being implemented. */
import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import { route } from '../lib/router';

// Until the handlers land, nothing exists yet: 404 keeps the tenancy matrix meaningful.
const notYet = (c: { json: (b: unknown, s: 404) => Response }) =>
  c.json({ error: { code: 'not_found', message: 'Coming soon' } }, 404);

export function inventoryRoutes(app: Hono<AppEnv>) {
  for (const id of [
    'inventory.history',
    'inventory.put',
    'inventory.delete',
    'inventory.assign',
    'inventory.return',
    'inventory.lost',
    'inventory.found',
    'inventory.retire',
    'inventory.split',
    'inventory.handoff.create',
    'inventory.handoff.accept',
    'inventory.handoff.decline',
  ] as const)
    route(app, id, (c) => notYet(c));
}
