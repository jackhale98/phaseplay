import { buildDemo, DEMO_TABLE_ORDER, DEMO_TEAM_ID } from './demo';

/** Refresh the demo at most this often so its dates always look current. */
const MAX_AGE_MS = 20 * 3600e3;

/**
 * Make sure the public demo team exists and is fresh. A refresh is one atomic D1 batch: delete
 * the team (cascades to its rows), then one `INSERT … SELECT FROM json_each(?)` per table, so it
 * stays far below the 50-queries-per-invocation limit. Ids are deterministic, so open demo tabs
 * simply delta-sync to the new dates. Demo sessions survive (users are never deleted).
 */
export async function ensureDemo(db: D1Database, now = Date.now(), force = false): Promise<boolean> {
  if (!force) {
    const row = await db
      .prepare('SELECT updated_at FROM teams WHERE id = ? AND deleted_at IS NULL')
      .bind(DEMO_TEAM_ID)
      .first<{ updated_at: number }>();
    if (row && now - row.updated_at < MAX_AGE_MS) return false;
  }
  const tables = buildDemo(now);
  const stmts = [
    db.prepare('DELETE FROM teams WHERE id = ?').bind(DEMO_TEAM_ID),
    db.prepare('DELETE FROM audit_log WHERE team_id = ?').bind(DEMO_TEAM_ID),
  ];
  for (const t of DEMO_TABLE_ORDER) {
    const rows = tables[t];
    if (!rows.length) continue;
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const full = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    stmts.push(
      db
        .prepare(
          `INSERT ${t === 'users' ? 'OR IGNORE ' : ''}INTO ${t} (${cols.join(', ')})
           SELECT ${cols.map((c) => `j.value ->> '$.${c}'`).join(', ')} FROM json_each(?) j`,
        )
        .bind(JSON.stringify(full)),
    );
  }
  await db.batch(stmts);
  return true;
}
