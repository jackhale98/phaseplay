import { describe, expect, it } from 'vitest';
import {
  KIT_FLAG_WINDOW_MS,
  atRiskKit,
  inService,
  kitShortfalls,
  nextItemState,
  reduceItemState,
  splitSet,
  type InventoryEventKind,
} from '../src';

const ev = (kind: InventoryEventKind, toMemberId: string | null = null) => ({ kind, toMemberId });

describe('item status reducer', () => {
  it('replays a full lifecycle', () => {
    const steps = [
      ev('created'),
      ev('assigned', 'pip'),
      ev('handoff_requested', 'jess'),
      ev('handoff_declined', 'jess'),
      ev('handoff_requested', 'sam'),
      ev('handoff_accepted', 'sam'),
      ev('marked_lost'),
      ev('found'),
      ev('condition_changed'),
      ev('retired'),
    ];
    const seen = steps.map((_, i) => reduceItemState(steps.slice(0, i + 1)));
    expect(seen.map((s) => `${s.status}:${s.holderMemberId ?? '-'}`)).toEqual([
      'available:-',
      'with_someone:pip',
      'with_someone:pip',
      'with_someone:pip',
      'with_someone:pip',
      'with_someone:sam',
      'lost:-',
      'available:-',
      'available:-',
      'retired:-',
    ]);
  });

  it('assign to nobody is a take-back; a split-off item can start with someone', () => {
    expect(reduceItemState([ev('assigned', 'pip'), ev('assigned', null)])).toEqual({
      status: 'available',
      holderMemberId: null,
    });
    expect(reduceItemState([ev('created', 'pip')]).status).toBe('with_someone');
  });

  it('history-only events never change the state', () => {
    const s = { status: 'with_someone' as const, holderMemberId: 'pip' };
    for (const k of [
      'edited',
      'handoff_requested',
      'handoff_declined',
      'handoff_cancelled',
      'split',
    ] as const)
      expect(nextItemState(s, ev(k, 'other'))).toEqual(s);
  });

  it('retired and deleted items are out of service', () => {
    expect(inService({ status: 'available' })).toBe(true);
    expect(inService({ status: 'with_someone' })).toBe(true);
    expect(inService({ status: 'lost' })).toBe(false);
    expect(inService({ status: 'retired' })).toBe(false);
    expect(inService({ status: 'available', deletedAt: 1 })).toBe(false);
  });
});

describe('set splitting', () => {
  it('keeps at least one on each side', () => {
    expect(splitSet(15, 5)).toEqual({ keep: 10, take: 5 });
    expect(splitSet(2, 1)).toEqual({ keep: 1, take: 1 });
    expect(splitSet(15, 15)).toBeNull();
    expect(splitSet(15, 0)).toBeNull();
    expect(splitSet(1, 1)).toBeNull();
    expect(splitSet(15, 2.5)).toBeNull();
  });
});

describe('at-risk kit', () => {
  const now = Date.UTC(2030, 0, 1, 12);
  const day = 86400e3;
  const items = [
    {
      id: 'shields',
      kind: 'tackle_shields' as const,
      quantity: 6,
      status: 'with_someone' as const,
      holderMemberId: 'pip',
    },
    {
      id: 'balls',
      kind: 'balls' as const,
      quantity: 10,
      status: 'with_someone' as const,
      holderMemberId: 'jess',
    },
    {
      id: 'bibs',
      kind: 'bibs' as const,
      quantity: 15,
      status: 'available' as const,
      holderMemberId: null,
    },
    {
      id: 'gone',
      kind: 'cones' as const,
      quantity: 1,
      status: 'with_someone' as const,
      holderMemberId: 'sam',
      deletedAt: 5,
    },
  ];
  const events = [
    { id: 'thu', startsAt: now + 3 * day },
    { id: 'tue', startsAt: now + 1 * day },
    { id: 'later', startsAt: now + KIT_FLAG_WINDOW_MS + day },
    { id: 'past', startsAt: now - day },
    { id: 'off', startsAt: now + 2 * day, cancelledAt: now },
  ];

  it('flags holders who are out or have not replied, soonest event first', () => {
    const rsvps = [
      { eventId: 'tue', memberId: 'pip', status: 'no' as const },
      { eventId: 'tue', memberId: 'jess', status: 'yes' as const },
      { eventId: 'thu', memberId: 'pip', status: 'maybe' as const },
    ];
    expect(atRiskKit(items, events, rsvps, now)).toEqual([
      { eventId: 'tue', itemId: 'shields', holderMemberId: 'pip', reply: 'no' },
      { eventId: 'thu', itemId: 'balls', holderMemberId: 'jess', reply: null },
    ]);
  });

  it('clears once the kit is with someone who is going', () => {
    const rsvps = [
      { eventId: 'tue', memberId: 'pip', status: 'no' as const },
      { eventId: 'tue', memberId: 'jess', status: 'yes' as const },
    ];
    const handed = items.map((i) => (i.id === 'shields' ? { ...i, holderMemberId: 'jess' } : i));
    expect(atRiskKit(handed, [events[1]!], rsvps, now)).toEqual([]);
  });

  it('is empty when nobody holds anything', () => {
    expect(atRiskKit([items[2]!], events, [], now)).toEqual([]);
  });
});

describe('practice shortfalls', () => {
  it('counts the store plus holders who replied yes', () => {
    const items = [
      {
        id: 'a',
        kind: 'tackle_shields' as const,
        quantity: 2,
        status: 'available' as const,
        holderMemberId: null,
      },
      {
        id: 'b',
        kind: 'tackle_shields' as const,
        quantity: 2,
        status: 'with_someone' as const,
        holderMemberId: 'pip',
      },
      {
        id: 'c',
        kind: 'tackle_shields' as const,
        quantity: 2,
        status: 'with_someone' as const,
        holderMemberId: 'jess',
      },
      {
        id: 'd',
        kind: 'tackle_shields' as const,
        quantity: 4,
        status: 'lost' as const,
        holderMemberId: null,
      },
      {
        id: 'e',
        kind: 'balls' as const,
        quantity: 12,
        status: 'available' as const,
        holderMemberId: null,
      },
    ];
    const rsvps = [
      { eventId: 'tue', memberId: 'pip', status: 'yes' as const },
      { eventId: 'tue', memberId: 'jess', status: 'no' as const },
    ];
    expect(kitShortfalls({ tackle_shields: 6, balls: 10, bibs: 10 }, items, 'tue', rsvps)).toEqual([
      { kind: 'tackle_shields', need: 6, coming: 4 },
      { kind: 'bibs', need: 10, coming: 0 },
    ]);
    // Without an event only the store counts.
    expect(kitShortfalls({ tackle_shields: 3 }, items, null, rsvps)).toEqual([
      { kind: 'tackle_shields', need: 3, coming: 2 },
    ]);
  });
});
