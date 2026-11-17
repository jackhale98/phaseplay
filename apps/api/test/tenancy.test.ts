/**
 * The tenancy matrix (docs/testing-ci.md §Must-have suites), generated from the route table.
 * Every `team` route is called as anonymous, another team's member, a removed member and each
 * role. Disallowed roles must get 403, outsiders 404, anonymous 401, and nobody ever a 500.
 */
import { describe, expect, it } from 'vitest';
import { ROLES, ROUTES, can, routePath, uuidv7, type RouteId } from '@phaseplay/shared';
import { call, fixtureTeam } from './helpers';
import { registered } from '../src/lib/router';

/** Routes whose handler adds rules beyond the matrix action, and the roles it narrows. */
const REFINED: Partial<Record<RouteId, string[]>> = {
  'members.update': ['manager'],
};

const teamRoutes = (Object.keys(ROUTES) as RouteId[]).filter((id) => ROUTES[id].auth === 'team');
const userRoutes = (Object.keys(ROUTES) as RouteId[]).filter((id) => ROUTES[id].auth === 'user');

describe('route table', () => {
  it('every route in the table has a handler and vice versa', () => {
    expect([...registered].sort()).toEqual(
      (Object.keys(ROUTES) as RouteId[]).filter((id) => id !== 'health').sort(),
    );
  });
});

describe('user routes reject anonymous', () => {
  for (const id of userRoutes) {
    it(id, async () => {
      const r = ROUTES[id];
      const path = r.path.replace(/:(\w+)/g, () => uuidv7());
      const res = await call(
        r.method,
        path,
        r.method === 'GET' || r.method === 'DELETE' ? {} : { body: {} },
      );
      expect(res.status).toBe(401);
    });
  }
});

describe('tenancy matrix', () => {
  for (const id of teamRoutes) {
    it(id, async () => {
      const a = await fixtureTeam('Team A');
      const b = await fixtureTeam('Team B');
      const r = ROUTES[id] as { method: string; path: string; action: Parameters<typeof can>[1] };
      const params: Record<string, string> = {
        teamId: a.teamId,
        memberId: a.player.memberId,
        eventId: a.eventId,
        sheetId: a.sheetId,
        playId: a.playId,
        drillId: a.drillId,
        planId: a.planId,
        inviteId: a.inviteId,
        recurrenceId: a.recurrenceId,
        roleId: a.roleId,
        seasonId: uuidv7(),
      };
      const path = routePath(id, params);
      const opts = r.method === 'GET' ? {} : { body: {} };

      expect((await call(r.method, path, opts)).status, 'anonymous').toBe(401);
      expect(
        (await call(r.method, path, { ...opts, cookie: b.owner.cookie })).status,
        'other team',
      ).toBe(404);
      expect(
        (await call(r.method, path, { ...opts, cookie: a.removed.cookie })).status,
        'removed',
      ).toBe(404);

      // Team B's owner must not reach Team A's resources through their own team id either.
      const crossPath = routePath(id, { ...params, teamId: b.teamId });
      if (crossPath.split('/').length > 6) {
        const cross = await call(r.method, crossPath, { ...opts, cookie: b.owner.cookie });
        expect(
          [400, 404, 409, 415],
          `cross-team ${cross.status} ${JSON.stringify(cross.body)}`,
        ).toContain(cross.status);
      }

      const actors = {
        owner: a.owner,
        admin: a.admin,
        coach: a.coach,
        manager: a.manager,
        player: a.player,
      };
      for (const role of [...ROLES].reverse()) {
        const res = await call(r.method, path, { ...opts, cookie: actors[role].cookie });
        expect(res.status, `${role}: ${JSON.stringify(res.body)}`).not.toBe(500);
        if (can(role, r.action)) {
          // Allowed roles pass the guard; handlers may still refine (e.g. a player editing someone else).
          const refined = REFINED[id]?.includes(role) ?? false;
          if (!refined)
            expect([401, 403], `${role} allowed: ${JSON.stringify(res.body)}`).not.toContain(
              res.status,
            );
        } else expect(res.status, `${role} denied`).toBe(403);
        expect(res.queries, `${role} query budget`).toBeLessThanOrEqual(
          id === 'teams.import' ? 45 : 6,
        );
      }
    });
  }
});
