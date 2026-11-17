import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  EventCreate,
  atRiskKit,
  bestOption,
  defaultAnswerBy,
  frontRowCover,
  heldEvents,
  isConfirmed,
  isProposal,
  proposalCover,
  proposalTarget,
  uuidv7,
  type OptionTally,
} from '../src';

const DAY = 86400e3;

describe('front-row cover', () => {
  it('counts props and hookers, a player who does both in each', () => {
    const c = frontRowCover([[1], [3], [2], [2, 1], [9]], 3);
    expect(c).toMatchObject({ props: 3, hookers: 2, capable: 4, ok: true, short: null });
  });

  it('needs two hookers once there is a bench to cover', () => {
    const c = frontRowCover([[1], [3], [1], [3], [2]], 5);
    expect(c.ok).toBe(false);
    expect(c.short).toBe('Only 1 hooker');
    expect(frontRowCover([[1], [3], [1], [2], [2]], 5).ok).toBe(true);
  });

  it('one person cannot fill two roles at once', () => {
    // Two hookers needed and three props: four people who can each do both are not five.
    const c = frontRowCover(
      [
        [1, 2],
        [3, 2],
        [1, 2],
        [2, 3],
      ],
      5,
    );
    expect(c).toMatchObject({ props: 4, hookers: 4, ok: false });
    expect(c.short).toBe('Only 4 front-rowers (need 5)');
  });

  it('says when there is nobody', () => {
    expect(frontRowCover([], 3).short).toBe('No hooker');
    expect(frontRowCover([[2]], 3).short).toBe('No prop');
  });

  it('scales with the proposal target (Law 3)', () => {
    expect(proposalCover('15s', 23, []).need).toBe(6);
    expect(proposalCover('15s', 20, []).need).toBe(5);
    expect(proposalCover('15s', 15, []).need).toBe(3);
    expect(proposalCover('7s', 10, []).need).toBe(3);
  });
});

describe('best date', () => {
  const t = (id: string, n: number, ok: boolean | null, startsAt = 0): OptionTally => ({
    optionId: id,
    startsAt,
    in: n,
    cant: 0,
    cover: ok === null ? null : frontRowCover(ok ? [[1], [2], [3]] : [[1], [3]], 3),
  });

  it('prefers a date that meets the target with full cover', () => {
    expect(bestOption([t('a', 22, false, 1), t('b', 20, true, 2)], 20)).toBe('b');
  });
  it('otherwise the most people in, ties to the earlier date', () => {
    expect(bestOption([t('a', 12, false, 2), t('b', 14, false, 3)], 20)).toBe('b');
    expect(bestOption([t('a', 14, null, 2), t('b', 14, null, 1)], 20)).toBe('b');
  });
  it('is null when nobody is in', () => {
    expect(bestOption([t('a', 0, null), t('b', 0, null)], 20)).toBeNull();
  });
});

describe('proposal defaults', () => {
  it('answers are due in a week, or two days before the first date if sooner', () => {
    const now = Date.UTC(2026, 10, 1);
    expect(defaultAnswerBy(now, now + 30 * DAY)).toBe(now + 7 * DAY);
    expect(defaultAnswerBy(now, now + 5 * DAY)).toBe(now + 3 * DAY);
    // Tomorrow: a few hours before.
    expect(defaultAnswerBy(now, now + DAY)).toBe(now + DAY - 3 * 3600e3);
  });
  it('players needed: the override, else the team default for the format', () => {
    expect(proposalTarget({ '15s': 22, '7s': 11 }, '7s', null)).toBe(11);
    expect(proposalTarget(null, '15s', undefined)).toBe(20);
    expect(proposalTarget({ '15s': 22, '7s': 11 }, '15s', 18)).toBe(18);
  });
  it('rows cached before proposals count as confirmed', () => {
    expect(isConfirmed({})).toBe(true);
    expect(isConfirmed({ status: 'proposed' })).toBe(false);
    expect(isProposal({ status: 'proposed' })).toBe(true);
    expect(isConfirmed({ status: 'dropped' })).toBe(false);
  });
});

describe('proposal schema', () => {
  const base = { id: uuidv7(), type: 'match' as const, title: 'v Harlequins', startsAt: 1000 };
  const opt = (startsAt: number) => ({ id: uuidv7(), startsAt });
  it('accepts 1–4 dates for games and events', () => {
    expect(
      v.safeParse(EventCreate, { ...base, status: 'proposed', options: [opt(1000)] }).success,
    ).toBe(true);
    const five = [1, 2, 3, 4, 5].map((n) => opt(n * 1000));
    expect(v.safeParse(EventCreate, { ...base, status: 'proposed', options: five }).success).toBe(
      false,
    );
    expect(v.safeParse(EventCreate, { ...base, status: 'proposed' }).success).toBe(false);
  });
  it('never for practices, and dates only on proposals', () => {
    expect(
      v.safeParse(EventCreate, { ...base, type: 'training', status: 'proposed', options: [opt(1)] })
        .success,
    ).toBe(false);
    expect(v.safeParse(EventCreate, { ...base, options: [opt(1)] }).success).toBe(false);
    expect(v.parse(EventCreate, base).status).toBe('confirmed');
  });
});

describe('exclusions', () => {
  const now = Date.UTC(2026, 10, 17);
  const ev = (status: 'confirmed' | 'proposed' | 'dropped', startsAt: number) => ({
    id: status,
    type: 'match' as const,
    startsAt,
    endsAt: null,
    cancelledAt: null,
    deletedAt: null,
    status,
  });
  it('season stats only count confirmed events', () => {
    const list = [ev('confirmed', now - DAY), ev('proposed', now - DAY), ev('dropped', now - DAY)];
    expect(heldEvents(list, null, now).map((e) => e.id)).toEqual(['confirmed']);
  });
  it('kit at risk only looks at confirmed events', () => {
    const items = [
      {
        id: 'i',
        kind: 'balls' as const,
        quantity: 1,
        status: 'with_someone' as const,
        holderMemberId: 'm',
      },
    ];
    const list = [ev('confirmed', now + 3600e3), ev('proposed', now + 3600e3)];
    expect(atRiskKit(items, list, [], now).map((r) => r.eventId)).toEqual(['confirmed']);
  });
});
