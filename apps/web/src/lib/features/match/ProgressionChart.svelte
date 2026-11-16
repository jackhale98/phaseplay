<!--
  Score progression: two step lines on one shared y-axis. Identity is never colour alone (the
  opponent line is dashed with square markers, both lines are direct-labelled and there is a
  legend), every scoring point has a hover/focus tooltip, and a data table is one tap away.
-->
<script lang="ts">
  import { formatClock } from '@phaseplay/shared';

  type Pt = { gameMs: number; us: number; them: number };
  type Props = {
    points: Pt[];
    endMs: number;
    halfMs: number;
    offset?: number;
    us: string;
    them: string;
  };
  let { points, endMs, halfMs, offset = 0, us, them }: Props = $props();

  let w = $state(600);
  const H = 220;
  const narrow = $derived(w < 520);
  const M = $derived({ l: 32, r: narrow ? 36 : 120, t: 12, b: 28 });
  const short = (t: string) => (t.length > 14 ? `${t.slice(0, 13)}…` : t);

  const span = $derived(Math.max(endMs - offset, 2 * halfMs, 60e3));
  const top = $derived(Math.max(10, ...points.map((p) => Math.max(p.us, p.them))));
  const yMax = $derived(Math.ceil(top / 10) * 10);
  const x = (ms: number) => M.l + ((ms - offset) / span) * (w - M.l - M.r);
  const y = (v: number) => M.t + (1 - v / yMax) * (H - M.t - M.b);
  const yTicks = $derived(Array.from({ length: yMax / 10 + 1 }, (_, i) => i * 10));
  const step = $derived(halfMs >= 20 * 60e3 ? 10 * 60e3 : 2 * 60e3);
  const xTicks = $derived(
    Array.from({ length: Math.floor(span / step) + 1 }, (_, i) => offset + i * step),
  );

  function path(key: 'us' | 'them') {
    let d = `M${x(offset)},${y(0)}`;
    let prev = 0;
    for (const p of points) {
      if (p[key] === prev) continue;
      d += ` H${x(p.gameMs)} V${y(p[key])}`;
      prev = p[key];
    }
    return d + ` H${x(offset + span)}`;
  }
  const final = $derived(points.at(-1) ?? { us: 0, them: 0, gameMs: 0 });
  const changes = $derived(
    points.map((p, i) => {
      const before = points[i - 1] ?? { us: 0, them: 0 };
      return { ...p, who: p.us !== before.us ? ('us' as const) : ('them' as const) };
    }),
  );
  // Keep end labels apart when the scores are close.
  const labelY = $derived.by(() => {
    let a = y(final.us);
    let b = y(final.them);
    if (Math.abs(a - b) < 16) {
      const mid = (a + b) / 2;
      const up = final.us >= final.them;
      a = mid + (up ? -9 : 9);
      b = mid + (up ? 9 : -9);
    }
    return { us: a, them: b };
  });
  let hover = $state<number | null>(null);
  const hp = $derived(hover === null ? null : changes[hover]);
</script>

<figure class="pc">
  <div class="legend" aria-hidden="true">
    <span><i class="sw us"></i>{us}</span>
    <span><i class="sw them"></i>{them}</span>
  </div>
  <div class="plot" bind:clientWidth={w}>
    <svg
      width={w}
      height={H}
      role="img"
      aria-label="Score progression. Final score {us} {final.us}, {them} {final.them}. Table below."
    >
      {#each yTicks as t (t)}
        <line class="grid" x1={M.l} x2={w - M.r} y1={y(t)} y2={y(t)} />
        <text class="ax" x={M.l - 6} y={y(t)} dy="0.32em" text-anchor="end">{t}</text>
      {/each}
      {#each xTicks as t (t)}
        <text class="ax" x={x(t)} y={H - 8} text-anchor="middle"
          >{Math.round((t - offset) / 60e3)}'</text
        >
      {/each}
      <line class="ht" x1={x(offset + halfMs)} x2={x(offset + halfMs)} y1={M.t} y2={H - M.b} />
      <text class="ax" x={x(offset + halfMs) + 4} y={M.t + 10}>HT</text>
      <path class="ln them" d={path('them')} />
      <path class="ln us" d={path('us')} />
      {#each changes as p, i (i)}
        {#if p.who === 'us'}
          <circle class="pt us" cx={x(p.gameMs)} cy={y(p.us)} r="4" />
        {:else}
          <rect class="pt them" x={x(p.gameMs) - 4} y={y(p.them) - 4} width="8" height="8" rx="1" />
        {/if}
        <rect
          class="hit"
          x={x(p.gameMs) - 12}
          y={M.t}
          width="24"
          height={H - M.t - M.b}
          role="presentation"
          onpointerenter={() => (hover = i)}
          onpointerleave={() => (hover = null)}
        />
      {/each}
      <text class="end" x={w - M.r + 8} y={labelY.us} dy="0.32em">{narrow ? '' : `${short(us)} `}{final.us}</text>
      <text class="end" x={w - M.r + 8} y={labelY.them} dy="0.32em">{narrow ? '' : `${short(them)} `}{final.them}</text>
      {#if hp}
        <line class="cross" x1={x(hp.gameMs)} x2={x(hp.gameMs)} y1={M.t} y2={H - M.b} />
      {/if}
    </svg>
    {#if hp}
      <div class="tip" style:left="{Math.min(x(hp.gameMs), w - 150)}px">
        <strong class="tnum">{formatClock(hp.gameMs - offset)}</strong>
        <span class="tnum">{us} {hp.us} · {them} {hp.them}</span>
      </div>
    {/if}
  </div>
  <details>
    <summary>Show as a table</summary>
    <table>
      <caption class="sr-only">Score after each scoring play</caption>
      <thead
        ><tr><th scope="col">Time</th><th scope="col">{us}</th><th scope="col">{them}</th></tr
        ></thead
      >
      <tbody>
        {#each points as p, i (i)}
          <tr
            ><td class="tnum">{formatClock(p.gameMs - offset)}</td><td class="tnum">{p.us}</td><td
              class="tnum">{p.them}</td
            ></tr
          >
        {:else}
          <tr><td colspan="3">No points yet</td></tr>
        {/each}
      </tbody>
    </table>
  </details>
</figure>

<style>
  .pc {
    margin: 0;
  }
  .legend {
    display: flex;
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
    width: 22px;
    height: 0;
    border-top: 2px solid var(--viz-us);
  }
  .sw.them {
    border-top: 2px dashed var(--viz-them);
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
  .ht {
    stroke: var(--border-strong);
    stroke-dasharray: 2 3;
  }
  .ln {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .ln.us {
    stroke: var(--viz-us);
  }
  .ln.them {
    stroke: var(--viz-them);
    stroke-dasharray: 6 4;
  }
  .pt {
    stroke: var(--surface);
    stroke-width: 2;
  }
  .pt.us {
    fill: var(--viz-us);
  }
  .pt.them {
    fill: var(--viz-them);
  }
  .hit {
    fill: transparent;
  }
  .cross {
    stroke: var(--text-3);
    stroke-width: 1;
  }
  .end {
    fill: var(--text);
    font-size: 12px;
    font-weight: 750;
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
  }
  details {
    margin-top: var(--s-2);
    font-size: var(--t-14);
  }
  summary {
    cursor: pointer;
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    color: var(--accent-text);
    font-weight: 650;
  }
  table {
    width: 100%;
    max-width: 360px;
    border-collapse: collapse;
    margin-top: var(--s-2);
  }
  th,
  td {
    text-align: left;
    padding: var(--s-1) var(--s-2);
    border-bottom: 1px solid var(--border);
  }
</style>
