# Architecture

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Web | **SvelteKit 3 + Svelte 5 (runes)**, `adapter-static` in SPA mode (`ssr = false`, `fallback: '200.html'`); the landing and privacy pages are prerendered | Tiny bundles, file routing, code splitting, built-in transitions |
| PWA | Native SvelteKit service worker (`src/service-worker/`) | Precache, offline shell, user-confirmed update flow |
| Data in the browser | IndexedDB (`idb`), with a small query cache and an outbox | Instant loads, offline writes |
| Validation | **Valibot**, shared by client and Worker | Small and tree-shakeable |
| API | **Cloudflare Worker + Hono** | Fast, free tier, same platform as D1 |
| DB | **Cloudflare D1** with raw prepared statements and typed row mappers (`apps/api/src/db/rows.ts`); hand-written SQL migrations applied with `wrangler d1 migrations` | Exact control of the query budget, forward-only migrations |
| Auth | `@simplewebauthn/server` and `@simplewebauthn/browser` | Well-tested WebAuthn |
| Files | None until M7 (R2 for team crests). Exports are made client-side and shared, never uploaded. | Less data, less cost |
| Push (M7) | Web Push through a WebCrypto-based library that runs on Workers, plus Cron Triggers | No third-party push service |
| Tooling | pnpm, TypeScript strict, ESLint (flat config), Prettier, svelte-check, Vitest, `@cloudflare/vitest-pool-workers`, Playwright, Lighthouse CI, size-limit, Renovate | |

Use the latest stable versions, pinned by the lockfile. Record any deviation from this table in `docs/decisions.md`.

## Repo layout

```
apps/web/            SvelteKit SPA (routes, components, stores, data layer, service worker)
apps/api/            Worker: src/routes/*, src/auth/*, src/db/schema.ts, migrations/
packages/shared/     valibot schemas + inferred types, permissions.ts, rugby.ts, api route table
packages/diagram/    play model, migrations, sampling/interpolation, Canvas renderer, exporters
e2e/                 Playwright specs, fixtures, visual snapshots
docs/                specs, decisions.md, runbooks
.github/workflows/   ci.yml, nightly.yml (deploys run on Cloudflare Workers Builds)
.claude/agents/      reviewer.md, qa-tester.md
```

## Hosting and domains

- **One Worker, one origin.** `phaseplay.app` is a Worker custom domain (`apps/api/wrangler.toml`, `--env production`). Workers static assets serve `apps/web/build` directly; only requests that match no file reach the Worker (`run_worker_first` forces `/api/*` and `/cal/*`).
- The API lives at `https://phaseplay.app/api/v1/...`; the web app calls it same-origin, so there is no CORS. `www.phaseplay.app` redirects to the apex.
- **SPA fallback:** unknown paths (deep links like `/join`, `/events/:id`) get the `200.html` shell from the Worker with the document security headers.
- **Security headers:** `_headers` (written by `scripts/postbuild.mjs`) sets HSTS, `frame-ancestors`, Permissions-Policy, COOP and immutable caching; script hashes come from the SvelteKit `kit.csp` meta tag.
- **Local:** `pnpm dev` runs Vite on 5173 (proxying `/api` and `/cal`) and `wrangler dev` on 8787. E2E runs the production build through `wrangler dev --env test` on 8787 (`E2E_PORT` overrides).

## Auth and sessions

- **WebAuthn settings:**
  - `rpID: 'phaseplay.app'`, `rpName: 'Phaseplay'`, `expectedOrigin: 'https://phaseplay.app'`
  - `residentKey: 'required'`, `userVerification: 'preferred'`
  - store credential ID, public key, counter, transports and backup state
- **Challenges:** stored in D1 with a 5-minute TTL, used once and deleted.
- **Sign-up** collects only a display name. Never ask for email or phone.
- **Session cookie:** a 256-bit random ID in `__Host-pp_session` on `phaseplay.app` (`pp_session` without `Secure` on localhost), with `HttpOnly`, `SameSite=Lax`, `Path=/`.
  - The DB stores only the SHA-256 of the ID.
  - Expiry is 30 days, sliding, re-issued at half-life.
  - The API is same-origin, so fetches use `credentials: 'same-origin'`.
