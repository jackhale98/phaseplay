/** Display helpers and filters for drills. */
import {
  CONTACT_LABELS,
  DRILL_CATEGORY_LABELS,
  EQUIPMENT,
  EQUIPMENT_LABELS,
  equipmentFromDiagram,
  type ContactLevel,
  type DrillCategory,
  type DrillMeta,
  type EquipmentItem,
  type EquipmentList,
  type Play,
} from '@phaseplay/shared';

export const playersLabel = (d: Pick<DrillMeta, 'playersMin' | 'playersMax'>) =>
  d.playersMin === d.playersMax
    ? `${d.playersMin} players`
    : `${d.playersMin}–${d.playersMax} players`;

export const durationLabel = (m: number) => `${m} min`;

/** Short facts for cards and the drill card export. */
export function drillFacts(d: DrillMeta): string[] {
  return [
    durationLabel(d.defaultDurationMin),
    CONTACT_LABELS[d.contactLevel],
    playersLabel(d),
    `${d.area.w}×${d.area.h} m`,
  ];
}

/** Equipment derived from the diagram, with the manual list taking precedence. */
export function mergedEquipment(
  diagram: Play | null | undefined,
  manual: EquipmentList,
): EquipmentList {
  const out: EquipmentList = { ...equipmentFromDiagram(diagram), ...manual };
  for (const k of Object.keys(out) as EquipmentItem[]) if (!out[k]) delete out[k];
  return out;
}

export function equipmentLines(
  list: EquipmentList,
): { key: EquipmentItem; label: string; n: number }[] {
  return EQUIPMENT.filter((k) => (list[k] ?? 0) > 0).map((k) => ({
    key: k,
    label: EQUIPMENT_LABELS[k],
    n: list[k]!,
  }));
}

export type DurationBand = 'all' | 'short' | 'mid' | 'long';
export const DURATION_BANDS: { value: DurationBand; label: string }[] = [
  { value: 'all', label: 'Any length' },
  { value: 'short', label: 'Up to 10 min' },
  { value: 'mid', label: '11–20 min' },
  { value: 'long', label: 'Over 20 min' },
];

export type DrillFilter = {
  q: string;
  category: DrillCategory | 'all';
  contact: ContactLevel | 'all';
  players: number | null;
  duration: DurationBand;
};

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKD');

export function matchDrill(d: DrillMeta, f: DrillFilter): boolean {
  if (f.category !== 'all' && d.category !== f.category) return false;
  if (f.contact !== 'all' && d.contactLevel !== f.contact) return false;
  if (f.players && (f.players < d.playersMin || f.players > d.playersMax)) return false;
  const m = d.defaultDurationMin;
  if (f.duration === 'short' && m > 10) return false;
  if (f.duration === 'mid' && (m <= 10 || m > 20)) return false;
  if (f.duration === 'long' && m <= 20) return false;
  if (f.q.trim()) {
    const hay = norm(
      [
        d.title,
        d.description,
        DRILL_CATEGORY_LABELS[d.category],
        ...d.coachingPoints,
        d.setup,
      ].join(' '),
    );
    return norm(f.q)
      .split(/\s+/)
      .filter(Boolean)
      .every((w) => hay.includes(w));
  }
  return true;
}

export function matchPlay(
  p: { title: string; tags: string[]; description: string | null; category: string },
  q: string,
  categoryLabel: string,
): boolean {
  if (!q.trim()) return true;
  const hay = norm(
    [p.title, p.description ?? '', categoryLabel, ...p.tags.map((t) => `#${t} ${t}`)].join(' '),
  );
  return norm(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w.replace(/^#/, '')));
}
