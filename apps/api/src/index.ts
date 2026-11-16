import { createApp } from './app';
import type { Env } from './env';
import { scheduled } from './cron';
import { DOCUMENT_HEADERS } from './headers';

const app = createApp();

/**
 * Static assets are served by Workers Assets before this Worker runs. We only see requests that
 * matched no file: the API, calendar feeds, and SPA deep links (served the 200.html shell).
 */
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.hostname === 'www.phaseplay.app') {
      url.hostname = 'phaseplay.app';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cal/')) return app.fetch(req, env, ctx);
    if ((req.method === 'GET' || req.method === 'HEAD') && !/\.[a-z0-9]{2,5}$/i.test(url.pathname)) {
      const shell = await env.ASSETS.fetch(new Request(new URL('/200', url), req));
      const res = new Response(shell.body, { status: shell.ok ? 200 : shell.status, headers: shell.headers });
      for (const [k, v] of Object.entries(DOCUMENT_HEADERS)) res.headers.set(k, v);
      res.headers.set('Cache-Control', 'no-cache');
      return res;
    }
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduled(env));
  },
} satisfies ExportedHandler<Env>;
