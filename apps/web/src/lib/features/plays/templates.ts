/** Built-in drill templates and play presets a team has hidden from its pickers. */
import { app } from '#lib/data/app.svelte';

/** `drill:<id>` or `preset:<id>`: still offered unless the team hid it. */
export const shownTemplate = (key: string): boolean =>
  !(app.team?.hiddenTemplates ?? []).includes(key);
