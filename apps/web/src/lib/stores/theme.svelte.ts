import { accessibleAccent, fillAccent, type TeamColors } from '@phaseplay/shared';

export type ThemePref = 'system' | 'light' | 'dark';

function read(): ThemePref {
  try {
    const t = localStorage.getItem('pp:theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

class Theme {
  pref = $state<ThemePref>('system');
  init() {
    this.pref = read();
  }
  set(p: ThemePref) {
    this.pref = p;
    try {
      if (p === 'system') localStorage.removeItem('pp:theme');
      else localStorage.setItem('pp:theme', p);
    } catch {}
    if (p === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = p;
  }
  /** Apply a team's colours as the accent, nudged until text and fills pass WCAG AA. */
  applyTeam(colors: TeamColors | null) {
    const root = document.documentElement.style;
    if (!colors) {
      for (const k of [
        '--accent',
        '--on-accent',
        '--accent-text',
        '--secondary',
        '--accent-text-dark',
      ])
        root.removeProperty(k);
      try {
        localStorage.removeItem('pp:accent');
      } catch {}
      return;
    }
    const fill = fillAccent(colors.primary);
    const vars: Record<string, string> = {
      '--accent': fill.bg,
      '--on-accent': fill.fg,
      '--secondary': colors.secondary,
    };
    const dark =
      this.pref === 'dark' ||
      (this.pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    vars['--accent-text'] = accessibleAccent(colors.primary, dark ? '#131915' : '#ffffff');
    for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
    try {
      localStorage.setItem('pp:accent', JSON.stringify(vars));
    } catch {}
  }
}

export const theme = new Theme();
