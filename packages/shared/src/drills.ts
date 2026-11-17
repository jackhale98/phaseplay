import * as v from 'valibot';
import { Id, text } from './common';
import { PlayData, VISIBILITY } from './play';

export const DRILL_CATEGORIES = [
  'warmup',
  'handling',
  'contact',
  'breakdown',
  'set_piece',
  'attack',
  'defence',
  'kicking',
  'conditioning',
  'game',
] as const;
export type DrillCategory = (typeof DRILL_CATEGORIES)[number];
export const DRILL_CATEGORY_LABELS: Record<DrillCategory, string> = {
  warmup: 'Warm-up',
  handling: 'Handling',
  contact: 'Contact & tackle',
  breakdown: 'Breakdown',
  set_piece: 'Set piece',
  attack: 'Attack',
  defence: 'Defence',
  kicking: 'Kicking',
  conditioning: 'Conditioning',
  game: 'Game',
};

export const CONTACT_LEVELS = ['none', 'touch', 'shields', 'full'] as const;
export type ContactLevel = (typeof CONTACT_LEVELS)[number];
export const CONTACT_LABELS: Record<ContactLevel, string> = {
  none: 'No contact',
  touch: 'Tag / touch',
  shields: 'Shields',
  full: 'Full contact',
};

export const EQUIPMENT = [
  'balls',
  'cones',
  'markers',
  'poles',
  'tackle_shields',
  'tackle_bags',
  'tackle_tubes',
  'ladders',
  'hurdles',
  'scrum_machine',
  'bibs',
] as const;
export type EquipmentItem = (typeof EQUIPMENT)[number];
export const EQUIPMENT_LABELS: Record<EquipmentItem, string> = {
  balls: 'Balls',
  cones: 'Cones',
  markers: 'Flat markers',
  poles: 'Poles',
  tackle_shields: 'Tackle shields',
  tackle_bags: 'Tackle bags',
  tackle_tubes: 'Tackle tubes',
  ladders: 'Ladders',
  hurdles: 'Hurdles',
  scrum_machine: 'Scrum machine',
  bibs: 'Bibs',
};

export const EquipmentList = v.record(
  v.picklist(EQUIPMENT),
  v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(200)),
);
export type EquipmentList = v.InferOutput<typeof EquipmentList>;

const Count = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(80));

export const DrillInput = v.pipe(
  v.object({
    title: text(80, 1),
    category: v.picklist(DRILL_CATEGORIES),
    contactLevel: v.picklist(CONTACT_LEVELS),
    intensity: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)),
    playersMin: Count,
    playersMax: Count,
    area: v.object({
      w: v.pipe(v.number(), v.minValue(1), v.maxValue(100)),
      h: v.pipe(v.number(), v.minValue(1), v.maxValue(120)),
    }),
    equipment: v.optional(EquipmentList, {}),
    defaultDurationMin: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(120)),
    description: v.optional(text(2000), ''),
    coachingPoints: v.optional(v.pipe(v.array(text(200, 1)), v.maxLength(12)), []),
    setup: v.optional(text(1000), ''),
    variations: v.optional(v.pipe(v.array(text(300, 1)), v.maxLength(12)), []),
    diagram: v.optional(v.nullable(PlayData), null),
    visibility: v.picklist(VISIBILITY),
    parentId: v.optional(v.nullable(Id), null),
  }),
  v.check((d) => d.playersMax >= d.playersMin, 'Max players must be at least the minimum'),
);
export const DrillCreate = v.pipe(
  v.object({ id: Id, ...DrillInput.pipe[0].entries }),
  v.check((d) => d.playersMax >= d.playersMin, 'Max players must be at least the minimum'),
);
export type DrillCreate = v.InferOutput<typeof DrillCreate>;
export const DrillUpdate = v.object({
  ...v.partial(DrillInput.pipe[0]).entries,
  /** Archive (true) or restore (false): hidden from lists and pickers, kept in existing plans. */
  archived: v.optional(v.boolean()),
});
export type DrillUpdate = v.InferOutput<typeof DrillUpdate>;

/** Equipment derived from a diagram's entities (docs/diagrams.md §Drill mode). */
export function equipmentFromDiagram(
  diagram: v.InferOutput<typeof PlayData> | null | undefined,
): EquipmentList {
  const out: EquipmentList = {};
  if (!diagram) return out;
  const add = (k: EquipmentItem, n = 1) => (out[k] = (out[k] ?? 0) + n);
  for (const e of diagram.entities) {
    switch (e.kind) {
      case 'ball':
        add('balls');
        break;
      case 'cone':
        add('cones');
        break;
      case 'gate':
        add('cones', 2);
        break;
      case 'marker':
        add('markers');
        break;
      case 'pole':
        add('poles');
        break;
      case 'shield':
        add('tackle_shields');
        break;
      case 'bag':
        add('tackle_bags');
        break;
      case 'tube':
        add('tackle_tubes');
        break;
      case 'ladder':
        add('ladders');
        break;
      case 'hurdle':
        add('hurdles');
        break;
      case 'scrum_machine':
        add('scrum_machine');
        break;
      default:
        break;
    }
  }
  if (diagram.entities.some((e) => e.kind === 'player' && e.group)) {
    const groups = new Set(
      diagram.entities.filter((e) => e.kind === 'player' && e.group).map((e) => e.group),
    );
    if (groups.size > 1) add('bibs', diagram.entities.filter((e) => e.kind === 'player').length);
  }
  return out;
}
