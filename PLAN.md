# Phaseplay — product and delivery plan

## 0. Hand-off

1. Put these files at the root of a new repo, `phaseplay`.
2. Complete the human setup checklist (§7).
3. Open Claude Code in the repo and prompt: *"Read CLAUDE.md, then PLAN.md §1–§5 and the M0 section. Plan M0 as a short task list, then build it."*
4. Run one milestone per session where you can. Start each new session with: *"Continue with M<N>."*

## 1. Vision

Phaseplay gives a rugby coach one calm, fast place to run the team: who's available, who's playing, what the plays are, and what happened on the day. It's built first for a women's club coach who runs both 15s and 7s, and it replaces TeamSnap for his squad. It should be good enough that other teams ask for it.

**Qualities, in priority order:**

1. **Fast.** It opens instantly from cache and every write is optimistic.
2. **Easy.** Weekly tasks take two taps or fewer.
3. **Elegant.** Calm, confident and sporty, never cluttered or gamified.
4. **A joy to use.** Thoughtful motion, haptics, undo everywhere, and exports that look great in the team chat.

## 2. Roles and permissions

The canonical matrix lives in `packages/shared/permissions.ts`. Everyone has one **main role**, and may also hold any number of **team roles** (below).

| Action | Owner | Admin | Coach | Manager | Player |
| --- | :-: | :-: | :-: | :-: | :-: |
| Delete the team | ✓ | | | | |
| Hand over ownership (nominate, the nominee accepts) | ✓ | | | | |
| Team settings; create, edit and assign team roles; make or unmake admins | ✓ | ✓ | | | |
| Remove members, edit shirts and positions, change coach/manager/player roles | ✓ | ✓ | ✓ | | |
| Invite people (only to roles they could hand out) | ✓ | ✓ | ✓ | managers, players | |
| Create and edit events, mark attendance | ✓ | ✓ | ✓ | ✓ | |
| RSVP for themselves | ✓ | ✓ | ✓ | ✓ | ✓ |
| See RSVP notes, availability board, non-responders | ✓ | ✓ | ✓ | ✓ | counts, or names if the team allows (never notes) |
| Build and publish team sheets | ✓ | ✓ | ✓ | | view published |
| Create and edit plays, see "seen by" | ✓ | ✓ | ✓ | | view shared plays |
| Create and edit drills and practice plans | ✓ | ✓ | ✓ | | view shared |
| Run a practice (live session timer) | ✓ | ✓ | ✓ | ✓ | |
| Sideline match mode (record) | ✓ | ✓ | ✓ | ✓ | view match log |
| Audit log | ✓ | ✓ | ✓ | | |

- **Admins** are the e-board: they can do everything except delete the team. There can be several.
- **Team roles** are named bundles of extra permissions, made by owners and admins (for example *Captain*: see coach-only practice plans, availability and draft sheets; *Social sec*: create events). They can only add permissions from the `GRANTABLE` list, which leaves out team settings, deleting, roles and member management, so a team role can never escalate itself. A player with *invite people* can only invite players. *See who's in* shows replies and non-responders but never RSVP notes, which stay with staff by main role. Team roles are cleared when someone leaves or is removed, and a nomination lapses if the nominee leaves.
- **Ownership handover** for when the e-board changes: the owner nominates an active member, nothing changes until they accept, and the old owner becomes an admin. If the owner's account hasn't been used for 30 days, any admin can take over. Every step is in the audit log.

## 3. Scope

**v1 (M0–M6):** accounts and teams, schedule and availability, team sheets, play designer and playbook, drill library and practice planner, sideline match mode.

**Later (M7–M8):** push notifications, season stats, team crest upload, moving everything to Cloudflare.

**Out of scope:** injury, health or concussion tracking; payments and dues; in-app chat (teams keep their group chat, and Phaseplay makes great things to share into it); native app-store apps; public team pages.

## 4. Milestones

Each milestone is a series of small PRs, and each milestone ends deployed to production.

