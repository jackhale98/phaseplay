import { describe, expect, it } from 'vitest';
import { opaqueBounds, removeBackground } from './crest-bg';

type RGBA = [number, number, number, number];
function image(w: number, h: number, at: (x: number, y: number) => RGBA) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(at(x, y), (y * w + x) * 4);
  return d;
}
const px = (d: Uint8ClampedArray, w: number, x: number, y: number) =>
  Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

const WHITE: RGBA = [255, 255, 255, 255];
const GREEN: RGBA = [31, 111, 67, 255];

describe('emblem background removal', () => {
  it('clears a plain white background but keeps white inside the badge', () => {
    // 20×20 white; a green ring from 4..15 with a white centre 8..11 (enclosed by green).
    const w = 20;
    const d = image(w, w, (x, y) => {
      const inRing = x >= 4 && x <= 15 && y >= 4 && y <= 15;
      const inCentre = x >= 8 && x <= 11 && y >= 8 && y <= 11;
      return inRing && !inCentre ? GREEN : WHITE;
    });
    const r = removeBackground(d, w, w);
    expect(r.status).toBe('removed');
    expect(r.bg).toEqual([255, 255, 255]);
    expect(px(d, w, 0, 0)[3]).toBe(0);
    expect(px(d, w, 2, 10)[3]).toBe(0);
    expect(px(d, w, 6, 6)).toEqual(GREEN); // badge
    expect(px(d, w, 10, 10)).toEqual(WHITE); // enclosed white stays
    expect(opaqueBounds(d, w, w)).toEqual({ x: 4, y: 4, w: 12, h: 12 });
  });

  it('removes a coloured background too, within tolerance (JPEG noise)', () => {
    const w = 16;
    const d = image(w, w, (x, y) =>
      x >= 5 && x <= 10 && y >= 5 && y <= 10
        ? [250, 200, 0, 255]
        : [12 + (x % 3), 40, 90 - (y % 4), 255],
    );
    expect(removeBackground(d, w, w).status).toBe('removed');
    expect(px(d, w, 1, 1)[3]).toBe(0);
    expect(px(d, w, 7, 7)[3]).toBe(255);
  });

  it('feathers anti-aliased edges without a light halo', () => {
    const w = 12;
    // A grey pixel halfway between white and green, between the badge and the background.
    const mid: RGBA = [143, 183, 161, 255];
    const d = image(w, w, (x, y) =>
      x >= 4 && x <= 7 && y >= 4 && y <= 7 ? GREEN : x === 3 && y >= 4 && y <= 7 ? mid : WHITE,
    );
    removeBackground(d, w, w);
    const [r, g, b, a] = px(d, w, 3, 5);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
    // Decontaminated towards the badge colour, not left whitish.
    expect(Math.abs(r! - 31)).toBeLessThan(40);
    expect(Math.abs(g! - 111)).toBeLessThan(40);
    expect(Math.abs(b! - 67)).toBeLessThan(40);
  });

  it('leaves transparent images and busy photos alone', () => {
    const w = 10;
    const clear = image(w, w, (x, y) => (x > 2 && x < 7 && y > 2 && y < 7 ? GREEN : [0, 0, 0, 0]));
    expect(removeBackground(clear, w, w).status).toBe('transparent');
    let seed = 7;
    const noise = image(w, w, () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return [seed % 256, (seed >> 8) % 256, (seed >> 16) % 256, 255];
    });
    const before = noise.slice();
    expect(removeBackground(noise, w, w).status).toBe('busy');
    expect(noise).toEqual(before);
  });

  it('does not erase a plain square that is all one colour', () => {
    const w = 8;
    const d = image(w, w, () => GREEN);
    expect(removeBackground(d, w, w).status).toBe('busy');
    expect(px(d, w, 3, 3)[3]).toBe(255);
  });
});
