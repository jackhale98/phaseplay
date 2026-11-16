<script lang="ts">
  type Props = {
    progress: number;
    clock: string;
    overtime?: boolean;
    paused?: boolean;
    caption?: string;
  };
  let { progress, clock, overtime = false, paused = false, caption }: Props = $props();
  const R = 46;
  const C = 2 * Math.PI * R;
  const dash = $derived(C * Math.min(1, Math.max(0, progress)));
</script>

<div class="ring" class:overtime class:paused>
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <circle class="track" cx="50" cy="50" r={R} />
    <circle class="bar" cx="50" cy="50" r={R} stroke-dasharray={C} stroke-dashoffset={dash} />
  </svg>
  <div class="mid">
    <span class="clock tnum" data-testid="countdown">{clock}</span>
    {#if caption}<span class="cap">{caption}</span>{/if}
  </div>
</div>

<style>
  .ring {
    position: relative;
    width: min(70vw, 42dvh, 340px);
    aspect-ratio: 1;
    flex: none;
  }
  svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }
  circle {
    fill: none;
    stroke-width: 6;
  }
  .track {
    stroke: var(--surface-3);
  }
  .bar {
    stroke: var(--accent);
    stroke-linecap: round;
    transition: stroke-dashoffset 300ms linear;
  }
  .overtime .bar {
    stroke: var(--warn);
  }
  .paused .bar {
    stroke: var(--text-3);
  }
  .mid {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-1);
  }
  .clock {
    font-size: clamp(3rem, 14vw, 5.5rem);
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .overtime .clock {
    color: var(--warn);
  }
  .cap {
    font-size: var(--t-12);
    font-weight: 700;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
</style>
