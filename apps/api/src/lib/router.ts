import type { Context, Hono } from 'hono';
import { ROUTES, type RouteId } from '@phaseplay/shared';
import type { AppEnv } from '../env';
import { requireUser } from '../auth/session';
import { requireMember } from '../tenancy';

type Handler = (c: Context<AppEnv>) => Response | Promise<Response>;

/** Every registered route id, so the tenancy test can assert the table and the app agree. */
export const registered = new Set<RouteId>();

/**
 * Register a handler for a route id from packages/shared/api-routes.ts. Auth comes from the
 * table: `user` routes require a session; `team` routes run requireMember with the table's
 * action before the handler. Handlers can't skip it.
 */
export function route(app: Hono<AppEnv>, id: RouteId, handler: Handler) {
  const def = ROUTES[id];
  registered.add(id);
  const method = def.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  app[method](def.path, async (c) => {
    if (def.auth === 'user') requireUser(c);
    if (def.auth === 'team') {
      const action = 'action' in def ? def.action : undefined;
      if (!action) throw new Error(`Route ${id} has no action`);
      await requireMember(c, c.req.param('teamId') ?? '', action);
    }
    return handler(c);
  });
}
