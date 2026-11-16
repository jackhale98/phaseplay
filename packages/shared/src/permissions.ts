/**
 * The canonical permission matrix (PLAN.md §2). The API enforces it through requireMember;
 * the web app uses it only to decide what to show.
 */
export const ROLES = ['owner', 'coach', 'manager', 'player'] as const;
export type Role = (typeof ROLES)[number];

const ALL: readonly Role[] = ROLES;
const STAFF: readonly Role[] = ['owner', 'coach', 'manager'];
const COACHES: readonly Role[] = ['owner', 'coach'];

export const PERMISSIONS = {
  /** Read the team, its members, schedule, published sheets and shared plays/drills. */
  'team.view': ALL,
  /** Team settings, delete or transfer the team. */
  'team.manage': ['owner'],
  /** Remove members, change roles, jersey and positions; revoke invites; issue device re-links. */
  'members.manage': COACHES,
  /** Create invites (managers may only invite players and managers). */
  'invites.create': STAFF,
  /** See the invite list. */
  'invites.view': STAFF,
  /** Create/edit/cancel events, seasons, recurrences; mark attendance; RSVP on behalf of members. */
  'events.manage': STAFF,
  /** RSVP for yourself. */
  'rsvp.self': ALL,
  /** See RSVP notes, the availability board and non-responders. Players see counts only. */
  'availability.view': STAFF,
  /** Build, publish and see draft team sheets. */
  'sheets.manage': COACHES,
  /** Create/edit plays, see coach-only plays and "seen by". */
  'plays.manage': COACHES,
  /** Create/edit drills and practice plans; see coach-only ones. */
  'drills.manage': COACHES,
  'practice.manage': COACHES,
  /** Run a live practice session timer. */
  'practice.run': STAFF,
  /** Record sideline match events. */
  'match.record': STAFF,
  /** Read the audit log. */
  'audit.view': COACHES,
  /** Import a TeamSnap CSV. */
  'import.run': STAFF,
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return (PERMISSIONS[action] as readonly Role[]).includes(role);
}

const RANK: Record<Role, number> = { owner: 3, coach: 2, manager: 1, player: 0 };

/** Roles an inviter may hand out. Nobody can invite an owner; ownership is transferred. */
export function invitableRoles(role: Role): Role[] {
  if (role === 'owner' || role === 'coach') return ['coach', 'manager', 'player'];
  if (role === 'manager') return ['manager', 'player'];
  return [];
}

/** Can `actor` change `target`'s role to `next`? Owners are untouchable except via transfer. */
export function canChangeRole(actor: Role, target: Role, next: Role): boolean {
  if (!can(actor, 'members.manage')) return false;
  if (target === 'owner' || next === 'owner') return false;
  return RANK[actor] >= RANK[target] && RANK[actor] >= RANK[next];
}

export function canRemove(actor: Role, target: Role): boolean {
  if (!can(actor, 'members.manage')) return false;
  if (target === 'owner') return false;
  return RANK[actor] >= RANK[target];
}

export function isStaff(role: Role | null | undefined): boolean {
  return role === 'owner' || role === 'coach' || role === 'manager';
}

export function isCoach(role: Role | null | undefined): boolean {
  return role === 'owner' || role === 'coach';
}
