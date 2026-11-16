/**
 * Pitch themes (docs/design.md §Visual language): Grass, Chalkboard and Print. Attackers take the
 * team accent passed at draw time; everything else comes from the theme.
 */
import { contrast, fillAccent, onAccent } from '@phaseplay/shared';

export type ThemeName = 'grass' | 'chalkboard' | 'print';
export type Group = 'A' | 'B' | 'C' | 'D';

export type Theme = {
  name: ThemeName;
  /** Canvas fill outside the field of play. */
  surround: string;
  /** Alternating 10 m stripes of the field of play. */
  stripes: [string, string];
  /** In-goal fill. */
  inGoal: string;
  line: string;
  /** Faint metre grid for drill backgrounds. */
  grid: string;
  /** Text drawn directly on the pitch (dimension labels, captions on pitch). */
  text: string;
  defence: { fill: string; text: string };
  /** Outline around every token, for separation from the pitch. */
  tokenStroke: string;
  groups: Record<Group, string>;
  coach: { fill: string; text: string };
  ball: string;
  ballSeam: string;
  shadow: string;
  trail: { run: string; pass: string; kick: string };
  trailAlpha: number;
  highlight: string;
  zone: { stroke: string; fill: string };
  label: { bg: string; text: string };
  equipment: {
    cone: string;
    marker: string;
    pole: string;
    shield: string;
    bag: string;
    tube: string;
    ladder: string;
    hurdle: string;
    scrumMachine: string;
  };
  /** Panel/background colour for export chrome (headers, caption bands). */
  paper: string;
  ink: string;
  muted: string;
};

/** Canvas font stack: the app's self-hosted variable sans, then system fonts. */
export const FONT = "'PP Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const BIBS: Record<Group, string> = { A: '#facc15', B: '#2563eb', C: '#dc2626', D: '#9333ea' };

export const grass: Theme = {
  name: 'grass',
  surround: '#2f6b35',
  stripes: ['#3f8a45', '#468f4b'],
  inGoal: '#37803e',
  line: '#ffffff',
  grid: 'rgba(255,255,255,0.14)',
  text: '#ffffff',
  defence: { fill: '#1e293b', text: '#ffffff' },
  tokenStroke: 'rgba(0,0,0,0.55)',
  groups: BIBS,
  coach: { fill: '#111827', text: '#fde047' },
  ball: '#f8fafc',
  ballSeam: '#b45309',
  shadow: 'rgba(0,0,0,0.32)',
  trail: { run: '#ffffff', pass: '#fde047', kick: '#fb923c' },
  trailAlpha: 0.9,
  highlight: '#fde047',
  zone: { stroke: 'rgba(255,255,255,0.9)', fill: 'rgba(255,255,255,0.10)' },
  label: { bg: 'rgba(15,23,42,0.78)', text: '#ffffff' },
  equipment: {
    cone: '#f97316',
    marker: '#facc15',
    pole: '#f43f5e',
    shield: '#1d4ed8',
    bag: '#0f172a',
    tube: '#dc2626',
    ladder: '#fde047',
    hurdle: '#f8fafc',
    scrumMachine: '#334155',
  },
  paper: '#0f1f13',
  ink: '#ffffff',
  muted: 'rgba(255,255,255,0.72)',
};

export const chalkboard: Theme = {
  name: 'chalkboard',
  surround: '#1f2a2e',
  stripes: ['#26363a', '#26363a'],
  inGoal: '#223034',
  line: 'rgba(241,245,249,0.85)',
  grid: 'rgba(241,245,249,0.10)',
  text: '#f1f5f9',
  defence: { fill: '#e2e8f0', text: '#0f172a' },
  tokenStroke: 'rgba(241,245,249,0.9)',
  groups: BIBS,
  coach: { fill: '#f1f5f9', text: '#0f172a' },
  ball: '#f8fafc',
  ballSeam: '#92400e',
  shadow: 'rgba(0,0,0,0.45)',
  trail: { run: '#f1f5f9', pass: '#fde68a', kick: '#fdba74' },
  trailAlpha: 0.85,
  highlight: '#fde047',
  zone: { stroke: 'rgba(241,245,249,0.8)', fill: 'rgba(241,245,249,0.08)' },
  label: { bg: 'rgba(241,245,249,0.92)', text: '#0f172a' },
  equipment: {
    cone: '#fb923c',
    marker: '#fde047',
    pole: '#fb7185',
    shield: '#60a5fa',
    bag: '#94a3b8',
    tube: '#f87171',
    ladder: '#fde68a',
    hurdle: '#e2e8f0',
    scrumMachine: '#64748b',
  },
  paper: '#172023',
  ink: '#f1f5f9',
  muted: 'rgba(241,245,249,0.7)',
};

export const print: Theme = {
  name: 'print',
  surround: '#ffffff',
  stripes: ['#ffffff', '#f6f7f6'],
  inGoal: '#f1f3f1',
  line: '#111827',
  grid: 'rgba(17,24,39,0.10)',
  text: '#111827',
  defence: { fill: '#4b5563', text: '#ffffff' },
  tokenStroke: '#111827',
  groups: { A: '#ca8a04', B: '#1d4ed8', C: '#b91c1c', D: '#7e22ce' },
  coach: { fill: '#111827', text: '#ffffff' },
  ball: '#ffffff',
  ballSeam: '#111827',
  shadow: 'rgba(0,0,0,0.18)',
  trail: { run: '#111827', pass: '#1f2937', kick: '#374151' },
  trailAlpha: 1,
  highlight: '#ca8a04',
  zone: { stroke: '#374151', fill: 'rgba(17,24,39,0.05)' },
  label: { bg: '#111827', text: '#ffffff' },
  equipment: {
    cone: '#ea580c',
    marker: '#ca8a04',
    pole: '#be123c',
    shield: '#1d4ed8',
    bag: '#111827',
    tube: '#b91c1c',
    ladder: '#a16207',
    hurdle: '#374151',
    scrumMachine: '#374151',
  },
  paper: '#ffffff',
  ink: '#111827',
  muted: '#4b5563',
};

export const THEMES: Record<ThemeName, Theme> = { grass, chalkboard, print };

/** Accept a theme object or its name. */
export function resolveTheme(theme: Theme | ThemeName | undefined): Theme {
  if (!theme) return grass;
  return typeof theme === 'string' ? (THEMES[theme] ?? grass) : theme;
}

export type TokenColours = { fill: string; text: string };
const accentCache = new Map<string, TokenColours>();
const textCache = new Map<string, string>();

/**
 * Attacker colours for a team accent: the fill is nudged until black or white text reaches AA
 * (4.5:1), and the text picks whichever contrasts more. Memoised per accent.
 */
export function attackColours(accent: string): TokenColours {
  let c = accentCache.get(accent);
  if (!c) {
    const f = /^#[0-9a-f]{3,6}$/i.test(accent)
      ? fillAccent(accent)
      : { bg: '#2563eb', fg: '#ffffff' };
    c = { fill: f.bg, text: f.fg };
    accentCache.set(accent, c);
  }
  return c;
}

/** Black or white text for an arbitrary (hex) fill. Memoised. */
export function textOn(fill: string): string {
  let t = textCache.get(fill);
  if (!t) {
    t = /^#[0-9a-f]{3,6}$/i.test(fill) ? onAccent(fill) : '#ffffff';
    textCache.set(fill, t);
  }
  return t;
}

/** True when two hex colours are too close to tell apart as token fills. */
export function tooSimilar(a: string, b: string): boolean {
  return /^#/.test(a) && /^#/.test(b) && contrast(a, b) < 1.6;
}
