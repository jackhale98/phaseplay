import type { Play } from '@phaseplay/shared';
import {
  boxKickChase,
  channels,
  conditioningShuttle,
  dynamicWarmup,
  jackalClearOut,
  lineoutPod,
  lineoutThrowing,
  lineSpeed,
  overload2v1,
  overload3v2,
  ruckLanes,
  squareGrid,
  tackleBox,
  tackleTubes,
  touchGame,
  trianglePassing,
} from '@phaseplay/diagram/drill-templates';

/**
 * Starter drills reuse the shared drill templates so diagrams match the renderer exactly. Each
 * drill's area, players and equipment in starter-drills.ts describe the same picture.
 */
const MAP: Record<string, () => Play> = {
  'dynamic-warmup': () => dynamicWarmup(),
  'triangle-passing': () => trianglePassing(),
  'square-grid': () => squareGrid(),
  'channel-passing': () => channels(),
  'tackle-tubes': () => tackleTubes(),
  'tackle-box': () => tackleBox(),
  'ruck-lanes': () => ruckLanes(),
  jackal: () => jackalClearOut(),
  '2v1': () => overload2v1(),
  '3v2': () => overload3v2(),
  'line-speed': () => lineSpeed(),
  'lineout-throwing': () => lineoutThrowing(),
  'lineout-pod': () => lineoutPod(),
  'box-kick-chase': () => boxKickChase(),
  shuttles: () => conditioningShuttle(),
  'touch-game': () => touchGame(),
};

export function starterDiagram(key: string): Play | null {
  return MAP[key]?.() ?? null;
}
