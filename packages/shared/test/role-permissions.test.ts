import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  ACTIONS,
  ADMIN_ONLY,
  ALWAYS_ON,
  CONFIGURABLE,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_AREAS,
  PERMISSION_INFO,
  PERMISSIONS,
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_PRESETS,
  RolePermissionsInput,
  can,
  canChangeRole,
  canRelink,
  canRemove,
  isCustomised,
  normaliseRolePermissions,
  presetOf,
  roleSummary,
  setRoleAction,
  canRevokeInvite,
  parseRolePermissions,
  permissionPhrase,
  type RolePermissions,
} from '../src';

const club = ROLE_PRESETS.club.permissions;

describe('configurable base roles', () => {
  it('derives the configurable list from PERMISSIONS', () => {
    expect(CONFIGURABLE).toHaveLength(ACTIONS.length - ALWAYS_ON.length - ADMIN_ONLY.length);
    expect(CONFIGURABLE).toContain('members.manage');
    expect(CONFIGURABLE).not.toContain('roles.manage');
    expect(CONFIGURABLE).not.toContain('team.view');
    for (const a of CONFIGURABLE) expect(PERMISSION_AREAS).toContain(PERMISSION_INFO[a].area);
  });

  it('the default preset is exactly today', () => {
    for (const role of ROLES)
      for (const a of ACTIONS) {
        const today = (PERMISSIONS[a] as readonly string[]).includes(role);
        expect(can({ role, overrides: DEFAULT_ROLE_PERMISSIONS }, a), `${role} ${a}`).toBe(today);
        expect(can({ role, overrides: null }, a)).toBe(today);
      }
    expect(presetOf(null)).toBe('default');
    expect(presetOf(DEFAULT_ROLE_PERMISSIONS)).toBe('default');
    expect(DEFAULT_ROLE_PERMISSIONS.player).toEqual([]);
  });

  it('honours the club preset', () => {
    const coach = { role: 'coach' as const, overrides: club };
    const manager = { role: 'manager' as const, overrides: club };
    expect(can(coach, 'members.manage')).toBe(false);
    expect(can(coach, 'invites.create')).toBe(false);
    expect(can(coach, 'audit.view')).toBe(false);
    expect(can(coach, 'sheets.manage')).toBe(true);
    expect(can(coach, 'practice.manage')).toBe(true);
    expect(can(manager, 'members.manage')).toBe(true);
    expect(can(manager, 'sheets.manage')).toBe(false);
    expect(presetOf(club)).toBe('club');
    expect(isCustomised('coach', club)).toBe(true);
    expect(isCustomised('player', club)).toBe(false);
  });

  it('owner and admin ignore any configuration; always-on stays on', () => {
    const empty: RolePermissions = { coach: [], manager: [], player: [] };
    for (const a of ACTIONS) {
      expect(can({ role: 'owner', overrides: empty }, a)).toBe(true);
      expect(can({ role: 'admin', overrides: empty }, a)).toBe(a !== 'team.delete');
    }
    expect(can({ role: 'coach', overrides: empty }, 'team.view')).toBe(true);
    expect(can({ role: 'player', overrides: empty }, 'rsvp.self')).toBe(true);
    expect(can({ role: 'coach', overrides: empty }, 'events.manage')).toBe(false);
  });

  it('never lets overrides grant non-configurable actions', () => {
    const bad = {
      coach: ['roles.manage', 'team.manage'],
      manager: [],
      player: ['sheets.view_draft', 'members.manage'],
    } as unknown as RolePermissions;
    expect(can({ role: 'coach', overrides: bad }, 'roles.manage')).toBe(false);
    expect(can({ role: 'player', overrides: bad }, 'sheets.view_draft')).toBe(false);
    expect(can({ role: 'player', overrides: bad }, 'members.manage')).toBe(false);
  });

  it('team roles still add grants on top', () => {
    const cap = { role: 'player' as const, grants: ['sheets.view_draft'], overrides: club };
    expect(can(cap, 'sheets.view_draft')).toBe(true);
    const p = {
      role: 'player' as const,
      overrides: { ...club, player: ['match.record' as const] },
    };
    expect(can(p, 'match.record')).toBe(true);
    expect(can(p, 'practice.run')).toBe(false);
  });

  it('normalises dependencies', () => {
    const n = normaliseRolePermissions({
      coach: ['sheets.manage', 'plays.manage', 'members.manage'],
      manager: ['invites.create'],
      player: ['match.record', 'sheets.view_draft'],
    });
    expect(n.coach).toEqual(
      expect.arrayContaining(['sheets.view_draft', 'plays.view_private', 'invites.view']),
    );
    expect(n.manager).toEqual(['invites.create', 'invites.view']);
    expect(n.player).toEqual(['match.record']);
    // Missing roles keep their defaults.
    expect(normaliseRolePermissions({}).coach).toEqual(DEFAULT_ROLE_PERMISSIONS.coach);
  });

  it('mirrors dependencies when toggling', () => {
    let s = setRoleAction('manager', [], 'sheets.manage', true);
    expect(s).toEqual(['sheets.manage', 'sheets.view_draft']);
    s = setRoleAction('manager', s, 'sheets.view_draft', false);
    expect(s).toEqual([]);
    s = setRoleAction(
      'manager',
      ['members.manage', 'invites.create', 'invites.view'],
      'invites.view',
      false,
    );
    expect(s).toEqual([]);
    s = setRoleAction('coach', DEFAULT_ROLE_PERMISSIONS.coach, 'sheets.manage', false);
    expect(s).toContain('sheets.view_draft');
    expect(setRoleAction('player', [], 'sheets.manage', true)).toEqual([]);
  });

  it('validates per role', () => {
    expect(v.safeParse(RolePermissionsInput, club).success).toBe(true);
    expect(
      v.safeParse(RolePermissionsInput, { ...club, player: ['sheets.view_draft'] }).success,
    ).toBe(false);
    expect(v.safeParse(RolePermissionsInput, { ...club, coach: ['roles.manage'] }).success).toBe(
      false,
    );
    expect(v.safeParse(RolePermissionsInput, { ...club, manager: ['team.view'] }).success).toBe(
      false,
    );
    expect(
      v.safeParse(RolePermissionsInput, { ...club, player: ['match.record', 'match.record'] })
        .success,
    ).toBe(false);
    expect(v.safeParse(RolePermissionsInput, { coach: [], manager: [] }).success).toBe(false);
  });

  it('member rules follow the configuration and keep the rank rule', () => {
    const coach = { role: 'coach' as const, overrides: club };
    const manager = { role: 'manager' as const, overrides: club };
    expect(canRemove(coach, 'player')).toBe(false);
    expect(canChangeRole(coach, 'player', 'manager')).toBe(false);
    expect(canRelink(coach, 'player')).toBe(false);
    expect(canRemove(manager, 'player')).toBe(true);
    expect(canRemove(manager, 'coach')).toBe(false);
    expect(canRemove(manager, 'admin')).toBe(false);
    expect(canRemove(manager, 'owner')).toBe(false);
    expect(canChangeRole(manager, 'player', 'manager')).toBe(true);
    expect(canChangeRole(manager, 'player', 'coach')).toBe(false);
    expect(canChangeRole(manager, 'player', 'admin')).toBe(false);
    expect(canRelink(manager, 'player')).toBe(false);
  });

  it('describes customised roles', () => {
    expect(roleSummary('coach', null)).toBe(ROLE_DESCRIPTIONS.coach);
    expect(roleSummary('owner', club)).toBe(ROLE_DESCRIPTIONS.owner);
    expect(roleSummary('coach', club)).toMatch(/^Set by your club: schedule, availability/);
    expect(roleSummary('coach', club)).not.toMatch(/squad/);
    expect(roleSummary('manager', club)).toMatch(/squad & invites/);
  });
});

