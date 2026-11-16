import type {
  DrillMeta,
  Member,
  PlayMeta,
  PracticePlan,
  Rsvp,
  RsvpCounts,
  Season,
  Team,
  TeamEvent,
  TeamSheet,
} from '@phaseplay/shared';

/** Everything cached for one team. Rows are keyed by id (rsvps by `${eventId}:${memberId}`). */
export type TeamSnapshot = {
  teamId: string;
  cursor: number;
  syncedAt: number;
  team: Team;
  me: Member;
  rows: {
    members: Record<string, Member>;
    seasons: Record<string, Season>;
    events: Record<string, TeamEvent>;
    rsvps: Record<string, Rsvp>;
    counts: Record<string, RsvpCounts>;
    sheets: Record<string, TeamSheet>;
    plays: Record<string, PlayMeta>;
    drills: Record<string, DrillMeta>;
    plans: Record<string, PracticePlan>;
  };
};

export const rsvpKey = (eventId: string, memberId: string) => `${eventId}:${memberId}`;
