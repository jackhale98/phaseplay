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
- **Roles.** Each membership has a main `role` (owner, admin, coach, manager, player) and `role_ids`, a JSON list of team roles (`team_roles`: name, colour, `permissions` JSON). The same `requireMember` query folds the granted permissions in with `json_each`, so a role check costs no extra query. `can({ role, grants, overrides }, action)` in `permissions.ts` is the one check used by the API and the web app; grants outside `GRANTABLE` are ignored. Changing a member's roles, or editing a role they hold, forces their next sync to be a full one so newly hidden rows disappear.
- **Configurable main roles.** `teams.role_permissions` (JSON `{coach, manager, player}` of each role's full configurable set, or NULL for the defaults) is read by the same `requireMember` query (joined from `teams`, no extra query) and passed to `can()` as `overrides`. Owner and admin ignore it; `team.view`/`rsvp.self` are always on; anything outside `CONFIGURABLE_FOR[role]` is ignored. Writes go through `PUT /teams/:teamId/role-permissions` (`roles.manage`), validated by `RolePermissionsInput` (non-configurable actions → 400), normalised with `IMPLIES`, stored as NULL when equal to the defaults, and audited (`roles.base_changed`, before/after). The write bumps `teams.role_permissions_at`, which `requireMember` folds into `rolesUpdatedAt`, so every member's next sync is full. The API applies the change on the next request; devices on their next sync (the team row carries `rolePermissions`). Reading a stored value drops unknown or non-configurable actions (forward-compatible, never restoring removed powers); only unparseable JSON or the wrong shape is logged and treated as the defaults. The editor sends `If-Match: rolePermissionsVersion` (from the team payload; 1 = never changed, otherwise `role_permissions_at`); a stale one gets 409 with the latest, and no header (older builds) saves as before. Revoking invites needs `members.manage`; once a team customises roles, non-admins may only revoke invites for roles they could hand out (`canRevokeInvite`; unchanged under the defaults). A device re-link is refused when the target can manage members in another team: an owner, admin or coach there, or a manager in a team whose settings give managers `members.manage`. RSVP notes follow the main role's `availability.view` under the team's settings (never a team-role grant).
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
| `teams` | id, name, short_name, colors JSON, default_format, timezone, owner_id, pending_owner_member_id?, pending_owner_at?, crest_version?, rsvp_visibility (`counts`/`games`/`all`), proposal_target_15s, proposal_target_7s, role_permissions JSON? (configurable main roles; NULL = defaults), role_permissions_at?, created_at, updated_at, deleted_at | |
| `memberships` | id (member id), team_id, user_id?, display_name, role, role_ids JSON, jersey, positions JSON, status (`active`/`removed`/`pending`), joined_at, removed_at, updated_at | UNIQUE(team_id,user_id), (user_id,status), (team_id,status), (team_id,updated_at) |
| `team_roles` | id, team_id, name, color, permissions JSON (grantable actions only), created_at, updated_at, deleted_at | (team_id,updated_at) |
| `team_crests` | team_id PK, type (png/webp/jpeg), data BLOB (≤ 200 KB, magic bytes checked), updated_at; `teams.crest_version` is the cache key | |
| `invites` | id, team_id, token_hash UNIQUE, kind (`join`/`relink`), role, target_user_id?, created_by, expires_at, max_uses, uses, revoked_at | team_id |
| `seasons` | id, team_id, name, starts_on, ends_on | team_id |
| `events` | id, team_id, season_id, type, format, title, starts_at, meet_at, ends_at, time_tbd (see §Time TBD), location_name, location_url, opponent, notes, rsvp_deadline, recurrence_id?, cancelled_at, status (`confirmed`/`proposed`/`dropped`), answer_by?, target?, check_positions, proposal_reminded_at?, version, updated_at, deleted_at | (team_id,starts_at), (team_id,updated_at), answer_by where proposed |
| `event_options` | a proposal's candidate dates: id, team_id, event_id, starts_at, meet_at, ends_at, time_tbd, updated_at, deleted_at (the event row mirrors the earliest) | (team_id,updated_at), event_id |
| `proposal_answers` | option_id, member_id, event_id, team_id, answer (`in`/`cant`), updated_at; deleted with their date | PK(option_id,member_id), (team_id,updated_at), event_id, member_id |
| `recurrences` | id, team_id, rule JSON (weekly days, time, until), exceptions JSON | team_id |
| `rsvps` | event_id, member_id, team_id, status, note, note_expires_at, attended, reconfirm (yes from a confirmed proposal, awaiting "Still in?"), updated_at | PK(event_id,member_id), (team_id,updated_at), member_id, note_expires_at |
| `team_sheets` | id, event_id, team_id, format, replacements, slots JSON, captain_id, vice_id, status, published (snapshot JSON players see), version, published_at, updated_at | UNIQUE(event_id), (team_id,updated_at) |
| `team_sheet_versions` | sheet_id, version, slots JSON, created_at | sheet_id (keep last 10) |
| `plays` | id, team_id, title, category, tags JSON, format, visibility, data JSON (≤ 200 KB), kind (`diagram`/`picture`), media JSON (ordered image metadata, see §Uploaded images), version, created_by, updated_at, deleted_at | (team_id,updated_at), (team_id,category) |
| `play_views` | play_id, user_id, team_id, day, first_viewed_at | PK(play_id,user_id,day), play_id |
| `drills` | id, team_id, title, category, contact_level, intensity, players_min, players_max, area JSON (w×h m), equipment JSON, default_duration_min, description, coaching_points JSON, setup, variations JSON, diagram JSON (drill-mode Play, ≤ 200 KB; null for a photo-only drill), media JSON (photo metadata), visibility, source (`team`/`starter`), version, created_by, updated_at, deleted_at | (team_id,updated_at), (team_id,category) |
| `media` | uploaded image metadata: id (client UUIDv7), team_id, owner_type (`play`/`drill`), owner_id, position, caption, type (sniffed), width, height, size, thumb_size, created_by, created_at, updated_at, deleted_at (a deleted image is a bytes-free tombstone) | (team_id,owner_type,owner_id,position), team_id where live, deleted_at where deleted, (created_by,created_at) |
| `media_blobs` | media_id, kind (`full`/`thumb`), type, bytes BLOB (image ≤ 400 KB, thumb ≤ 40 KB); triggers on `media` keep `app_meta.media_bytes` (all teams' stored bytes) and delete a row's blobs when it is tombstoned | PK(media_id,kind) |
| `practice_plans` | id, team_id, event_id?, title, is_template, blocks JSON (ordered blocks with lanes/rotations, see below), planned_total_min, version, created_by, updated_at, deleted_at | (team_id,updated_at), event_id |
| `practice_runs` | id (client), plan_id, team_id, kind (`start`/`advance`/`extend`/`pause`/`resume`/`skip`/`end`), payload JSON, at | plan_id |
| `match_events` | id (client), event_id, team_id, seq, kind, payload JSON, game_ms, wall_at, supersedes_id?, created_by, created_at | event_id, (team_id,created_at) |
| `audit_log` | id, team_id, actor_id, action, target_type, target_id, meta JSON, at | (team_id,at) |
| `calendar_tokens` | token_hash PK, user_id, team_id?, scope, created_at, revoked_at (older personal links; new ones use `teams.calendar_token`) | user_id |
| `push_subscriptions` (M7) | id, user_id, endpoint UNIQUE, p256dh, auth, prefs JSON, created_at | user_id |
| `inventory_items` (M9) | id, team_id, kind, name, tag?, quantity (> 1 = a set), condition, status (`available`/`with_someone`/`lost`/`retired`), holder_member_id?, home, notes (kit managers only), match_day, version, created_by, created_at, updated_at, deleted_at | (team_id,updated_at), holder_member_id, UNIQUE(team_id,tag) where set and not deleted |
| `inventory_events` (M9) | append-only history: id, team_id, item_id, kind, actor_member_id, from_member_id, to_member_id, note (≤ 140, kit managers only), at; written in the same guarded batch as each change | (item_id,at) |
| `inventory_handoffs` (M9) | id, team_id, item_id, from_member_id?, to_member_id, note, created_at, expires_at (7 days), resolved_at, outcome (`accepted`/`declined`/`cancelled`), updated_at | (team_id,updated_at), UNIQUE(item_id) while open |

### Proposals ("Not confirmed yet")

- Routes: `events.create`/`events.update` take `status: 'proposed'` with `options[]` (1–4; an edit sends the full list, kept ids keep their answers, removed dates lose theirs), `answerBy`, `target`, `checkPositions`. `proposals.answer` (PUT, own answers only, `rsvp.self`), `proposals.confirm` and `proposals.drop` (POST, `events.manage`). All ≤ 6 queries.
- Sync sends proposals only to builds that ask for them (`sync?caps=proposals`), so an older installed build never shows one as a fixture; dropped proposals go out as tombstones. A full sync carries dates and answers of open proposals only.
- A proposal changes only through its dates: `events.update` refuses start/meet/finish times, cancelling or a practice type for a non-confirmed event (400) and never sends "Changed" pushes for it. Deleting a proposal tells only those who answered; a dropped one, nobody.
- Confirm and drop are one read plus one batch: the guarded status change (`WHERE status = 'proposed'`, recording `confirmed_option_id`), the replies and the pushes commit together, and pushes are gated on this request's write (`updated_at = t`), so a retry never double-sends. Confirm's two messages ("It's on … Still in?" and "New: …") are one `notifyStmt` with an alternative payload. Drop is held 5 s on the device with Undo. Its rsvp upsert only fills replies that are still empty, so a retry never overwrites a later "Can't now".
- Everything that means "the schedule" filters `status = 'confirmed'` (SQL) or `isConfirmed` / `events()` (shared and web); dropped events are hidden (full syncs skip them).

### Time TBD

- A game or event (never a practice, never a weekly series) can have its date set and its time still to decide: `events.time_tbd = 1` (migration 0013, additive). `starts_at` is then **local noon of that date in the team's timezone** (`tbdStartsAt`), so the date never shifts across zones or DST; `meet_at` and `ends_at` are null. `events.create`/`events.update` refuse (400) a TBD practice or a TBD event with a meet or finish time, checking a patch against the stored row. The server re-stores a TBD start at local noon of its date (also on `{timeTbd: true}`), and on a team timezone change moves every TBD event and proposal date to noon in the new zone. A patch from an older build with only a non-noon `startsAt` (meet time allowed) sets the time; a noon one keeps TBD. Setting or clearing the time on the same day keeps `reminded_at`; moving the date clears it.
- One helper set in `packages/shared/event-time.ts`, used by API and web: `eventEndsAt` (a TBD event runs until the **end of its local day**, so it stays upcoming all day; otherwise `ends_at` or start + 3 h), `stillToCome`, `sortByEventStart` (TBD after the day's timed events), `eventTimeLabel` ("Time TBD"/"TBD"), `timeChangeText`. `upcoming()/past()`, sorting, stats (`heldEvents`), kit at risk (`atRiskKit` and the cron job) and the API's "is it still ahead?" checks for pushes (create, edit, delete, confirm, drop) use them; RSVP note expiry counts from the end of a TBD day (noon + 12 h in SQL). `endOfLocalDay` steps past a midnight that DST skips (e.g. Asia/Beirut).
- Proposals: each `event_options` row has its own `time_tbd`; the event mirrors its earliest date, TBD included. Confirming a TBD date keeps it TBD unless the confirm sends `startsAt` (then a meet time may follow).
- Pushes say "Sat 22 Nov, time TBD"; setting the time sends the usual "Changed" push as "Time set: 14:30 · Sat 22 Nov", taking it back "Time now TBD · …". Day-before reminders still go out (noon is 18–30 h ahead the day before).
- Calendar feed: a TBD event is all-day (`DTSTART;VALUE=DATE` / `DTEND;VALUE=DATE` the next day) with "Time TBD." in the description; setting the time bumps `version`, so `SEQUENCE` and `LAST-MODIFIED` change and calendars update.

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
- **Delta sync:** `GET /api/v1/teams/:teamId/sync?since=<cursor>` returns changed rows, tombstones included, for members, seasons, events, RSVPs (players: their own plus per-event counts), sheets (players: published snapshots), play/drill metadata, practice plans, kit items and handovers (open ones, plus those resolved since the cursor), proposal dates and answers (own answers always; everyone's for staff or when the team's reply setting shows names for that event) plus per-date counts for everyone — in **one SQL statement** (`json_group_array` per table). The cursor is the server time at query start; the next sync re-reads a 10 s overlap. A first sync only includes RSVP history from the last 120 days.
- **Writes:** `POST`, `PATCH` and `DELETE` on resource routes.
  - Clients generate IDs, and the server inserts with `ON CONFLICT DO NOTHING`, so outbox retries are idempotent.
  - Versioned resources (events, sheets, plays) take `If-Match: <version>`. A stale version gets `409` with the latest copy.
- **Calendar:** one team calendar per team (`teams.calendar_token`, made on first `teams.calendar.get`, shown to every member, reset by staff with `events.manage`). `GET /cal/:token.ics` is public with that token; older per-user tokens (`calendar_tokens`) still resolve. Feeds send `max-age=300` and `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` of 30 minutes (Google Calendar ignores these and polls on its own schedule). Meet times are written in the team's timezone. "Time TBD" events are all-day entries (see §Time TBD).
- **Bulk writes** (recurring series, attendance, match/run logs, imports) use one `INSERT ... SELECT FROM json_each(?)` statement; imports are sent in chunks of 40 rows.
- **Query budget:** at most 6 D1 queries per request (the free cap is 50). Use `db.batch()`, and avoid N+1 queries.

### Uploaded images (picture plays, drill photos)

- **What:** a picture play (`plays.kind = 'picture'`) is ordered pages of uploaded images instead of an animated diagram (its `data` is a one-frame placeholder so every reader still gets a valid Play). Any drill can have photos next to its diagram, or only photos (`diagram` null). Images only: no PDF/PowerPoint import, no tracing yet.
- **Storage:** bytes in D1 like team emblems; no R2. Metadata (`media`) and bytes (`media_blobs`, one row for the image and one for its thumbnail) are separate tables, so counting, listing and serving a thumbnail never read a full image. The owner row's `media` JSON (`[{id, type, width, height, size, caption, v}]`, rebuilt from `media` in the same batch as every change, and only when an upload really inserted) carries the metadata, so delta sync, visibility and tombstones come from the play/drill row and never send bytes. Image changes bump the owner's `updated_at` but not its `version`, so they never conflict with a pending edit.
- **Routes** (all through `route()`): `plays.media.add` / `drills.media.add` (POST multipart `file`, optional `thumb`, `id`, `caption`; `plays.manage` / `drills.manage`), `plays.media.set` / `drills.media.set` (PUT `MediaSet`: explicit `order`, `remove` and `captions`; live images not mentioned, e.g. another coach's upload a moment ago, are kept after the ordered ones, so two coaches never lose each other's pages), `media.get` (GET `/teams/:teamId/media/:mediaId?v=<v>[&s=thumb]`, `team.view`, and the owner's visibility: a coaches-only play's or drill's images are 404 for players, like the row itself). Each stays within the 6-query budget (membership 2, upload 3 + 1 to explain a refusal, set 3, get 1).
- **Checks** (`packages/shared/media.ts`, `apps/api/src/lib/image.ts`): the type is sniffed from magic bytes and the header (WebP/JPEG/PNG only; never SVG, GIF, HTML or HEIC), pixel size from the header (≤ 1600 px longest side, thumbs ≤ 480), ≤ 400 KB per image (body read with a hard cap), then the file is rebuilt server-side as defence in depth: JPEG keeps JFIF, an `ICC_PROFILE` APP2, Adobe APP14 and codec segments and ends at the EOI closing its own scans (no EXIF/XMP/GPS, MPF second image, comments or appended data); PNG and WebP keep an allowlist of image chunks only.
- **Limits** (one constant each in `media.ts`; all checked inside the INSERT, refusals explained by one follow-up query): 20 pages per play, 6 photos per drill, **150 live images per team** (`MEDIA_TEAM_LIMIT`, 409 `quota`), **60 uploads per person per hour** (`MEDIA_UPLOADS_PER_HOUR`, counted from `media` rows incl. tombstones, 429), and a **global 250 MB** of stored image bytes across all teams (`MEDIA_GLOBAL_BYTES`, 507 "Picture storage is full — tell the Phaseplay admin"; see docs/runbook.md §Picture storage). Uploads need a connection; they never go through the outbox.
- **Serving:** `Content-Type` from the sniffed bytes (re-checked on read), `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Content-Security-Policy: default-src 'none'; sandbox`, CORP same-origin, `Cache-Control: private, max-age=86400` (URLs carry `?v=`; a day keeps shared devices from holding images for long). Signing out (`auth.logout`, `me.signout_all`) sends `Clear-Site-Data: "cache"`. `img-src 'self'` already covers them.
- **Browser side** (`apps/web/src/lib/features/media/compress.ts`): files over 25 MB are refused up front; big photos are decoded straight to about 1600 px (`createImageBitmap` with `resizeWidth`, from a header sniff, EXIF orientation applied), with an `<img>` fallback downscaled in halving steps; then fit to 1600 px, WebP q 0.8 (JPEG on white where the browser can't encode WebP, e.g. older Safari), step quality 0.8→0.6 then size down to 900 px until ≤ 400 KB, else a friendly refusal; a ≤ 40 KB thumbnail from the same pixels. Re-encoding from pixels drops EXIF/GPS. HEIC works where the browser decodes it (Safari); elsewhere a "save it as JPEG or PNG" message. Per-image progress and cancel; the uploader and viewer are lazy chunks. A new picture play left with no pages (cancelled or every upload failed) is deleted again.
- **Deleting:** removing a page, or deleting the play/drill, tombstones its `media` rows in the same batch; a trigger deletes the bytes at once and subtracts them from the global total. The nightly cron purges tombstones after 30 days, deletes any orphaned blobs and recomputes `app_meta.media_bytes`. The demo team can't upload (read-only server-side) and seeds no images.
- **D1 free-tier limits to watch:** 2 MB per value (we store ≤ 400 KB), 100 MB request body (we refuse > ~450 KB), **500 MB per database on Workers Free** (10 GB on Paid), 5M rows read / 100K rows written per day (an upload writes 2 rows plus index entries; a page view reads 1–2). A full team (150 × ~250 KB typical) is ~37 MB; the 250 MB global budget keeps pictures to half the Free database whatever happens. Move bytes to R2 (same routes and checks, `media` keeps metadata and an object key) before raising it far.

## Offline and sync (web)

- The service worker precaches the app shell and static assets. API responses are not cached by the service worker, except playbook images a user has opened: `GET /api/v1/teams/:teamId/media/:id` is cache-first in runtime caches (`pp-media`, `pp-media-thumbs`, 150 entries each, LRU), kept across app versions and cleared with the rest of the device cache on sign-out, account switch or removal from a team, so a viewed picture play opens at the field without signal.
- **Data layer:** each team's data is cached in IndexedDB. Screens render from cache straight away, then delta-sync on load, on focus, on reconnect, and every 60 s while visible.
- **Self-healing:** a device rebuilds its copy with a full sync (`since=0`) once a day and after each app update, so rows the server never accepted (e.g. a write that half-failed in an older build) drop out; change-only syncs can't correct those.
- **Outbox:** mutations are queued in IndexedDB with client IDs and applied to the cache optimistically. Versioned edits pin the version they were based on when made (`baseVersion`) and send it as `If-Match`, advancing only through this device's own successful writes, so another person's change always surfaces as a 409. Entries failing with 5xx are discarded after 6 tries so they can't block the queue. Signing in as a different account clears the device cache. They retry with backoff (and Background Sync where supported), and the UI shows a small sync status that is announced through `aria-live`.
- **Match mode** writes append-only `match_events`, so the server merge is a union by ID.
- **Season stats** compute on the device; see §Season stats for the one extra read they need.

## Push notifications (M7)

- **Topics** (`packages/shared/notify.ts`): `events` (new, moved, cancelled; proposals: "Would you play?" to the team, "It's on … Still in?" to those who were in, "Not going ahead" to those who answered; to the team except the author), `reminders` (cron, the day before, to members with no reply), `sheets` (published), `plays` (a play or practice plan shared with the team), `kit` (cron: a "no" from someone holding kit for an event in the next 24 h). Every topic is on until switched off in `users.notify_prefs`; each device opts in (`push_subscriptions`, one row per browser, ≤ 10 per user).
- **Queueing:** handlers add `notifyStmt(...)` (`apps/api/src/lib/notify.ts`) to their batch: one `INSERT … SELECT` into `push_queue` that resolves the members' users and skips the author, users with the topic off, users with no device, and the demo team. An optional `onlyIf` guard keeps idempotent retries from notifying twice. Then `flushNotifications(c)` drains with `waitUntil` after the response.
- **Draining** (`lib/push/queue.ts`): Workers Free allows 50 subrequests, 50 D1 queries and 10 ms CPU per invocation, so a drain claims ≤ 12 sends (≈0.5 ms CPU each; attempts are counted at claim time so an invocation killed mid-send can't resend forever; a 5-minute lease, one `UPDATE … RETURNING` with each user's ≤ 5 newest devices), sends them in parallel and records outcomes in one batch. 404/410 deletes the device; 429/5xx/network errors back off (1 min, 10 min, 1 h) and give up after 4 attempts; a device failing 10 times in a row is dropped. Messages older than 24 h are dropped unsent.
- **Cron:** `* * * * *` drains the queue; `*/5 * * * *` queues reminders (confirmed events 18–30 h ahead, once each via `events.reminded_at`, which is cleared when the event moves), proposal reminders (two days before `answer_by`, to members who haven't answered, once via `proposal_reminded_at`), kit at risk (once per event and member, by the tick in which the event crossed 24 h or the "no" arrived) and drains the queue. The nightly cron purges queue rows older than two days.
- **Crypto** (`lib/push/`): RFC 8291 `aes128gcm` and RFC 8292 VAPID (ES256 JWT) with WebCrypto only, tested against the RFC 8291 §5 vector. The VAPID key pair is generated on first use into `server_keys`, its private key sealed with AES-GCM (HKDF from the `PUSH_KEY_SECRET` Worker secret) when that secret is set, and sealed in place the first time it appears; signed JWTs are cached in memory per push-service origin for 12 h.
- **Safety:** endpoints must be a known push service (FCM, Mozilla, WNS, Apple) so the server never posts to arbitrary hosts. Payloads carry only names and titles the team already sees, never RSVP notes. Signing out everywhere or deleting the account removes every device. With `ENV=test` sends are faked. Redirects from a push service aren't followed. Signing out on a device removes its subscription first; a re-published team sheet only notifies when the line-up changed.
- **Web:** `/settings/notifications` turns push on per device, sets topics, sends a test and lists devices. On iPhone/iPad in Safari it shows how to add the app to the Home Screen first (iOS only allows Web Push for installed web apps, 16.4+). The service worker shows the notification and, on tap, focuses an open window and navigates it, or opens one.

## Season stats (M7)

- **Where the numbers come from:** pure functions in `packages/shared/stats.ts`, unit-tested, run on the device over the snapshot rows plus the stats feed. Nothing is stored or pre-aggregated on the server.
  - **Attendance** (`attendanceStats`): practices and games attended vs held (held = over, not cancelled or deleted, in the window). Where a register was taken (any `rsvps.attended` set for the event) it counts; otherwise an RSVP "yes" counts and the UI says how many sessions that was. An event counts for someone once they've joined, or whenever they have a mark for it. Team turnout averages cover events with any replies or a register.
  - **Minutes, results, scorers, cards** (`matchLine`, `seasonTallies`): each game's log goes through `reduceMatch` (and `reduceDay` with `settle` for 7s tournaments: each game its own result, reduced at its own last entry) so an unfinished log or game never keeps counting. The line-up is `matchLineup` (`match-day.ts`), the one rule match mode uses too: the last **published** sheet when there is one (staff sheets carry it as `published`; players' copies are it), otherwise the sheet as it stands. Games with no kick-off in the log count as "not recorded".
  - **Penalty trend** (`penaltyTrend`): penalties conceded per recorded game, the average, and top offences.
  - **Training load** (`planLoad`, `trainingLoad`, `loadByGroup`): per week (Monday start, team timezone), from the practice plans attached to held practices: contact = drill contact level shields/full, high intensity = drill intensity ≥ 4, × block minutes (rotations count all stations). The team figure is the planner's (the busiest lane per slot); split sessions also count per group, and a whole-squad block counts for every group. Team-level only.
- **Stats feed** `GET /api/v1/teams/:teamId/stats?from=&to=` (`stats.feed`, action `team.view`, query checked by `StatsQuery`): one membership query plus one batch of two or three indexed statements (events by `(team_id, starts_at)` joined to `rsvps` / `match_events` by event). It returns what the snapshot lacks: match logs of games in the window (capped at 10,000 rows; a partly cut match is left out and `truncated` set), attendance marks older than the 120-day sync window, and per-event team turnout (taken, present, yes; people who play only, `PLAYS_FOR_TEAM_SQL`), sent only to callers without `availability.view` (staff work it out from the marks). Marks are everyone's with `availability.view`, otherwise only the caller's. RSVP notes are never selected. If the row cap was hit, the web fetches the missing games one by one with `match.list` (≤ 40) and says if any still didn't load, rather than calling them unrecorded.
- **Web:** `/stats` (desktop sidebar, More on phones, key 7). It renders from the snapshot and match mode's local logs at once, then the last feed cached in IndexedDB (`kv`), then a fresh feed only if the cached one is over 5 minutes old (or none is cached for that season). The season picker defaults to the season running today (`currentSeason`) and offers "All time".
- **Who sees what:** results, scoring, cards, minutes played (as in every match summary), penalties, training load and team turnout are for every member. Other people's attendance needs `availability.view` (staff, or a Captain-style role); players see, and the API sends them, only their own attendance. No health data: stoppage reasons and RSVP notes are never read.

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
