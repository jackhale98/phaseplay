/** Mini-pitch zones: x runs from our try line (0) to theirs (1), y from left touch (0) to right (1). */
export type Zone = { x: number; y: number };

export const ZONE_COLS = [
  { x: 0.11, name: 'Our 22' },
  { x: 0.36, name: 'Our half' },
  { x: 0.64, name: 'Their half' },
  { x: 0.89, name: 'Their 22' },
] as const;
export const ZONE_ROWS = [
  { y: 1 / 6, name: 'left' },
  { y: 0.5, name: 'middle' },
  { y: 5 / 6, name: 'right' },
] as const;

export function cellOf(z: Zone | null | undefined): { c: number; r: number } | null {
  if (!z) return null;
  const c = z.x < 0.22 ? 0 : z.x < 0.5 ? 1 : z.x < 0.78 ? 2 : 3;
  const r = z.y < 1 / 3 ? 0 : z.y < 2 / 3 ? 1 : 2;
  return { c, r };
}

export function zoneName(z: Zone | null | undefined): string {
  const k = cellOf(z);
  return k ? `${ZONE_COLS[k.c]!.name}, ${ZONE_ROWS[k.r]!.name}` : 'No zone';
}
