/**
 * Notification wording. Payloads hold only names and titles the team can already see, never RSVP
 * notes or anything about health (docs/architecture.md §Push).
 */
import type { PushPayload, RecurrenceRule } from '@phaseplay/shared';
import { whenText } from '../notify';

export type Message = Omit<PushPayload, 'topic' | 'teamId'>;

/** The bits of an event row a message needs (snake_case, as read from D1). */
export type EventInfo = {
  id: string;
  title: string;
  type: string;
  opponent: string | null;
  starts_at: number;
  location_name: string | null;
  timezone: string;
  short_name: string;
};

/** "PRFC v Rivals" for games with an opponent, else the event title. */
export const eventLabel = (e: {
  title: string;
  type: string;
  opponent: string | null;
  short_name?: string;
}) =>
  (e.type === 'match' || e.type === 'tournament') && e.opponent
    ? `${e.short_name ?? e.title} v ${e.opponent}`
    : e.title;

const where = (loc: string | null | undefined) => (loc ? ` · ${loc}` : '');
const eventUrl = (teamId: string, id: string) => `/events/${id}?team=${teamId}`;

export function eventCreated(teamId: string, e: EventInfo): Message {
  return {
    title: `New: ${eventLabel(e)}`,
    body: `${whenText(e.starts_at, e.timezone)}${where(e.location_name)}. Can you make it?`,
    url: eventUrl(teamId, e.id),
    tag: `event-${e.id}`,
  };
}

export function eventChanged(teamId: string, e: EventInfo): Message {
  return {
    title: `Changed: ${eventLabel(e)}`,
    body: `Now ${whenText(e.starts_at, e.timezone)}${where(e.location_name)}.`,
    url: eventUrl(teamId, e.id),
    tag: `event-${e.id}`,
  };
}

export function eventCancelled(teamId: string, e: EventInfo, removed = false): Message {
  return {
    title: `Cancelled: ${eventLabel(e)}`,
    body: `${whenText(e.starts_at, e.timezone)} is ${removed ? 'off the schedule' : 'cancelled'}.`,
    url: removed ? `/schedule?team=${teamId}` : eventUrl(teamId, e.id),
    tag: `event-${e.id}`,
  };
}

export function eventRestored(teamId: string, e: EventInfo): Message {
  return {
    title: `Back on: ${eventLabel(e)}`,
    body: `${whenText(e.starts_at, e.timezone)}${where(e.location_name)} is going ahead after all.`,
    url: eventUrl(teamId, e.id),
    tag: `event-${e.id}`,
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const listOf = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
/** "Tue and Thu at 19:00" (series times are in team time already). */
export const ruleText = (r: Pick<RecurrenceRule, 'weekdays' | 'time'>) =>
  `${listOf([...r.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d]!))} at ${r.time}`;

export function seriesCreated(
  teamId: string,
  s: { title: string; rule: RecurrenceRule; locationName?: string | null; count: number },
): Message {
  return {
    title: `New: ${s.title}, ${ruleText(s.rule)}`,
    body: `${s.count} session${s.count === 1 ? '' : 's'} from ${s.rule.startsOn}${where(s.locationName)}.`,
    url: `/schedule?team=${teamId}`,
    tag: 'series',
  };
}

export function seriesChanged(
  teamId: string,
  s: { title: string; rule: RecurrenceRule; locationName?: string | null },
): Message {
  return {
    title: `Changed: ${s.title}`,
    body: `Now ${ruleText(s.rule)}${where(s.locationName)}, for upcoming sessions.`,
    url: `/schedule?team=${teamId}`,
    tag: 'series',
  };
}

export function seriesRemoved(teamId: string, title: string, count: number): Message {
  return {
    title: `Cancelled: ${title}`,
    body: `The ${count} upcoming session${count === 1 ? ' is' : 's are'} off the schedule.`,
    url: `/schedule?team=${teamId}`,
    tag: 'series',
  };
}

export function sheetPublished(
  teamId: string,
  e: { id: string; title: string; type: string; opponent: string | null; short_name: string },
): Message {
  return {
    title: `Team sheet: ${eventLabel(e)}`,
    body: "The team is out. See who's playing.",
    url: `/events/${e.id}/sheet?team=${teamId}`,
    tag: `sheet-${e.id}`,
  };
}

export function playShared(teamId: string, id: string, title: string): Message {
  return {
    title: `New play: ${title}`,
    body: 'Shared with the team. Have a look before training.',
    url: `/plays/${id}?team=${teamId}`,
    tag: `play-${id}`,
  };
}

export function planShared(teamId: string, id: string, title: string): Message {
  return {
    title: `Practice plan: ${title}`,
    body: 'Shared with the team.',
    url: `/practice/${id}?team=${teamId}`,
    tag: `plan-${id}`,
  };
}

/** "Sat 12" in the team's timezone. */
export function dayText(ms: number, tz: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
    }).formatToParts(ms);
    const get = (k: string) => parts.find((x) => x.type === k)?.value ?? '';
    return `${get('weekday')} ${get('day')}`;
  } catch {
    return new Date(ms).toUTCString().slice(0, 7);
  }
}

/** "Sat 12, 2:30 PM" (US zones) or "Sat 12, 14:30". */
export function dayTimeText(ms: number, tz: string) {
  try {
    const clock = new Intl.DateTimeFormat(tz.startsWith('America/') ? 'en-US' : 'en-GB', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
    }).format(ms);
    return `${dayText(ms, tz)}, ${clock}`;
  } catch {
    return dayText(ms, tz);
  }
}

const orList = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
export const datesText = (dates: number[], tz: string) =>
  orList([...dates].sort((a, b) => a - b).map((d) => dayText(d, tz)));
const isGameType = (type: string) => type === 'match' || type === 'tournament';

/** "Would you play? · PRFC v Harlequins: Sat 12 or Sat 19". */
export function proposalCreated(teamId: string, e: EventInfo, dates: number[]): Message {
  return {
    title: isGameType(e.type) ? 'Would you play?' : 'Are you in?',
    body: `${eventLabel(e)}: ${datesText(dates, e.timezone)}. Not confirmed yet, tap to answer.`,
    url: eventUrl(teamId, e.id),
    tag: `event-${e.id}`,
  };
}

/** To everyone who was in for the chosen date: "It's on: PRFC v Harlequins · Sat 12, 2:30. Still in?" */
export function proposalConfirmed(teamId: string, e: EventInfo): Message {
  return {
    title: `It's on: ${eventLabel(e)}`,
    body: `${dayTimeText(e.starts_at, e.timezone)}${where(e.location_name)}. Still in?`,
    url: eventUrl(teamId, e.id),
    tag: `event-${e.id}`,
  };
}

/** To everyone who answered a proposal that won't happen. */
export function proposalDropped(teamId: string, e: EventInfo): Message {
  return {
    title: `Not going ahead: ${eventLabel(e)}`,
    body: 'Thanks for answering. It’s off for now.',
    url: `/schedule?team=${teamId}`,
    tag: `event-${e.id}`,
  };
}
