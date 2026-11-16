<!--
  Mini pitch, our try line on the left. "pick" mode is a 4 × 3 grid of real buttons (keyboard and
  screen-reader friendly) that sets a zone at the cell centre; "show" mode plots dots.
-->
<script lang="ts">
  import { ZONE_COLS as COLS, ZONE_ROWS as ROWS, cellOf, type Zone } from './zones';

  type Dot = Zone & { kind: 'for' | 'against'; label: string };
  type Props = {
    mode: 'pick' | 'show';
    value?: Zone | null;
    dots?: Dot[];
    label: string;
  };
  let { mode, value = $bindable(null), dots = [], label }: Props = $props();

  const sel = $derived(cellOf(value));
  function pick(c: number, r: number) {
    value = value && sel?.c === c && sel?.r === r ? null : { x: COLS[c]!.x, y: ROWS[r]!.y };
  }
</script>

<div class="mp {mode}">
  <svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true" class="field">
    <rect x="0" y="0" width="100" height="60" class="grass" />
    <line x1="22" y1="0" x2="22" y2="60" />
    <line x1="50" y1="0" x2="50" y2="60" class="half" />
    <line x1="78" y1="0" x2="78" y2="60" />
    <line x1="40" y1="0" x2="40" y2="60" class="dash" />
    <line x1="60" y1="0" x2="60" y2="60" class="dash" />
    <line x1="1" y1="0" x2="1" y2="60" class="try" />
    <line x1="99" y1="0" x2="99" y2="60" class="try" />
  </svg>
  {#if mode === 'pick'}
    <div class="cells" role="group" aria-label={label}>
      {#each ROWS as r, ri (r.name)}
        {#each COLS as c, ci (c.name)}
          <button
            type="button"
            class="cell"
            aria-pressed={sel?.c === ci && sel?.r === ri && !!value}
            aria-label="{c.name}, {r.name}"
            onclick={() => pick(ci, ri)}
          >
            {#if sel?.c === ci && sel?.r === ri && value}<span class="mark"></span>{/if}
          </button>
        {/each}
      {/each}
    </div>
  {:else}
    <svg viewBox="0 0 100 60" preserveAspectRatio="none" class="dots" role="img" aria-label={label}>
      {#each dots as d, i (i)}
        {#if d.kind === 'for'}
          <circle cx={d.x * 100} cy={d.y * 60} r="2.6" class="for"><title>{d.label}</title></circle>
        {:else}
          <rect
            x={d.x * 100 - 2.3}
            y={d.y * 60 - 2.3}
            width="4.6"
            height="4.6"
            rx="0.6"
            class="against"><title>{d.label}</title></rect
          >
        {/if}
      {/each}
    </svg>
  {/if}
  <div class="ends" aria-hidden="true"><span>Our line</span><span>Their line</span></div>
</div>

<style>
  .mp {
    position: relative;
    width: 100%;
    max-width: 420px;
    aspect-ratio: 5 / 3;
    border-radius: var(--r-md);
    overflow: hidden;
  }
  .field,
  .dots,
  .cells {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .grass {
    fill: color-mix(in srgb, var(--ok) 22%, var(--surface));
  }
  line {
    stroke: color-mix(in srgb, var(--text) 30%, transparent);
    stroke-width: 0.5;
    vector-effect: non-scaling-stroke;
  }
  .half {
    stroke-width: 1.2;
  }
  .dash {
    stroke-dasharray: 3 3;
  }
  .try {
    stroke-width: 2;
  }
  .cells {
    display: grid;
    grid-template-columns: 22fr 28fr 28fr 22fr;
    grid-template-rows: repeat(3, 1fr);
  }
  .cell {
    position: relative;
    border: 0;
    border-radius: 0;
    background: transparent;
    min-height: 44px;
    outline-offset: -3px;
  }
  .cell:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }
  .cell[aria-pressed='true'] {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .mark {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--surface);
  }
  .for {
    fill: var(--viz-us);
    stroke: var(--surface);
    stroke-width: 0.6;
  }
  .against {
    fill: var(--viz-them);
    stroke: var(--surface);
    stroke-width: 0.6;
  }
  .ends {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 2px;
    display: flex;
    justify-content: space-between;
    padding: 0 6px;
    pointer-events: none;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text);
  }
</style>