### M0 — Foundations
- pnpm monorepo: `apps/web` (SvelteKit SPA, adapter-static), `apps/api` (Worker, Hono, D1), `packages/shared`, `packages/diagram`, `e2e/`. See `docs/architecture.md` §Repo layout.
- Design tokens, light and dark themes, and the app shell: bottom tab bar on mobile, rail on tablet, sidebar on desktop. See `docs/design.md`.
- PWA basics: manifest, maskable icons, service-worker precache, offline shell, "update available" toast and a gentle install prompt.
- A prerendered landing page for signed-out visitors. It's beautiful enough to show the coach on his birthday, with a "your team is coming soon" state.
- The full CI and deploy pipelines (`docs/testing-ci.md`), live from day one even while the test suites are small.
- Worker `GET /health` returning `{ ok, version }`, and the first D1 migration (users, credentials, sessions).
- `.claude/settings.json`: a permission allowlist for the `pnpm` scripts above, plus a PostToolUse hook that runs Prettier on edited files.
- `docs/decisions.md`, seeded with the stack choices.

**Accepted when:** prod landing page scores Lighthouse mobile ≥ 95 perf and 100 a11y; `https://api.phaseplay.app/health` returns the deployed commit SHA; CI wall-clock time is under 8 minutes.

### M1 — Accounts and teams
- **Passkey sign-up:** display name only, no email or phone. Sign-in uses passkey autofill (conditional mediation) with a button fallback.
- **Account security:**
  - add, rename and remove passkeys
  - 10 single-use recovery codes, shown once, with download and print options
  - "sign out everywhere"
  - delete account
  - export my data as JSON
- **Create team:** name, short name, colours (generated monogram crest), default format (15s or 7s), timezone.
- **Invites:**
  - role, expiry (1h, 1d, 7d by default, or 30d) and max uses
  - revocable at any time
  - delivered as a QR code plus a share link, with the token in the URL fragment
  - the join screen shows the team and coach before the player accepts
- **Device re-link:** a coach issues a single-use 24-hour link that lets a player who lost her passkey add a new one.
- **Members:**
  - list, change role, jersey number, positions (primary first)
  - remove a member: takes effect on her next request, and she sees "You've been removed from {team}"
  - leave team, transfer ownership
- **Audit log:** joins, removals, role changes, invite create and revoke, play deletes.

**Accepted when:**
- the tenancy matrix passes
- a removed member gets 404 on her next request
- the full sign-up → create team → invite → join e2e passes with a virtual authenticator

### M2 — Schedule and availability (replacing TeamSnap)
- **Seasons.** Events: training, match, tournament (7s days), social. Each has meet time and kickoff, location with a map link, opponent, format, and notes.
- **Recurring trainings:** a weekly rule with skip and override for single dates. Cancelling or rescheduling shows a clear banner.
- **One-tap RSVP** (yes, no, maybe) from Home and the schedule. An optional note is visible to coaches only and auto-deleted 30 days after the event.
- **Availability board:**
  - counts by position group (15s: front row, locks, back row, halves, centres, back three; 7s: forwards, backs)
  - coverage warnings, e.g. "only 2 available front-rowers"
  - non-responders, with "copy a nudge" for the group chat
- **Attendance:** a fast checklist after training, pre-filled from RSVPs.
- **Calendar feeds:** a revocable ICS subscription feed per user, plus a team feed for coaches.
- ~~CSV import from TeamSnap~~ Removed (product call). Coaches add names by hand ("Add name"); pending names are claimed when players join.
- **Weekly series**: practices and other non-game events can repeat weekly with an end date. Editing a session offers "This session" or "All upcoming" (time, days, details, end date to stop or extend, or delete the rest).
- **Who's going** (team setting, owner/admin): players see just the numbers (default), names for games, or names for every event. Never RSVP notes.

**Accepted when:** RSVP is ≤ 2 taps from Home and queues offline; the ICS feed subscribes cleanly in Apple and Google Calendar; the availability board loads in < 100 ms from cache.

### M3 — Team sheets
- One sheet per match event, and its slots follow the format (`packages/shared/rugby.ts`).
- **Assigning players:**
  - desktop: drag and drop
  - mobile: tap a slot, then pick from a list ranked by position fit and availability
- **Rules and warnings:**
  - bench slots and captain/vice markers
  - out-of-position flags, unavailable-player warnings, no duplicates
  - front-row cover check (configurable)
- **Draft and publish:** publishing shows the sheet on players' Home screens. Keeps the last 10 versions, and you can copy from the previous match.
- **PNG export:**
  - story (1080×1920), square (1080×1080) and landscape (1920×1080) templates
  - team colours, opponent, kickoff and venue on the image
  - shared with the Web Share API on mobile; downloaded or copied on desktop

**Accepted when:** a 23-player sheet can be built on a phone in under 2 minutes, and the exports match their visual snapshots.

