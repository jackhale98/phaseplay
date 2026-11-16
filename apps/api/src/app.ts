import { Hono } from 'hono';
import type { AppEnv } from './env';
import { HttpError } from './lib/http';
import { countingDb } from './lib/db';
import { loadSession } from './auth/session';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { teamRoutes } from './routes/teams';
import { memberRoutes } from './routes/members';
import { eventRoutes } from './routes/events';
import { sheetRoutes } from './routes/sheets';
import { playRoutes } from './routes/plays';
import { drillRoutes } from './routes/drills';
import { practiceRoutes } from './routes/practice';
import { matchRoutes } from './routes/match';
import { calendarRoutes } from './routes/calendar';
import { syncRoutes } from './routes/sync';
import { testRoutes } from './routes/test';

export function origins(env: AppEnv['Bindings']) {
  return env.ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const counter = { n: 0 };
    c.set('queries', counter);
    c.set('db', countingDb(c.env.DB, counter));
    c.set('requestId', crypto.randomUUID());
    c.set('user', null);

    // CSRF: state-changing requests must come from an allowlisted Origin. The API is same-origin
    // with the app, so there is no CORS: cross-origin browsers can't read responses either.
    if (!SAFE.has(c.req.method) && c.req.path.startsWith('/api/')) {
      const origin = c.req.header('origin');
      if (!origin || !origins(c.env).includes(origin))
        throw new HttpError(403, 'forbidden', 'Cross-origin request blocked');
    }
    if (c.req.path.startsWith('/api/')) c.set('user', await loadSession(c));

    await next();

    c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    if (c.env.ENV !== 'production') c.header('x-pp-queries', String(counter.n));
  });

  app.get('/api/health', (c) => c.json({ ok: true, version: c.env.VERSION, env: c.env.ENV }));

  authRoutes(app);
  meRoutes(app);
  teamRoutes(app);
  memberRoutes(app);
  eventRoutes(app);
  sheetRoutes(app);
  playRoutes(app);
  drillRoutes(app);
  practiceRoutes(app);
  matchRoutes(app);
  calendarRoutes(app);
  syncRoutes(app);
  if (__TEST_AUTH__) testRoutes(app);

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(
        { error: { code: err.code, message: err.message, ...(err.extra ?? {}) } },
        err.status,
      );
    }
    console.error(
      JSON.stringify({
        requestId: c.var.requestId,
        path: c.req.path,
        err: String(err),
        stack: (err as Error).stack,
      }),
    );
    return c.json(
      { error: { code: 'internal', message: 'Something went wrong', requestId: c.var.requestId } },
      500,
    );
  });
  return app;
}
