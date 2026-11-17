/**
 * The API route table. The Worker registers handlers against these ids, and the tenancy test
 * matrix is generated from this table: every `team` route is called as anonymous, another team's
 * member, a removed member and each role. A handler without an entry here fails the test.
 */
import type { Action } from './permissions';

export type RouteAuth = 'public' | 'user' | 'team';
export type RouteDef = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  auth: RouteAuth;
  /** For `team` routes: the permission checked by requireMember. */
  action?: Action;
  /** Only for routes reachable when the build has ENV=test. */
  testOnly?: boolean;
};

export const API_PREFIX = '/api/v1';

export const ROUTES = {
  health: { method: 'GET', path: '/api/health', auth: 'public' },

  // Auth (passkeys)
  'auth.register.options': {
    method: 'POST',
    path: '/api/v1/auth/register/options',
    auth: 'public',
  },
  'auth.register.verify': { method: 'POST', path: '/api/v1/auth/register/verify', auth: 'public' },
  'auth.login.options': { method: 'POST', path: '/api/v1/auth/login/options', auth: 'public' },
  'auth.login.verify': { method: 'POST', path: '/api/v1/auth/login/verify', auth: 'public' },
  'auth.recover': { method: 'POST', path: '/api/v1/auth/recover', auth: 'public' },
  'auth.relink.options': { method: 'POST', path: '/api/v1/auth/relink/options', auth: 'public' },
  'auth.relink.verify': { method: 'POST', path: '/api/v1/auth/relink/verify', auth: 'public' },
  /** Public demo: signs the visitor in as the read-only demo coach of "Phaseplay RFC". */
  'demo.start': { method: 'POST', path: '/api/v1/demo', auth: 'public' },
  'auth.logout': { method: 'POST', path: '/api/v1/auth/logout', auth: 'user' },
  'auth.test.login': { method: 'POST', path: '/api/v1/test/login', auth: 'public', testOnly: true },

  // Me
  'me.get': { method: 'GET', path: '/api/v1/me', auth: 'user' },
  'me.update': { method: 'PATCH', path: '/api/v1/me', auth: 'user' },
  'me.delete': { method: 'DELETE', path: '/api/v1/me', auth: 'user' },
  'me.export': { method: 'GET', path: '/api/v1/me/export', auth: 'user' },
  'me.signout_all': { method: 'POST', path: '/api/v1/me/sessions/revoke', auth: 'user' },
  'me.passkeys.list': { method: 'GET', path: '/api/v1/me/passkeys', auth: 'user' },
  'me.passkeys.options': { method: 'POST', path: '/api/v1/me/passkeys/options', auth: 'user' },
  'me.passkeys.add': { method: 'POST', path: '/api/v1/me/passkeys', auth: 'user' },
  'me.passkeys.rename': {
    method: 'PATCH',
    path: '/api/v1/me/passkeys/:credentialId',
    auth: 'user',
  },
  'me.passkeys.remove': {
    method: 'DELETE',
    path: '/api/v1/me/passkeys/:credentialId',
    auth: 'user',
  },
  'me.recovery.regenerate': { method: 'POST', path: '/api/v1/me/recovery-codes', auth: 'user' },
  'me.calendar.create': { method: 'POST', path: '/api/v1/me/calendar-feeds', auth: 'user' },
  'me.calendar.list': { method: 'GET', path: '/api/v1/me/calendar-feeds', auth: 'user' },
  'me.calendar.revoke': {
    method: 'DELETE',
    path: '/api/v1/me/calendar-feeds/:feedId',
    auth: 'user',
  },

  // Teams
  'teams.create': { method: 'POST', path: '/api/v1/teams', auth: 'user' },
  'teams.get': { method: 'GET', path: '/api/v1/teams/:teamId', auth: 'team', action: 'team.view' },
  'teams.update': {
    method: 'PATCH',
    path: '/api/v1/teams/:teamId',
    auth: 'team',
    action: 'team.manage',
  },
  /** Hide built-in drill templates / play presets (drills.manage / plays.manage checked per key). */
  /** The team's calendar link (made on first request). Any member. */
  'teams.calendar.get': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/calendar',
    auth: 'team',
    action: 'team.view',
  },
  /** A new team calendar link; the old one stops working. */
  'teams.calendar.reset': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/calendar',
    auth: 'team',
    action: 'events.manage',
  },
  'teams.templates': {
    method: 'PUT',
    path: '/api/v1/teams/:teamId/templates',
    auth: 'team',
    action: 'team.view',
  },
  'teams.crest.get': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/crest',
    auth: 'team',
    action: 'team.view',
  },
  'teams.crest.put': {
    method: 'PUT',
    path: '/api/v1/teams/:teamId/crest',
    auth: 'team',
    action: 'team.manage',
  },
  'teams.crest.delete': {
    method: 'DELETE',
    path: '/api/v1/teams/:teamId/crest',
    auth: 'team',
    action: 'team.manage',
  },
  'teams.delete': {
    method: 'DELETE',
    path: '/api/v1/teams/:teamId',
    auth: 'team',
    action: 'team.delete',
  },
  /** Owner nominates a successor (owner-only; the nominee must accept). */
  'teams.transfer': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/transfer',
    auth: 'team',
    action: 'team.delete',
  },
  /** The nominee accepts ownership; the old owner becomes an admin. */
  'teams.transfer.accept': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/transfer/accept',
    auth: 'team',
    action: 'team.view',
  },
  /** The owner cancels, or the nominee declines. */
  'teams.transfer.cancel': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/transfer/cancel',
    auth: 'team',
    action: 'team.view',
  },
  /** An admin takes over when the owner hasn't been seen for 30 days. */
  'teams.claim': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/claim-ownership',
    auth: 'team',
    action: 'roles.manage',
  },
  'roles.put': {
    method: 'PUT',
    path: '/api/v1/teams/:teamId/roles/:roleId',
    auth: 'team',
    action: 'roles.manage',
  },
  'roles.delete': {
    method: 'DELETE',
    path: '/api/v1/teams/:teamId/roles/:roleId',
    auth: 'team',
    action: 'roles.manage',
  },
  'teams.leave': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/leave',
    auth: 'team',
    action: 'team.view',
  },
  'teams.sync': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/sync',
    auth: 'team',
    action: 'team.view',
  },
  'teams.audit': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/audit',
    auth: 'team',
    action: 'audit.view',
  },

  // Members & invites
  'members.update': {
    method: 'PATCH',
    path: '/api/v1/teams/:teamId/members/:memberId',
    auth: 'team',
    action: 'team.view',
  },
  'members.remove': {
    method: 'DELETE',
    path: '/api/v1/teams/:teamId/members/:memberId',
    auth: 'team',
    action: 'members.manage',
  },
  'members.pending': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/members',
    auth: 'team',
    action: 'members.manage',
  },
  'members.relink': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/members/:memberId/relink',
    auth: 'team',
    action: 'members.manage',
  },
  'invites.list': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/invites',
    auth: 'team',
    action: 'invites.view',
  },
  'invites.create': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/invites',
    auth: 'team',
    action: 'invites.create',
  },
  'invites.revoke': {
    method: 'DELETE',
    path: '/api/v1/teams/:teamId/invites/:inviteId',
    auth: 'team',
    action: 'members.manage',
  },
  'invites.preview': { method: 'POST', path: '/api/v1/invites/preview', auth: 'public' },
  'invites.accept': { method: 'POST', path: '/api/v1/invites/accept', auth: 'user' },

  // Seasons, events, RSVPs
  'seasons.put': {
    method: 'PUT',
    path: '/api/v1/teams/:teamId/seasons/:seasonId',
    auth: 'team',
    action: 'events.manage',
  },
  'events.create': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/events',
    auth: 'team',
    action: 'events.manage',
  },
  'events.update': {
    method: 'PATCH',
    path: '/api/v1/teams/:teamId/events/:eventId',
    auth: 'team',
    action: 'events.manage',
  },
  'events.delete': {
    method: 'DELETE',
    path: '/api/v1/teams/:teamId/events/:eventId',
    auth: 'team',
    action: 'events.manage',
  },
  'recurrences.create': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/recurrences',
    auth: 'team',
    action: 'events.manage',
  },
  'recurrences.get': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/recurrences/:recurrenceId',
    auth: 'team',
    action: 'events.manage',
  },
  'recurrences.update': {
    method: 'PUT',
    path: '/api/v1/teams/:teamId/recurrences/:recurrenceId',
    auth: 'team',
    action: 'events.manage',
  },
  'recurrences.delete': {
    method: 'DELETE',
    path: '/api/v1/teams/:teamId/recurrences/:recurrenceId',
    auth: 'team',
    action: 'events.manage',
  },
  'rsvps.put': {
    method: 'PUT',
    path: '/api/v1/teams/:teamId/events/:eventId/rsvps/:memberId',
    auth: 'team',
    action: 'rsvp.self',
  },
  'attendance.put': {
    method: 'PUT',
    path: '/api/v1/teams/:teamId/events/:eventId/attendance',
    auth: 'team',
    action: 'events.manage',
  },

  // Team sheets
  'sheets.put': {
    method: 'PUT',
    path: '/api/v1/teams/:teamId/sheets/:sheetId',
    auth: 'team',
    action: 'sheets.manage',
  },
  'sheets.publish': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/sheets/:sheetId/publish',
    auth: 'team',
    action: 'sheets.manage',
  },
  'sheets.versions': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/sheets/:sheetId/versions',
    auth: 'team',
    action: 'sheets.manage',
  },

  // Plays
  'plays.get': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/plays/:playId',
    auth: 'team',
    action: 'team.view',
  },
  'plays.create': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/plays',
    auth: 'team',
    action: 'plays.manage',
  },
  'plays.update': {
    method: 'PATCH',
    path: '/api/v1/teams/:teamId/plays/:playId',
    auth: 'team',
    action: 'plays.manage',
  },
  'plays.delete': {
    method: 'DELETE',
    path: '/api/v1/teams/:teamId/plays/:playId',
    auth: 'team',
    action: 'plays.manage',
  },
  'plays.view': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/plays/:playId/view',
    auth: 'team',
    action: 'team.view',
  },
  'plays.seen': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/plays/:playId/seen',
    auth: 'team',
    action: 'plays.manage',
  },

  // Drills & practice
  'drills.get': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/drills/:drillId',
    auth: 'team',
    action: 'team.view',
  },
  'drills.create': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/drills',
    auth: 'team',
    action: 'drills.manage',
  },
  'drills.update': {
    method: 'PATCH',
    path: '/api/v1/teams/:teamId/drills/:drillId',
    auth: 'team',
    action: 'drills.manage',
  },
  'drills.delete': {
    method: 'DELETE',
    path: '/api/v1/teams/:teamId/drills/:drillId',
    auth: 'team',
    action: 'drills.manage',
  },
  'plans.create': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/plans',
    auth: 'team',
    action: 'practice.manage',
  },
  'plans.update': {
    method: 'PATCH',
    path: '/api/v1/teams/:teamId/plans/:planId',
    auth: 'team',
    action: 'practice.manage',
  },
  'plans.delete': {
    method: 'DELETE',
    path: '/api/v1/teams/:teamId/plans/:planId',
    auth: 'team',
    action: 'practice.manage',
  },
  'runs.list': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/plans/:planId/runs',
    auth: 'team',
    action: 'team.view',
  },
  'runs.append': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/plans/:planId/runs',
    auth: 'team',
    action: 'practice.run',
  },

  // Match mode
  'match.list': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/events/:eventId/match',
    auth: 'team',
    action: 'team.view',
  },
  'match.append': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/events/:eventId/match',
    auth: 'team',
    action: 'match.record',
  },

  // Season stats: what the sync doesn't carry (match logs, full attendance history, turnout).
  // Everyone's attendance marks need availability.view; the handler narrows to your own otherwise.
  'stats.feed': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/stats',
    auth: 'team',
    action: 'team.view',
  },

  // Kit and inventory (items and open handoffs ride the team sync)
  /** Append-only history of one item. */
  'inventory.history': {
    method: 'GET',
    path: '/api/v1/teams/:teamId/inventory/:itemId/history',
    auth: 'team',
    action: 'team.view',
  },
  /** Create or edit details (InventoryItemInput); If-Match on edit. */
  'inventory.put': {
    method: 'PUT',
    path: '/api/v1/teams/:teamId/inventory/:itemId',
    auth: 'team',
    action: 'inventory.manage',
  },
  /** Remove a mistaken entry (soft delete). Real kit is retired instead. */
  'inventory.delete': {
    method: 'DELETE',
    path: '/api/v1/teams/:teamId/inventory/:itemId',
    auth: 'team',
    action: 'inventory.manage',
  },
  /** Give to a member, or null to take it back to the store. */
  'inventory.assign': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/inventory/:itemId/assign',
    auth: 'team',
    action: 'inventory.manage',
  },
  /** Holder (or inventory.manage): back in the store at its home. */
  'inventory.return': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/inventory/:itemId/return',
    auth: 'team',
    action: 'team.view',
  },
  /** Holder (or inventory.manage): mark lost; the holder is cleared. */
  'inventory.lost': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/inventory/:itemId/lost',
    auth: 'team',
    action: 'team.view',
  },
  /** Lost item is back in the store. */
  'inventory.found': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/inventory/:itemId/found',
    auth: 'team',
    action: 'inventory.manage',
  },
  /** Out of service; keeps its history. */
  'inventory.retire': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/inventory/:itemId/retire',
    auth: 'team',
    action: 'inventory.manage',
  },
  /** Split part of a set into a new item. */
  'inventory.split': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/inventory/:itemId/split',
    auth: 'team',
    action: 'inventory.manage',
  },
  /** Holder (or inventory.manage) offers it to a teammate. */
  'inventory.handoff.create': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/inventory/:itemId/handoffs',
    auth: 'team',
    action: 'team.view',
  },
  /** Recipient (or inventory.manage, as an override) accepts. */
  'inventory.handoff.accept': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/handoffs/:handoffId/accept',
    auth: 'team',
    action: 'team.view',
  },
  /** Recipient declines, sender cancels, or inventory.manage cancels. */
  'inventory.handoff.decline': {
    method: 'POST',
    path: '/api/v1/teams/:teamId/handoffs/:handoffId/decline',
    auth: 'team',
    action: 'team.view',
  },

  // Web Push (per user and device)
  /** VAPID public key for PushManager.subscribe. */
  'push.key': { method: 'GET', path: '/api/v1/push/key', auth: 'user' },
  'push.subscribe': { method: 'POST', path: '/api/v1/push/subscriptions', auth: 'user' },
  'push.unsubscribe': { method: 'POST', path: '/api/v1/push/subscriptions/remove', auth: 'user' },
  /** Send a test notification to this user's devices. */
  'push.test': { method: 'POST', path: '/api/v1/push/test', auth: 'user' },
  /** Replace the user's notification preferences (NotifyPrefs). */
  'me.notify': { method: 'PUT', path: '/api/v1/me/notifications', auth: 'user' },

  // Calendar feed (secret token in the path)
  'cal.feed': { method: 'GET', path: '/cal/:token', auth: 'public' },
} as const satisfies Record<string, RouteDef>;

export type RouteId = keyof typeof ROUTES;

/** Build a concrete path from a route id and params. */
export function routePath(id: RouteId, params: Record<string, string> = {}): string {
  return ROUTES[id].path.replace(/:(\w+)/g, (_, k: string) => {
    const val = params[k];
    if (val === undefined) throw new Error(`Missing route param ${k} for ${id}`);
    return encodeURIComponent(val);
  });
}
