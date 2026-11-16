/** Per-category icon and colour class. Colour is never the only signal: each has its own icon. */
import type { Component } from 'svelte';
import type { EventCategory, EventType } from '@phaseplay/shared';
import IconGame from '@lucide/svelte/icons/swords';
import IconPractice from '@lucide/svelte/icons/traffic-cone';
import IconEvent from '@lucide/svelte/icons/party-popper';
import IconAll from '@lucide/svelte/icons/calendar-days';
import IconTrophy from '@lucide/svelte/icons/trophy';
import IconCoins from '@lucide/svelte/icons/hand-coins';
import IconMeeting from '@lucide/svelte/icons/users-round';
import IconStar from '@lucide/svelte/icons/star';
import type { Show } from './schedule';

export const CATEGORY_ICON: Record<Show, Component> = {
  all: IconAll,
  games: IconGame,
  practices: IconPractice,
  events: IconEvent,
};

export const TYPE_ICON: Record<EventType, Component> = {
  match: IconGame,
  tournament: IconTrophy,
  training: IconPractice,
  social: IconEvent,
  fundraiser: IconCoins,
  meeting: IconMeeting,
  other: IconStar,
};

export const CATEGORY_BLURB: Record<EventCategory, string> = {
  games: 'Fixtures, friendlies and 7s tournaments',
  practices: 'Training sessions, one-off or every week',
  events: 'Socials, fundraisers, meetings and the rest',
};
