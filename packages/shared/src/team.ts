import * as v from 'valibot';
import { HexColor, Id, Timezone, text } from './common';
import { FORMATS } from './rugby';
import { ROLES } from './permissions';

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

export const TeamUpdate = v.partial(v.omit(TeamCreate, ['id']));
export type TeamUpdate = v.InferOutput<typeof TeamUpdate>;

export const Positions = v.pipe(
  v.array(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(15))),
  v.maxLength(6),
  v.check((a) => new Set(a).size === a.length, 'Positions must be unique'),
);

export const MemberUpdate = v.partial(
  v.object({
    role: v.picklist(ROLES),
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
  role: v.picklist(['coach', 'manager', 'player']),
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
