import { describe, expect, it } from 'vitest';
import {
  canChangeRole,
  canRemove,
  can,
  invitableRoles,
  sheetWarnings,
  slotFit,
  zonedToUtc,
  weeklyDates,
  uuidv7,
  contrast,
  fillAccent,
  accessibleAccent,
  ROUTES,
  EVENT_TYPES,
  EVENT_CATEGORIES,
  eventCategory,
  typesInCategory,
} from '../src';

describe('permissions', () => {
  it('matches the plan matrix', () => {
    expect(can('player', 'rsvp.self')).toBe(true);
    expect(can('player', 'availability.view')).toBe(false);
    expect(can('manager', 'events.manage')).toBe(true);
    expect(can('manager', 'sheets.manage')).toBe(false);
    expect(can('coach', 'team.manage')).toBe(false);
    expect(invitableRoles('manager')).toEqual(['manager', 'player']);
    expect(canChangeRole('coach', 'player', 'coach')).toBe(true);
    expect(canChangeRole('coach', 'owner', 'player')).toBe(false);
    expect(canRemove('coach', 'owner')).toBe(false);
    expect(canRemove('manager', 'player')).toBe(false);
  });

  it('every team route names an action', () => {
    for (const [id, r] of Object.entries(ROUTES))
      if (r.auth === 'team') expect('action' in r && r.action, id).toBeTruthy();
  });
});

describe('rugby', () => {
  it('ranks slot fit', () => {
    expect(slotFit('15s', 1, [1, 3])).toBe(3);
    expect(slotFit('15s', 3, [1, 3])).toBe(2);
    expect(slotFit('15s', 2, [1])).toBe(1);
    expect(slotFit('15s', 10, [1])).toBe(0);
    expect(slotFit('7s', 7, [14])).toBe(3);
  });

  it('warns about duplicates, availability and front-row cover', () => {
    const a = uuidv7();
    const b = uuidv7();
    const w = sheetWarnings(
      '15s',
      8,
      { '1': a, '2': a, '10': b },
      { [a]: { positions: [1], rsvp: 'yes' }, [b]: { positions: [1], rsvp: 'no' } },
    );
    const kinds = w.map((x) => x.kind);
    expect(kinds).toContain('duplicate');
    expect(kinds).toContain('unavailable');
    expect(kinds).toContain('out_of_position');
    expect(w.find((x) => x.kind === 'front_row_cover')).toEqual({
      kind: 'front_row_cover',
      have: 2,
      need: 6,
    });
  });
});

describe('time', () => {
  it('converts local times across DST', () => {
    expect(new Date(zonedToUtc('2026-07-01', '19:00', 'Europe/London')).toISOString()).toBe(
      '2026-07-01T18:00:00.000Z',
    );
    expect(new Date(zonedToUtc('2026-12-01', '19:00', 'Europe/London')).toISOString()).toBe(
      '2026-12-01T19:00:00.000Z',
    );
    expect(new Date(zonedToUtc('2026-03-29', '10:00', 'Europe/London')).toISOString()).toBe(
      '2026-03-29T09:00:00.000Z',
    );
    expect(new Date(zonedToUtc('2026-11-01', '18:30', 'America/New_York')).toISOString()).toBe(
      '2026-11-01T23:30:00.000Z',
    );
  });
  it('expands weekly dates', () => {
    expect(weeklyDates('2026-11-16', '2026-11-30', [2, 4])).toEqual([
      '2026-11-17',
      '2026-11-19',
      '2026-11-24',
      '2026-11-26',
    ]);
  });
});

describe('event categories', () => {
  it('splits every type into games, practices or events', () => {
    expect(typesInCategory('games')).toEqual(['match', 'tournament']);
    expect(typesInCategory('practices')).toEqual(['training']);
    expect(typesInCategory('events')).toEqual(['social', 'fundraiser', 'meeting', 'other']);
    expect(EVENT_TYPES.every((t) => EVENT_CATEGORIES.includes(eventCategory(t)))).toBe(true);
  });
});

describe('ids and colours', () => {
  it('uuidv7 is sortable and well-formed', () => {
    const a = uuidv7(1000);
    const b = uuidv7(2000);
    expect(a < b).toBe(true);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('team accents always reach AA', () => {
    for (const c of ['#ffd400', '#1b5e20', '#777777', '#e10600', '#00a3e0', '#ffffff']) {
      const { bg, fg } = fillAccent(c);
      expect(contrast(bg, fg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accessibleAccent(c, '#ffffff'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accessibleAccent(c, '#0e1210'), '#0e1210')).toBeGreaterThanOrEqual(4.5);
    }
  });
});
