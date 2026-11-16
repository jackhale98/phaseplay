// One-command production deploy (docs/runbook.md). Same steps as .github/workflows/deploy.yml:
// ensure D1 → migrate → build web → deploy the Worker (web + API together) → check /api/health.
import { execSync } from 'node:child_process';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

run('node scripts/ensure-d1.mjs');
run('pnpm exec wrangler d1 migrations apply phaseplay --remote --env production', {
  cwd: 'apps/api',
});
run('pnpm --filter @phaseplay/web build', { env: { ...process.env, PUBLIC_VERSION: sha } });
run(
  `pnpm exec wrangler deploy --env production --var VERSION:${sha} --message ${sha.slice(0, 12)}`,
  { cwd: 'apps/api' },
);

for (let i = 0; i < 20; i++) {
  try {
    const res = await fetch('https://phaseplay.app/api/health');
    const body = await res.json();
    if (body.version === sha) {
      console.log(`\n✓ phaseplay.app is live at ${sha.slice(0, 7)}`);
      process.exit(0);
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 6000));
}
console.error(
  'Deployed, but /api/health has not reported the new version yet. The certificate for a new custom domain can take a few minutes.',
);
process.exit(1);