- **CORS:** none. Cross-origin pages can neither send credentialed state changes (Origin check) nor read responses.
- **CSRF:** state-changing requests must send an allowlisted `Origin` and `Content-Type: application/json`.
- **Public demo:** `POST /api/v1/demo` creates a session for the fixed demo account (no passkey). A middleware in `app.ts` rejects every non-GET request from it with `403 demo`, except logout. `/me` returns `demo: true`, and the client keeps demo edits on-device.
- **Recovery:** 10 single-use recovery codes, hashed and shown once. Coaches can also issue a device re-link link (single use, 24 hours).
- **Rate limits:** the Workers Rate Limiting binding guards auth, invite redemption and recovery, per IP and per token.
- **Test-only login** (`POST /api/v1/test/login`) exists only when built with `__TEST_AUTH__=true` (local dev and `--env test`) and refuses `ENV=production`. CI and the post-deploy smoke test fail if it is reachable or present in a prod bundle.

## Authorization and tenancy

- `requireMember(c, teamId, action)` loads the caller's active membership with one indexed query, checks `permissions.ts`, and puts the membership on the context. Handlers never accept a `teamId` without it.
- Every resource query is scoped: `WHERE id = ? AND team_id = ?`, with `team_id` taken from the membership. Another team's resource returns **404**.
- Membership is checked on every request and never cached in the session, so removing someone takes effect immediately.
- **Roles.** Each membership has a main `role` (owner, admin, coach, manager, player) and `role_ids`, a JSON list of team roles (`team_roles`: name, colour, `permissions` JSON). The same `requireMember` query folds the granted permissions in with `json_each`, so a role check costs no extra query. `can({ role, grants }, action)` in `permissions.ts` is the one check used by the API and the web app; grants outside `GRANTABLE` are ignored. Changing a member's roles, or editing a role they hold, forces their next sync to be a full one so newly hidden rows disappear.
- **Ownership.** `teams.owner_id` plus `pending_owner_member_id`/`pending_owner_at` for a nominate-then-accept handover. An admin may claim ownership when the owner's last activity (`users.last_seen_at`, or their newest session) is over 30 days old (`OWNER_CLAIM_AFTER_MS`).
- `packages/shared/api-routes.ts` exports the route table. The tenancy test generates cases from it: anonymous, other team's member, removed member, and each role. See `docs/testing-ci.md`.

## Data model (D1 / SQLite)

- IDs are client-generatable UUIDv7 text. Timestamps are INTEGER milliseconds UTC.
- JSON columns are validated with shared schemas on write.
- Soft deletes use `deleted_at` (tombstones feed delta sync). A cron job purges them after 30 days.

