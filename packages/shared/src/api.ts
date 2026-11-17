/** Wire types returned by the API (camelCase). Rows in D1 are snake_case; see apps/api/src/db. */
import type { Role } from './permissions';
import type { Format } from './rugby';
import type { TeamColors } from './team';
import type { EventType, MatchSettings, RsvpStatus } from './events';
import type { SheetSlots } from './sheets';
import type { Play, PlayCategory, Visibility } from './play';
import type { ContactLevel, DrillCategory, EquipmentList } from './drills';
import type { PlanData, RunEvent } from './practice';
import type { MatchEvent } from './match';

export type User = { id: string; displayName: string; createdAt: number };

export type Team = {
  id: string;
  name: string;
  shortName: string;
  colors: TeamColors;
  defaultFormat: Format;
  timezone: string;
  ownerId: string;
  /** Ownership handover in progress: the nominated member, until they accept or decline. */
  pendingOwnerMemberId: string | null;
  /** When the nomination was made; stale if the nominee has (re)joined since. */
  pendingOwnerAt: number | null;
  /** Set when the team has uploaded an emblem; changes with every upload (cache key). */
  crestVersion: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type MemberStatus = 'active' | 'removed' | 'pending';
export type Member = {
  id: string;
  teamId: string;
  userId: string | null;
  displayName: string;
  role: Role;
  jersey: number | null;
  positions: number[];
  status: MemberStatus;
  /** Team roles (Captain, Treasurer…) assigned to this member. */
  roleIds: string[];
  joinedAt: number | null;
  updatedAt: number;
};

/** A team-defined role: a named bundle of extra permissions (see permissions.ts). */
export type TeamRole = {
  id: string;
  teamId: string;
  name: string;
  color: string;
  permissions: string[];
  updatedAt: number;
  deletedAt: number | null;
};

export type MeResponse = {
  user: User;
  memberships: { member: Member; team: Team }[];
  env: 'production' | 'development' | 'test';
  /** Signed in to the public demo: the server refuses writes; the app keeps changes on-device. */
  demo: boolean;
};

export type Season = {
  id: string;
  teamId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  updatedAt: number;
  deletedAt: number | null;
};

export type TeamEvent = {
  id: string;
  teamId: string;
  seasonId: string | null;
  type: EventType;
  format: Format | null;
  title: string;
  startsAt: number;
  meetAt: number | null;
  endsAt: number | null;
  locationName: string | null;
  locationUrl: string | null;
  opponent: string | null;
  notes: string | null;
  rsvpDeadline: number | null;
  recurrenceId: string | null;
  cancelledAt: number | null;
  settings: MatchSettings | null;
  version: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type Rsvp = {
  eventId: string;
  memberId: string;
  teamId: string;
  status: RsvpStatus | null;
  /** Only sent to staff and to the member themself. */
  note: string | null;
  attended: boolean | null;
  updatedAt: number;
};

export type RsvpCounts = { yes: number; no: number; maybe: number };

export type TeamSheet = {
  id: string;
  eventId: string;
  teamId: string;
  format: Format;
  replacements: number;
  slots: SheetSlots;
  captainId: string | null;
  viceId: string | null;
  status: 'draft' | 'published';
  version: number;
  publishedAt: number | null;
  updatedAt: number;
};

export type PlayMeta = {
  id: string;
  teamId: string;
  title: string;
  category: PlayCategory;
  tags: string[];
  format: '15s' | '7s' | 'any';
  visibility: Visibility;
  description: string | null;
  version: number;
  createdBy: string;
  updatedAt: number;
  deletedAt: number | null;
  frameCount: number;
};
export type PlayFull = PlayMeta & { data: Play };

export type DrillMeta = {
  id: string;
  teamId: string;
  title: string;
  category: DrillCategory;
  contactLevel: ContactLevel;
  intensity: number;
  playersMin: number;
  playersMax: number;
  area: { w: number; h: number };
  equipment: EquipmentList;
  defaultDurationMin: number;
  description: string;
  coachingPoints: string[];
  setup: string;
  variations: string[];
  visibility: Visibility;
  source: 'team' | 'starter';
  parentId: string | null;
  version: number;
  createdBy: string | null;
  updatedAt: number;
  deletedAt: number | null;
  hasDiagram: boolean;
};
export type DrillFull = DrillMeta & { diagram: Play | null };

export type PracticePlan = {
  id: string;
  teamId: string;
  eventId: string | null;
  title: string;
  isTemplate: boolean;
  visibility: Visibility;
  data: PlanData;
  plannedTotalMin: number;
  version: number;
  createdBy: string;
  updatedAt: number;
  deletedAt: number | null;
};

export type SyncResponse = {
  cursor: number;
  full: boolean;
  team: Team;
  me: Member;
  members: Member[];
  roles: TeamRole[];
  seasons: Season[];
  events: TeamEvent[];
  rsvps: Rsvp[];
  /** Players get counts instead of everyone's RSVPs. */
  rsvpCounts: Record<string, RsvpCounts>;
  sheets: TeamSheet[];
  plays: PlayMeta[];
  drills: DrillMeta[];
  plans: PracticePlan[];
};

export type Invite = {
  id: string;
  teamId: string;
  kind: 'join' | 'relink';
  role: Role;
  targetMemberId: string | null;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  revokedAt: number | null;
};

export type InvitePreview = {
  kind: 'join' | 'relink';
  team: Pick<Team, 'id' | 'name' | 'shortName' | 'colors'>;
  invitedBy: string;
  role: Role;
  pending: { id: string; displayName: string }[];
  targetName?: string;
};

export type Passkey = {
  id: string;
  nickname: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  backedUp: boolean;
};

export type AuditEntry = {
  id: string;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  meta: Record<string, unknown> | null;
  at: number;
};

export type SeenBy = { seen: { memberId: string; firstViewedAt: number }[]; total: number };

export type MatchEventsResponse = { events: MatchEvent[] };
export type RunEventsResponse = { events: RunEvent[] };
