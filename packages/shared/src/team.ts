import * as v from 'valibot';
import { HexColor, Id, Timezone, text } from './common';
import { FORMATS } from './rugby';
import {
  CONFIGURABLE_FOR,
  GRANTABLE,
  ROLES,
  normaliseRolePermissions,
  type Action,
  type RolePermissions,
} from './permissions';
import { RSVP_VISIBILITY } from './events';
import { ProposalTargets } from './proposals';

export const TeamColors = v.object({ primary: HexColor, secondary: HexColor });
export type TeamColors = v.InferOutput<typeof TeamColors>;

export const TeamCreate = v.object({
  id: Id,
  name: text(60, 1),
  shortName: v.pipe(text(4, 1), v.toUpperCase()),
  colors: TeamColors,
  defaultFormat: v.picklist(FORMATS),
  timezone: Timezone,
});
export type TeamCreate = v.InferOutput<typeof TeamCreate>;

export const TeamUpdate = v.partial(
  v.object({
    ...v.omit(TeamCreate, ['id']).entries,
    rsvpVisibility: v.picklist(RSVP_VISIBILITY),
    /** Default "players needed" for proposed games, per format. */
    proposalTargets: ProposalTargets,
  }),
);
export type TeamUpdate = v.InferOutput<typeof TeamUpdate>;

export const Positions = v.pipe(
  v.array(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(15))),
  v.maxLength(6),
  v.check((a) => new Set(a).size === a.length, 'Positions must be unique'),
);

export const MemberUpdate = v.partial(
  v.object({
    role: v.picklist(ROLES),
    /** Team roles (Captain, Treasurer…) assigned to this member. */
    roleIds: v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.maxLength(12)),
    jersey: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(99))),
    positions: Positions,
    displayName: text(40, 1),
  }),
);
export type MemberUpdate = v.InferOutput<typeof MemberUpdate>;

export const PendingMemberCreate = v.object({
  id: Id,
  displayName: text(40, 1),
  jersey: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(99)))),
  positions: v.optional(Positions, []),
});
export type PendingMemberCreate = v.InferOutput<typeof PendingMemberCreate>;

export const INVITE_EXPIRIES = {
  '1h': 3600e3,
  '1d': 86400e3,
  '7d': 7 * 86400e3,
  '30d': 30 * 86400e3,
};
export const InviteCreate = v.object({
  id: Id,
  role: v.picklist(['admin', 'coach', 'manager', 'player']),
  expiresIn: v.optional(v.picklist(['1h', '1d', '7d', '30d']), '7d'),
  maxUses: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 40),
});
export type InviteCreate = v.InferOutput<typeof InviteCreate>;

export const RelinkCreate = v.object({ id: Id, memberId: Id });

export const InviteToken = v.object({
  token: v.pipe(v.string(), v.minLength(16), v.maxLength(64)),
});
export const InviteAccept = v.object({
  token: v.pipe(v.string(), v.minLength(16), v.maxLength(64)),
  claimMemberId: v.optional(v.nullable(Id)),
});

export const TransferOwnership = v.object({ memberId: Id });

export const SeasonInput = v.object({
  id: Id,
  name: text(60, 1),
  startsOn: v.pipe(v.string(), v.isoDate()),
  endsOn: v.pipe(v.string(), v.isoDate()),
});

export const TeamRoleInput = v.object({
  name: text(30, 1),
  color: HexColor,
  permissions: v.pipe(
    v.array(v.picklist(GRANTABLE)),
    v.maxLength(GRANTABLE.length),
    v.check((a) => new Set(a).size === a.length, 'Permissions must be unique'),
  ),
});
export type TeamRoleInput = v.InferOutput<typeof TeamRoleInput>;

/** Raster types accepted for an uploaded emblem. SVG is rasterised in the browser first. */
export const CREST_TYPES = ['image/png', 'image/webp', 'image/jpeg'] as const;
export const CREST_MAX_BYTES = 200 * 1024;
/** Uploaded emblems are resized to fit this square, keeping transparency. */
export const CREST_PX = 256;
export const CrestUpload = v.object({
  type: v.picklist(CREST_TYPES),
  /** Base64 image bytes. */
  data: v.pipe(
    v.string(),
    v.minLength(8),
    v.maxLength(Math.ceil(CREST_MAX_BYTES / 3) * 4),
    v.regex(/^[A-Za-z0-9+/]+={0,2}$/),
  ),
});
export type CrestUpload = v.InferOutput<typeof CrestUpload>;

/**
 * Built-in drill templates and play presets a team has hidden from its pickers, as
 * `drill:<templateId>` or `preset:<presetId>` (ids from packages/diagram).
 */
export const TemplateKey = v.pipe(v.string(), v.regex(/^(drill|preset):[A-Za-z0-9]{1,40}$/));
export const HiddenTemplates = v.object({
  hidden: v.pipe(v.array(TemplateKey), v.maxLength(100)),
});
export type HiddenTemplates = v.InferOutput<typeof HiddenTemplates>;

/**
 * Who plays: every player, plus staff with positions (player-coaches). Used for team sheets, the
 * availability board, attendance, "seen by" and stats. Membership role still decides permissions.
 */
export const playsForTeam = (m: { role: string; positions: readonly number[] }): boolean =>
  m.role === 'player' || m.positions.length > 0;
/** The same rule in SQL, for a `memberships` row aliased `m`. */
export const PLAYS_FOR_TEAM_SQL = `(m.role = 'player' OR json_array_length(m.positions) > 0)`;

const roleActions = (allowed: readonly Action[]) =>
  v.pipe(
    v.array(v.picklist(allowed as [Action, ...Action[]])),
    v.maxLength(allowed.length),
    v.check((a) => new Set(a).size === a.length, 'Permissions must be unique'),
  );
/**
 * What coaches, managers and players can do in this team (`teams.role_permissions`). Each list is
 * the role's full configurable set; anything outside `CONFIGURABLE_FOR` (admin-only actions, or a
 * non-safe action for players) is rejected. The server then adds implied views (IMPLIES).
 */
export const RolePermissionsInput = v.object({
  coach: roleActions(CONFIGURABLE_FOR.coach),
  manager: roleActions(CONFIGURABLE_FOR.manager),
  player: roleActions(CONFIGURABLE_FOR.player),
});
export type RolePermissionsInput = v.InferOutput<typeof RolePermissionsInput>;

/** Reads a stored `teams.role_permissions` value: null (defaults) unless it is valid. */
export function parseRolePermissions(raw: string | null | undefined): RolePermissions | null {
  if (!raw) return null;
  try {
    const r = v.safeParse(RolePermissionsInput, JSON.parse(raw));
    return r.success ? normaliseRolePermissions(r.output) : null;
  } catch {
    return null;
  }
}
