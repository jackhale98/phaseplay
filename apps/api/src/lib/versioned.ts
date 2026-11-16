import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { HttpError, ifMatch, notFound, now } from './http';

/**
 * Optimistic-concurrency update: `UPDATE ... WHERE version = If-Match RETURNING`. A stale version
 * returns 409 with the latest copy so the client can offer Keep mine / Take theirs / Save as copy.
 */
export async function versionedUpdate<T>(
  c: Context<AppEnv>,
  opts: {
    table: string;
    cols: string;
    id: string;
    sets: string[];
    vals: unknown[];
    map: (row: Record<string, unknown>) => T;
    what: string;
    extraWhere?: string;
  },
): Promise<T> {
  const version = ifMatch(c);
  const teamId = c.var.member.teamId;
  const where = `id = ? AND team_id = ? AND deleted_at IS NULL ${opts.extraWhere ?? ''}`;
  const row = await c.var.db
    .prepare(
      `UPDATE ${opts.table} SET ${[...opts.sets, 'version = version + 1', 'updated_at = ?'].join(', ')}
       WHERE ${where} AND (? IS NULL OR version = ?) RETURNING ${opts.cols}`,
    )
    .bind(...opts.vals, now(), opts.id, teamId, version, version)
    .first<Record<string, unknown>>();
  if (row) return opts.map(row);
  const current = await c.var.db
    .prepare(`SELECT ${opts.cols} FROM ${opts.table} WHERE ${where}`)
    .bind(opts.id, teamId)
    .first<Record<string, unknown>>();
  if (!current) throw notFound(`${opts.what} not found`);
  throw new HttpError(409, 'conflict', `Someone else changed this ${opts.what.toLowerCase()}`, {
    latest: opts.map(current),
  });
}

/** Build `col = ?` pairs from a partial input using a field → column map. */
export function setsFrom(
  input: Record<string, unknown>,
  map: Record<string, string>,
  json: string[] = [],
): { sets: string[]; vals: unknown[] } {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, col] of Object.entries(map)) {
    const val = input[k];
    if (val === undefined) continue;
    sets.push(`${col} = ?`);
    vals.push(
      json.includes(k)
        ? val === null
          ? null
          : JSON.stringify(val)
        : typeof val === 'boolean'
          ? val
            ? 1
            : 0
          : val,
    );
  }
  return { sets, vals };
}