### M4 — Play designer and playbook
- The full spec is in `docs/diagrams.md`: model, renderer, mobile and desktop editors, presets, viewer and exports.
- **Playbook:** categories (lineouts, scrums, strike moves, kick-offs, exits, defence, 7s restarts), tags and search. Visibility is coaches-only or team.
- **View tracking:** "Seen by 18/26" with the list of who hasn't seen it. Records one view per player per play per day.

**Accepted when:**
- a 4-frame lineout move can be built on a phone in < 3 minutes
- playback holds 60 fps on a mid-range Android phone
- a 10-second play exports to MP4 in < 5 seconds on desktop Chrome

### M5 — Drill library and practice planner
- **Drill library** (stored in D1, team-scoped, see `docs/architecture.md`):
  - each drill has a diagram (drill mode in `docs/diagrams.md`), a description, coaching points, setup, and progressions or variations
  - recorded details:
    - category (warm-up, handling, contact and tackle technique, breakdown, set piece, attack, defence, kicking, conditioning, game)
    - contact level (none, tag/touch, shields, full)
    - intensity (1–5)
    - player range, area size in metres, equipment list, default duration
  - search and filter by category, contact level, player count and duration
  - duplicate a drill to make a variation; a starter pack of ~15 generic drills seeds new teams
  - visibility: coaches only, or shared with the team
- **Practice planner** (a plan attaches to a training event):
  - build the session as a timeline of blocks: a drill, a water break, a talk/briefing, a game or a custom block
  - each block has a duration, an assigned coach, a group (all, forwards, backs or custom), notes, and an optional linked play to rehearse
  - parallel tracks for split sessions (for example forwards at the scrum machine while backs run strike moves), shown as lanes
  - station rotations: N groups × M stations with a rotation interval, and the timeline expands automatically
  - always visible: total planned time against the event's slot, with an overrun warning, plus contact-minutes and high-intensity minutes per session
  - auto-suggest a water break after every 20–25 minutes of work (configurable), or insert one with a tap
  - an aggregated equipment checklist (cones, tackle shields, balls, bibs)
  - save as a template, copy last week's plan, and reorder by drag on desktop or long-press drag on mobile
- **Live practice runner:**
  - full-screen view with the current block, a big countdown, the next block preview, and the drill diagram animating on demand
  - a chime plus vibration at 1 minute left and at the end; auto-advance or manual advance
  - if a block runs long, "+2 min" shifts the blocks after it, and the projected finish time updates live
  - pause, skip, and the Screen Wake Lock API keeps the screen on
  - timers are computed from timestamps, so they stay accurate when the screen locks
  - every coach and manager can open the same live session on their own phone (e.g. one with the forwards, one with the backs): split slots show each group's drill and its own countdown, the coach's own group is highlighted, and any of them can move the session on. Devices stay in step through the shared run log (synced every 5 s); step transitions have deterministic ids so two phones moving on together create one event
  - players see the shared plan beforehand; there is no live player view during practice (phones away on the pitch)
- **After the session:** record what actually ran (actual durations, skipped blocks). Attendance from M2 links to the plan.

**Accepted when:**
- a 90-minute session with 6 drills, 2 water breaks and a forwards/backs split can be built on a phone in under 4 minutes
- the runner stays accurate to within 1 s over 90 minutes with the screen locked
- the equipment checklist and the overrun warnings are correct

### M6 — Sideline match mode
- Offline-first, full screen, big buttons, one-handed use. Screen Wake Lock keeps it on.
- **Clocks:**
  - a **running game clock** with halves, and **time off / time on** to follow the referee
  - real elapsed time shown alongside it
  - halves default to 15s 2×40 and 7s 2×7 (finals 2×10), configurable per event
  - clocks are derived from stored timestamps, never from interval ticks, so they survive screen lock and app restarts
- **Play stoppages:** each time off is logged with a reason (injury stoppage, referee time off, review, other) and its length. Stoppage reasons are never linked to a player, so this stays clear of health data.
- **Scores**, for both teams, each with game time and scorer:
  - try 5, conversion 2 (made or missed), penalty goal 3, drop goal 3, penalty try 7
  - point values are configurable per competition
- **Penalties**, for and against, with game time and optional detail:
  - offence type (offside, ruck or breakdown, scrum, lineout, high tackle, not releasing, obstruction, other)
  - the player involved
  - the pitch zone, tapped on a mini pitch
  - the outcome (kick to touch, scrum, tap, kick at goal)
  - running penalty counts per half
