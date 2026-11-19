# Play designer, renderer and exports (`packages/diagram`)

## Goals

- Coaches can create animated **plays and drills** quickly on a phone at the pitch or on a laptop at home.
- Players can watch plays anywhere.
- Coaches can export plays as images and video for the team chat.

`packages/diagram` is pure TypeScript with no Svelte inside, so it's easy to test. The editor UI lives in `apps/web`.

## Model

```ts
type Vec2 = { x: number; y: number }; // metres. x: 0..70 across, y: -10..110 along (includes in-goals)

type Play = {
  v: 1;                          // schema version; migrations in packages/diagram/migrate.ts
  id: string;
  mode: 'play' | 'drill';        // same engine; drill mode adds equipment, zones and looping (see §Drill mode)
  title: string;
  format: '15s' | '7s' | 'any';
  view: 'full' | 'half' | 'attack22' | 'lineout' | 'scrum' | 'custom';
  background?: { kind: 'pitch' | 'grass' | 'grid'; w?: number; h?: number; gridM?: number }; // drills default to grass w×h
  viewport?: { x: number; y: number; w: number; h: number };
  entities: Entity[];
  frames: Frame[];               // frames[0] is the starting formation
  loop?: boolean;                // drills usually loop
};

type Entity = {
  id: string;
  kind:
    | 'attack' | 'defence' | 'player'               // 'player' = neutral drill player, coloured by group
    | 'ball' | 'cone' | 'marker' | 'pole' | 'gate'  // gate = cone pair with width
    | 'shield' | 'bag' | 'tube' | 'ladder' | 'hurdle' | 'scrum_machine'
    | 'zone' | 'label' | 'coach';
  group?: 'A' | 'B' | 'C' | 'D'; // drill groups/bib colours
  number?: number;               // shirt number shown in the token
  text?: string;                 // for labels/annotations
  size?: { w: number; h: number; rot?: number }; // metres, for zones, ladders, gates
  memberId?: string;             // optional link to a squad member ("highlight me")
};

type Move = {
  kind: 'run' | 'carry' | 'pass' | 'kick';
  ctrl?: Vec2[];                 // Bézier control points; empty = straight
  ease?: 'linear' | 'inOut' | 'out';
  delayMs?: number;              // stagger within the frame
};

type Frame = {
  id: string;
  durationMs: number;            // time to animate INTO this frame (ignored for frames[0])
  pos: Record<string, Vec2>;     // every entity's position at the end of this frame
  moves: Record<string, Move>;   // how each entity travels from the previous frame
  ball?: { holder?: string; at?: Vec2 };
  caption?: string;              // shown under the viewer and in exports
  arrows?: { from: Vec2; to: Vec2; ctrl?: Vec2[]; style: 'run' | 'pass' | 'kick' }[];
};
```

- Coordinates are in pitch metres, so a play renders identically in portrait and landscape.
- A typical play is under 20 KB of JSON. Writes over 200 KB are rejected.
- Validate the model with a Valibot schema exported from `packages/shared`.

## Animation

- `sample(play, tMs) → Scene` is pure and deterministic. It finds the frame segment, then interpolates each entity along its move path.
- **Paths:** quadratic or cubic Bézier, arc-length parameterised so speed is constant before easing is applied.
- **Ball:**
  - when held, it follows the holder at a small offset
  - a pass travels a slight arc between passer and receiver over the move's timing
  - a kick follows a parabolic height, drawn as scale plus a ground shadow
- **Trails:** optional ghost paths for the current segment. Runs are solid, passes dashed, kicks dotted, all with arrowheads.
- `draw(ctx, scene, { theme, viewport, orientation, highlight })` draws one scene. The editor, the viewer and every exporter use the same `draw`.

## Renderer

- Canvas 2D, scaled by device pixel ratio. The pitch is pre-rendered to an offscreen layer cached by size, theme and orientation, so each frame only draws entities and trails.
- The `requestAnimationFrame` loop runs only while playing or dragging. It's idle otherwise, to save battery.
- **Markings:**
  - try lines, dead-ball lines, 22 m lines and halfway (solid)
  - 10 m lines, plus the 5 m and 15 m lines (dashed)
  - 5 m dashes from the try lines, and goalposts
