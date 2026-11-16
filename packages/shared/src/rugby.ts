/**
 * Rugby domain rules (docs/architecture.md §Rugby domain). Everything configurable per event
 * starts from these defaults.
 */
export const FORMATS = ['15s', '7s'] as const;
export type Format = (typeof FORMATS)[number];

export type Position = { n: number; name: string; short: string; group: PositionGroup };

export const GROUPS_15 = [
  'front_row',
  'locks',
  'back_row',
  'halves',
  'centres',
  'back_three',
] as const;
export const GROUPS_7 = ['forwards', 'backs'] as const;
export type PositionGroup = (typeof GROUPS_15)[number] | (typeof GROUPS_7)[number];

export const GROUP_LABELS: Record<PositionGroup, string> = {
  front_row: 'Front row',
  locks: 'Locks',
  back_row: 'Back row',
  halves: 'Halves',
  centres: 'Centres',
  back_three: 'Back three',
  forwards: 'Forwards',
  backs: 'Backs',
};

export const POSITIONS_15: Position[] = [
  { n: 1, name: 'Loosehead prop', short: 'LHP', group: 'front_row' },
  { n: 2, name: 'Hooker', short: 'HK', group: 'front_row' },
  { n: 3, name: 'Tighthead prop', short: 'THP', group: 'front_row' },
  { n: 4, name: 'Lock', short: 'LK', group: 'locks' },
  { n: 5, name: 'Lock', short: 'LK', group: 'locks' },
  { n: 6, name: 'Blindside flanker', short: 'BF', group: 'back_row' },
  { n: 7, name: 'Openside flanker', short: 'OF', group: 'back_row' },
  { n: 8, name: 'Number 8', short: 'N8', group: 'back_row' },
  { n: 9, name: 'Scrum-half', short: 'SH', group: 'halves' },
  { n: 10, name: 'Fly-half', short: 'FH', group: 'halves' },
  { n: 11, name: 'Left wing', short: 'LW', group: 'back_three' },
  { n: 12, name: 'Inside centre', short: 'IC', group: 'centres' },
  { n: 13, name: 'Outside centre', short: 'OC', group: 'centres' },
  { n: 14, name: 'Right wing', short: 'RW', group: 'back_three' },
  { n: 15, name: 'Fullback', short: 'FB', group: 'back_three' },
];

export const POSITIONS_7: Position[] = [
  { n: 1, name: 'Loosehead prop', short: 'LHP', group: 'forwards' },
  { n: 2, name: 'Hooker', short: 'HK', group: 'forwards' },
  { n: 3, name: 'Tighthead prop', short: 'THP', group: 'forwards' },
  { n: 4, name: 'Scrum-half', short: 'SH', group: 'backs' },
  { n: 5, name: 'Fly-half', short: 'FH', group: 'backs' },
  { n: 6, name: 'Centre', short: 'C', group: 'backs' },
  { n: 7, name: 'Wing', short: 'W', group: 'backs' },
];

export type FormatRules = {
  starters: number;
  maxReplacements: number;
  defaultReplacements: number;
  halfMinutes: number;
  finalHalfMinutes: number;
  sinBinMinutes: number;
  groups: readonly PositionGroup[];
  positions: Position[];
  /** Front-row-capable players required for a full matchday squad (World Rugby Law 3). */
  frontRowCover: number;
};

export const RULES: Record<Format, FormatRules> = {
  '15s': {
    starters: 15,
    maxReplacements: 8,
    defaultReplacements: 8,
    halfMinutes: 40,
    finalHalfMinutes: 40,
    sinBinMinutes: 10,
    groups: GROUPS_15,
    positions: POSITIONS_15,
    frontRowCover: 6,
  },
  '7s': {
    starters: 7,
    maxReplacements: 5,
    defaultReplacements: 5,
    halfMinutes: 7,
    finalHalfMinutes: 10,
    sinBinMinutes: 2,
    groups: GROUPS_7,
    positions: POSITIONS_7,
    frontRowCover: 3,
  },
};

/**
 * 7s positions numbered 1–7 map onto 15s equivalents so a player's 15s positions also rank for 7s.
 * Positions are stored in 15s numbering (1–15) on the member.
 */
const SEVENS_EQUIV: Record<number, number[]> = {
  1: [1],
  2: [2],
  3: [3],
  4: [9],
  5: [10],
  6: [12, 13],
  7: [11, 14, 15],
};

export function positionsFor(format: Format): Position[] {
  return RULES[format].positions;
}

export function positionName(format: Format, n: number): string {
  return positionsFor(format).find((p) => p.n === n)?.name ?? `Replacement ${n}`;
}

/** Group a 15s position number for the given format. */
export function groupOf(format: Format, position15: number): PositionGroup | undefined {
  if (format === '15s') return POSITIONS_15.find((p) => p.n === position15)?.group;
  return position15 <= 8 ? 'forwards' : 'backs';
}

export function primaryGroup(format: Format, positions: number[]): PositionGroup | undefined {
  const first = positions[0];
  return first === undefined ? undefined : groupOf(format, first);
}

export function isFrontRowCapable(positions: number[]): boolean {
  return positions.some((p) => p >= 1 && p <= 3);
}

/**
 * How well a player fits a sheet slot. 3 = primary position, 2 = listed position, 1 = same group,
 * 0 = out of position. Bench slots accept anyone (1) but favour front-row cover when short.
 */
export function slotFit(format: Format, slot: number, positions: number[]): number {
  const rules = RULES[format];
  if (slot > rules.starters) return positions.length ? 1 : 0;
  const wanted = format === '15s' ? [slot] : (SEVENS_EQUIV[slot] ?? []);
  if (positions[0] !== undefined && wanted.includes(positions[0])) return 3;
  if (positions.some((p) => wanted.includes(p))) return 2;
  const slotGroup = format === '15s' ? groupOf('15s', slot) : slot <= 3 ? 'forwards' : 'backs';
  if (positions.some((p) => groupOf(format, p) === slotGroup)) return 1;
  return 0;
}

export function sheetSlots(format: Format, replacements?: number): number[] {
  const r = RULES[format];
  const bench = Math.max(0, Math.min(r.maxReplacements, replacements ?? r.defaultReplacements));
  return Array.from({ length: r.starters + bench }, (_, i) => i + 1);
}

export type ScoringValues = {
  try: number;
  conversion: number;
  penalty_goal: number;
  drop_goal: number;
  penalty_try: number;
};

export const DEFAULT_POINTS: ScoringValues = {
  try: 5,
  conversion: 2,
  penalty_goal: 3,
  drop_goal: 3,
  penalty_try: 7,
};

export const PENALTY_OFFENCES = [
  'offside',
  'ruck',
  'scrum',
  'lineout',
  'high_tackle',
  'not_releasing',
  'obstruction',
  'other',
] as const;

export const OFFENCE_LABELS: Record<(typeof PENALTY_OFFENCES)[number], string> = {
  offside: 'Offside',
  ruck: 'Ruck / breakdown',
  scrum: 'Scrum',
  lineout: 'Lineout',
  high_tackle: 'High tackle',
  not_releasing: 'Not releasing',
  obstruction: 'Obstruction',
  other: 'Other',
};

export const PENALTY_OUTCOMES = ['kick_to_touch', 'scrum', 'tap', 'kick_at_goal'] as const;
export const OUTCOME_LABELS: Record<(typeof PENALTY_OUTCOMES)[number], string> = {
  kick_to_touch: 'Kick to touch',
  scrum: 'Scrum',
  tap: 'Tap',
  kick_at_goal: 'Kick at goal',
};
