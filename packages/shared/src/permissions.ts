/**
 * The canonical permission model (PLAN.md §2). The API enforces it through requireMember; the web
 * app uses it only to decide what to show.
 *
 * Everyone has one **base role**. Teams can also define **team roles** (Captain, Treasurer, Kit
 * manager…): named bundles of extra permissions assigned to members and moved each season. A
 * member's effective permissions are their base role's plus every assigned team role's.
 */
export const ROLES = ['owner', 'admin', 'coach', 'manager', 'player'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  coach: 'Coach',
  manager: 'Manager',
  player: 'Player',
};
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything, including deleting the team. One per team; hand it over in team settings.',
  admin: 'E-board: everything except deleting the team, including roles, members and settings.',
  coach: 'Runs the rugby: schedule, sheets, plays, drills, practice plans and match day.',
  manager: 'Logistics: schedule, availability, invites, attendance and match recording.',
  player: 'Replies to events, sees published sheets and shared plays, drills and plans.',
};

const ALL: readonly Role[] = ROLES;
const ADMINS: readonly Role[] = ['owner', 'admin'];
const COACHES: readonly Role[] = ['owner', 'admin', 'coach'];
const STAFF: readonly Role[] = ['owner', 'admin', 'coach', 'manager'];

export const PERMISSIONS = {
  /** Read the team, its members, schedule, published sheets and shared plays/drills/plans. */
  'team.view': ALL,
  /** Team settings: name, colours, format, timezone. */
  'team.manage': ADMINS,
  /** Delete the team, or nominate a new owner. */
  'team.delete': ['owner'],
  /** Define team roles (Captain, Treasurer…), assign them, and change base roles. */
  'roles.manage': ADMINS,
  /** Remove members, edit their shirt and positions, revoke invites, issue device re-links. */
  'members.manage': COACHES,
  /** Create invites (only for roles you may hand out). */
  'invites.create': STAFF,
  /** See the invite list. */
  'invites.view': STAFF,
  /** Create/edit/cancel events, seasons and series; mark attendance; reply on others' behalf. */
  'events.manage': STAFF,
  /** RSVP for yourself. */
  'rsvp.self': ALL,
  /** See everyone's replies and notes, the availability board and non-responders. */
  'availability.view': STAFF,
  /** Build and publish team sheets. */
  'sheets.manage': COACHES,
  /** See team sheets before they're published. */
  'sheets.view_draft': COACHES,
  /** Create and edit plays. */
  'plays.manage': COACHES,
  /** See coach-only plays and who has seen each play. */
  'plays.view_private': COACHES,
  /** Create and edit drills. */
  'drills.manage': COACHES,
  /** See coach-only drills. */
  'drills.view_private': COACHES,
  /** Create and edit practice plans. */
  'practice.manage': COACHES,
  /** See coach-only practice plans. */
  'practice.view_private': COACHES,
  /** Run (or help run) a live practice session. */
  'practice.run': STAFF,
  /** Record sideline match events. */
  'match.record': STAFF,
  /** Read the audit log. */
  'audit.view': COACHES,
  /** Add, edit, assign, mark lost or retired, and override handovers of club kit. */
  'inventory.manage': STAFF,
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;
export const ACTIONS = Object.keys(PERMISSIONS) as Action[];

/**
 * Permissions a team role may add. Team settings, deleting the team, roles and member management
 * stay with base roles so a team role can never escalate itself.
 */
export const GRANTABLE = [
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
] as const satisfies readonly Action[];
export type GrantableAction = (typeof GRANTABLE)[number];

/** Plain-language labels for the roles editor, grouped. */
export const GRANT_INFO: Record<GrantableAction, { group: string; label: string; hint: string }> = {
  'events.manage': {
    group: 'Schedule',
    label: 'Create and edit events',
    hint: 'Games, practices, socials and fundraisers; attendance; reply for others.',
  },
  'availability.view': {
    group: 'Schedule',
    label: "See who's in",
    hint: "Everyone's replies, notes and who hasn't answered.",
  },
  'invites.create': {
    group: 'Squad',
    label: 'Invite people',
    hint: 'Make invite links. Players with it can only invite players.',
  },
  'invites.view': { group: 'Squad', label: 'See invite links', hint: 'The list of open invites.' },
  'sheets.view_draft': {
    group: 'Team sheets',
    label: 'See draft team sheets',
    hint: 'Before they are published to the squad.',
  },
  'sheets.manage': { group: 'Team sheets', label: 'Build and publish team sheets', hint: '' },
  'practice.view_private': {
    group: 'Practice',
    label: 'See coach-only practice plans',
    hint: 'Useful for captains.',
  },
  'practice.manage': { group: 'Practice', label: 'Create and edit practice plans', hint: '' },
  'practice.run': {
    group: 'Practice',
    label: 'Run live practice sessions',
    hint: 'Help keep time on their own phone.',
  },
  'plays.view_private': {
    group: 'Playbook',
    label: 'See coach-only plays',
    hint: 'And who has watched each play.',
  },
  'plays.manage': { group: 'Playbook', label: 'Create and edit plays', hint: '' },
  'drills.view_private': { group: 'Playbook', label: 'See coach-only drills', hint: '' },
  'drills.manage': { group: 'Playbook', label: 'Create and edit drills', hint: '' },
  'match.record': {
    group: 'Match day',
    label: 'Record matches',
    hint: 'Clock, scores, cards and subs.',
  },
  'audit.view': {
    group: 'Admin',
    label: 'See the audit log',
    hint: 'Joins, removals, role changes and deletions.',
  },
  'inventory.manage': {
    group: 'Admin',
    label: 'Manage club kit',
    hint: 'Add kit, assign it, mark it lost and sort out handovers. For a kit manager.',
  },
};

/**
 * Configurable base roles (PLAN.md §2). Owner and admin always have everything above; a team may
 * change what coaches, managers and (a little of) players can do. A team stores the full
 * configurable set for each of those roles (`teams.role_permissions`); null means the defaults.
 */
export const CONFIGURABLE_ROLES = ['coach', 'manager', 'player'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];
/** Everyone can do these, whatever the team's settings. */
export const ALWAYS_ON = ['team.view', 'rsvp.self'] as const satisfies readonly Action[];
/** Owner and admin only (team.delete: owner only); never configurable. */
export const ADMIN_ONLY = [
  'team.manage',
  'team.delete',
  'roles.manage',
] as const satisfies readonly Action[];
/** What a team may switch on or off for coaches and managers. */
export const CONFIGURABLE: readonly Action[] = ACTIONS.filter(
  (a) =>
    !(ALWAYS_ON as readonly Action[]).includes(a) && !(ADMIN_ONLY as readonly Action[]).includes(a),
);
/** The small safe set a team may give players (never drafts, private content, members or kit). */
export const PLAYER_CONFIGURABLE = [
  'match.record',
  'practice.run',
] as const satisfies readonly Action[];
export const CONFIGURABLE_FOR: Record<ConfigurableRole, readonly Action[]> = {
  coach: CONFIGURABLE,
  manager: CONFIGURABLE,
  player: PLAYER_CONFIGURABLE,
};
export type RolePermissions = Record<ConfigurableRole, Action[]>;

const defaultsFor = (role: ConfigurableRole): Action[] =>
  CONFIGURABLE_FOR[role].filter((a) => (PERMISSIONS[a] as readonly Role[]).includes(role));
/** Today's behaviour, straight from PERMISSIONS. */
export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  coach: defaultsFor('coach'),
  manager: defaultsFor('manager'),
  player: defaultsFor('player'),
};

