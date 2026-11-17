/**
 * One `INSERT … SELECT FROM json_each(?)` per table instead of one statement per row: bulk writes
 * stay inside the ≤ 6-query budget and D1's 50-queries-per-invocation limit. Column names come
 * from code (never from request input); values are bound as one JSON parameter.
 */
export function bulkInsert(
  db: D1Database,
  table: string,
  rows: Record<string, unknown>[],
  opts: { ignoreConflicts?: boolean } = {},
): D1PreparedStatement | null {
  if (!rows.length) return null;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  for (const c of [table, ...cols])
    if (!/^[a-z_]+$/.test(c)) throw new Error(`bad identifier ${c}`);
  const full = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
  return db
    .prepare(
      `INSERT ${opts.ignoreConflicts ? 'OR IGNORE ' : ''}INTO ${table} (${cols.join(', ')})
       SELECT ${cols.map((c) => `j.value ->> '$.${c}'`).join(', ')} FROM json_each(?) j`,
    )
    .bind(JSON.stringify(full));
}
