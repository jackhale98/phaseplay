import type { Component } from 'svelte';
import {
  IconCalendar,
  IconHome,
  IconMore,
  IconPlaybook,
  IconUsers,
  IconTimer,
  IconSettings,
  IconClipboard,
} from '#lib/icons';

export type NavItem = {
  href: string;
  label: string;
  icon: Component;
  match: RegExp;
  desktopOnly?: boolean;
};

export const NAV: NavItem[] = [
  { href: '/home', label: 'Home', icon: IconHome, match: /^\/home/ },
  { href: '/schedule', label: 'Schedule', icon: IconCalendar, match: /^\/(schedule|events)/ },
  { href: '/squad', label: 'Squad', icon: IconUsers, match: /^\/squad/ },
  { href: '/playbook', label: 'Playbook', icon: IconPlaybook, match: /^\/(playbook|plays|drills)/ },
  {
    href: '/practice',
    label: 'Practice',
    icon: IconTimer,
    match: /^\/practice/,
    desktopOnly: true,
  },
  // On phones Kit lives under More.
  { href: '/kit', label: 'Kit', icon: IconClipboard, match: /^\/kit/, desktopOnly: true },
  { href: '/more', label: 'More', icon: IconMore, match: /^\/(more|settings)/ },
];

export const DESKTOP_EXTRA: NavItem[] = [
  { href: '/settings', label: 'Settings', icon: IconSettings, match: /^\/settings/ },
];
