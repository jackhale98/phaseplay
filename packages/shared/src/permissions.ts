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
  /** Import a TeamSnap CSV. */
  'import.run': STAFF,
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
  'import.run',
  'audit.view',
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
  'import.run': { group: 'Admin', label: 'Import from TeamSnap', hint: '' },
  'audit.view': {
    group: 'Admin',
    label: 'See the audit log',
    hint: 'Joins, removals, role changes and deletions.',
  },
};

/** Who is asking: a base role plus any extra permissions from team roles. */
export type Perms = { role: Role; grants?: readonly string[] | null };

export function can(who: Role | Perms | null | undefined, action: Action): boolean {
  if (!who) return false;
  const p: Perms = typeof who === 'string' ? { role: who } : who;
  if ((PERMISSIONS[action] as readonly Role[]).includes(p.role)) return true;
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
export function canChangeRole(actor: Role, target: Role, next: Role): boolean {
  if (target === 'owner' || next === 'owner' || target === next) return false;
  if (next === 'admin' || target === 'admin') return can(actor, 'roles.manage');
  if (!can(actor, 'members.manage')) return false;
  return RANK[actor] >= RANK[target] && RANK[actor] >= RANK[next];
}

export function canRemove(actor: Role, target: Role): boolean {
  if (target === 'owner') return false;
  if (target === 'admin') return can(actor, 'roles.manage');
  if (!can(actor, 'members.manage')) return false;
  return RANK[actor] >= RANK[target];
}

/** May `actor` issue a device re-link (adds a passkey to the target's whole account)? */
export function canRelink(actor: Role, target: Role): boolean {
  if (target === 'owner') return false;
  if (actor === 'owner') return true;
  if (actor === 'admin') return target !== 'admin';
  if (actor === 'coach') return target === 'manager' || target === 'player';
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
