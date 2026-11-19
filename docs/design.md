# Design and UX

## Principles

1. **Two taps to anything weekly.** RSVP, check who's in, open the team sheet, watch the new play.
2. **Instant by default.** Render from cache, write optimistically, sync quietly.
3. **Calm and confident.** A sporty feel that stays restrained: generous space, strong type, one accent colour.
4. **Undo over confirm.** Destructive actions show a 5-second undo toast. Confirm dialogs are only for irreversible things like deleting a team or account.
5. **Thumb-first on mobile, keyboard-first on desktop.** It's the same app, with each layout built properly.

## Brand

The brand kit lives in `brand/` (see `brand/README.md`); `scripts/brand/build.py` builds it into `apps/web/static/brand/` (ribbon text outlined with Archivo), the icons and the wordmark font.
- The logo is a shield crest with a loop play on a striped pitch and a PHASEPLAY ribbon. Use `phaseplay-mark.svg` (no ribbon) at 64 px and below (`#lib/marketing/Logo.svelte` inlines it).
- The loading state everywhere is `phaseplay-loader.svg`, which runs the play in a loop (`#lib/components/Loader.svelte`, shown after 300 ms). Don't add other spinners.
- Brand colours (Ink, Pitch, Chalk, Paper, Amber) seed the design tokens below. Amber is reserved for the ball and key accents.
- The wordmark is Archivo expanded, weight 800, all caps (`#lib/marketing/Wordmark.svelte`, a 2 KB caps-only font subset).

## Visual language

- **Tokens** are CSS custom properties in `apps/web/src/lib/styles/tokens.css`:
  - colour: a neutral scale, surfaces, text, and the accent with on-accent
  - selected state: `--sel` / `--on-sel`, a solid fill (never a tint) for the current tab, segment, nav item, designer tool and chosen chips; it differs from the surface by ≥ 3:1 and carries ≥ 4.5:1 text in both themes for any team colour (`e2e/specs/selected-state.spec.ts`)
  - spacing on a 4 px base
  - radius (6/10/16/full) and elevation (3 levels)
  - motion: 120/200/320 ms, standard and emphasised easing
  - z-index layers
- **Type:** one self-hosted variable sans (open licence, Latin subset, woff2). Use tabular numerals for times, scores and clocks. Scale: 12/14/16/20/24/32/40.
- **Themes:** light and dark follow the system, with a manual override.
- **Team theming:** the accent comes from the team colours. On-accent text is chosen automatically to pass WCAG AA, and the accent is nudged if it can't.
- **Icons:** one open icon set, imported per icon as inline SVG.
- **Pitch themes** (shared with diagrams): *Grass* (striped greens, white lines), *Chalkboard* (dark slate) and *Print* (white, high contrast).
- **Shapes carry meaning:** attackers are circles and defenders are rounded squares, so colour is never the only signal.

## Layout

| Breakpoint | Navigation | Pattern |
| --- | --- | --- |
| < 768 px (mobile) | Bottom tab bar: **Home, Schedule, Squad, Playbook (Plays · Drills), More** | Single column; bottom sheets for create and edit; full-screen match mode; safe-area insets |
| 768–1199 px (tablet) | Navigation rail | Two-pane list/detail |
| ≥ 1200 px (desktop) | Sidebar with team switcher | List/detail, side panels, command palette (⌘/Ctrl-K), shortcut sheet (`?`) |

**Home** shows:
- the next event card with my RSVP buttons
- events still awaiting my RSVP
- the latest published team sheet
- new plays shared with me
- for coaches, availability at a glance and non-responders

## Key screens