- **Cards**, for either team:
  - yellow: a sin-bin countdown on the *game* clock (default 10 min in 15s, 2 min in 7s), with alerts at 1 minute left and at the end, then a "return player" prompt
  - red: permanent, or a timed-replacement mode if the competition uses one (configurable)
  - players on the field is shown live for both teams (for example 15 v 14)
- **Subs** with game time:
  - on/off from the bench, as tactical or temporary replacements (no reason recorded)
  - warnings when the replacement limit is reached or a front-row replacement is needed
  - minutes played per player are calculated automatically
- **Set piece and other tallies:** lineouts and scrums won or lost, turnovers, restarts, plus optional per-player tackles.
- **Timeline:**
  - every entry is timestamped and shown in a scrollable match log
  - any entry can be edited afterwards, for example to fix its time or player
  - "undo last" is always one tap away
- **Afterwards:**
  - a post-match summary with score progression, penalties by type and zone, cards and minutes played
  - a match report PNG for the team chat
  - season totals feed M7 stats
  - a 7s tournament day view shows several matches and each player's minutes across the day
- **Sync:** an append-only match event log through the outbox. Edits are new events that supersede old ones, so merging never conflicts.

**Accepted when:**
- a full match recorded in airplane mode syncs exactly once on reconnect
- game clock drift stays under 1 s over 40 minutes with the screen locked
- sin-bin timers pause correctly during time off
- the score always equals the sum of the scoring events

### M7 — Notifications and stats
- **Web Push** (VAPID) with per-user preferences:
  - new or changed events and cancellations
  - RSVP reminders from a cron job
  - team sheet published
  - new play or practice plan shared
- On iOS, guide players through installing the app to the home screen first, because Web Push only works after install.
- **Season stats:** attendance, minutes played, match tallies and penalty trends, and training load (contact and high-intensity minutes from the practice plans).
- ~~Team crest upload~~ Done early: emblems are resized in the browser (256 px, PNG/WebP) and stored in D1 (`team_crests`, ≤ 200 KB), not R2. See `docs/decisions.md`.

### M8 — Cloudflare hardening (hosting itself moved into M0)
- Done in M0: one Worker serves web + API on `phaseplay.app`, real security headers through `_headers`, runbook in `docs/runbook.md`.
- Remaining: preview deploys per PR (without passkeys, which need the real origin) and a staging environment on `staging.phaseplay.app`.

### M9 — Kit and inventory (planned after v1)

Know what the club owns, who has it, and get a nudge before a practice when the person holding the tackle pads isn't coming.

