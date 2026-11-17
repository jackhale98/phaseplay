/**
 * The play/drill diagram model (docs/diagrams.md §Model). Coordinates are pitch metres:
 * x 0..70 across, y -10..110 along (includes in-goals). packages/diagram consumes these types.
 */
import * as v from 'valibot';
import { Id, MAX_JSON_BYTES, text } from './common';

export const Vec2 = v.object({ x: v.number(), y: v.number() });
export type Vec2 = v.InferOutput<typeof Vec2>;

export const ENTITY_KINDS = [
  'attack',
  'defence',
  'player',
  'ball',
  'cone',
  'marker',
  'pole',
  'gate',
  'shield',
  'bag',
  'tube',
  'ladder',
  'hurdle',
  'scrum_machine',
  'zone',
  'label',
  'coach',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Entity kinds counted as equipment for a drill's derived equipment list. */
export const EQUIPMENT_KINDS = [
  'ball',
  'cone',
  'marker',
  'pole',
  'gate',
  'shield',
  'bag',
  'tube',
  'ladder',
  'hurdle',
  'scrum_machine',
] as const satisfies readonly EntityKind[];

export const Entity = v.object({
  id: v.pipe(v.string(), v.maxLength(40)),
  kind: v.picklist(ENTITY_KINDS),
  group: v.optional(v.picklist(['A', 'B', 'C', 'D'])),
  number: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(99))),
  text: v.optional(v.pipe(v.string(), v.maxLength(80))),
  size: v.optional(v.object({ w: v.number(), h: v.number(), rot: v.optional(v.number()) })),
  memberId: v.optional(Id),
});
export type Entity = v.InferOutput<typeof Entity>;

export const MOVE_KINDS = ['run', 'carry', 'pass', 'kick'] as const;
export const Move = v.object({
  kind: v.picklist(MOVE_KINDS),
  ctrl: v.optional(v.pipe(v.array(Vec2), v.maxLength(2))),
  ease: v.optional(v.picklist(['linear', 'inOut', 'out'])),
  delayMs: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(20000))),
});
export type Move = v.InferOutput<typeof Move>;

export const Arrow = v.object({
  from: Vec2,
  to: Vec2,
  ctrl: v.optional(v.pipe(v.array(Vec2), v.maxLength(2))),
  style: v.picklist(['run', 'pass', 'kick']),
});
export type Arrow = v.InferOutput<typeof Arrow>;

export const Frame = v.object({
  id: v.pipe(v.string(), v.maxLength(40)),
  durationMs: v.pipe(v.number(), v.minValue(0), v.maxValue(30000)),
  pos: v.record(v.string(), Vec2),
  moves: v.record(v.string(), Move),
  ball: v.optional(v.object({ holder: v.optional(v.string()), at: v.optional(Vec2) })),
  caption: v.optional(v.pipe(v.string(), v.maxLength(280))),
  arrows: v.optional(v.pipe(v.array(Arrow), v.maxLength(40))),
});
export type Frame = v.InferOutput<typeof Frame>;

export const VIEWS = ['full', 'half', 'attack22', 'lineout', 'scrum', 'custom'] as const;
export type View = (typeof VIEWS)[number];

export const Viewport = v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() });
export type Viewport = v.InferOutput<typeof Viewport>;

export const Play = v.pipe(
  v.object({
    v: v.literal(1),
    id: v.string(),
    mode: v.picklist(['play', 'drill']),
    title: v.pipe(v.string(), v.maxLength(80)),
    format: v.picklist(['15s', '7s', 'any']),
    view: v.picklist(VIEWS),
    background: v.optional(
      v.object({
        kind: v.picklist(['pitch', 'grass', 'grid']),
        w: v.optional(v.number()),
        h: v.optional(v.number()),
        gridM: v.optional(v.number()),
      }),
    ),
    viewport: v.optional(Viewport),
    entities: v.pipe(v.array(Entity), v.maxLength(120)),
    frames: v.pipe(v.array(Frame), v.minLength(1), v.maxLength(40)),
    loop: v.optional(v.boolean()),
  }),
  v.check(
    (p) => new Set(p.entities.map((e) => e.id)).size === p.entities.length,
    'Entity ids must be unique',
  ),
);
export type Play = v.InferOutput<typeof Play>;

export const PLAY_CATEGORIES = [
  'lineout',
  'scrum',
  'strike',
  'kickoff',
  'exit',
  'defence',
  'restart7s',
  'other',
] as const;
export type PlayCategory = (typeof PLAY_CATEGORIES)[number];
export const PLAY_CATEGORY_LABELS: Record<PlayCategory, string> = {
  lineout: 'Lineouts',
  scrum: 'Scrums',
  strike: 'Strike moves',
  kickoff: 'Kick-offs',
  exit: 'Exits',
  defence: 'Defence',
  restart7s: '7s restarts',
  other: 'Other',
};

export const VISIBILITY = ['coaches', 'team'] as const;
export type Visibility = (typeof VISIBILITY)[number];

const jsonSize = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).length;
export const PlayData = v.pipe(
  Play,
  v.check((p) => jsonSize(p) <= MAX_JSON_BYTES, 'Diagram is too large (200 KB max)'),
);

export const PlayInput = v.object({
  title: text(80, 1),
  category: v.picklist(PLAY_CATEGORIES),
  tags: v.optional(v.pipe(v.array(text(24, 1)), v.maxLength(12)), []),
  format: v.picklist(['15s', '7s', 'any']),
  visibility: v.picklist(VISIBILITY),
  description: v.optional(v.nullable(text(2000)), null),
  data: PlayData,
});
export const PlayCreate = v.object({ id: Id, ...PlayInput.entries });
export type PlayCreate = v.InferOutput<typeof PlayCreate>;
export const PlayUpdate = v.object({
  ...v.partial(PlayInput).entries,
  /** Archive (true) or restore (false): hidden from lists, still works where it's used. */
  archived: v.optional(v.boolean()),
});
export type PlayUpdate = v.InferOutput<typeof PlayUpdate>;
