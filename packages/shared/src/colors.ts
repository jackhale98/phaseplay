/** WCAG contrast helpers for team theming (docs/design.md §Team theming). */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return (
    '#' +
    [r, g, b]
      .map((x) =>
        Math.round(Math.max(0, Math.min(255, x)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Pick black-ish or white text for an accent, whichever contrasts more. */
export function onAccent(accent: string): string {
  return contrast(accent, '#ffffff') >= contrast(accent, '#0b0f0c') ? '#ffffff' : '#0b0f0c';
}

function mix(hex: string, target: string, t: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/**
 * Nudge an accent until it reaches `min` contrast against `surface` (for text/icons drawn in the
 * accent colour), darkening on light surfaces and lightening on dark ones.
 */
export function accessibleAccent(accent: string, surface: string, min = 4.5): string {
  if (contrast(accent, surface) >= min) return accent;
  const toward = luminance(surface) > 0.5 ? '#000000' : '#ffffff';
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(accent, toward, t);
    if (contrast(c, surface) >= min) return c;
  }
  return toward;
}

/** Accent usable as a filled background with AA text on it (4.5:1 for either black or white). */
export function fillAccent(accent: string): { bg: string; fg: string } {
  let bg = accent;
  for (let i = 0; i < 20 && Math.max(contrast(bg, '#ffffff'), contrast(bg, '#0b0f0c')) < 4.5; i++)
    bg = mix(bg, luminance(bg) > 0.4 ? '#ffffff' : '#000000', 0.08);
  return { bg, fg: onAccent(bg) };
}

export function initials(name: string, max = 3): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words
    .slice(0, max)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
