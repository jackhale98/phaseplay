# Testing, CI and deployment

## Test layers

| Layer | Tooling | Covers |
| --- | --- | --- |
| Unit | Vitest | `packages/shared` (rules, permissions, schemas), `packages/diagram`, web stores, outbox, sync merge |
| Worker integration | Vitest + `@cloudflare/vitest-pool-workers` | Real local D1 with migrations applied, routes hit via `SELF.fetch`, auth flows, tenancy matrix, query budgets |
| E2E | Playwright | User journeys on `desktop-chromium`, `mobile-chromium` (Pixel 7) and `mobile-webkit` (iPhone 15), against the production build served by `wrangler dev --env test` (same origin, seeded local D1) |
| Visual | Playwright screenshots | Diagram renders, team-sheet and storyboard exports, key screens in light and dark |
| Accessibility | `@axe-core/playwright` | Every key screen, with zero violations |
| Offline | Playwright `context.setOffline` | RSVP queueing, match mode, outbox replay exactly once |
| Performance | Lighthouse CI + size-limit | The budgets in `docs/design.md` |

### Must-have suites

- **Tenancy matrix.** Generated from `packages/shared/api-routes.ts`. For every route, it calls as anonymous, as a member of another team, as a removed member and as each role, and asserts the expected status. A route missing from the table fails the test.
- **Query budget.** Seed realistic volume (40 teams × 40 members × 200 events × 50 plays). Assert at most 6 D1 queries per request, and keep `meta.rows_read` for the sync, schedule and playbook endpoints under thresholds kept in `e2e/budgets.json`.
- **Auth.**
  - Chromium uses a CDP virtual authenticator for real WebAuthn register and sign-in.
  - WebKit uses the test-only login route, which exists only in `ENV=test` builds.
  - Also covers recovery codes, device re-link, invite expiry, max uses and revocation, and that a removed member is cut off on her next request.

### Practices

- Use role and label locators. Never sleep: wait on UI state or network.
- Each test gets an isolated, seeded team through a fixture.
- Snapshots change only on purpose (`--update-snapshots`), and the PR says why.
- Run tests narrowly while developing. CI runs everything.

## Seed data

`pnpm db:seed` creates the team "Phaseplay RFC":
- 30 players with positions, plus a coach, an assistant coach and a manager
- a season of trainings and matches, including a 7s tournament day
- RSVPs, two team sheets, 8 plays and 12 drills across categories
- two practice plans (one with a forwards/backs split and rotations) and one recorded match log with cards, subs and time off

Local dev, e2e, screenshots and the landing page's demo visuals all use it.

## CI — `.github/workflows/ci.yml`

Runs on `pull_request` and `push` to `main`. A concurrency group cancels superseded runs. Target: under 8 minutes wall clock.

1. **setup:** checkout, pnpm with cache, Playwright browser cache.
2. **check:** ESLint, Prettier check, `svelte-check`, `tsc -b`.
3. **unit:** Vitest for shared, diagram and web.
4. **api:** Vitest with the workers pool, applying migrations to local D1.
5. **e2e:** Playwright, sharded ×3 across the three projects. HTML report and traces are uploaded only on failure.
6. **perf:** production build, size-limit and Lighthouse CI (mobile preset) on the landing page and Home with fixtures.
7. **security:** `pnpm audit --prod` (fails on high), plus a grep check that the prod bundle has no test-auth route or test flags.

All jobs are required checks for `main`.

## Deploy — `.github/workflows/deploy.yml`

Runs on push to `main`, after CI succeeds. Steps run in this order:

1. **Migrate:** `wrangler d1 migrations apply phaseplay --remote --env production`. Migrations must be **expand/contract**: add first, then backfill, and drop only in a later release. The code being deployed must work with both the old and the new schema.
2. **Build and deploy:** build the web app (`PUBLIC_VERSION=<sha>`), then `wrangler deploy --env production --var VERSION:<sha>`. Web and API ship together in one Worker version.
3. **Smoke test:** `/api/health` returns the new SHA. `e2e/specs-prod` checks the landing page renders without console errors, the API is reachable, deep links get the shell with headers, and test auth is absent.
4. **On failure:** `wrangler rollback` (restores web and API together) and an issue is opened with the run link.

Installed PWAs may run the previous web build until the user taps "Refresh", so the API stays backward-compatible with the previous web build.

**Secrets:** `CLOUDFLARE_API_TOKEN` (least privilege: Workers Scripts edit, D1 edit, Workers Routes/Custom Domains on the zone) and `CLOUDFLARE_ACCOUNT_ID`, in a GitHub `production` environment.

## Nightly — `.github/workflows/nightly.yml`

- The full browser matrix, adding desktop-webkit and Firefox.
- Lighthouse against production.
- Renovate PRs are grouped weekly, and minor and patch updates auto-merge once CI is green.

## Releases in the app

- The service worker detects a new version and shows an "Update available — refresh" toast. It never reloads on its own in the middle of a match.
- Settings → About shows the version (SHA and date).
