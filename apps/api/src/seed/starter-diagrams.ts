import type { Play } from '@phaseplay/shared';
import {
  channels,
  conditioningShuttle,
  gates,
  overload2v1,
  overload3v2,
  ruckLanes,
  squareGrid,
  tackleBox,
  touchGame,
  trianglePassing,
} from '@phaseplay/diagram/drill-templates';

/** Starter drills reuse the shared drill templates so diagrams match the renderer exactly. */
const MAP: Record<string, () => Play> = {
  'dynamic-warmup': () => gates(),
  'triangle-passing': () => trianglePassing(),
  'square-grid': () => squareGrid(),
  'channel-passing': () => channels(),
  'tackle-box': () => tackleBox(),
  'ruck-lanes': () => ruckLanes(),
  jackal: () => ruckLanes(),
  '2v1': () => overload2v1(),
  '3v2': () => overload3v2(),
  shuttles: () => conditioningShuttle(),
  'touch-game': () => touchGame(),
};

export function starterDiagram(key: string): Play | null {
  return MAP[key]?.() ?? null;
}
