import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  addDays,
  EventCreate,
  EventUpdate,
  ProposalOption,
  atRiskKit,
  dateInTz,
  endOfLocalDay,
  eventEndsAt,
  eventTimeLabel,
  heldEvents,
  isTimeTbd,
  sortByEventStart,
  tbdStartsAt,
  timeChangeText,
  zonedToUtc,
} from '../src/index';

const LON = 'Europe/London';
const NY = 'America/New_York';
const AKL = 'Pacific/Auckland';

describe('tbdStartsAt (local noon)', () => {
  it('stores noon in team time, on both sides of a DST change', () => {
    // UK clocks go back on 26 Oct 2025 and forward on 29 Mar 2026.
    expect(new Date(tbdStartsAt('2025-10-25', LON)).toISOString()).toBe('2025-10-25T11:00:00.000Z');
    expect(new Date(tbdStartsAt('2025-10-26', LON)).toISOString()).toBe('2025-10-26T12:00:00.000Z');
    expect(new Date(tbdStartsAt('2026-03-29', LON)).toISOString()).toBe('2026-03-29T11:00:00.000Z');
    expect(new Date(tbdStartsAt('2025-11-02', NY)).toISOString()).toBe('2025-11-02T17:00:00.000Z');
  });

  it('keeps the date in team time whatever the zone', () => {
    for (const tz of [LON, NY, AKL, 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC'])
      for (const d of ['2025-10-26', '2026-03-29', '2026-04-05', '2026-11-22', '2026-12-31'])
        expect(dateInTz(tbdStartsAt(d, tz), tz)).toBe(d);
  });
});

describe('eventEndsAt', () => {
  it('runs a TBD event until the end of its local day', () => {
    const e = { startsAt: tbdStartsAt('2026-11-22', LON), endsAt: null, timeTbd: true };
    expect(eventEndsAt(e, LON)).toBe(zonedToUtc('2026-11-23', '00:00', LON));
    // The day the clocks go back is 25 hours long.
    const long = { startsAt: tbdStartsAt('2025-10-26', LON), timeTbd: true };
    expect(eventEndsAt(long, LON) - zonedToUtc('2025-10-26', '00:00', LON)).toBe(25 * 3600e3);
  });

  it('uses the finish time, else start + 3 h (or a given length) for timed events', () => {
    const s = zonedToUtc('2026-11-22', '15:00', LON);
    expect(eventEndsAt({ startsAt: s, endsAt: s + 3600e3 }, LON)).toBe(s + 3600e3);
    expect(eventEndsAt({ startsAt: s, endsAt: null }, LON)).toBe(s + 3 * 3600e3);
    expect(eventEndsAt({ startsAt: s, endsAt: null, timeTbd: false }, LON, 2 * 3600e3)).toBe(
      s + 2 * 3600e3,
    );
  });

  it('end of day matches endOfLocalDay', () => {
    const at = zonedToUtc('2026-03-29', '23:30', LON);
    expect(endOfLocalDay(at, LON)).toBe(zonedToUtc('2026-03-30', '00:00', LON));
  });

  it("where DST skips midnight, the day ends at the next day's first minute", () => {
    // Lebanon: clocks jump from 00:00 to 01:00 on Sunday 29 March 2026.
    const tz = 'Asia/Beirut';
    for (const d of ['2026-03-28', '2026-03-27', '2026-10-24', '2026-11-21']) {
      const end = endOfLocalDay(tbdStartsAt(d, tz), tz);
      expect(dateInTz(end, tz)).toBe(addDays(d, 1));
      expect(dateInTz(end - 60e3, tz)).toBe(d);
    }
    const tbd = { startsAt: tbdStartsAt('2026-03-28', tz), timeTbd: true };
    expect(eventEndsAt(tbd, tz)).toBe(Date.UTC(2026, 2, 28, 22));
  });
});

describe('sortByEventStart', () => {
  it('puts TBD events after the timed events of the same day', () => {
    const tbd = { id: 'tbd', startsAt: tbdStartsAt('2026-11-22', LON), timeTbd: true };
    const evening = { id: 'eve', startsAt: zonedToUtc('2026-11-22', '19:00', LON) };
    const morning = { id: 'am', startsAt: zonedToUtc('2026-11-22', '09:00', LON) };
    const nextDay = { id: 'next', startsAt: zonedToUtc('2026-11-23', '00:30', LON) };
    const before = { id: 'before', startsAt: zonedToUtc('2026-11-21', '23:00', LON) };
    expect(
      sortByEventStart([nextDay, tbd, evening, before, morning], LON).map((e) => e.id),
    ).toEqual(['before', 'am', 'eve', 'tbd', 'next']);
  });
});

describe('labels', () => {
  it('says Time TBD / TBD, else the time', () => {
    const tbd = { startsAt: tbdStartsAt('2026-11-22', LON), timeTbd: true };
    expect(eventTimeLabel(tbd, LON)).toBe('Time TBD');
    expect(eventTimeLabel(tbd, LON, { short: true })).toBe('TBD');
    expect(isTimeTbd(tbd)).toBe(true);
    expect(isTimeTbd({})).toBe(false);
    const timed = { startsAt: zonedToUtc('2026-11-22', '14:30', LON) };
    expect(eventTimeLabel(timed, LON, { locale: 'en-GB' })).toBe('14:30');
    expect(eventTimeLabel(timed, NY, { locale: 'en-US' })).toBe('9:30 AM');
  });

  it('describes a time being set or cleared', () => {
    const tbd = { startsAt: tbdStartsAt('2026-11-22', NY), timeTbd: true };
    const timed = { startsAt: zonedToUtc('2026-11-22', '14:30', NY) };
    expect(timeChangeText(tbd, timed, NY, 'en-US')).toBe('Time set: 2:30 PM');
    expect(timeChangeText(timed, tbd, NY, 'en-US')).toBe('Time now TBD');
    expect(timeChangeText(timed, timed, NY, 'en-US')).toBeNull();
  });
});

describe('schemas', () => {
  const base = {
    id: '0190a8d2-0000-7000-8000-000000000001',
    type: 'social' as const,
    title: 'Quiz night',
    startsAt: tbdStartsAt('2026-11-27', LON),
    timeTbd: true,
  };
  it('accepts a TBD social and defaults timeTbd to false', () => {
    expect(v.safeParse(EventCreate, base).success).toBe(true);
    const { timeTbd: _, ...timed } = base;
    expect(v.parse(EventCreate, timed).timeTbd).toBe(false);
  });
  it('refuses TBD practices and TBD with meet or finish times', () => {
    expect(v.safeParse(EventCreate, { ...base, type: 'training' }).success).toBe(false);
    expect(v.safeParse(EventCreate, { ...base, endsAt: base.startsAt + 1 }).success).toBe(false);
    expect(v.safeParse(EventCreate, { ...base, meetAt: base.startsAt - 1 }).success).toBe(false);
    expect(v.safeParse(EventUpdate, { timeTbd: true, meetAt: 1 }).success).toBe(false);
    expect(v.safeParse(EventUpdate, { timeTbd: true, type: 'training' }).success).toBe(false);
    expect(v.safeParse(EventUpdate, { timeTbd: true, meetAt: null, endsAt: null }).success).toBe(
      true,
    );
    // A patch that leaves timeTbd out doesn't touch it.
    expect(v.parse(EventUpdate, { title: 'x' }).timeTbd).toBeUndefined();
  });
  it('lets a proposal date be TBD, without meet or finish', () => {
    const o = { id: base.id, startsAt: base.startsAt, timeTbd: true };
    expect(v.safeParse(ProposalOption, o).success).toBe(true);
    expect(v.safeParse(ProposalOption, { ...o, meetAt: o.startsAt - 1 }).success).toBe(false);
    expect(v.parse(ProposalOption, { id: base.id, startsAt: 1 }).timeTbd).toBe(false);
  });
});

describe('held and kit windows', () => {
  const day = '2026-11-22';
  const tbd = {
    id: 'g',
    type: 'match' as const,
    startsAt: tbdStartsAt(day, LON),
    endsAt: null,
    timeTbd: true,
    cancelledAt: null,
    deletedAt: null,
  };
  it('a TBD game is held only once its day is over', () => {
    expect(heldEvents([tbd], null, zonedToUtc(day, '20:00', LON), LON)).toEqual([]);
    expect(heldEvents([tbd], null, zonedToUtc('2026-11-23', '00:01', LON), LON)).toHaveLength(1);
  });
  it('flags kit for a TBD event all day', () => {
    const items = [
      {
        id: 'i',
        kind: 'balls' as const,
        quantity: 1,
        status: 'with_someone' as const,
        holderMemberId: 'm',
      },
    ];
    const later = zonedToUtc(day, '15:00', LON);
    expect(atRiskKit(items, [tbd], [], later, undefined, LON)).toHaveLength(1);
    expect(
      atRiskKit(items, [tbd], [], zonedToUtc('2026-11-23', '00:01', LON), undefined, LON),
    ).toEqual([]);
  });
});
