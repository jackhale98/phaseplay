/** Android vibration where supported; iOS gets the visual only (docs/design.md §Haptics). */
export function buzz(pattern: number | number[] = 12) {
  try {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(pattern);
  } catch {}
}