/** A manage permission needs its view counterpart; managing members needs the invite list. */
export const IMPLIES: Partial<Record<Action, readonly Action[]>> = {
  'sheets.manage': ['sheets.view_draft'],
  'plays.manage': ['plays.view_private'],
  'drills.manage': ['drills.view_private'],
  'practice.manage': ['practice.view_private'],
  'invites.create': ['invites.view'],
  'members.manage': ['invites.view'],
};

/** Adds what the actions imply and keeps only what `role` may have, in a stable order. */
export function normaliseRoleActions(role: ConfigurableRole, actions: readonly string[]): Action[] {
  const want = new Set<string>(actions);
  for (const a of actions) for (const x of IMPLIES[a as Action] ?? []) want.add(x);
  return CONFIGURABLE_FOR[role].filter((a) => want.has(a));
}
export function normaliseRolePermissions(
  p: Partial<Record<ConfigurableRole, readonly string[]>>,
): RolePermissions {
  const out = {} as RolePermissions;
  for (const r of CONFIGURABLE_ROLES)
    out[r] = normaliseRoleActions(r, p[r] ?? DEFAULT_ROLE_PERMISSIONS[r]);
  return out;
}

/**
 * Switch one action on or off for a role, keeping dependencies: turning a manage on turns its view
 * on; turning a view off turns off whatever needs it.
 */
