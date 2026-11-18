import { describe, expect, it } from 'vitest';
import { MEDIA_MAX_PX } from '@phaseplay/shared';
import { encodePlan, fitSize, isHeic, precheck } from './compress';

const file = (name: string, type: string, size = 1000) => ({ name, type, size }) as unknown as File;

describe('fitSize', () => {
  it('fits the longest side and never enlarges', () => {
    expect(fitSize(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(10000, 1, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe('encodePlan', () => {
  it('steps quality down first, then size, and stops at a readable minimum', () => {
    const plan = encodePlan(4032);
    expect(plan.slice(0, 3)).toEqual([
      { px: MEDIA_MAX_PX, q: 0.8 },
      { px: MEDIA_MAX_PX, q: 0.7 },
      { px: MEDIA_MAX_PX, q: 0.6 },
    ]);
    expect(plan[3]!.px).toBeLessThan(MEDIA_MAX_PX);
    expect(Math.min(...plan.map((p) => p.px))).toBe(900);
    for (let i = 1; i < plan.length; i++) expect(plan[i]!.px).toBeLessThanOrEqual(plan[i - 1]!.px);
  });
  it('small pictures are only re-encoded, never shrunk below their size', () => {
    expect(encodePlan(640).every((p) => p.px === 640)).toBe(true);
  });
});

describe('precheck', () => {
  it('turns away SVG, GIF and non-images with a friendly message', () => {
    expect(precheck(file('diagram.svg', 'image/svg+xml'))).toMatch(/SVG/);
    expect(precheck(file('anim.gif', 'image/gif'))).toMatch(/GIF/);
    expect(precheck(file('notes.pdf', 'application/pdf'))).toMatch(/isn’t a picture/);
    expect(precheck(file('huge.jpg', 'image/jpeg', 50 * 1024 * 1024))).toMatch(/large/);
  });
  it('lets photos through, including HEIC (decoded where the browser can)', () => {
    expect(precheck(file('IMG_0001.HEIC', ''))).toBeNull();
    expect(precheck(file('IMG_0001.heic', 'image/heic'))).toBeNull();
    expect(precheck(file('board.jpg', 'image/jpeg'))).toBeNull();
    expect(isHeic(file('IMG_0001.HEIC', ''))).toBe(true);
    expect(isHeic(file('a.png', 'image/png'))).toBe(false);
  });
});