1. **Landing** (prerendered): the hero, what Phaseplay does, and sign in / create account.
2. **Sign-up / sign-in:** display name, then the passkey prompt, then recovery codes (save, print or copy, with "I've saved these").
3. **Join** (`/join#t=…`): team crest, team name, the inviting coach and the role, then "Join with a passkey".
4. **Schedule:** an agenda list grouped by week, with a month view on desktop and filters by type.
5. **Event detail:** RSVP, meet time and kickoff, the map link, the availability board (coaches), the team sheet link and attendance.
6. **Squad:** members by position group, with jersey and positions. Coaches also see invites and pending names.
7. **Team sheet builder:** see M3 in `PLAN.md`. Pitch and list views, warnings in a collapsible tray, and Export.
8. **Playbook:** a Plays/Drills segmented control, category chips, search and filters, and cards with an animated thumbnail on hover or focus. Coaches see "seen by n/m" on plays.
    - Drill cards also show duration, contact level and player range.
    - A drill's detail page shows the diagram, coaching points, setup, equipment, variations and "Add to practice".
    - **Picture plays and drill photos:** "Upload a play" sits next to "New play" and opens a sheet: add pages (camera roll, camera or files; drag-and-drop on laptops), each prepared in the browser with its own progress bar and cancel, then reorder with ↑/↓ buttons (keyboard and screen-reader friendly), caption and remove, plus the usual name, category, tags, format, visibility and notes. Saving needs a connection and says so when offline. Picture plays show their first page as the card thumbnail with a "Picture" marker and "n pages"; drills with only photos show a "Photo" marker. On the play/drill page the current picture fills the main column with ‹ › and a thumbnail strip; "Full screen" opens a black viewer: pinch-zoom, double-tap and swipe on phones, zoom buttons, Ctrl/⌘+wheel, ← → between pages, + − 0 and Esc on laptops. Accessible names come from captions, else "<title>, page n of m". Share sends every page to the share sheet on phones and downloads them on laptops. The designer, animation and video/PNG exports don't apply to picture plays and are hidden.
9. **Play editor and viewer:** see `docs/diagrams.md`.
10. **Practice planner:** a timeline of blocks with lanes for split groups, and a running total against the session slot (overrun shown in amber).
    - Add drills from the library through a bottom sheet with search, add water breaks in one tap, and see the equipment checklist.
    - Desktop has a drag-to-reorder timeline with a library side panel.
11. **Practice runner:** the current block in large type, a countdown ring, next up, the drill diagram looping, and coaching points.
    - Controls: +2 min, pause, skip, next.
    - The chime and vibration can be toggled.
12. **Match mode:** large game clock with time off/on, score, and players on field (15 v 14).
    - Primary buttons: Score, Penalty, Card, Sub and Stoppage. Each opens a 1–2 tap sheet that pre-fills the game time.
    - Active sin-bin countdowns are shown, along with a scrollable timeline with edit and undo.
13. **Settings:**
    - account: passkeys, recovery codes, sign out everywhere, export, delete
    - team: details, colours, invites, members, audit log
    - notifications (M7)
    - privacy

**Proposals ("Not confirmed yet")** look provisional everywhere: a dashed outline (`--tent-line`), a lighter fill (`--tent-fill`) and a "Tentative" or "Date poll" chip; the month view shows a dashed "?" pill on each candidate date. One card (`ProposalCard`) serves Home, the agenda and the event page: open with the answer buttons until every date has an answer, then folded to one line with Change (the Home replies' slide, instant with reduced motion). The form keeps one new control (Confirmed | Not confirmed yet) and one defaults line with Change for the rest.

## Interaction details

- **Optimistic writes** come with an undo toast. Sync status is a small dot (synced, pending or offline) with an `aria-live` announcement on change.
- **Haptics:** `navigator.vibrate` where supported (Android) on RSVP, sub and sin-bin end. iOS just gets the visual.
- **Transitions:** View Transitions API for route changes where supported, falling back to crossfades. Reduced motion switches to instant swaps.
- **Sync, not refresh:** data syncs on focus, so there's no pull-to-refresh.
- **Empty states** have one clear action, e.g. "Add your first training".
- **Copy** is friendly and rugby-literate, but short. Use "Who's in for Saturday?", never "Availability management".
- **Forms:** inline validation, a sensible default for every field, and the timezone always shown for events.

## Performance budgets (enforced in CI)

| Metric | Budget |
| --- | --- |
| Initial route JS | ≤ 90 KB gzip |
| CSS | ≤ 20 KB gzip |
| Fonts | ≤ 60 KB total woff2 |
| Play editor chunk (lazy) | ≤ 120 KB gzip; video/GIF encoders load only when exporting |
| Lighthouse mobile (landing, and Home with fixtures) | perf ≥ 95, a11y 100, best practices ≥ 95 |
| LCP / INP / CLS | < 1.8 s (landing, simulated slow 4G; < 2.0 s measured against production) / < 200 ms / < 0.05 |
| Diagram playback | 60 fps on a mid-range Android; no long tasks > 50 ms |

## Accessibility

- WCAG 2.2 AA throughout.
- Touch targets are at least 44×44 px, and focus is always visible.
- Live regions announce timers, sync status and toasts.
- Every flow is keyboard operable, including the team-sheet builder (assign with Enter and arrow keys) and the play editor (see `docs/diagrams.md`).
- Each play, drill and frame has a text description and captions, so they are readable without the animation.
- Timers (practice runner, sin bin) announce milestones politely through `aria-live`, and never rely on sound alone.
- Every key screen gets an axe check in e2e, with zero violations allowed.