export function setRoleAction(
  role: ConfigurableRole,
  actions: readonly Action[],
  action: Action,
  on: boolean,
): Action[] {
  if (on) return normaliseRoleActions(role, [...actions, action]);
  const drop = new Set<Action>([action]);
  for (let grew = true; grew;) {
    grew = false;
    for (const a of actions)
      if (!drop.has(a) && (IMPLIES[a] ?? []).some((x) => drop.has(x))) {
        drop.add(a);
        grew = true;
      }
  }
  return normaliseRoleActions(
    role,
    actions.filter((a) => !drop.has(a)),
  );
}

/** Starting points for "What each role can do". */
export const ROLE_PRESETS = {
  default: { label: 'Coach-led team', permissions: DEFAULT_ROLE_PERMISSIONS },
  club: {
    label: 'Club with a committee',
    permissions: normaliseRolePermissions({
      coach: [
        'events.manage',
        'availability.view',
        'sheets.manage',
        'sheets.view_draft',
        'plays.manage',
        'plays.view_private',
        'drills.manage',
        'drills.view_private',
        'practice.manage',
        'practice.view_private',
        'practice.run',
        'match.record',
        'inventory.manage',
      ],
      manager: [
        'invites.create',
        'invites.view',
        'members.manage',
        'events.manage',
        'availability.view',
        'practice.run',
        'match.record',
        'inventory.manage',
      ],
      player: [],
    }),
  },
} as const satisfies Record<string, { label: string; permissions: RolePermissions }>;
export type RolePreset = keyof typeof ROLE_PRESETS;
export const ROLE_PRESET_IDS = Object.keys(ROLE_PRESETS) as RolePreset[];

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));
export function sameRolePermissions(a: RolePermissions, b: RolePermissions): boolean {
  return CONFIGURABLE_ROLES.every((r) => sameSet(a[r], b[r]));
}
/** The team's effective configuration, defaults filled in. */
export function rolePermissionsOf(overrides: RolePermissions | null | undefined): RolePermissions {
  return overrides ? normaliseRolePermissions(overrides) : DEFAULT_ROLE_PERMISSIONS;
}
/** Which preset a configuration matches, or null for a custom one. */
export function presetOf(overrides: RolePermissions | null | undefined): RolePreset | null {
  const cfg = rolePermissionsOf(overrides);
  return ROLE_PRESET_IDS.find((k) => sameRolePermissions(cfg, ROLE_PRESETS[k].permissions)) ?? null;
}
/** Has the team changed what this base role does from the default? */
export function isCustomised(role: Role, overrides: RolePermissions | null | undefined): boolean {
  if (role === 'owner' || role === 'admin' || !overrides) return false;
  return !sameSet(rolePermissionsOf(overrides)[role], DEFAULT_ROLE_PERMISSIONS[role]);
}