| Table | Key columns | Indexes |
| --- | --- | --- |
| `users` | id, display_name, created_at, deleted_at | |
| `credentials` | id (credential id), user_id, public_key, counter, transports, backed_up, nickname, created_at, last_used_at | user_id |
| `sessions` | id_hash PK, user_id, created_at, expires_at, last_seen_at | user_id, expires_at |
| `auth_challenges` | id, challenge, kind, user_id?, expires_at | expires_at |
| `recovery_codes` | user_id, code_hash, used_at | user_id |
| `teams` | id, name, short_name, colors JSON, default_format, timezone, owner_id, pending_owner_member_id?, pending_owner_at?, crest_version?, rsvp_visibility (`counts`/`games`/`all`), created_at, updated_at, deleted_at | |
| `memberships` | id (member id), team_id, user_id?, display_name, role, role_ids JSON, jersey, positions JSON, status (`active`/`removed`/`pending`), joined_at, removed_at, updated_at | UNIQUE(team_id,user_id), (user_id,status), (team_id,status), (team_id,updated_at) |
| `team_roles` | id, team_id, name, color, permissions JSON (grantable actions only), created_at, updated_at, deleted_at | (team_id,updated_at) |
| `team_crests` | team_id PK, type (png/webp/jpeg), data BLOB (≤ 200 KB, magic bytes checked), updated_at; `teams.crest_version` is the cache key | |
| `invites` | id, team_id, token_hash UNIQUE, kind (`join`/`relink`), role, target_user_id?, created_by, expires_at, max_uses, uses, revoked_at | team_id |
| `seasons` | id, team_id, name, starts_on, ends_on | team_id |
| `events` | id, team_id, season_id, type, format, title, starts_at, meet_at, ends_at, location_name, location_url, opponent, notes, rsvp_deadline, recurrence_id?, cancelled_at, version, updated_at, deleted_at | (team_id,starts_at), (team_id,updated_at) |
| `recurrences` | id, team_id, rule JSON (weekly days, time, until), exceptions JSON | team_id |
| `rsvps` | event_id, member_id, team_id, status, note, note_expires_at, attended, updated_at | PK(event_id,member_id), (team_id,updated_at), member_id, note_expires_at |
| `team_sheets` | id, event_id, team_id, format, replacements, slots JSON, captain_id, vice_id, status, published (snapshot JSON players see), version, published_at, updated_at | UNIQUE(event_id), (team_id,updated_at) |
| `team_sheet_versions` | sheet_id, version, slots JSON, created_at | sheet_id (keep last 10) |
| `plays` | id, team_id, title, category, tags JSON, format, visibility, data JSON (≤ 200 KB), version, created_by, updated_at, deleted_at | (team_id,updated_at), (team_id,category) |
| `play_views` | play_id, user_id, team_id, day, first_viewed_at | PK(play_id,user_id,day), play_id |
| `drills` | id, team_id, title, category, contact_level, intensity, players_min, players_max, area JSON (w×h m), equipment JSON, default_duration_min, description, coaching_points JSON, setup, variations JSON, diagram JSON (drill-mode Play, ≤ 200 KB), visibility, source (`team`/`starter`), version, created_by, updated_at, deleted_at | (team_id,updated_at), (team_id,category) |
| `practice_plans` | id, team_id, event_id?, title, is_template, blocks JSON (ordered blocks with lanes/rotations, see below), planned_total_min, version, created_by, updated_at, deleted_at | (team_id,updated_at), event_id |
| `practice_runs` | id (client), plan_id, team_id, kind (`start`/`advance`/`extend`/`pause`/`resume`/`skip`/`end`), payload JSON, at | plan_id |
| `match_events` | id (client), event_id, team_id, seq, kind, payload JSON, game_ms, wall_at, supersedes_id?, created_by, created_at | event_id, (team_id,created_at) |
| `audit_log` | id, team_id, actor_id, action, target_type, target_id, meta JSON, at | (team_id,at) |
| `calendar_tokens` | token_hash PK, user_id, team_id?, scope, created_at, revoked_at (older personal links; new ones use `teams.calendar_token`) | user_id |
| `push_subscriptions` (M7) | id, user_id, endpoint UNIQUE, p256dh, auth, prefs JSON, created_at | user_id |
| `inventory_items` (M9) | id, team_id, kind, name, tag?, quantity (> 1 = a set), condition, status (`available`/`with_someone`/`lost`/`retired`), holder_member_id?, home, notes (kit managers only), match_day, version, created_by, created_at, updated_at, deleted_at | (team_id,updated_at), holder_member_id, UNIQUE(team_id,tag) where set and not deleted |
| `inventory_events` (M9) | append-only history: id, team_id, item_id, kind, actor_member_id, from_member_id, to_member_id, note (≤ 140, kit managers only), at; written in the same guarded batch as each change | (item_id,at) |
| `inventory_handoffs` (M9) | id, team_id, item_id, from_member_id?, to_member_id, note, created_at, expires_at (7 days), resolved_at, outcome (`accepted`/`declined`/`cancelled`), updated_at | (team_id,updated_at), UNIQUE(item_id) while open |

### Practice plan blocks (JSON, schema in `packages/shared/practice.ts`)

```ts
type Block = {
  id: string;
  kind: 'drill' | 'water' | 'talk' | 'game' | 'custom';
  drillId?: string;          // kind = 'drill'
  playId?: string;           // optional play to rehearse
  title?: string;            // custom/talk/game
  durationMin: number;
  lane: 'all' | 'forwards' | 'backs' | string;   // parallel tracks share start times
  coachId?: string;
  notes?: string;
  rotation?: { groups: number; stations: string[]; intervalMin: number }; // expands to stations × groups
};
```

- The plan is an ordered list of time slots, and each slot holds one block per lane, so parallel lanes stay time-aligned.
- Validation checks that lanes in the same slot end together, or it inserts a filler.
- Equipment, contact-minutes and intensity totals are derived values: computed client-side and never stored.

### Match event kinds (`packages/shared/match.ts`)

