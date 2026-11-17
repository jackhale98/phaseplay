/** Wire types returned by the API (camelCase). Rows in D1 are snake_case; see apps/api/src/db. */
import type { Role } from './permissions';
import type { Format } from './rugby';
import type { TeamColors } from './team';
import type { EventType, MatchSettings, RsvpStatus, RsvpVisibility } from './events';
import type { SheetSlots } from './sheets';
import type { Play, PlayCategory, Visibility } from './play';
import type { ContactLevel, DrillCategory, EquipmentList } from './drills';
import type { PlanData, RunEvent } from './practice';
import type { MatchEvent } from './match';
import type { InventoryEventKind, ItemCondition, ItemKind, ItemStatus } from './inventory';
import type { NotifyPrefs } from './notify';
import type { EventStatus, ProposalAnswer, ProposalTargets } from './proposals';

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
  /** What players see of each other's replies. */
  rsvpVisibility: RsvpVisibility;
  /** Default "players needed" for proposed games, per format. */
  proposalTargets: ProposalTargets;
  /** Built-in templates/presets hidden from this team's pickers (`drill:<id>`, `preset:<id>`). */
  hiddenTemplates: string[];
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
  /** What this user wants push notifications about. */
  notify: NotifyPrefs;
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
  /** `proposed` = not confirmed yet (dates in `options`); `dropped` = not going ahead (hidden). */
  status: EventStatus;
  /** Proposals: when answers are due. */
  answerBy: number | null;
  /** Proposals: players needed (null = the team default for the format). */
  target: number | null;
  /** Proposed games: check front-row cover per date. */
  checkPositions: boolean;
  version: number;
  updatedAt: number;
  deletedAt: number | null;
};

/** A candidate date of a proposal. */
export type EventOption = {
  id: string;
  eventId: string;
  teamId: string;
  startsAt: number;
  meetAt: number | null;
  endsAt: number | null;
  updatedAt: number;
  deletedAt: number | null;
};

/** One member's answer for one date of a proposal. */
export type OptionAnswer = {
  optionId: string;
  eventId: string;
  memberId: string;
  teamId: string;
  answer: ProposalAnswer;
  updatedAt: number;
};
export type AnswerCounts = { in: number; cant: number };

export type Rsvp = {
  eventId: string;
  memberId: string;
  teamId: string;
  status: RsvpStatus | null;
  /** Only sent to staff and to the member themself. */
  note: string | null;
  attended: boolean | null;
  /** Marked yes when a proposal was confirmed: waiting for the member's "Still in?". */
  reconfirm?: boolean;
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
  /**
   * Staff copies only: the last published line-up (players' copies already are it). Match mode
   * and season stats use it in preference to later draft edits; see `matchLineup`.
   */
  published?: PublishedSheet | null;
};

/** What players see of a published sheet (the `team_sheets.published` snapshot). */
export type PublishedSheet = {
  format: Format;
  replacements: number;
  slots: SheetSlots;
  captainId: string | null;
  viceId: string | null;
  publishedAt: number;
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
  /** Archived: hidden from lists and pickers; still opens and works where used. */
  archivedAt?: number | null;
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
  /** Archived: hidden from lists and pickers; still opens and works where used. */
  archivedAt?: number | null;
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
  /** Proposal dates (tombstones when removed). */
  options: EventOption[];
  /** Proposal answers: my own; everyone's for staff, or when players see replies for the event. */
  answers: OptionAnswer[];
  /** Per-date counts, for everyone. */
  answerCounts: Record<string, AnswerCounts>;
  sheets: TeamSheet[];
  plays: PlayMeta[];
  drills: DrillMeta[];
  plans: PracticePlan[];
  /** Club kit (deleted items arrive as tombstones in delta syncs). */
  items: InventoryItem[];
  /** Open handovers, plus ones resolved since the cursor (so devices can clear them). */
  handoffs: InventoryHandoff[];
};

export type InventoryItem = {
  id: string;
  teamId: string;
  kind: ItemKind;
  name: string;
  tag: string | null;
  quantity: number;
  condition: ItemCondition;
  status: ItemStatus;
  holderMemberId: string | null;
  home: string | null;
  notes: string | null;
  matchDay: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type InventoryHandoff = {
  id: string;
  teamId: string;
  itemId: string;
  fromMemberId: string | null;
  toMemberId: string;
  note: string | null;
  createdAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  /** How it ended, once resolved. */
  outcome: 'accepted' | 'declined' | 'cancelled' | 'expired' | null;
};

export type InventoryEvent = {
  id: string;
  itemId: string;
  kind: InventoryEventKind;
  actorMemberId: string | null;
  fromMemberId: string | null;
  toMemberId: string | null;
  note: string | null;
  at: number;
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
  /** The join link (`/join#t=…`) for live invites made since links were kept; else null. */
  path?: string | null;
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