/** Plain-language areas for the "What each role can do" editor, in display order. */
export const PERMISSION_AREAS = [
  'Schedule',
  'Squad & invites',
  'Availability',
  'Team sheets',
  'Playbook & drills',
  'Practice',
  'Match day',
  'Kit',
] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];
type PermissionInfo = {
  area: PermissionArea | null;
  label: string;
  hint: string;
  phrase: string;
};
const info = (area: PermissionArea | null, label: string, hint: string, phrase: string) => ({
  area,
  label,
  hint,
  phrase,
});
const grant = (a: GrantableAction, area: PermissionArea, phrase: string, hint?: string) =>
  info(area, GRANT_INFO[a].label, hint ?? GRANT_INFO[a].hint, phrase);
/**
 * Labels for base-role settings (GRANT_INFO's where there is one), the area each sits in, and a
 * phrase for "Coaches will no longer be able to: …".
 */
export const PERMISSION_INFO: Record<Action, PermissionInfo> = {
  'team.view': info(null, 'See the team', '', 'see the team'),
  'rsvp.self': info(null, 'Reply to events', '', 'reply to events'),
  'team.manage': info(null, 'Team settings', '', 'change team settings'),
  'team.delete': info(null, 'Delete the team', '', 'delete the team'),
  'roles.manage': info(null, 'Manage roles', '', 'manage roles'),
  'events.manage': grant('events.manage', 'Schedule', 'create and edit events'),
  'members.manage': info(
    'Squad & invites',
    'Manage members',
    'Remove members, change coach, manager and player roles, edit shirts, revoke invites.',
    'remove members or change their roles',
  ),
  'invites.create': grant('invites.create', 'Squad & invites', 'create invites'),
  'invites.view': grant('invites.view', 'Squad & invites', 'see invite links'),
  'audit.view': grant('audit.view', 'Squad & invites', 'see the audit log'),
  'availability.view': grant('availability.view', 'Availability', "see who's in"),
  'sheets.manage': grant('sheets.manage', 'Team sheets', 'build and publish team sheets'),
  'sheets.view_draft': grant('sheets.view_draft', 'Team sheets', 'see draft team sheets'),
  'plays.manage': grant('plays.manage', 'Playbook & drills', 'create and edit plays'),
  'plays.view_private': grant('plays.view_private', 'Playbook & drills', 'see coach-only plays'),
  'drills.manage': grant('drills.manage', 'Playbook & drills', 'create and edit drills'),
  'drills.view_private': grant('drills.view_private', 'Playbook & drills', 'see coach-only drills'),
  'practice.manage': grant('practice.manage', 'Practice', 'create and edit practice plans'),
  'practice.view_private': grant(
    'practice.view_private',
    'Practice',
    'see coach-only practice plans',
    '',
  ),
  'practice.run': grant('practice.run', 'Practice', 'run live practice sessions'),
  'match.record': info(
    'Match day',
    'Record match events',
    GRANT_INFO['match.record'].hint,
    'record match events',
  ),
  'inventory.manage': grant(
    'inventory.manage',
    'Kit',
    'manage club kit',
    'Add kit, assign it, mark it lost and sort out handovers.',
  ),
};

/** One line describing a base role under the team's configuration. */
export function roleSummary(role: Role, overrides: RolePermissions | null | undefined): string {
  if (!isCustomised(role, overrides)) return ROLE_DESCRIPTIONS[role];
  const set = rolePermissionsOf(overrides)[role as ConfigurableRole];
  const areas = PERMISSION_AREAS.filter((area) =>
    set.some((a) => PERMISSION_INFO[a].area === area),
  );
  if (!areas.length) return 'Set by your club: replies to events and sees what is shared.';
  return `Set by your club: ${areas.map((x) => x.toLowerCase()).join(', ')}.`;
}

/** Who is asking: a base role, any extra permissions from team roles, and the team's settings. */
export type Perms = {
  role: Role;
  grants?: readonly string[] | null;
  /** The team's base-role configuration; null or missing means the defaults. */
  overrides?: RolePermissions | null;
};

/** What the base role alone allows under the team's configuration (no team-role grants). */
export function baseCan(role: Role, action: Action, overrides?: RolePermissions | null): boolean {
  if (role === 'owner' || role === 'admin' || !overrides)
    return (PERMISSIONS[action] as readonly Role[]).includes(role);
  if ((ALWAYS_ON as readonly Action[]).includes(action)) return true;
  return CONFIGURABLE_FOR[role].includes(action) && (overrides[role] ?? []).includes(action);
}