| Kind | Fields |
| --- | --- |
| Clock | `period_start`, `period_end`, `time_off { reason }`, `time_on` |
| Scoring | `score { team, type: try\|conversion\|conversion_miss\|penalty_goal\|penalty_goal_miss\|drop_goal\|penalty_try, playerId? }` |
| Penalties | `penalty { team: for\|against, offence?, playerId?, zone?, outcome? }` |
| Cards | `card { team, colour: yellow\|red, playerId?, mode? }`, `card_return { cardId }` |
| Subs | `sub { team, offId, onId, type: tactical\|temporary }`, `sub_return` |
| Tallies | `tally { kind: lineout_won\|lineout_lost\|scrum_won\|scrum_lost\|turnover_won\|turnover_lost\|restart_won\|restart_lost\|tackle\|missed_tackle, playerId? }` |
| Corrections | `edit { supersedesId, patch }`, `void { supersedesId }` |

- `game_ms` is the game clock at the moment of the event. The client derives it from the clock events, never from interval ticks.
- Derived state (score, players on field, sin-bin remaining, minutes played) comes from a pure reducer over the event log. The reducer is unit-tested and property-tested: the score always equals the sum of the scoring events.

## API

- REST over JSON under `/api/v1`. Request and response schemas come from `packages/shared`. Errors look like `{ "error": { "code": "not_found", "message": "…" } }`.
- **Bootstrap:** `GET /v1/me` returns the user, memberships and team summaries in one call.
- **Delta sync:** `GET /api/v1/teams/:teamId/sync?since=<cursor>` returns changed rows, tombstones included, for members, seasons, events, RSVPs (players: their own plus per-event counts), sheets (players: published snapshots), play/drill metadata, practice plans, kit items and handovers (open ones, plus those resolved since the cursor) — in **one SQL statement** (`json_group_array` per table). The cursor is the server time at query start; the next sync re-reads a 10 s overlap. A first sync only includes RSVP history from the last 120 days.
- **Writes:** `POST`, `PATCH` and `DELETE` on resource routes.
  - Clients generate IDs, and the server inserts with `ON CONFLICT DO NOTHING`, so outbox retries are idempotent.
  - Versioned resources (events, sheets, plays) take `If-Match: <version>`. A stale version gets `409` with the latest copy.
- **Calendar:** one team calendar per team (`teams.calendar_token`, made on first `teams.calendar.get`, shown to every member, reset by staff with `events.manage`). `GET /cal/:token.ics` is public with that token; older per-user tokens (`calendar_tokens`) still resolve. Feeds send `max-age=300` and `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` of 30 minutes (Google Calendar ignores these and polls on its own schedule). Meet times are written in the team's timezone.
- **Bulk writes** (recurring series, attendance, match/run logs, imports) use one `INSERT ... SELECT FROM json_each(?)` statement; imports are sent in chunks of 40 rows.
- **Query budget:** at most 6 D1 queries per request (the free cap is 50). Use `db.batch()`, and avoid N+1 queries.

## Offline and sync (web)

- The service worker precaches the app shell and static assets. API responses are not cached by the service worker.
- **Data layer:** each team's data is cached in IndexedDB. Screens render from cache straight away, then delta-sync on load, on focus, on reconnect, and every 60 s while visible.
- **Outbox:** mutations are queued in IndexedDB with client IDs and applied to the cache optimistically. Versioned edits pin the version they were based on when made (`baseVersion`) and send it as `If-Match`, advancing only through this device's own successful writes, so another person's change always surfaces as a 409. Entries failing with 5xx are discarded after 6 tries so they can't block the queue. Signing in as a different account clears the device cache. They retry with backoff (and Background Sync where supported), and the UI shows a small sync status that is announced through `aria-live`.
- **Match mode** writes append-only `match_events`, so the server merge is a union by ID.

## Push notifications (M7)