**Contracts (`packages/shared/inventory.ts`, migration `00NN_inventory.sql`, additive only)**
- `inventory_items`: `id, team_id, kind, name, tag, quantity, condition, status, holder_member_id, home, notes, version, created_at, updated_at, deleted_at`.
  - `kind`: balls, tackle shields, tackle bags, cones, bibs, contact suits, first-aid kit (the box, never anything medical about people), kicking tees, flags, scrum machine, other.
  - `tag`: optional club asset id, unique per team when set (index `(team_id, tag)`); printable QR labels encode `phaseplay.app/kit/<tag>` (opens the item for members, nothing for anyone else).
  - `quantity` > 1 makes an item a set (e.g. "Bibs, red × 15"); sets move as a whole. A set can be split into two items when only part of it goes home with someone.
  - `condition`: good, worn, needs repair. `status`: available (in the store), with someone, lost, retired.
  - `home`: where it lives when nobody has it (shed, coach's car, clubhouse cage).
- `inventory_events` (append-only, the history and audit trail): `id, team_id, item_id, kind, actor_member_id, from_member_id, to_member_id, note, at`.
  - kinds: created, assigned, handoff_requested, handoff_accepted, handoff_declined, returned, marked_lost, found, condition_changed, retired.
  - `note` is plain text, coach-visible, max 140 chars; the UI warns not to write anything about health.
- Pending handoffs: `inventory_handoffs (id, team_id, item_id, from_member_id, to_member_id, created_at, expires_at, resolved_at)`, one open per item; expires after 7 days.
- New grantable permission `inventory.manage` (add, edit, assign, mark lost or retired, override a handoff). Base roles: owner, admin, coach and manager have it. A *Kit manager* team role gives it to a player. Everyone can see the kit list and what they themselves hold.
- Route ids: `inventory.list`, `inventory.put`, `inventory.delete`, `inventory.assign`, `inventory.return`, `inventory.lost`, `inventory.found`, `inventory.handoff.create`, `inventory.handoff.accept`, `inventory.handoff.decline`. All go into the tenancy matrix.
- Sync: items and open handoffs ride the existing delta sync (one more `json_group_array` subquery; check the ≤ 6 query budget). Events are fetched per item on demand.

**Holding and handing over**
- Staff with `inventory.manage` assign an item to a member, or take it back to the store.
- Holders can offer an item to a teammate ("Can you take the tackle shields?"). The teammate accepts or declines from a banner and a push (M7). Until they accept, the original holder still has it.
- Staff can complete or cancel any handoff (override) when someone has left or isn't answering. Everything is logged.
- Holders can mark "I've returned it to the shed": the item goes back to `available` at its `home`.
- Lost: anyone with `inventory.manage`, or the holder, marks it lost (holder cleared, last holder kept in history). Found reverses it. Retired items drop out of counts but keep history.

**Flags (the point of the feature)**
- For each upcoming event in the next 7 days, list kit held by members who replied **no** or **haven't replied**. Show it on the event page (staff), on Home for the holder ("You're not going on Tuesday: hand the tackle shields to someone?" with a one-tap handoff), and in the M7 RSVP reminder.
- Practice plans already total equipment needs (balls, bibs, cones, shields). The plan page compares needs with kit that is available or held by people who replied yes, and shows shortfalls ("Shields: need 6, 4 coming").
- Match day checklist on the match-day view: the kit tagged for games (flags, tees, first-aid box) and who's bringing it.
- A weekly "kit check" view for the kit manager: everything, grouped by holder, with lost and needs-repair at the top.

**Offline and UX**
- Every action is an optimistic outbox mutation like RSVPs. Handoff accept/decline needs the server (it's two-party), so it's queued but the UI shows "waiting to send".
- Phone: a Kit tab under More; scanning a QR label opens the item with Take, Hand over and Return buttons. Desktop: a sortable table with filters (kind, status, holder) and bulk assign.
- Both layouts and e2e on `mobile-webkit` and `desktop-chromium`, zero axe violations.

**Tests**
- Shared: status transitions (pure reducer over events), set splitting, the "at risk for this event" selector.
- API: tenancy matrix rows for every route; handoff race (two accepts → one wins, other 409); a player can't assign or mark someone else's item lost; tag uniqueness per team; sync tombstones.
- E2E: assign shields to a player, player RSVPs no, the event shows the flag, player hands over to a teammate who accepts, flag clears.

**Slices (≤ ~400 lines each)**
1. Contracts + migration + permission + route table.
2. API handlers and tests.
3. Sync + web data layer + kit list and item page.
4. Handoffs (banner, accept/decline, staff override).
5. Event flags, practice-plan shortfalls, Home nudge.
6. QR labels (print sheet) and scan-to-open.

## 5. Definition of Done (every PR)

- [ ] `pnpm check`, `pnpm test` and the e2e tests for touched features pass on desktop-chromium, mobile-chromium and mobile-webkit.
- [ ] New routes are in the tenancy matrix. New queries are indexed and within the query budget.
- [ ] Mobile and desktop layouts both work, with keyboard, screen-reader labels and reduced motion.
- [ ] Performance and bundle budgets pass.
- [ ] Docs and `docs/decisions.md` are updated where relevant.
- [ ] The `reviewer` agent has run and its CONFIRMED findings are fixed.
- [ ] The PR description includes mobile and desktop screenshots for UI changes.

## 6. Success measures

- A coach can create a team and invite the squad in under 5 minutes.
- Most of the squad RSVPs within 48 hours of an event being posted.
- p75 LCP under 1.5 s and INP under 200 ms on real phones.

## 7. Human setup checklist (agents can't do these)

See `docs/runbook.md` §First deploy for the exact steps.

- [x] Buy `phaseplay.app` and add it to a Cloudflare account, which will manage its DNS.
- [ ] Remove any existing apex/`www` DNS records for `phaseplay.app` (the Worker custom domain creates them).
- [x] Connect GitHub to Cloudflare.
- [ ] Import the repo in Workers & Pages with the build settings in `docs/runbook.md` (the D1 database is created automatically on first deploy).
- [ ] Turn on branch protection for `main` and require the CI checks.
- [ ] Switch to the Workers Paid plan ($5/month) once a second team joins, so daily limits can't take the app down on match day.

## 8. Open questions (don't block on these; use sensible defaults)

- The coach's team name and colours, for the seed data and the landing page.
- Whether there's an assistant coach or manager to invite at launch.
