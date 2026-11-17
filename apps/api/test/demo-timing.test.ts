import { timingIssues } from '@phaseplay/diagram/timing-check';
import type { Play } from '@phaseplay/shared';
import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/seed/demo';

describe('demo plays and drills read like rugby', () => {
  const demo = buildDemo(0);
  const diagrams: [string, Play][] = [
    ...demo.plays.map(
      (p) => [String(p.title), JSON.parse(String(p.data)) as Play] as [string, Play],
    ),
    ...demo.drills
      .filter((d) => d.diagram)
      .map((d) => [String(d.title), JSON.parse(String(d.diagram)) as Play] as [string, Play]),
  ];
  it('has diagrams to check', () => expect(diagrams.length).toBeGreaterThan(5));
  it.each(diagrams)('%s: nobody outruns their pass or moves too fast', (_, play) => {
    expect(timingIssues(play)).toEqual([]);
  });
});
