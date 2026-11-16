import type { Hono } from 'hono';
import * as v from 'valibot';
import { text, uuidv7 } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { route } from '../lib/router';
import { body } from '../lib/http';
import { newSession } from '../auth/session';

/**
 * Dev/test-only login (`__TEST_AUTH__` is false in production builds, so esbuild strips
 * this module). CI greps the production bundle to prove it is absent.
 */
export function testRoutes(app: Hono<AppEnv>) {
  route(app, 'auth.test.login', async (c) => {
    if (c.env.ENV === 'production')
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    const input = await body(
      c,
      v.object({ userId: v.optional(v.string()), displayName: v.optional(text(40, 1)) }),
    );
    const id = input.userId ?? uuidv7();
    const name = input.displayName ?? 'Test Player';
    await c.var.db.batch([
      c.var.db
        .prepare(
          'INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        )
        .bind(id, name, Date.now()),
      await newSession(c, id),
    ]);
    c.header('x-pp-test-login', '1');
    return c.json({ user: { id, displayName: name } });
  });
}
