// Finds (or creates) the production D1 database "phaseplay" and writes its id into
// apps/api/wrangler.toml [env.production]. Idempotent; needs Cloudflare credentials
// (`wrangler login`, or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const apiDir = fileURLToPath(new URL('../apps/api/', import.meta.url));
const wrangler = (...args) =>
  execFileSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: apiDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

const find = () => {
  const out = wrangler('d1', 'list', '--json');
  const list = JSON.parse(out.slice(out.indexOf('[')));
  return list.find((d) => d.name === 'phaseplay')?.uuid;
};

let id = find();
if (!id) {
  console.log('Creating D1 database "phaseplay"…');
  wrangler('d1', 'create', 'phaseplay');
  id = find();
}
if (!id) throw new Error('Could not find or create the D1 database "phaseplay"');

const toml = fileURLToPath(new URL('../apps/api/wrangler.toml', import.meta.url));
const src = readFileSync(toml, 'utf8');
const updated = src.replace(
  /(\[\[env\.production\.d1_databases\]\][\s\S]*?database_id = ")[^"]*(")/,
  `$1${id}$2`,
);
if (updated !== src) writeFileSync(toml, updated);

console.log(`D1 "phaseplay" = ${id}`);
