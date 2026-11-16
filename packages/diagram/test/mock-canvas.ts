/** A recording 2D context and canvas factory for tests (no jsdom / node-canvas). */
import type { CanvasFactory, CanvasLike, Ctx2D } from '../src/canvas';

export type Call = { name: string; args: unknown[] };

export function mockContext(calls: Call[] = []): {
  ctx: Ctx2D;
  calls: Call[];
  props: Record<string, unknown>;
} {
  const props: Record<string, unknown> = {};
  const gradient = { addColorStop: () => {} };
  const handler: ProxyHandler<object> = {
    get(_t, key) {
      if (typeof key === 'symbol') return undefined;
      if (key in props) return props[key];
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
        for (const a of args)
          if (typeof a === 'number' && !Number.isFinite(a))
            throw new Error(`Non-finite argument to ${key}: ${args.join(',')}`);
        if (key === 'measureText') return { width: String(args[0] ?? '').length * 10 };
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return gradient;
        if (key === 'getImageData')
          return {
            data: new Uint8ClampedArray(4 * (args[2] as number) * (args[3] as number)),
            width: args[2],
            height: args[3],
          };
        if (key === 'getLineDash') return [];
        return undefined;
      };
    },
    set(_t, key, value) {
      if (typeof key === 'string') {
        props[key] = value;
        calls.push({ name: `set:${key}`, args: [value] });
      }
      return true;
    },
  };
  return { ctx: new Proxy({}, handler) as unknown as Ctx2D, calls, props };
}

export type MockCanvas = CanvasLike & { calls: Call[] };

/** A factory that records every canvas it creates. */
export function mockFactory(): { factory: CanvasFactory; created: MockCanvas[] } {
  const created: MockCanvas[] = [];
  const factory: CanvasFactory = (width, height) => {
    const { ctx, calls } = mockContext();
    const c: MockCanvas = {
      width,
      height,
      calls,
      getContext: () => ctx,
      convertToBlob: async (o) =>
        new Blob([`png:${width}x${height}`], { type: o?.type ?? 'image/png' }),
    };
    created.push(c);
    return c;
  };
  return { factory, created };
}
