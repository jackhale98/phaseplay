/** Row → wire mappers. Keep SQL column lists next to their mappers so they can't drift. */
import type {
  DrillFull,
  DrillMeta,
  Member,
  PlayFull,
  PlayMeta,
  PracticePlan,
  Rsvp,
  Season,
  Team,
  TeamEvent,
  TeamSheet,
  Invite,
  TeamRole,
} from '@phaseplay/shared';
import { bool, nullableBool } from '../lib/db';
import { parseJson } from '../lib/http';

type Row = Record<string, unknown>;
const s = (x: unknown) => x as string;
const n = (x: unknown) => x as number;
const ns = (x: unknown) => (x ?? null) as string | null;
const nn = (x: unknown) => (x ?? null) as number | null;

export const TEAM_COLS =
  'id, name, short_name, colors, default_format, timezone, owner_id, created_at, updated_at, deleted_at, pending_owner_member_id';
export const teamFromRow = (r: Row): Team => ({
  id: s(r.id),
  name: s(r.name),
  shortName: s(r.short_name),
  colors: parseJson(s(r.colors), { primary: '#1f6f43', secondary: '#f2c230' }),
  defaultFormat: s(r.default_format) as Team['defaultFormat'],
  timezone: s(r.timezone),
  ownerId: s(r.owner_id),
  createdAt: n(r.created_at),
  updatedAt: n(r.updated_at),
  deletedAt: nn(r.deleted_at),
  pendingOwnerMemberId: ns(r.pending_owner_member_id),
});

export const MEMBER_COLS =
  'id, team_id, user_id, display_name, role, jersey, positions, status, joined_at, updated_at, role_ids';
export const memberFromRow = (r: Row): Member => ({
  id: s(r.id),
  teamId: s(r.team_id),
  userId: ns(r.user_id),
  displayName: s(r.display_name),
  role: s(r.role) as Member['role'],
  jersey: nn(r.jersey),
  positions: parseJson(s(r.positions), [] as number[]),
  status: s(r.status) as Member['status'],
  roleIds: parseJson(s(r.role_ids ?? '[]'), [] as string[]),
  joinedAt: nn(r.joined_at),
  updatedAt: n(r.updated_at),
});

export const seasonFromRow = (r: Row): Season => ({
  id: s(r.id),
  teamId: s(r.team_id),
  name: s(r.name),
  startsOn: s(r.starts_on),
  endsOn: s(r.ends_on),
  updatedAt: n(r.updated_at),
  deletedAt: nn(r.deleted_at),
});

export const EVENT_COLS =
  'id, team_id, season_id, type, format, title, starts_at, meet_at, ends_at, location_name, location_url, opponent, notes, rsvp_deadline, recurrence_id, cancelled_at, settings, version, updated_at, deleted_at';
export const eventFromRow = (r: Row): TeamEvent => ({
  id: s(r.id),
  teamId: s(r.team_id),
  seasonId: ns(r.season_id),
  type: s(r.type) as TeamEvent['type'],
  format: ns(r.format) as TeamEvent['format'],
  title: s(r.title),
  startsAt: n(r.starts_at),
  meetAt: nn(r.meet_at),
  endsAt: nn(r.ends_at),
  locationName: ns(r.location_name),
  locationUrl: ns(r.location_url),
  opponent: ns(r.opponent),
  notes: ns(r.notes),
  rsvpDeadline: nn(r.rsvp_deadline),
  recurrenceId: ns(r.recurrence_id),
  cancelledAt: nn(r.cancelled_at),
  settings: parseJson(ns(r.settings), null),
  version: n(r.version),
  updatedAt: n(r.updated_at),
  deletedAt: nn(r.deleted_at),
});

export const rsvpFromRow = (r: Row, showNote: boolean): Rsvp => ({
  eventId: s(r.event_id),
  memberId: s(r.member_id),
  teamId: s(r.team_id),
  status: ns(r.status) as Rsvp['status'],
  note: showNote ? ns(r.note) : null,
  attended: nullableBool(r.attended),
  updatedAt: n(r.updated_at),
});

export const SHEET_COLS =
  'id, event_id, team_id, format, replacements, slots, captain_id, vice_id, status, published, version, published_at, updated_at';
export const sheetFromRow = (r: Row, asPlayer: boolean): TeamSheet | null => {
  const base: TeamSheet = {
    id: s(r.id),
    eventId: s(r.event_id),
    teamId: s(r.team_id),
    format: s(r.format) as TeamSheet['format'],
    replacements: n(r.replacements),
    slots: parseJson(s(r.slots), {}),
    captainId: ns(r.captain_id),
    viceId: ns(r.vice_id),
    status: s(r.status) as TeamSheet['status'],
    version: n(r.version),
    publishedAt: nn(r.published_at),
    updatedAt: n(r.updated_at),
  };
  if (!asPlayer) return base;
  const pub = parseJson<Partial<TeamSheet> | null>(ns(r.published), null);
  if (!pub) return null;
  return { ...base, ...pub, status: 'published' };
};

