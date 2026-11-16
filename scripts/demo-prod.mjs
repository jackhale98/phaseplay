// Loads the "Phaseplay RFC" demo team into PRODUCTION and makes your account its owner.
// 1. Sign up at https://phaseplay.app with a passkey (note the exact name you used).
// 2. pnpm demo:prod "Your Name"
// Re-running replaces the demo team (and only the demo team).
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const owner = process.argv.slice(2).join(' ').trim();
if (!owner) {
  console.error(
    'Usage: pnpm demo:prod "Your Name"   (the name you signed up with on phaseplay.app)',
  );
  process.exit(1);
}
const api = new URL('../apps/api/', import.meta.url).pathname;
mkdirSync(`${api}.wrangler`, { recursive: true });
execSync(`pnpm exec tsx scripts/seed.ts > .wrangler/demo.sql`, {
  cwd: api,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, DEMO_OWNER: owner },
  shell: '/bin/bash',
});
const wr = (...a) =>
  execFileSync('pnpm', ['exec', 'wrangler', ...a], { cwd: api, encoding: 'utf8' });
const check = wr(
  'd1',
  'execute',
  'phaseplay',
  '--remote',
  '--env',
  'production',
  '--json',
  '--command',
  `SELECT count(*) AS n FROM users WHERE display_name = '${owner.replace(/'/g, "''")}' AND deleted_at IS NULL`,
);
if (!/"n":\s*[1-9]/.test(check)) {
  console.error(
    `No account named "${owner}" on phaseplay.app yet. Sign up there first, using exactly that name.`,
  );
  process.exit(1);
}
execFileSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'phaseplay',
    '--remote',
    '--env',
    'production',
    '--yes',
    '--file',
    '.wrangler/demo.sql',
  ],
  { cwd: api, stdio: 'inherit' },
);
console.log(
  `\n✓ Phaseplay RFC is loaded and owned by ${owner}. Reload https://phaseplay.app/home (pull the team switcher if you also created your own team).`,
);