export function can(who: Role | Perms | null | undefined, action: Action): boolean {
  if (!who) return false;
  const p: Perms = typeof who === 'string' ? { role: who } : who;
  if (baseCan(p.role, action, p.overrides)) return true;
  return !!p.grants?.includes(action) && (GRANTABLE as readonly string[]).includes(action);
}

/** Every action this member may perform (for UIs that summarise effective permissions). */
export function effective(who: Perms): Action[] {
  return ACTIONS.filter((a) => can(who, a));
}
const RANK: Record<Role, number> = { owner: 4, admin: 3, coach: 2, manager: 1, player: 0 };

/** Roles an inviter may hand out. Nobody can invite an owner; ownership is handed over. */
export function invitableRoles(role: Role): Role[] {
  if (role === 'owner' || role === 'admin') return ['admin', 'coach', 'manager', 'player'];
  if (role === 'coach') return ['coach', 'manager', 'player'];
  if (role === 'manager') return ['manager', 'player'];
  // A player only reaches this with an `invites.create` team-role grant.
  return ['player'];
}

/**
 * Can `actor` change `target`'s base role to `next`? The owner role only moves through the
 * handover flow. Admin is given and taken only by owners and admins.
 */
const roleOf = (who: Role | Perms) => (typeof who === 'string' ? who : who.role);

/**
 * Can `actor` change `target`'s base role to `next`? The owner role only moves through the
 * handover flow. Admin is given and taken only by owners and admins. Otherwise it needs
 * `members.manage` (which a team may give or take away) and the rank rule: never above yourself.
 */
export function canChangeRole(actor: Role | Perms, target: Role, next: Role): boolean {
  if (target === 'owner' || next === 'owner' || target === next) return false;
  if (next === 'admin' || target === 'admin') return can(actor, 'roles.manage');
  if (!can(actor, 'members.manage')) return false;
  const r = roleOf(actor);
  return RANK[r] >= RANK[target] && RANK[r] >= RANK[next];
}

export function canRemove(actor: Role | Perms, target: Role): boolean {
  if (target === 'owner') return false;
  if (target === 'admin') return can(actor, 'roles.manage');
  if (!can(actor, 'members.manage')) return false;
  return RANK[roleOf(actor)] >= RANK[target];
}

/**
 * May `actor` issue a device re-link (adds a passkey to the target's whole account)? Needs
 * `members.manage`, and stays with owners, admins and coaches by base role.
 */
export function canRelink(actor: Role | Perms, target: Role): boolean {
  if (target === 'owner' || !can(actor, 'members.manage')) return false;
  const r = roleOf(actor);
  if (r === 'owner') return true;
  if (r === 'admin') return target !== 'admin';
  if (r === 'coach') return target === 'manager' || target === 'player';
  return false;
}
/** Owner, admin, coach or manager (the base roles that run the team day to day). */
export function isStaff(role: Role | null | undefined): boolean {
  return !!role && role !== 'player';
}

/** Owner, admin or coach. */
export function isCoach(role: Role | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'coach';
}

/** An owner who hasn't been seen for this long can be replaced by an admin. */
/** Most team roles a team can have. */
export const MAX_TEAM_ROLES = 30;
export const OWNER_CLAIM_AFTER_MS = 30 * 86400e3;

/**
 * The member an ownership handover is waiting on, if the nomination is still live: a nomination
 * made before the nominee last (re)joined is stale. Mirrors the API's accept check.
 */
export function liveNominee<M extends { id: string; status: string; joinedAt: number | null }>(
  team: { pendingOwnerMemberId: string | null; pendingOwnerAt: number | null },
  members: readonly M[],
): M | null {
  const m = members.find((x) => x.id === team.pendingOwnerMemberId);
  if (!m || m.status !== 'active') return null;
  return (team.pendingOwnerAt ?? 0) >= (m.joinedAt ?? 0) ? m : null;
}