export const PLAY_META_COLS =
  'id, team_id, title, category, tags, format, visibility, description, frame_count, version, created_by, updated_at, deleted_at';
export const playMetaFromRow = (r: Row): PlayMeta => ({
  id: s(r.id),
  teamId: s(r.team_id),
  title: s(r.title),
  category: s(r.category) as PlayMeta['category'],
  tags: parseJson(s(r.tags), [] as string[]),
  format: s(r.format) as PlayMeta['format'],
  visibility: s(r.visibility) as PlayMeta['visibility'],
  description: ns(r.description),
  frameCount: n(r.frame_count),
  version: n(r.version),
  createdBy: s(r.created_by),
  updatedAt: n(r.updated_at),
  deletedAt: nn(r.deleted_at),
});
export const playFullFromRow = (r: Row): PlayFull => ({
  ...playMetaFromRow(r),
  data: parseJson(s(r.data), null as unknown as PlayFull['data']),
});

export const DRILL_META_COLS =
  'id, team_id, title, category, contact_level, intensity, players_min, players_max, area, equipment, default_duration_min, description, coaching_points, setup, variations, visibility, source, parent_id, version, created_by, updated_at, deleted_at, diagram IS NOT NULL AS has_diagram';
export const drillMetaFromRow = (r: Row): DrillMeta => ({
  id: s(r.id),
  teamId: s(r.team_id),
  title: s(r.title),
  category: s(r.category) as DrillMeta['category'],
  contactLevel: s(r.contact_level) as DrillMeta['contactLevel'],
  intensity: n(r.intensity),
  playersMin: n(r.players_min),
  playersMax: n(r.players_max),
  area: parseJson(s(r.area), { w: 20, h: 20 }),
  equipment: parseJson(s(r.equipment), {}),
  defaultDurationMin: n(r.default_duration_min),
  description: s(r.description ?? ''),
  coachingPoints: parseJson(s(r.coaching_points), [] as string[]),
  setup: s(r.setup ?? ''),
  variations: parseJson(s(r.variations), [] as string[]),
  visibility: s(r.visibility) as DrillMeta['visibility'],
  source: s(r.source) as DrillMeta['source'],
  parentId: ns(r.parent_id),
  version: n(r.version),
  createdBy: ns(r.created_by),
  updatedAt: n(r.updated_at),
  deletedAt: nn(r.deleted_at),
  hasDiagram: bool(r.has_diagram),
});
export const drillFullFromRow = (r: Row): DrillFull => ({
  ...drillMetaFromRow(r),
  hasDiagram: r.diagram !== null && r.diagram !== undefined,
  diagram: parseJson(ns(r.diagram), null),
});

export const PLAN_COLS =
  'id, team_id, event_id, title, is_template, visibility, blocks, planned_total_min, version, created_by, updated_at, deleted_at';
export const planFromRow = (r: Row): PracticePlan => ({
  id: s(r.id),
  teamId: s(r.team_id),
  eventId: ns(r.event_id),
  title: s(r.title),
  isTemplate: bool(r.is_template),
  visibility: s(r.visibility) as PracticePlan['visibility'],
  data: parseJson(s(r.blocks), { lanes: ['all'], slots: [], waterEveryMin: 22 }),
  plannedTotalMin: n(r.planned_total_min),
  version: n(r.version),
  createdBy: s(r.created_by),
  updatedAt: n(r.updated_at),
  deletedAt: nn(r.deleted_at),
});

export const INVITE_COLS =
  'id, team_id, kind, role, target_member_id, created_by, created_at, expires_at, max_uses, uses, revoked_at';
export const inviteFromRow = (r: Row): Invite => ({
  id: s(r.id),
  teamId: s(r.team_id),
  kind: s(r.kind) as Invite['kind'],
  role: s(r.role) as Invite['role'],
  targetMemberId: ns(r.target_member_id),
  createdBy: s(r.created_by),
  createdAt: n(r.created_at),
  expiresAt: n(r.expires_at),
  maxUses: n(r.max_uses),
  uses: n(r.uses),
  revokedAt: nn(r.revoked_at),
});

export const ROLE_COLS = 'id, team_id, name, color, permissions, updated_at, deleted_at';
export const roleFromRow = (r: Row): TeamRole => ({
  id: s(r.id),
  teamId: s(r.team_id),
  name: s(r.name),
  color: s(r.color),
  permissions: parseJson(s(r.permissions), [] as string[]),
  updatedAt: n(r.updated_at),
  deletedAt: nn(r.deleted_at),
});