- **Topics** (`packages/shared/notify.ts`): `events` (new, moved, cancelled; to the team except the author), `reminders` (cron, the day before, to members with no reply), `sheets` (published), `plays` (a play or practice plan shared with the team), `kit` (cron: a "no" from someone holding kit for an event in the next 24 h). Every topic is on until switched off in `users.notify_prefs`; each device opts in (`push_subscriptions`, one row per browser, ≤ 10 per user).
- **Queueing:** handlers add `notifyStmt(...)` (`apps/api/src/lib/notify.ts`) to their batch: one `INSERT … SELECT` into `push_queue` that resolves the members' users and skips the author, users with the topic off, users with no device, and the demo team. An optional `onlyIf` guard keeps idempotent retries from notifying twice. Then `flushNotifications(c)` drains with `waitUntil` after the response.
- **Draining** (`lib/push/queue.ts`): Workers Free allows 50 subrequests, 50 D1 queries and 10 ms CPU per invocation, so a drain claims ≤ 12 sends (≈0.5 ms CPU each; attempts are counted at claim time so an invocation killed mid-send can't resend forever; a 5-minute lease, one `UPDATE … RETURNING` with each user's ≤ 5 newest devices), sends them in parallel and records outcomes in one batch. 404/410 deletes the device; 429/5xx/network errors back off (1 min, 10 min, 1 h) and give up after 4 attempts; a device failing 10 times in a row is dropped. Messages older than 24 h are dropped unsent.
- **Cron:** `* * * * *` drains the queue; `*/5 * * * *` queues reminders (events 18–30 h ahead, once each via `events.reminded_at`, which is cleared when the event moves), kit at risk (once per event and member, by the tick in which the event crossed 24 h or the "no" arrived) and drains the queue. The nightly cron purges queue rows older than two days.
- **Crypto** (`lib/push/`): RFC 8291 `aes128gcm` and RFC 8292 VAPID (ES256 JWT) with WebCrypto only, tested against the RFC 8291 §5 vector. The VAPID key pair is generated on first use into `server_keys`; signed JWTs are cached in memory per push-service origin for 12 h.
- **Safety:** endpoints must be a known push service (FCM, Mozilla, WNS, Apple) so the server never posts to arbitrary hosts. Payloads carry only names and titles the team already sees, never RSVP notes. Signing out everywhere or deleting the account removes every device. With `ENV=test` sends are faked. Redirects from a push service aren't followed. Signing out on a device removes its subscription first; a re-published team sheet only notifies when the line-up changed.
- **Web:** `/settings/notifications` turns push on per device, sets topics, sends a test and lists devices. On iPhone/iPad in Safari it shows how to add the app to the Home Screen first (iOS only allows Web Push for installed web apps, 16.4+). The service worker shows the notification and, on tap, focuses an open window and navigates it, or opens one.

## Security and privacy

- **CSP:** script hashes via a meta tag from SvelteKit `kit.csp` (hash mode), plus a header policy for what meta can't express (`frame-ancestors 'none'`, `base-uri`, `object-src`, `form-action`).
  - `default-src 'self'`
  - `connect-src 'self'`
  - `img-src 'self' data: blob:`
  - `worker-src 'self' blob:`
  - `style-src 'self' 'unsafe-inline'` (only if Svelte needs it)
  - HSTS (with preload), Permissions-Policy and COOP are real headers from day one.
- **Secrets** come from `wrangler secret` only. The frontend holds none.
- **Invite and personal calendar tokens** are 128-bit random and stored hashed (the team calendar token is stored as is, since every member is shown it). Invite tokens travel in the URL fragment (`/join#t=…`), so they never reach server logs or referrers.
- **Validation and output:** every route validates input with shared schemas and returns only the fields the caller's role may see. For example, RSVP notes are never sent to players.
- **Privacy:**
  - collect no email or phone, and no health data
  - RSVP notes auto-delete (cron)
  - export-my-data and delete-account are available
  - a plain-language privacy page
  - no analytics in v1
- **Backups:** D1 Time Travel (7 days on free, 30 on paid). Revisit nightly exports to private R2 once there are multiple teams.
- **Dependencies:** Renovate runs weekly. CI fails on `pnpm audit --prod` high severity.

## Rugby domain (`packages/shared/rugby.ts`)

- **15s:** positions 1–15 with names (loosehead prop … fullback); up to 8 replacements, configurable per competition (0–8).
  - Position groups: front row (1–3), locks (4–5), back row (6–8), halves (9–10), centres (12–13), back three (11, 14, 15).
- **7s:** 7 starters (forwards 1–3, backs 4–7) and up to 5 replacements.
- **Timing defaults:** 15s 2×40 with a 10-minute sin bin; 7s 2×7 (finals can be 2×10) with a 2-minute sin bin. All are configurable per event, because competitions and law trials vary.
- **Front-row cover:** a configurable rule (default: a 23-player matchday squad needs 6 front-row-capable players). Verify the default against the current World Rugby Law 3 and the competition's rules, and record the source in `docs/decisions.md`.
- A player's `positions[]` is ordered, primary first. "Front-row capable" means any of 1–3.
