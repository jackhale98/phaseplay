import { describe, expect, it } from 'vitest';
import type { DrillMeta } from '@phaseplay/shared';
import { squareGrid } from '@phaseplay/diagram/drill-templates';
import { matchDrill, matchPlay, mergedEquipment, playersLabel, type DrillFilter } from './meta';

const d = (o: Partial<DrillMeta> = {}): DrillMeta => ({
  id: 'd1',
  teamId: 't',
  title: 'Tackle box',
  category: 'contact',
  contactLevel: 'full',
  intensity: 4,
  playersMin: 6,
  playersMax: 12,
  area: { w: 5, h: 5 },
  equipment: {},
  defaultDurationMin: 15,
  description: 'Low tackles',
  coachingPoints: ['Cheek to cheek'],
  setup: '',
  variations: [],
  visibility: 'team',
  source: 'starter',
  parentId: null,
  version: 1,
  createdBy: null,
  updatedAt: 0,
  deletedAt: null,
  hasDiagram: true,
  ...o,
});
const f = (o: Partial<DrillFilter> = {}): DrillFilter => ({
  q: '',
  category: 'all',
  contact: 'all',
  players: null,
  duration: 'all',
  ...o,
});

describe('drill filters', () => {
  it('filters by category, contact, players, duration and text', () => {
    expect(matchDrill(d(), f())).toBe(true);
    expect(matchDrill(d(), f({ category: 'handling' }))).toBe(false);
    expect(matchDrill(d(), f({ contact: 'none' }))).toBe(false);
    expect(matchDrill(d(), f({ players: 8 }))).toBe(true);
    expect(matchDrill(d(), f({ players: 20 }))).toBe(false);
    expect(matchDrill(d(), f({ duration: 'mid' }))).toBe(true);
    expect(matchDrill(d(), f({ duration: 'short' }))).toBe(false);
    expect(matchDrill(d(), f({ q: 'cheek tackle' }))).toBe(true);
    expect(matchDrill(d(), f({ q: 'kicking' }))).toBe(false);
  });

  it('matches plays by tag and title', () => {
    const p = { title: 'Zeus', tags: ['front'], description: null, category: 'lineout' };
    expect(matchPlay(p, '#front', 'Lineouts')).toBe(true);
    expect(matchPlay(p, 'lineouts zeus', 'Lineouts')).toBe(true);
    expect(matchPlay(p, 'scrum', 'Lineouts')).toBe(false);
  });

  it('merges derived equipment with the manual list', () => {
    const play = squareGrid();
    const derived = mergedEquipment(play, {});
    expect(derived.cones).toBeGreaterThan(0);
    expect(mergedEquipment(play, { cones: 0, bibs: 10 })).toMatchObject({ bibs: 10 });
    expect(mergedEquipment(play, { cones: 0 }).cones).toBeUndefined();
    expect(playersLabel({ playersMin: 4, playersMax: 4 })).toBe('4 players');
  });
});
