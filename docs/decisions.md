# Decisions

One line per decision: date — decision — why.

- 2026-11-16 — SvelteKit SPA on GitHub Pages + Worker/D1 API on api.phaseplay.app — passkeys bound to phaseplay.app from day one; move to Cloudflare is DNS-only.
- 2026-11-16 — One shared D1 database, no app-level encryption — tenancy enforced in code and tests; revisit per-team DBs if adoption grows.
- 2026-11-16 — No health/concussion data — legal and privacy risk outweighs value.
- 2026-11-16 — Drills reuse the play diagram engine (`mode: 'drill'`) — one renderer, editor and export pipeline; drill details live on the drill row, not in the diagram.
- 2026-11-16 — Match and practice timing come from timestamped event logs reduced by pure functions — accurate through screen lock, offline-safe, conflict-free sync.
