/**
 * Play model migrations. Each entry upgrades a raw diagram from version N to N + 1; migratePlay
 * runs them in order and validates the result against the shared schema.
 */
import { Play } from '@phaseplay/shared';
import * as v from 'valibot';

export const CURRENT_PLAY_VERSION = 1;

type Raw = Record<string, unknown>;

/**
 * Registry: MIGRATIONS[n] upgrades a version-n object to version n + 1.
 * Example for the future: `1: (p) => ({ ...p, v: 2, newField: default })`.
 */
export const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {};

export class PlayMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlayMigrationError';
  }
}

/** Upgrade any stored diagram to the current Play version, then validate it. Throws on failure. */
export function migratePlay(raw: unknown): Play {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new PlayMigrationError('Diagram is not an object');
  let cur = raw as Raw;
  const v0 = cur.v;
  if (typeof v0 !== 'number' || !Number.isInteger(v0) || v0 < 1)
    throw new PlayMigrationError('Diagram has no valid version');
  let ver: number = v0;
  if (ver > CURRENT_PLAY_VERSION)
    throw new PlayMigrationError(
      `Diagram version ${ver} is newer than this app supports (${CURRENT_PLAY_VERSION}); please update`,
    );
  while (ver < CURRENT_PLAY_VERSION) {
    const step = MIGRATIONS[ver];
    if (!step) throw new PlayMigrationError(`No migration from version ${ver}`);
    cur = step(cur);
    if (cur.v !== ver + 1)
      throw new PlayMigrationError(`Migration from ${ver} did not produce version ${ver + 1}`);
    ver = cur.v as number;
  }
  const res = v.safeParse(Play, cur);
  if (!res.success)
    throw new PlayMigrationError(`Invalid diagram: ${res.issues.map((i) => i.message).join('; ')}`);
  return res.output;
}
