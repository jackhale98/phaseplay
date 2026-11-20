/**
 * Existing teams must behave exactly as before configurable base roles: with no overrides
 * (`teams.role_permissions` NULL), `can()` must return what the pre-change matrix returned. The
 * matrix below is a frozen copy of PERMISSIONS as it was before the change; never derive it from
 * the current code.
 */
import { describe, expect, it } from 'vitest';
import { can, GRANTABLE, ROLES, type Action, type Role } from '../src';

const O = 'owner',
  A = 'admin',
  C = 'coach',
  M = 'manager',
  P = 'player';
const TODAY: Record<string, readonly Role[]> = {
  'team.view': [O, A, C, M, P],
  'team.manage': [O, A],
  'team.delete': [O],
  'roles.manage': [O, A],
  'members.manage': [O, A, C],
  'invites.create': [O, A, C, M],
  'invites.view': [O, A, C, M],
  'events.manage': [O, A, C, M],
  'rsvp.self': [O, A, C, M, P],
  'availability.view': [O, A, C, M],
  'sheets.manage': [O, A, C],
  'sheets.view_draft': [O, A, C],
  'plays.manage': [O, A, C],
  'plays.view_private': [O, A, C],
  'drills.manage': [O, A, C],
  'drills.view_private': [O, A, C],
  'practice.manage': [O, A, C],
  'practice.view_private': [O, A, C],
  'practice.run': [O, A, C, M],
  'match.record': [O, A, C, M],
  'audit.view': [O, A, C],
  'inventory.manage': [O, A, C, M],
};
/** Frozen copy of the pre-change GRANTABLE list. */
const TODAY_GRANTABLE = [
  'events.manage',
  'availability.view',
  'invites.create',
  'invites.view',
  'sheets.view_draft',
  'sheets.manage',
  'plays.view_private',
  'plays.manage',
  'drills.view_private',
  'drills.manage',
  'practice.view_private',
  'practice.manage',
  'practice.run',
  'match.record',
  'audit.view',
  'inventory.manage',
];
const ACTIONS = Object.keys(TODAY) as Action[];

describe('no overrides = exactly the pre-change matrix', () => {
  it('the action and grantable lists are unchanged', () => {
    expect([...ROLES].sort()).toEqual([O, A, C, M, P].sort());
    expect([...GRANTABLE].sort()).toEqual([...TODAY_GRANTABLE].sort());
  });

  for (const role of [O, A, C, M, P] as Role[])
    it(`${role}: every action`, () => {
      for (const a of ACTIONS) {
        const want = TODAY[a]!.includes(role);
        expect(can(role, a), `${role} ${a}`).toBe(want);
        expect(can({ role }, a), `${role} ${a} (perms)`).toBe(want);
        expect(can({ role, grants: [] }, a)).toBe(want);
        expect(can({ role, overrides: null }, a), `${role} ${a} (null overrides)`).toBe(want);
        expect(can({ role, grants: null, overrides: undefined }, a)).toBe(want);
      }
    });

  it('team-role grants add exactly what they did before', () => {
    // Every single grant, every pair, and a grant of everything (including non-grantable junk).
    const grantSets: string[][] = [
      ...ACTIONS.map((a) => [a]),
      ['practice.view_private', 'availability.view', 'sheets.view_draft'],
      ['events.manage'],
      [...ACTIONS, 'nonsense.action'],
    ];
    for (const role of [O, A, C, M, P] as Role[])
      for (const grants of grantSets)
        for (const a of ACTIONS) {
          const want =
            TODAY[a]!.includes(role) || (grants.includes(a) && TODAY_GRANTABLE.includes(a));
          expect(can({ role, grants }, a), `${role} +[${grants.join(',')}] ${a}`).toBe(want);
          expect(can({ role, grants, overrides: null }, a)).toBe(want);
        }
  });
});