describe('stored settings', () => {
  it('drops unknown actions but keeps the rest (forward-compatible)', () => {
    let bad = '';
    const p = parseRolePermissions(
      JSON.stringify({
        coach: ['events.manage', 'old.action', 'roles.manage', 7],
        manager: [],
        player: ['match.record', 'sheets.view_draft'],
        extra: true,
      }),
      (raw) => (bad = raw),
    );
    expect(bad).toBe('');
    expect(p).toEqual({ coach: ['events.manage'], manager: [], player: ['match.record'] });
    // An unknown action never restores removed powers.
    expect(can({ role: 'coach', overrides: p }, 'members.manage')).toBe(false);
  });

  it('falls back to the defaults only for unparseable JSON or the wrong shape', () => {
    for (const raw of [
      '{not json',
      'null',
      '[]',
      '"coach"',
      '{"coach":"events.manage","manager":[],"player":[]}',
      '{"coach":[],"manager":[]}',
    ]) {
      let bad = '';
      expect(
        parseRolePermissions(raw, (r) => (bad = r)),
        raw,
      ).toBeNull();
      expect(bad).toBe(raw);
    }
    expect(parseRolePermissions(null)).toBeNull();
    expect(parseRolePermissions('')).toBeNull();
  });

  it('revoking invites: unchanged under the defaults, limited once customised', () => {
    // Defaults: anyone with members.manage revokes any invite, as before.
    expect(canRevokeInvite({ role: 'coach' }, 'admin')).toBe(true);
    expect(canRevokeInvite({ role: 'manager' }, 'player')).toBe(false);
    const manager = { role: 'manager' as const, overrides: club };
    expect(canRevokeInvite(manager, 'player')).toBe(true);
    expect(canRevokeInvite(manager, 'manager')).toBe(true);
    expect(canRevokeInvite(manager, 'coach')).toBe(false);
    expect(canRevokeInvite(manager, 'admin')).toBe(false);
    expect(canRevokeInvite({ role: 'admin', overrides: club }, 'admin')).toBe(true);
    expect(canRevokeInvite({ role: 'coach', overrides: club }, 'player')).toBe(false);
  });

  it('says what members.manage means for each role', () => {
    expect(permissionPhrase('coach', 'members.manage')).toMatch(/device links/);
    expect(permissionPhrase('manager', 'members.manage')).not.toMatch(/device links/);
    expect(PERMISSION_INFO['members.manage'].hint).toMatch(/device links/);
  });
});