- **Themes:** Grass, Chalkboard and Print (see `docs/design.md`). Attackers use the team accent and defenders a neutral contrast colour, and their shapes differ too.
- **Orientation:** portrait draws the pitch vertically, so phones use the full screen without rotating.

## Editor — mobile

- The pitch fills the screen. A bottom toolbar holds Select, Add (attacker, defender, ball, cone), Run, Pass, Kick, Text and Undo/Redo. Above it sits the frame strip with a "+ Frame" button. A floating ▶ previews the play.
- **Gestures:**
  - drag a token to move it
  - with Run, drag from a token to draw a curved line; the stroke is sampled, simplified (RDP) and fitted to a Bézier
  - with Pass or Kick, tap the receiver or the landing point
  - pinch to zoom, two-finger pan; snapping to pitch lines can be toggled
  - long-press a token to open a sheet: number, link a squad member, duplicate, delete
- **Presets** (law-checked in `packages/diagram/test/model.test.ts`):
  - lineouts (4-, 5-, 6- and 7-player, with jumpers and lifters); players not in the line and the backs stand 10 m+ back (Law 18)
  - 15s and 7s scrums (backs 5 m+ behind the hindmost feet, Law 19), kick-off receive (15s) and restart receive (7s) with the kicking team behind the ball (Law 12)
  - backline flat or deep (11 on the blindside), pods (1-3-3-1, 2-4-2), each with a "Ruck" marker
  - defensive line (15s and 7s), with two guards tight on the ruck
- New frames copy the previous end positions, so you only move what changes.

## Editor — desktop

- Everything from mobile, plus a properties side panel, marquee multi-select, a right-click menu and a resizable timeline with a scrubber.
- **Shortcuts:**

| Key | Action |
| --- | --- |
| `V` | Select |
| `A` / `D` / `B` | Add attacker / defender / ball |
| `R` / `P` / `K` | Run / pass / kick |
| `N` | New frame |
| `⌘D` | Duplicate frame |
| `Space` | Play |
| `←` / `→` | Previous / next frame |
| Arrow keys | Nudge (Shift = 1 m) |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `Del` | Delete |
| `⇧Del` | Remove the selection's move in this frame (it stays where it was) |
| `?` | Shortcut sheet |

- **Keyboard access:** Tab cycles through tokens, arrow keys move them, and Enter opens their properties.

## Editing model

- Undo and redo use a command pattern. A drag counts as one command.
- Every change autosaves to IndexedDB, and syncs to the server after a 2-second debounce using `If-Match`.
- If the server version is newer, show a non-blocking choice: **Keep mine / Take theirs / Save as copy**.

## Viewer (players)

- Shows plays shared with the team: ▶ or step frame by frame, speed 0.5× or 1×, loop, captions and a scrubber.
- **Highlight me:** if a token is linked to the viewer's `memberId`, it gets a ring and the trail emphasises her path.
- Opening a play records one view per player per play per day (`POST /v1/plays/:id/view`, idempotent).
- Coaches see a **Seen by** panel listing who has and hasn't viewed it, with "copy a nudge".
- **Picture plays** (`kind = 'picture'`, uploaded pages; docs/architecture.md §Uploaded images) use the pictures viewer instead of the player: no designer, animation, PNG/video export or duplicate. Views and Seen by work the same.

## Drill mode

Drills use the same model, renderer, editor and exports, with these additions. The editor switches its toolbar and panels when `mode = 'drill'`.

- **Space:**
  - default background: plain grass sized to the drill area (for example 20×20 m), with an optional metre grid
  - or any portion of a pitch: pick "pitch" and drag the viewport
  - area dimensions are drawn on the edges ("20 m"), and a measure tool shows distances while dragging
- **Equipment palette:** cones, flat markers, poles, gates (cone pairs with a width), tackle shields, tackle bags, tackle tubes, ladders, hurdles, scrum machine, balls, and coach position.
  - Equipment is static by default but can move between frames.
  - The drill's **equipment list is derived from the diagram** (counts by type) and can be adjusted manually.
