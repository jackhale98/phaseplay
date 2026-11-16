# Decisions

One line per decision: date — decision — why.

- 2026-11-16 — SvelteKit SPA on GitHub Pages + Worker/D1 API on api.phaseplay.app — passkeys bound to phaseplay.app from day one; move to Cloudflare is DNS-only.
- 2026-11-16 — One shared D1 database, no app-level encryption — tenancy enforced in code and tests; revisit per-team DBs if adoption grows.
- 2026-11-16 — No health/concussion data — legal and privacy risk outweighs value.
- 2026-11-16 — Drills reuse the play diagram engine (`mode: 'drill'`) — one renderer, editor and export pipeline; drill details live on the drill row, not in the diagram.
- 2026-11-16 — Match and practice timing come from timestamped event logs reduced by pure functions — accurate through screen lock, offline-safe, conflict-free sync.
- 2026-11-16 — Launch straight to Cloudflare: one Worker serves the SPA (Workers static assets) and the API on the same origin, `phaseplay.app/api/*`; M8 folded into M0 — no CORS or preflights, real security headers from day one, one atomic deploy/rollback, `__Host-` cookie on the app origin. Supersedes the GitHub Pages + `api.phaseplay.app` plan.
- 2026-11-16 — Raw D1 prepared statements instead of Drizzle — exact control of the ≤6-query budget (sync is one `json_group_array` statement), bulk writes via `json_each`, fewer abstractions; schema of record is `apps/api/migrations/*.sql`, row mappers in `apps/api/src/db/rows.ts`.
- 2026-11-16 — Memberships have their own id (`member id`), unique on (team_id, user_id) — imported/pending names can be put on sheets and RSVP'd for by staff before they join; claiming sets `user_id`.
- 2026-11-16 — Recurring trainings are materialised into concrete events (≤ 1 year, ≤ 160) — RSVPs, sheets, ICS and sync all work on plain events; skip/override = edit/cancel one event; deleting a series soft-deletes its future events.
- 2026-11-16 — Delta sync cursor is the server time at query start, re-read with a 10 s overlap; the client merges idempotently by id — rows committed concurrently with a sync are never missed.
- 2026-11-16 — Team sheets keep a `published` snapshot; players only ever receive the snapshot, so coaches can keep editing after publishing without leaking drafts.
- 2026-11-16 — SvelteKit 3 (current major): config in `vite.config.ts`, `#lib` subpath imports (+ TS `paths`), `$app/env`, `$app/manifest`; native SvelteKit service worker instead of `@vite-pwa/sveltekit` (smaller, full control of the "update available" flow).
- 2026-11-16 — Font: Archivo variable (wght axis, Latin subset, 34 KB woff2, OFL) — sporty grotesque with tabular figures, inside the 60 KB budget.
- 2026-11-16 — Front-row cover default follows World Rugby Law 3: 15 or fewer players → 3, 16–18 → 4, 19–22 → 5, 23 → 6 front-row-capable players (7s: 3); configurable per event (`settings.frontRowCover`).
- 2026-11-16 — Test-only login is behind a build-time `__TEST_AUTH__` define (true for local dev and `--env test`, false for production) and refuses ENV=production at runtime; CI and the post-deploy smoke test both assert it's absent.
- 2026-11-16 — A 7s tournament event records consecutive games as period pairs (1–2 = game 1, 3–4 = game 2) in one append-only log.
- 2026-11-16 — Deploys run on Cloudflare Workers Builds (Git integration), not GitHub Actions — no Cloudflare token in GitHub; the D1 database is auto-provisioned by name on first deploy; Actions stays CI-only plus a nightly production smoke test.
