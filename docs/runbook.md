# Runbook

## First deploy to phaseplay.app

Prerequisites: `phaseplay.app` is on your Cloudflare account. **Delete any existing apex or `www` DNS records** (for example GitHub Pages records); the Worker custom domain creates its own, and conflicting records make the deploy fail.

### Option A — from your laptop (quickest)

```sh
git clone <repo> && cd phaseplay && git checkout claude/dreamy-rubin-nfa71o
pnpm i
pnpm --filter @phaseplay/api exec wrangler login   # opens Cloudflare in your browser
pnpm deploy                                          # creates D1 "phaseplay" if needed, migrates, builds, deploys, checks /api/health
```

`pnpm deploy` writes the D1 database id into `apps/api/wrangler.toml`; commit that change. The first certificate for a new custom domain can take a few minutes.

### Option B — GitHub Actions

1. Create a Cloudflare API token: dashboard → My Profile → API Tokens → **Edit Cloudflare Workers** template, add **Account · D1 · Edit**, zone resources `phaseplay.app`.
2. GitHub repo → Settings → Environments → `production` → add secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Cloudflare dashboard → Workers & Pages → Account ID).
3. Actions → **Deploy** → Run workflow (pick the branch). After that, every green CI run on `main` deploys automatically.

## See it with demo data

1. Open https://phaseplay.app → **Get started** → create your account with a passkey (remember the exact name you type).
2. From your laptop (logged in with wrangler): `pnpm demo:prod "Your Name"`.
3. Reload https://phaseplay.app/home. You now own **Phaseplay RFC**: 30 players, a season of practices and games, a 7s tournament, a quiz night, a fundraiser, team sheets, plays, drills, practice plans and a recorded match. Re-running replaces only the demo team.

To invite someone to look around, Squad → Invite → share the link (role: coach or player).

## Rollback

`pnpm --filter @phaseplay/api exec wrangler rollback --env production` restores the previous Worker version (web and API together). Migrations are expand/contract, so the previous version works with the current schema. The deploy workflow rolls back automatically when the post-deploy smoke test fails.

## Data

- Backups: D1 Time Travel (`wrangler d1 time-travel restore phaseplay --env production --timestamp <iso>`), 7 days on the free plan, 30 on Workers Paid.
- Switch to Workers Paid ($5/month) once a second team joins, so daily D1 limits can't take the app down on match day.
