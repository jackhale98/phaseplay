import { Hono } from 'hono';
import type { AppEnv } from './env';
import { HttpError } from './lib/http';
import { countingDb } from './lib/db';
import { loadSession } from './auth/session';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { teamRoutes } from './routes/teams';
import { crestRoutes } from './routes/crest';
import { inventoryRoutes } from './routes/inventory';
import { pushRoutes } from './routes/push';
import { memberRoutes } from './routes/members';
import { eventRoutes } from './routes/events';
import { proposalRoutes } from './routes/proposals';
import { sheetRoutes } from './routes/sheets';
import { playRoutes } from './routes/plays';
import { drillRoutes } from './routes/drills';
import { practiceRoutes } from './routes/practice';
import { matchRoutes } from './routes/match';
import { statsRoutes } from './routes/stats';
import { calendarRoutes } from './routes/calendar';
import { syncRoutes } from './routes/sync';
import { testRoutes } from './routes/test';
import { demoRoutes } from './routes/demo';
import { DEMO_USER_ID } from './seed/demo';

export function origins(env: AppEnv['Bindings']) {
  return env.ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEMO_ALLOWED = new Set(['/api/v1/demo', '/api/v1/invites/preview']);

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
    // The public demo account is read-only on the server; the app keeps demo edits on-device.
    if (
      c.var.user?.id === DEMO_USER_ID &&
      !SAFE.has(c.req.method) &&
      !DEMO_ALLOWED.has(c.req.path) &&
      // Signing in/up/out, recovery and device links replace the demo session; they're fine.
      !c.req.path.startsWith('/api/v1/auth/')
    )
      throw new HttpError(
        403,
        'demo',
        "This is the demo team, so changes aren't saved. Create your own team to keep your work.",
      );

    await next();

    c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    if (c.env.ENV !== 'production') c.header('x-pp-queries', String(counter.n));
  });

  app.get('/api/health', (c) => c.json({ ok: true, version: c.env.VERSION, env: c.env.ENV }));

  authRoutes(app);
  demoRoutes(app);
  meRoutes(app);
  teamRoutes(app);
  crestRoutes(app);
  inventoryRoutes(app);
  pushRoutes(app);
  memberRoutes(app);
  eventRoutes(app);
  proposalRoutes(app);
  sheetRoutes(app);
  playRoutes(app);
  drillRoutes(app);
  practiceRoutes(app);
  matchRoutes(app);
  statsRoutes(app);
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
