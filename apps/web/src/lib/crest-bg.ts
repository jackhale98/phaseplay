/**
 * Remove a plain background from an uploaded emblem so it sits well on light and dark themes.
 * Pure (RGBA bytes in, bytes out), so it runs anywhere and is unit-tested without a DOM.
 *
 * 1. If the edges are already mostly transparent, there's nothing to do.
 * 2. Otherwise find the dominant edge colour. If the edges are busy (a photo), give up.
 * 3. Flood-fill from the edges through pixels close to that colour, making them transparent. White
 *    inside the badge isn't connected to the edge, so it stays.
 * 4. Feather the boundary: pixels part-way between the background and the badge become partly
 *    transparent, with the background colour taken out ("decontaminated"), so there's no halo.
 */
export type BgResult = {
  /** What happened: removed, already transparent, or no plain background found. */
  status: 'removed' | 'transparent' | 'busy';
  /** The background colour that was removed. */
  bg?: [number, number, number];
};

const dist = (d: Uint8ClampedArray, i: number, bg: [number, number, number]) => {
  const r = d[i]! - bg[0];
  const g = d[i + 1]! - bg[1];
  const b = d[i + 2]! - bg[2];
  return Math.sqrt(r * r + g * g + b * b);
};

function borderIndices(w: number, h: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < w; x++) out.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) out.push(y * w, y * w + w - 1);
  return out;
}

/**
 * Make the background of `data` (w×h RGBA, modified in place) transparent.
 * `tolerance` is the RGB distance still counted as background (0–441).
 */
export function removeBackground(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  tolerance = 36,
): BgResult {
  if (w < 3 || h < 3) return { status: 'busy' };
  const border = borderIndices(w, h);
  const clear = border.filter((p) => data[p * 4 + 3]! < 16).length;
  if (clear / border.length >= 0.4) return { status: 'transparent' };

  // Dominant edge colour: bucket at 4 bits per channel, then average the winning bucket.
  const buckets = new Map<number, number[]>();
  for (const p of border) {
    const i = p * 4;
    if (data[i + 3]! < 16) continue;
    const key = ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4);
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  let best: number[] = [];
  for (const list of buckets.values()) if (list.length > best.length) best = list;
  if (best.length / border.length < 0.5) return { status: 'busy' };
  const bg: [number, number, number] = [0, 0, 0];
  for (const p of best) for (let c = 0; c < 3; c++) bg[c]! += data[p * 4 + c]!;
  for (let c = 0; c < 3; c++) bg[c] = Math.round(bg[c]! / best.length);

  // Flood fill from the edges.
  const isBg = new Uint8Array(w * h);
  const stack: number[] = [];
  const near = (p: number) => data[p * 4 + 3]! < 16 || dist(data, p * 4, bg) <= tolerance;
  for (const p of border)
    if (!isBg[p] && near(p)) {
      isBg[p] = 1;
      stack.push(p);
    }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    const next = [
      x > 0 ? p - 1 : -1,
      x < w - 1 ? p + 1 : -1,
      y > 0 ? p - w : -1,
      y < h - 1 ? p + w : -1,
    ];
    for (const q of next)
      if (q >= 0 && !isBg[q] && near(q)) {
        isBg[q] = 1;
        stack.push(q);
      }
  }
  let removed = 0;
  for (let p = 0; p < w * h; p++) removed += isBg[p]!;
  // Nothing found, or the whole picture is "background" (a plain square): leave it alone.
  if (removed === 0 || removed > w * h * 0.97) return { status: 'busy' };

  // Despeckle: JPEG noise leaves lone pixels just outside the tolerance; absorb any small group
  // (≤ 2 px) that's almost entirely surrounded by background.
  for (let pass = 0; pass < 2; pass++)
    for (let p = 0; p < w * h; p++) {
      if (isBg[p]) continue;
      const x = p % w;
      const y = (p - x) / w;
      let around = 0;
      let bgAround = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          around++;
          bgAround += isBg[ny * w + nx]!;
        }
      if (around && bgAround >= around - 1) isBg[p] = 1;
    }

  // Feather pixels touching the background: treat each as a mix of the background and the most
  // distinct badge colour within 2 px, recover how much badge it holds (alpha) and take the
  // background out of its colour, so edges blend on any theme without a halo.
  const edgeOf = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && isBg[ny * w + nx]) return true;
      }
    return false;
  };
  const updates: [number, number, number, number, number][] = [];
  for (let p = 0; p < w * h; p++) {
    if (isBg[p]) continue;
    const x = p % w;
    const y = (p - x) / w;
    if (!edgeOf(x, y)) continue;
    let far = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (!isBg[q]) far = Math.max(far, dist(data, q * 4, bg));
      }
    const i = p * 4;
    const d = dist(data, i, bg);
    if (far <= tolerance || d >= far * 0.95) continue;
    const a = Math.max(0.05, d / far);
    const rgb = [0, 1, 2].map((c) => (data[i + c]! - (1 - a) * bg[c]!) / a);
    updates.push([i, rgb[0]!, rgb[1]!, rgb[2]!, Math.round(data[i + 3]! * a)]);
  }
  for (const [i, r, g, b, al] of updates) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = al;
  }
  for (let p = 0; p < w * h; p++) if (isBg[p]) data[p * 4 + 3] = 0;
  return { status: 'removed', bg };
}

/** Bounding box of pixels with alpha above `min`, or null if the image is empty. */
export function opaqueBounds(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  min = 8,
): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3]! > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
