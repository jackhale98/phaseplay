import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { newSession, rateLimit } from '../auth/session';
import { ensureDemo } from '../seed/load-demo';
import { DEMO_USER_ID } from '../seed/demo';

/**
 * Public demo: anyone can look around "Phaseplay RFC" as its coach before signing up. The demo
 * account has no passkey and the app middleware rejects every write it makes (see app.ts), so
 * visitors can't change anything for each other.
 */
export function demoRoutes(app: Hono<AppEnv>) {
  route(app, 'demo.start', async (c) => {
    await rateLimit(c, 'demo');
    await ensureDemo(c.var.db);
    await (await newSession(c, DEMO_USER_ID)).run();
    return c.json({ ok: true });
  });
}
