/**
 * Web Push notifications (PLAN.md M7). Users opt in per device; what they hear about is a per-user
 * preference. Payloads carry no personal details beyond names already visible in the team.
 */
import * as v from 'valibot';
import { text } from './common';

export const NOTIFY_TOPICS = ['events', 'reminders', 'sheets', 'plays', 'kit'] as const;
export type NotifyTopic = (typeof NOTIFY_TOPICS)[number];
export const NOTIFY_TOPIC_INFO: Record<NotifyTopic, { label: string; hint: string }> = {
  events: {
    label: 'Schedule changes',
    hint: 'New events, time or place changes and cancellations.',
  },
  reminders: { label: 'Reply reminders', hint: "A nudge the day before if you haven't replied." },
  sheets: { label: 'Team sheets', hint: 'When the team sheet for a game is published.' },
  plays: {
    label: 'Plays and practice plans',
    hint: 'When a play or practice plan is shared with you.',
  },
  kit: { label: 'Kit', hint: 'Handover requests, and kit you hold for an event you’re missing.' },
};

/** Per-user preferences; every topic is on until switched off. */
export const NotifyPrefs = v.object({
  events: v.optional(v.boolean(), true),
  reminders: v.optional(v.boolean(), true),
  sheets: v.optional(v.boolean(), true),
  plays: v.optional(v.boolean(), true),
  kit: v.optional(v.boolean(), true),
});
export type NotifyPrefs = v.InferOutput<typeof NotifyPrefs>;

const B64Url = (min: number, max: number) =>
  v.pipe(v.string(), v.minLength(min), v.maxLength(max), v.regex(/^[A-Za-z0-9_-]+=*$/));

/** A browser PushSubscription (`subscription.toJSON()`), plus a device label. */
export const PushSubscriptionInput = v.object({
  endpoint: v.pipe(v.string(), v.url(), v.startsWith('https://'), v.maxLength(1000)),
  keys: v.object({ p256dh: B64Url(40, 200), auth: B64Url(8, 64) }),
  label: v.optional(v.nullable(text(60, 1)), null),
});
export type PushSubscriptionInput = v.InferOutput<typeof PushSubscriptionInput>;

export const PushUnsubscribe = v.object({
  endpoint: v.pipe(v.string(), v.url(), v.maxLength(1000)),
});
export type PushUnsubscribe = v.InferOutput<typeof PushUnsubscribe>;

/** What the service worker receives and shows. */
export type PushPayload = {
  topic: NotifyTopic | 'test';
  teamId: string | null;
  title: string;
  body: string;
  /** App path to open on tap, e.g. `/events/<id>?team=<teamId>`. */
  url: string;
  /** Replaces an earlier notification with the same tag (e.g. one per event). */
  tag?: string;
};
