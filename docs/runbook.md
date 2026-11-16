# Runbook

## Deploys (Cloudflare Workers Builds)

Cloudflare builds and deploys straight from GitHub, so no API token lives in GitHub. GitHub Actions runs CI only.

**One-time setup** (Cloudflare dashboard, with GitHub already connected):

1. Delete any existing apex or `www` DNS records for `phaseplay.app` (for example old GitHub Pages records). The Worker's custom domain creates its own.
2. **Workers & Pages → Create → Import a repository** → pick this repo.
3. Settings:
   - **Project / Worker name:** `phaseplay` (must match `[env.production] name` in `apps/api/wrangler.toml`)
   - **Production branch:** `main` (use the feature branch temporarily if you want to preview before merging)
   - **Root directory:** `/` (the repo root; pnpm workspaces install from there)
   - **Build command:** `pnpm cf:build`
   - **Deploy command:** `pnpm deploy`
   - Leave non-production branch builds **off** for now: passkeys only work on `phaseplay.app`, so preview URLs can't sign in.
4. Save and deploy. The first deploy creates the D1 database `phaseplay`, applies migrations, attaches `phaseplay.app` and `www.phaseplay.app`, and serves the app. A new custom domain's certificate can take a few minutes.

After that, every push to the production branch deploys. Each build shows as a check on the GitHub commit.

**From a laptop instead:** `pnpm i`, then `pnpm --filter @phaseplay/api exec wrangler login`, then `pnpm deploy`.

## See it with demo data

1. Open https://phaseplay.app → **Get started** → create your account with a passkey (remember the exact name you type).
2. From a laptop logged in with `wrangler login`: `pnpm demo:prod "Your Name"`.
3. Reload https://phaseplay.app/home. You now own **Phaseplay RFC**: 30 players, a season of practices and games, a 7s tournament, a quiz night, a fundraiser, team sheets, plays, drills, practice plans and a recorded match. Re-running replaces only the demo team.

To invite someone to look around, Squad → Invite → share the link (role: coach or player).

## Rollback

`pnpm --filter @phaseplay/api exec wrangler rollback --env production` restores the previous Worker version (web and API together). Migrations are expand/contract, so the previous version works with the current schema. You can also roll back from the dashboard: Workers & Pages → phaseplay → Deployments. The nightly workflow smoke-tests production.

## Data

- Backups: D1 Time Travel (`wrangler d1 time-travel restore phaseplay --env production --timestamp <iso>`), 7 days on the free plan, 30 on Workers Paid.
- Switch to Workers Paid ($5/month) once a second team joins, so daily D1 limits can't take the app down on match day.
