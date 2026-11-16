/**
 * `pnpm db:seed`: prints SQL that loads the demo team "Phaseplay RFC" (src/seed/demo.ts) for
 * `wrangler d1 execute --local`. Re-running replaces the demo team.
 */
import { buildDemo, DEMO_TABLE_ORDER, DEMO_TEAM_ID, DEMO_USER_ID } from '../src/seed/demo';

const q = (v: unknown) =>
  v === null || v === undefined
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : typeof v === 'boolean'
        ? v
          ? '1'
          : '0'
        : `'${String(v).replace(/'/g, "''")}'`;

const tables = buildDemo();
const out = [
  `DELETE FROM teams WHERE id = '${DEMO_TEAM_ID}';`,
  `DELETE FROM audit_log WHERE team_id = '${DEMO_TEAM_ID}';`,
];
for (const t of DEMO_TABLE_ORDER)
  for (const row of tables[t])
    out.push(
      `INSERT ${t === 'users' ? 'OR IGNORE ' : ''}INTO ${t} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`,
    );
console.log(out.join('\n'));
console.error(
  `seeded Phaseplay RFC: ${tables.memberships.length} members, ${tables.events.length} events. Demo coach user id: ${DEMO_USER_ID}`,
);
