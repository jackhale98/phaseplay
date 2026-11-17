<!--
  Bars per category on one shared y-axis (one or two series, grouped). Same conventions as the
  match summary's score progression: series identity is never colour alone (fixed order, legend,
  the second series is hatched), a hover tooltip per category (Esc dismisses it), and a data
  table one tap away.
-->
<script lang="ts">
  type Series = { key: string; label: string; values: number[] };
  type Cat = { label: string; title: string };
  type Props = {
    categories: Cat[];
    series: Series[];
    /** Appended to values, e.g. "'" for minutes. */
    unit?: string;
    /** Names the chart for screen readers; the table carries the numbers. */
    summary: string;
    caption: string;
    /** Heading of the category column in the table. */
    catHeading: string;
    /** Optional dashed reference line (e.g. the average), with its label. */
    ref?: { value: number; label: string } | null;
  };
  let { categories, series, unit = '', summary, caption, catHeading, ref = null }: Props = $props();

  let w = $state(600);
  const H = 200;
  const M = { l: 30, r: 8, t: 14, b: 26 };
  const n = $derived(Math.max(1, categories.length));
  const top = $derived(Math.max(1, ref?.value ?? 0, ...series.flatMap((s) => s.values)));
  const step = $derived(niceStep(top / 4));
  const yMax = $derived(Math.ceil(top / step) * step);
  const yTicks = $derived(Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step));
  const plotW = $derived(Math.max(40, w - M.l - M.r));
  const gw = $derived(plotW / n);
  const bw = $derived(Math.max(3, Math.min(22, (gw - 6) / series.length - 2)));
  const y = (v: number) => M.t + (1 - v / yMax) * (H - M.t - M.b);
  const gx = (i: number) => M.l + i * gw + gw / 2 - (series.length * (bw + 2) - 2) / 2;
  // Thin out x labels so they never collide (about 44px each).
  const every = $derived(Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 44)))));

  function niceStep(raw: number) {
    if (raw <= 1) return 1;
    const p = 10 ** Math.floor(Math.log10(raw));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  /** A bar anchored to the baseline with a rounded data end. */
  function bar(x: number, v: number) {
    const y0 = y(0);
    const y1 = y(v);
    const h = y0 - y1;
    if (h <= 0) return '';
    const r = Math.min(4, h, bw / 2);
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y0} Z`;
  }
  let hover = $state<number | null>(null);
  const hc = $derived(hover === null ? undefined : categories[hover]);
  const fmt = (v: number) => `${Math.round(v * 10) / 10}${unit}`;
  const uid = $props.id();
</script>

<!-- Hover tooltips can be dismissed without moving the pointer (WCAG 1.4.13). -->
<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') hover = null;
  }}
/>

<figure class="bc">
  {#if series.length > 1}
    <div class="legend" aria-hidden="true">
      {#each series as s, i (s.key)}<span><i class="sw s{i}"></i>{s.label}</span>{/each}
    </div>
  {/if}
  <div class="plot" bind:clientWidth={w}>
    <svg width={w} height={H} role="img" aria-label="{summary} Table below.">
      <defs>
        <pattern
          id="hatch-{uid}"
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="5" height="5" class="s1f" />
          <line x1="0" y1="0" x2="0" y2="5" class="hl" />
        </pattern>
      </defs>
      {#each yTicks as t (t)}
        <line class="grid" x1={M.l} x2={w - M.r} y1={y(t)} y2={y(t)} />
        <text class="ax" x={M.l - 6} y={y(t)} dy="0.32em" text-anchor="end">{t}</text>
      {/each}
      {#each categories as c, i (i)}
        {#if i % every === 0}
          <text class="ax" x={M.l + i * gw + gw / 2} y={H - 8} text-anchor="middle">{c.label}</text>
        {/if}
        {#each series as s, k (s.key)}
          <path
            class="b s{k}"
            d={bar(gx(i) + k * (bw + 2), s.values[i] ?? 0)}
            fill={k === 1 ? `url(#hatch-${uid})` : undefined}
          />
        {/each}
        <rect
          class="hit"
          x={M.l + i * gw}
          y={M.t}
          width={gw}
          height={H - M.t - M.b}
          role="presentation"
          onpointerenter={() => (hover = i)}
          onpointerleave={() => (hover = null)}
        />
      {/each}
      {#if ref}
        <line class="ref" x1={M.l} x2={w - M.r} y1={y(ref.value)} y2={y(ref.value)} />
        <text class="ax rl" x={w - M.r} y={y(ref.value) - 4} text-anchor="end">{ref.label}</text>
      {/if}
      {#if hover !== null}
        <rect class="hl-bg" x={M.l + hover * gw} y={M.t} width={gw} height={H - M.t - M.b} />
      {/if}
    </svg>
    {#if hover !== null && hc}
      <div class="tip" style:left="{Math.max(0, Math.min(M.l + hover * gw, w - 170))}px">
        <strong>{hc.title}</strong>
        {#each series as s (s.key)}<span class="tnum">{s.label}: {fmt(s.values[hover] ?? 0)}</span
          >{/each}
      </div>
    {/if}
  </div>
  <details>
    <summary>Show as a table</summary>
    <div>
      <table>
        <caption class="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{catHeading}</th>
            {#each series as s (s.key)}<th scope="col">{s.label}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each categories as c, i (i)}
            <tr>
              <th scope="row">{c.title}</th>
              {#each series as s (s.key)}<td class="tnum">{fmt(s.values[i] ?? 0)}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</figure>

<style>
  .bc {
    margin: 0;
    min-width: 0;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-4);
    margin-bottom: var(--s-2);
    font-size: var(--t-12);
    font-weight: 650;
    color: var(--text-2);
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--viz-1);
  }
  .sw.s1 {
    background: repeating-linear-gradient(
      45deg,
      var(--viz-2) 0 3px,
      color-mix(in srgb, var(--viz-2) 55%, var(--surface)) 3px 5px
    );
  }
  .plot {
    position: relative;
    width: 100%;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: var(--border);
    stroke-width: 1;
  }
  .ax {
    fill: var(--text-3);
    font-size: 11px;
    font-weight: 600;
  }
  .rl {
    fill: var(--text-2);
  }
  .b.s0 {
    fill: var(--viz-1);
  }
  .s1f {
    fill: var(--viz-2);
  }
  .hl {
    stroke: color-mix(in srgb, var(--viz-2) 55%, var(--surface));
    stroke-width: 2;
  }
  .ref {
    stroke: var(--text-2);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
  }
  .hit {
    fill: transparent;
  }
  .hl-bg {
    fill: var(--text);
    opacity: 0.05;
    pointer-events: none;
  }
  .tip {
    position: absolute;
    top: 0;
    display: flex;
    flex-direction: column;
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-sm);
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--e-2);
    font-size: var(--t-12);
    pointer-events: none;
    white-space: nowrap;
    z-index: 1;
  }
  details {
    margin-top: var(--s-2);
    font-size: var(--t-14);
  }
  summary {
    cursor: pointer;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    color: var(--accent-text);
    font-weight: 650;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: right;
    padding: var(--s-1) var(--s-2);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  th:first-child {
    text-align: left;
  }
  thead th {
    color: var(--text-3);
    font-size: var(--t-12);
  }
  tbody th {
    font-weight: 600;
    white-space: normal;
  }
</style>
