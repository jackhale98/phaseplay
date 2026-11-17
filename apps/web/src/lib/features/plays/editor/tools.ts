import type { Component } from 'svelte';
import type { Entity } from '@phaseplay/shared';
import IconSelect from '@lucide/svelte/icons/mouse-pointer-2';
import IconCircle from '@lucide/svelte/icons/circle';
import IconSquare from '@lucide/svelte/icons/square';
import IconBall from '@lucide/svelte/icons/egg';
import IconCone from '@lucide/svelte/icons/traffic-cone';
import IconRun from '@lucide/svelte/icons/spline';
import IconPass from '@lucide/svelte/icons/move-right';
import IconKick from '@lucide/svelte/icons/footprints';
import IconText from '@lucide/svelte/icons/type';
import IconZone from '@lucide/svelte/icons/square-dashed';
import IconPlayer from '@lucide/svelte/icons/user-round';
import IconPackage from '@lucide/svelte/icons/package';

export type ToolId = 'select' | 'add' | 'run' | 'pass' | 'kick' | 'text';
export type Tool = { id: ToolId; kind?: Entity['kind'] };

export type ToolButton = {
  key: string;
  label: string;
  short: string;
  icon: Component;
  tool: Tool | null; // null = opens the equipment palette
  shortcut?: string;
};

export const PLAY_TOOLS: ToolButton[] = [
  {
    key: 'select',
    label: 'Select and move',
    short: 'Select',
    icon: IconSelect,
    tool: { id: 'select' },
    shortcut: 'V',
  },
  {
    key: 'attack',
    label: 'Add attacker',
    short: 'Attacker',
    icon: IconCircle,
    tool: { id: 'add', kind: 'attack' },
    shortcut: 'A',
  },
  {
    key: 'defence',
    label: 'Add defender',
    short: 'Defender',
    icon: IconSquare,
    tool: { id: 'add', kind: 'defence' },
    shortcut: 'D',
  },
  {
    key: 'ball',
    label: 'Place the ball',
    short: 'Ball',
    icon: IconBall,
    tool: { id: 'add', kind: 'ball' },
    shortcut: 'B',
  },
  {
    key: 'cone',
    label: 'Add cone',
    short: 'Cone',
    icon: IconCone,
    tool: { id: 'add', kind: 'cone' },
  },
  {
    key: 'run',
    label: 'Draw a run',
    short: 'Run',
    icon: IconRun,
    tool: { id: 'run' },
    shortcut: 'R',
  },
  {
    key: 'pass',
    label: 'Pass: tap the receiver',
    short: 'Pass',
    icon: IconPass,
    tool: { id: 'pass' },
    shortcut: 'P',
  },
  {
    key: 'kick',
    label: 'Kick: tap the landing spot',
    short: 'Kick',
    icon: IconKick,
    tool: { id: 'kick' },
    shortcut: 'K',
  },
  {
    key: 'text',
    label: 'Add text',
    short: 'Text',
    icon: IconText,
    tool: { id: 'text' },
    shortcut: 'T',
  },
];

export const DRILL_TOOLS: ToolButton[] = [
  PLAY_TOOLS[0]!,
  {
    key: 'player',
    label: 'Add player',
    short: 'Player',
    icon: IconPlayer,
    tool: { id: 'add', kind: 'player' },
  },
  PLAY_TOOLS[1]!,
  PLAY_TOOLS[2]!,
  { key: 'equipment', label: 'Equipment', short: 'Kit', icon: IconPackage, tool: null },
  {
    key: 'zone',
    label: 'Add zone',
    short: 'Zone',
    icon: IconZone,
    tool: { id: 'add', kind: 'zone' },
  },
  PLAY_TOOLS[5]!,
  PLAY_TOOLS[6]!,
  PLAY_TOOLS[8]!,
];

export const EQUIPMENT_KINDS: { kind: Entity['kind']; label: string }[] = [
  { kind: 'cone', label: 'Cone' },
  { kind: 'marker', label: 'Flat marker' },
  { kind: 'pole', label: 'Pole' },
  { kind: 'gate', label: 'Gate (cone pair)' },
  { kind: 'shield', label: 'Tackle shield' },
  { kind: 'bag', label: 'Tackle bag' },
  { kind: 'tube', label: 'Tackle tube' },
  { kind: 'ladder', label: 'Ladder' },
  { kind: 'hurdle', label: 'Hurdle' },
  { kind: 'scrum_machine', label: 'Scrum machine' },
  { kind: 'ball', label: 'Ball' },
  { kind: 'coach', label: 'Coach' },
];

export const SHORTCUTS: [string, string][] = [
  ['V', 'Select'],
  ['A / D / B', 'Add attacker / defender / ball'],
  ['R / P / K', 'Run / pass / kick'],
  ['T', 'Text'],
  ['N', 'New frame'],
  ['⌘D / Ctrl+D', 'Duplicate frame'],
  ['Space', 'Play preview'],
  ['← / →', 'Previous / next frame (nothing selected)'],
  ['Arrow keys', 'Nudge selection (Shift = 1 m)'],
  ['Tab', 'Cycle through tokens'],
  ['Enter', 'Token properties'],
  ['⌘Z / ⇧⌘Z', 'Undo / redo'],
  ['Del', 'Delete selection'],
  ['Esc', 'Clear selection'],
  ['?', 'This sheet'],
];

export const sameTool = (a: Tool, b: Tool | null) =>
  !!b && a.id === b.id && (a.kind ?? null) === (b.kind ?? null);
