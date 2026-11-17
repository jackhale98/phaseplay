#!/usr/bin/env bash
# Cloudflare Workers Builds "Deploy command" (also `pnpm deploy` from a laptop after `wrangler login`).
# Order keeps migrations expand/contract-safe: migrate → deploy → migrate (the last is a no-op except
# on the very first deploy, when `wrangler deploy` has only just created the D1 database).
set -euo pipefail
SHA="${WORKERS_CI_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo local)}"
cd "$(dirname "$0")/../apps/api"
if [ ! -f ../web/build/200.html ]; then bash ../../scripts/cf-build.sh; fi
# Before the first deploy the database doesn't exist yet (wrangler deploy creates it). Any other
# migration failure must stop the deploy.
if pnpm exec wrangler d1 info DB --env production > /dev/null 2>&1; then
  pnpm exec wrangler d1 migrations apply DB --remote --env production
else
  echo "D1 database not created yet; wrangler deploy will create it."
fi
pnpm exec wrangler deploy --env production --var "VERSION:${SHA}" --message "${SHA:0:12}"
pnpm exec wrangler d1 migrations apply DB --remote --env production
echo "Deployed ${SHA:0:7} to https://phaseplay.app"
