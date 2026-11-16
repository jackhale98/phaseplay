# Phaseplay — agent guide

Phaseplay is an installable web app (PWA) for rugby coaches and their squads, covering both 15s and 7s. It handles teams, the schedule and availability (replacing TeamSnap), team sheets, animated play diagrams and a sideline match mode.

- Web app: `https://phaseplay.app`. A static SvelteKit SPA, on GitHub Pages first and Cloudflare later.
- API: `https://api.phaseplay.app`. A Cloudflare Worker (Hono) with D1.

## Read on demand, not all at once

| File | Read when |
| --- | --- |
| `PLAN.md` | Starting a milestone. Read only that milestone's section and the Definition of Done. |
| `docs/architecture.md` | Touching the stack, data model, API, auth, sync or security. |
| `docs/design.md` | Building any UI. It also holds the performance budgets. |
| `docs/diagrams.md` | Working on the play designer, renderer, exports or the team-sheet image. |
| `docs/testing-ci.md` | Writing tests or changing CI and deploys. |
| `docs/decisions.md` | Before revisiting a settled choice. Append a one-line ADR whenever you make a non-obvious one. |

Use Grep on headings (`^## `) to jump to the section you need.

## Commands (created in M0 with exactly these names)

```
pnpm i                    # install
pnpm dev                  # web (vite) + api (wrangler dev, local D1, seeded)
pnpm check                # lint + format check + typecheck (svelte-check, tsc -b)
pnpm test                 # unit + worker integration (vitest)
pnpm test <path|pattern>  # narrow run, always try this first
pnpm test:e2e [--project=mobile-webkit] [file]
pnpm build                # production build of web + api
pnpm db:migrate:local     # apply D1 migrations locally
pnpm db:seed              # demo team "Phaseplay RFC" with realistic data
```

## Non-negotiables

1. **Tenancy.** Every handler gets team access only through `requireMember(c, teamId, action)`. Never trust a `teamId` or `userId` from the client without it. Every new route goes into the tenancy test matrix. Respond 404, not 403, for another team's resources.
2. **No health data.** Store no injury reasons, medical notes or concussion data. RSVP notes are coach-only and auto-expire.
3. **No third parties at runtime.** No trackers, analytics scripts or CDNs. Self-host fonts and icons.
4. **Budgets.** Performance and bundle budgets (`docs/design.md`) are enforced in CI. Ask before raising one.
5. **Both layouts.** Mobile and desktop are both first-class. Every feature ships with both layouts and e2e coverage on `mobile-webkit` and `desktop-chromium`.
6. **One source of truth for contracts.** Schemas, types, rugby rules and the permission matrix live in `packages/shared`. Never duplicate them in `apps/*`.
7. **Accessibility.** WCAG 2.2 AA, fully keyboard operable, `prefers-reduced-motion` honoured, zero axe violations.

## How to work

- Work one milestone at a time, in small PRs (aim for ≤ ~400 changed lines). Name branches `m<N>-<slug>` and use Conventional Commits.
- **Contracts first.** Write the schema, types and migration in `packages/shared` and `apps/api/migrations`, then the API, then the UI. Parallel work starts only after the contract is merged.
- Write tests alongside the code. Run the narrowest test first, then `pnpm check && pnpm test` before pushing, then e2e for the features you touched.
- Update docs in the same PR whenever behaviour or a contract changes.
- Every PR meets the Definition of Done in `PLAN.md`.

## Token efficiency

- Search before reading. Use Grep and Glob for symbols, and read line ranges of big files rather than the whole file.
- Don't re-read a file you just wrote. Don't dump large output: use `--reporter=dot`, `| tail -n 40` and filters.
- Never pull lockfiles, build output, snapshots or coverage reports into context.
- Prefer a small script over many repetitive manual edits.
- Keep summaries and PR descriptions short: what changed, how it was tested, any follow-ups.

## Delegation

- **Use subagents for:**
  - broad codebase searches (`Explore`)
  - independent parallel work on files no one else is touching
  - fresh-eyes review (`reviewer`)
  - e2e, visual and accessibility testing across devices (`qa-tester`)
- Don't delegate anything that takes fewer steps than writing the brief.
- **A brief has five parts:**
  1. the goal
  2. the files the agent owns and the files it must not touch
  3. the contracts it must honour, as paths in `packages/shared`
  4. the acceptance tests to make pass
  5. the return format: ≤ 10-line summary, files changed, test result
- Parallel agents that edit code each run in their own git worktree, and the main agent merges. Two agents never edit the same file.
- Run `reviewer` on the diff before opening each PR, and fix every CONFIRMED finding.

## Ask the human before

- Making a non-additive schema change to a table that holds production data (after M1 ships).
- Adding a web runtime dependency over 15 KB gzip, or any new service or vendor.
- Changing auth, session or crypto code beyond what the plan says.
- Deleting production data, rotating secrets or raising a budget.

## Environment facts

- WebAuthn RP ID: `phaseplay.app`. Expected origin: `https://phaseplay.app`. Local dev uses `localhost`. Passkeys cannot work on `*.github.io` or preview URLs.
- GitHub Pages can't set HTTP headers. CSP is a `<meta>` tag generated by SvelteKit `kit.csp` (hash mode), and the SPA fallback is `404.html`.
- D1 free tier: 50 queries per Worker invocation, 5M rows read and 100K rows written per day. Batch queries (`db.batch`) and index every filter column.
