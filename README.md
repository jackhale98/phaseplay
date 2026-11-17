# Phaseplay

Run your rugby team from one app: availability, team sheets, animated plays, practice plans and a sideline match mode for coaches running 15s and 7s.

- **Stack:** SvelteKit 3 SPA + Hono API on one Cloudflare Worker with D1, same origin at `https://phaseplay.app`.
- **Start here:** `CLAUDE.md` (commands and rules), `PLAN.md` (milestones), `docs/` (architecture, design, diagrams, testing, decisions), `docs/runbook.md` (deploy, demo data, rollback).

```sh
pnpm i
pnpm dev        # http://localhost:5173 — /signin has one-click logins for the seeded demo team
pnpm check && pnpm test
pnpm test:e2e --project=desktop-chromium
pnpm cf:deploy  # production (see docs/runbook.md)
```
