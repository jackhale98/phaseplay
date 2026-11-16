#!/usr/bin/env bash
# Cloudflare Workers Builds "Build command". Builds the SPA that the Worker serves as static assets.
set -euo pipefail
export PUBLIC_VERSION="${WORKERS_CI_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo local)}"
pnpm --filter @phaseplay/web build