- **Zones:** labelled rectangles for channels, tackle boxes, end zones and stations, with an optional fill and dashed border. Resize and rotate with handles, and snap sizes to whole metres.
- **People:**
  - neutral `player` tokens coloured by group (A–D, matching bib colours), plus attack and defence tokens for contact drills
  - "add N players" places a line or a grid in one step
  - queue indicators show a stack of players waiting at a cone
- **Motion:**
  - frames work as in plays; drills typically **loop**
  - a **rotation** marker (curved arrow, "rotate to next line") and a **rep flow** (where players go after their rep) show the drill's cycle
  - captions per frame become the step-by-step instructions
- **Drill templates:**
  - handling: square grid with 4 corners, channels, triangle passing, gates
  - warm-up: dynamic warm-up (RAMP, World Rugby Activate)
  - contact and breakdown: tackle box, tackle tubes, ruck-clearing lanes, jackal vs clear-out
  - attack and defense: 2v1 and 3v2 overload, defensive line speed
  - set piece and kicking: lineout pod (throw, lift, catch, maul), lineout throwing targets, box kick and chase
  - conditioning shuttle, and touch / flag game area
  - the "New drill" picker offers `DRILL_TEMPLATES`; warm-up, tackle tubes, jackal, line speed, lineout pod and throwing, and box kick are `EXTRA_DRILL_TEMPLATES`, used for the starter-pack diagrams
  - templates are editable starting points; every pass goes sideways or back, and tackle captions cue contact below the sternum
- **Details panel** (stored on the drill row, not in the diagram): category, contact level, intensity, player range, default duration, description, coaching points, setup, and progressions or variations. Each variation can have its own diagram, made by duplicating the parent and linking back to it.
- **Practice integration:**
  - the practice runner shows the drill diagram looping full-screen with the coaching points beside it
  - the PNG export includes a **drill card** layout (diagram + setup + coaching points + equipment) that prints well on A4/Letter; a photo-only drill's card shows its first photo where the diagram goes
  - drills can carry up to 6 photos (setup photo, scanned diagram) beside the diagram, or instead of it

## Exports (`packages/diagram/export`, which also powers team-sheet PNGs)

- **PNG:** the current frame, or a **storyboard** grid of all frames with captions, which is great for printing.
  - Sizes: 1080×1080, 1920×1080 and 1080×1920, at 2× scale.
  - Optional title, crest or monogram, captions and a small "phaseplay.app" mark.
- **Framing** (`export/framing.ts`, used by PNG, storyboard, video and drill card): the union of everything drawn over the whole animation (tokens, the ball's flight and kick height, labels, zones, arrows) plus a 2 m margin, fitted to the export's aspect ratio in the orientation that shows it largest, clamped to the pitch. Nearby touchlines and try lines are pulled into view (lineouts always show the touchline and the 15 m line). A play's own `viewport` or drill area is kept, grown only where it would crop something. The on-screen player and editor keep the play's view.
- **Video:**
  - MP4 (H.264, 30 fps) with WebCodecs `VideoEncoder` and an MP4 muxer, in a Web Worker drawing to `OffscreenCanvas`
  - fallback 1: WebM via `MediaRecorder` on `canvas.captureStream()`
  - fallback 2: an animated GIF (15 fps) from a worker encoder
  - detect features at runtime, show progress, allow cancelling, and lazy-load the encoders
- **Sharing:**
  - mobile: `navigator.share({ files })`
  - desktop: download, plus "copy image" to the clipboard for PNGs

## Tests

- **Unit:** `sample()` interpolation, path fitting, Bézier arc-length, model migrations, the undo stack, preset and drill-template generation, equipment derivation from entities.
- **Property tests (fast-check):** positions stay continuous across frame boundaries and stay inside pitch bounds, and `sample()` is deterministic.
- **Visual regression:** Playwright screenshots of fixture plays in every theme and both orientations, plus storyboard exports.
- **E2E:**
  - build a play with touch on mobile-webkit and with mouse plus keyboard on desktop-chromium
  - check the PNG export's dimensions
  - MP4 export smoke test on Chromium
- **Performance:** during a 10-second playback, a PerformanceObserver must see no long tasks over 50 ms.
