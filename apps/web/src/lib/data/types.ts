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
  TeamRole,
  InventoryItem,
  InventoryHandoff,
} from '@phaseplay/shared';

/** A handover as cached on this device: `queued` while my accept/decline waits in the outbox. */
export type LocalHandoff = InventoryHandoff & { queued?: 'accept' | 'decline' };

/** Everything cached for one team. Rows are keyed by id (rsvps by `${eventId}:${memberId}`). */
export type TeamSnapshot = {
  teamId: string;
  cursor: number;
  syncedAt: number;
  /** When this copy was last rebuilt from a full sync, and by which app build (self-healing). */
  fullAt?: number;
  appVersion?: string;
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
    /** Missing from snapshots cached before team roles existed. */
    roles?: Record<string, TeamRole>;
    /** Club kit (M9). Missing from snapshots cached before kit existed. */
    items?: Record<string, InventoryItem>;
    /** Open handovers. Missing from snapshots cached before kit existed. */
    handoffs?: Record<string, LocalHandoff>;
  };
};

export const rsvpKey = (eventId: string, memberId: string) => `${eventId}:${memberId}`;
